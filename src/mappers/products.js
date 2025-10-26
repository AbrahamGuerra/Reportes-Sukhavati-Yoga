import crypto from 'crypto'
import XLSX from 'xlsx'
import { query } from '../DB/db.js'

function normalizeString(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function buildIngestSig(row) {
  const base = [
    String(row.producto?.toLowerCase() ?? ''),
    String(row.tipo?.toLowerCase() ?? ''),
    String(row.precio ?? ''),
    String(row.pago?.toLowerCase() ?? ''),
  ].join('|')
  return crypto.createHash('md5').update(base, 'utf8').digest('hex')
}

const MAP = {
  'Producto': 'producto',
  'Precio': 'precio',
  'Tipo': 'tipo',
  'Pago': 'pago',
  'Características': 'caracteristicas',
  'Suscritos': 'suscritos',
  'Stock': 'stock',
  'Disponibilidad': 'disponibilidad',
}

function mapRow(raw) {
  const r = {}
  for (const [src, dst] of Object.entries(MAP)) {
    if (!(src in raw)) continue
    let v = raw[src]
    v = normalizeString(v)
    r[dst] = v
  }
  if (r.producto) r.producto = r.producto.trim()
  if (r.tipo) r.tipo = r.tipo.trim().toLowerCase()
  if (r.disponibilidad) r.disponibilidad = r.disponibilidad.trim().toLowerCase()
  return r
}

export async function upsertProductsRows(rows, { schema='reportes_sukhavati', table='productos' } = {}) {
  if (!rows?.length) return { inserted: 0, updated: 0 }
  const allowed = ['producto','precio','tipo','pago','caracteristicas','suscritos','stock','disponibilidad']

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

export async function upsertProductsFromXlsx(xlsxPathOrBuffer, { sheet='Export', schema='reportes_sukhavati' } = {}) {
  const wb = typeof xlsxPathOrBuffer === 'string'
    ? XLSX.readFile(xlsxPathOrBuffer, { cellDates: true })
    : XLSX.read(xlsxPathOrBuffer, { type: 'buffer', cellDates: true })

  let ws = wb.Sheets[sheet]
  if (!ws) ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null })

    const expectedHeaders = [
    'Producto',
    'Precio',
    'Tipo',
    'Pago',
    'Características',
    'Suscritos',
    'Stock',
    'Disponibilidad'
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
  
  return upsertProductsRows(rawRows, { schema, table: 'productos' })
}