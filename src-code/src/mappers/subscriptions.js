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

function normalizeString(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function buildIngestSig(row) {
  const base = [
    String(row.id_suscripcion?.toLowerCase() ?? ''),
    String(row.nombre?.toLowerCase() ?? ''),
    String(row.apellidos?.toLowerCase() ?? ''),
    String(row.producto?.toLowerCase() ?? ''),
    String(row.fecha_de_inicio ?? ''),
  ].join('|')
  return crypto.createHash('md5').update(base, 'utf8').digest('hex')
}

const MAP = {
  'Nombre': 'nombre',
  'Apellidos': 'apellidos',
  'Producto': 'producto',
  'Precio': 'precio',
  'Método de pago': 'metodo_de_pago',
  'Periodicidad': 'periodicidad',
  'Sesiones disponibles': 'sesiones_disponibles',
  'Fecha de inicio': 'fecha_de_inicio',
  'Próximo pago': 'proximo_pago',
  'Fecha de fin': 'fecha_de_fin',
  'Estado': 'estado',
  'Empleado': 'empleado',
  'Id. Suscripción': 'id_suscripcion',
}

function mapRow(raw) {
  const r = {}
  for (const [src, dst] of Object.entries(MAP)) {
    if (!(src in raw)) continue
    let v = raw[src]
    switch (dst) {
      case 'fecha_de_inicio':
      case 'fecha_de_fin':
        v = parseDateLike(v)
        break
      default:
        v = normalizeString(v)
        break
    }
    r[dst] = v
  }
  if (r.nombre) r.nombre = r.nombre.trim()
  if (r.apellidos) r.apellidos = r.apellidos.trim()
  if (r.estado) r.estado = r.estado.trim().toLowerCase()
  return r
}

export async function upsertSubscriptionsRows(rows, { schema='reportes_sukhavati', table='suscripciones' } = {}) {
  if (!rows?.length) return { inserted: 0, updated: 0 }
  const allowed = ['nombre','apellidos','producto','precio','metodo_de_pago','periodicidad','sesiones_disponibles','fecha_de_inicio','proximo_pago','fecha_de_fin','estado','empleado','id_suscripcion']

  const mapped = rows.map(mapRow).map(r => ({ ...r, ingest_sig: buildIngestSig(r) }))

  const seen = new Set()
  const deduped = []
  for (const r of mapped) {
    const sig = r.ingest_sig
    if (!sig || seen.has(sig)) continue
    deduped.push(r); seen.add(sig)
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

export async function upsertSubscriptionsFromXlsx(xlsxPathOrBuffer, { sheet=null, schema='reportes_sukhavati' } = {}) {
  const wb = typeof xlsxPathOrBuffer === 'string'
    ? XLSX.readFile(xlsxPathOrBuffer, { cellDates: true })
    : XLSX.read(xlsxPathOrBuffer, { type: 'buffer', cellDates: true })

  let ws = sheet ? wb.Sheets[sheet] : null
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null })

  const expectedHeaders = [
    'Nombre',
    'Apellidos',
    'Producto',
    'Precio',
    'Método de pago',
    'Periodicidad',
    'Sesiones disponibles',
    'Fecha de inicio',
    'Próximo pago',
    'Fecha de fin',
    'Estado',
    'Empleado',
    'Id. Suscripción'
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

  return upsertSubscriptionsRows(rawRows, { schema, table: 'suscripciones' })
}