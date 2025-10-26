import crypto from 'crypto'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import XLSX from 'xlsx'
import { query } from '../DB/db.js'

dayjs.extend(customParseFormat)

const DATE_PATTERNS = ['DD/MM/YYYY','YYYY-MM-DD','DD-MM-YYYY','DD/MM/YYYY HH:mm','YYYY-MM-DD HH:mm:ss']

function parseDateLike(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return isNaN(value) ? null : value
  const s = String(value).trim()
  if (!s) return null
  for (const fmt of DATE_PATTERNS) {
    const d = dayjs(s, fmt, true)
    if (d.isValid()) return d.toDate()
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t) : null
}

function onlyDigits(s) {
  const m = String(s ?? '').match(/\d+/g)
  return m ? m.join('') : null
}

function buildIngestSig(row) {
  const parts = []
  for (const k of ['id_socio','id_socio_externo','email','nif']) {
    parts.push(String(row[k]?.toLowerCase() ?? ''))
  }
  if (!parts.some(x => x)) {
    parts.push(String(row.socio?.toLowerCase() ?? ''))
    parts.push(String(row.fecha_de_nacimiento ?? ''))
  }
  const base = parts.join('|')
  return crypto.createHash('md5').update(base, 'utf8').digest('hex')
}

const MAP = {
  'Id Socio': 'id_socio',
  'Id Socio Externo': 'id_socio_externo',
  'Socio': 'socio',
  'Fecha de nacimiento': 'fecha_de_nacimiento',
  'Nif': 'nif',
  'email': 'email',
  'Móvil': 'movil',
  'Dirección': 'direccion',
  'Ciudad': 'ciudad',
  'Código postal': 'codigo_postal',
  'Fecha de Alta': 'fecha_de_alta',
  'Fecha de baja': 'fecha_de_baja',
  'Sexo': 'sexo',
  'Grupo Socio': 'grupo_socio',
  'Perfil Socio': 'perfil_socio',
}

function mapRow(raw) {
  const r = {}
  for (const [src, dst] of Object.entries(MAP)) {
    if (!(src in raw)) continue
    let v = raw[src]
    switch (dst) {
      case 'fecha_de_nacimiento':
      case 'fecha_de_alta':
        v = parseDateLike(v)
        break
      case 'codigo_postal':
        v = onlyDigits(v)
        v = v ? Number(v) : null
        break
      default:
        v = v === '' ? null : v
        break
    }
    r[dst] = v
  }
  if (r.email) r.email = String(r.email).trim().toLowerCase()
  if (r.nif) r.nif = String(r.nif).trim().toUpperCase()
  return r
}

export async function upsertPartnersRows(rows, { schema='reportes_sukhavati', table='socios' } = {}) {
  if (!rows?.length) return { inserted: 0, updated: 0 }

  const allowed = ['id_socio','id_socio_externo','socio','fecha_de_nacimiento','nif','email','movil','direccion','ciudad','codigo_postal','fecha_de_alta','fecha_de_baja','sexo','grupo_socio','perfil_socio']
  const mapped = rows.map(mapRow).map(r => ({ ...r, ingest_sig: buildIngestSig(r) }))

  const seen = new Set()
  const deduped = []
  for (const r of mapped) {
    if (!r.ingest_sig || seen.has(r.ingest_sig)) continue
    deduped.push(r); seen.add(r.ingest_sig)
  }
  if (!deduped.length) return { inserted: 0, updated: 0 }

  const cols = [...allowed, 'ingest_sig']
  const setUpdates = allowed.map(
    c => `"${c}" = CASE WHEN EXCLUDED."${c}" IS NOT NULL AND (EXCLUDED."${c}"::text IS DISTINCT FROM ''::text) THEN EXCLUDED."${c}" ELSE "${table}"."${c}" END`
  ).join(', ')

  const CHUNK = 300
  let inserted = 0, updated = 0
  for (let i=0; i<deduped.length; i+=CHUNK) {
    const chunk = deduped.slice(i, i+CHUNK)
    const params = []
    const valuesSql = chunk.map((row, ridx) => {
      cols.forEach(c => params.push(row[c] ?? null))
      const ph = cols.map((_, j) => `$${ridx * cols.length + j + 1}`)
      return `(${ph.join(',')})`
    }).join(',')

    const colsSql = cols.map(c => `"${c}"`).join(', ')
    const sql = `
      INSERT INTO ${schema}.${table} (${colsSql})
      VALUES ${valuesSql}
      ON CONFLICT ("ingest_sig")
      DO UPDATE SET ${setUpdates}
      RETURNING (xmax = 0) AS inserted
    `
    const { rows: ret } = await query(sql, params)
    for (const r of ret) (r.inserted ? inserted++ : updated++)
  }
  return { inserted, updated }
}

export async function upsertPartnersFromXlsx(xlsxPathOrBuffer, { sheet=null, schema='reportes_sukhavati' } = {}) {
  const wb = typeof xlsxPathOrBuffer === 'string'
    ? XLSX.readFile(xlsxPathOrBuffer, { cellDates: true })
    : XLSX.read(xlsxPathOrBuffer, { type: 'buffer', cellDates: true })

  let ws = sheet ? wb.Sheets[sheet] : null
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null })

  const expectedHeaders = [
    'Id Socio',
    'Id Socio Externo',
    'Socio',
    'Fecha de nacimiento',
    'Nif',
    'email',
    'Móvil',
    'Dirección',
    'Ciudad',
    'Código postal',
    'Fecha de Alta',
    'Fecha de baja',
    'Sexo',
    'Grupo Socio',
    'Perfil Socio'
  ]

  const headersFromFile = Object.keys(rawRows[0] || {})

  const missingHeaders = expectedHeaders.filter(h => !headersFromFile.includes(h))
  const extraHeaders = headersFromFile.filter(h => !expectedHeaders.includes(h))

  if (missingHeaders.length > 0 || extraHeaders.length > 0) {
    return {
      ok: false,
      error: 'Estructura de archivo inválida',
      missingHeaders,
      extraHeaders
    }
  }

  return upsertPartnersRows(rawRows, { schema, table: 'socios' })
}

