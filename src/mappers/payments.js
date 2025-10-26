import XLSX from 'xlsx'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import crypto from 'crypto'
import { query } from '../DB/db.js'

dayjs.extend(customParseFormat)

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normText(s) {
  if (s == null) return ''
  return stripDiacritics(String(s).trim().replace(/\s+/g, ' ')).toLowerCase()
}

const norm = (s = '') =>
  stripDiacritics(String(s).toLowerCase())
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')

const REPO_KEYS = new Set([
  'bruto','cod_autorizacion','id_transaccion','id_cargo',
  'subtotal','impuesto','impuesto_porcentaje','total',
  'centro','canal','factura','producto','metodo_de_pago','método_de_pago'
])

const HIST_KEYS = new Set([
  'concepto','tipo_producto','tipo','precio','cantidad',
  'descuento','cupon_codigo','cupon_porcentaje','cupon_monto',
  'tipo_metodo_de_pago','tipo_de_tarjeta','tarjeta','no_de_tarjeta',
  'origen_de_pago','estado','facturado','notas','id_suscripcion',
  'nombre','apellidos'
])

function scoreHeaders(headers = [], kindSet) {
  let score = 0
  for (const h of headers) if (kindSet.has(norm(h))) score++
  return score
}

function classifyByHeaders(rows) {
  if (!rows || !rows.length) return { type: 'unknown', headers: [] }
  const headers = Object.keys(rows[0]).map(norm)

  let repScore = scoreHeaders(headers, REPO_KEYS)
  let hisScore = scoreHeaders(headers, HIST_KEYS)

  if (headers.includes('producto')) repScore += 2
  if (headers.includes('concepto')) hisScore += 2
  if (headers.includes('bruto')) repScore += 2
  if (headers.includes('id_transaccion') || headers.includes('cod_autorizacion')) repScore += 1
  if (headers.includes('nombre') || headers.includes('apellidos')) hisScore += 1

  const type = repScore === hisScore
    ? 'unknown'
    : (repScore > hisScore ? 'reporte' : 'historico')

  return { type, headers, repScore, hisScore }
}

function classifyByFilename(name='') {
  const n = norm(name)
  if (/reporte|reportes|pagos|reporte_pagos/.test(n)) return 'reporte'
  if (/historico|historial/.test(n)) return 'historico'
  return 'unknown'
}

function parseMoney(value) {
  if (value == null) return null
  let s = String(value).trim()
  if (!s) return null
  const euLike = /[0-9]\.[0-9]{3},[0-9]+$/.test(s) || (s.includes('.') && s.includes(',') && /,[0-9]{1,3}$/.test(s))
  s = s.replace(/[^0-9,.\-]/g, '')
  if (euLike) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const DATE_PATTERNS = [
  'DD/MM/YYYY HH:mm:ss',
  'DD/MM/YYYY HH:mm',
  'DD/MM/YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD',
]

function parseDateTime(value) {
  if (value == null) return null
  if (value instanceof Date) return isNaN(value) ? null : value
  const s = String(value).trim()
  if (!s) return null
  for (const fmt of DATE_PATTERNS) {
    const d = dayjs(s, fmt, true)
    if (d.isValid()) return d.toDate()
  }
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? new Date(ms) : null
}

function combineDateAndTime(dateStr, timeStr) {
  const d = parseDateTime(dateStr)
  let t = (timeStr ?? '').toString().trim()
  if (!d) return null
  if (!t) return d
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) {
    const hh = Math.min(23, parseInt(m[1],10))
    const mm = Math.min(59, parseInt(m[2],10))
    const ss = Math.min(59, parseInt(m[3]||'0',10))
    const dd = new Date(d)
    dd.setHours(hh, mm, ss, 0)
    return dd
  }
  const dt = parseDateTime(`${dateStr} ${timeStr}`)
  return dt || d
}

function formatKeyDateMinute(d) {
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function firstNonNull(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null) return obj[k]
  }
  return null
}

function readFirstSheet(pathOrBufferOrFile) {
  let buf = null

  if (typeof pathOrBufferOrFile === 'string') {
    const wb = XLSX.readFile(pathOrBufferOrFile, { cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(ws, { raw: false, defval: null, blankrows: false })
  }

  if (Buffer.isBuffer(pathOrBufferOrFile)) {
    buf = pathOrBufferOrFile
  } else if (pathOrBufferOrFile && pathOrBufferOrFile.buffer && Buffer.isBuffer(pathOrBufferOrFile.buffer)) {
    buf = pathOrBufferOrFile.buffer
  } else {
    throw new Error('readFirstSheet: entrada no soportada (esperaba string o Buffer o {buffer})')
  }

  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
 
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null, blankrows: false })
    if (rows && rows.length) return rows
  }
  
  const ws0 = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json(ws0, { header: 1, raw: false, defval: null, blankrows: false })
  if (Array.isArray(matrix) && matrix.length > 1) {
    const [headers, ...rest] = matrix
    return rest.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])))
  }
  return []
}

function keyFromReporte(rowRep) {
  const socio = normText(firstNonNull(rowRep, ['socio', 'Socio']))
  const fechaReg = firstNonNull(rowRep, ['fecha de registro', 'Fecha de registro'])
  const hora = firstNonNull(rowRep, ['hora', 'Hora'])
  const bruto = parseMoney(firstNonNull(rowRep, ['bruto', 'Bruto']))
  const producto = normText(firstNonNull(rowRep, ['producto', 'Producto']))
  const metodo = normText(firstNonNull(rowRep, ['método de pago', 'metodo de pago', 'Método de pago', 'Metodo de Pago'])) || 'SIN_METODO'
  const dt = combineDateAndTime(fechaReg, hora)
  if (!socio || !dt || bruto == null || !producto) return null
  return `${socio}|${formatKeyDateMinute(dt)}|${bruto.toFixed(2)}|${producto}|${metodo}`
}

function keyFromHistorico(rowHist) {
  const nombre = normText(firstNonNull(rowHist, ['nombre', 'Nombre']))
  const apellidos = normText(firstNonNull(rowHist, ['apellidos', 'Apellidos']))
  const socio = normText(`${nombre} ${apellidos}`.trim())
  const fechaReg = firstNonNull(rowHist, ['fecha registro', 'Fecha registro'])
  const dt = parseDateTime(fechaReg)
  const total = parseMoney(firstNonNull(rowHist, ['total', 'Total']))
  const concepto = normText(firstNonNull(rowHist, ['concepto', 'Concepto', 'producto', 'Producto']))
  const metodo = normText(firstNonNull(rowHist, ['método de pago', 'metodo de pago', 'Método de pago', 'Metodo de pago'])) || 'SIN_METODO'
  if (!socio || !dt || total == null || !concepto) return null
  return `${socio}|${formatKeyDateMinute(dt)}|${total.toFixed(2)}|${concepto}|${metodo}`
}

const baseKey = (key) => key?.slice(0, key.lastIndexOf('|'))

function getMetodoFromHistorico(rowHist) {
  return normText(firstNonNull(rowHist, [
    'método de pago', 'metodo de pago', 'Método de pago', 'Metodo de pago'
  ]))
}

function setMetodoInReporte(rowRep, metodo) {
  // set en los posibles encabezados
  rowRep['Metodo de Pago'] = metodo
}

function mergePayments(reporteRows, historicoRows) {
  const mapFullH = new Map() // clave completa (incluye método)
  const mapBaseH = new Map() // clave base (sin método)

  for (const rowHist of historicoRows) {
    const k = keyFromHistorico(rowHist)
    if (!k) continue
    if (!mapFullH.has(k)) mapFullH.set(k, rowHist)

    const kb = baseKey(k)
    if (kb && !mapBaseH.has(kb)) mapBaseH.set(kb, rowHist)
  }

  const merged = []
  const misses = []

  for (const rowRep of reporteRows) {
    let k = keyFromReporte(rowRep)
    if (!k) { misses.push({ row: rowRep, reason: 'key-null-reporte' }); continue }

    // Caso especial: SIN_METODO en reporte -> tomar método del histórico y regenerar key
    if (k.endsWith('|SIN_METODO')) {
      const kb = baseKey(k)
      const rowHist = kb ? mapBaseH.get(kb) : null
      if (!rowHist) { misses.push({ row: rowRep, key: kb, reason: 'not-found-in-historico-base' }); continue }

      const metodoHist = getMetodoFromHistorico(rowHist)
      if (!metodoHist) { misses.push({ row: rowRep, key: kb, reason: 'metodo-missing-in-historico' }); continue }

      // 1) inyecta método en el reporte
      setMetodoInReporte(rowRep, metodoHist)

      // 2) regenera la key completa del reporte (ya con método)
      k = keyFromReporte(rowRep)
    }

    const h = mapFullH.get(k)
    if (!h) { misses.push({ row: rowRep, key: k, reason: 'not-found-in-historico' }); continue }

    merged.push({ rep: rowRep, hist: h, key: k })
  }

  return { merged, misses }
}

function buildIngestSig(row) {
  const base = [
    String(row.id_transaccion?.toLowerCase() ?? ''),
    String(row.id_suscripcion?.toLowerCase() ?? ''),
    String(row.socio?.toLowerCase() ?? ''),
    String(row.fecha_de_registro ?? ''),
    String(row.fecha_de_valor ?? ''),
    String(row.hora ?? ''),
    String(Number(row.total ?? 0).toFixed(2)),
    String(row.producto?.toLowerCase() ?? ''),
    String(row.metodo_de_pago?.toLowerCase() ?? ''),
  ].join('|')
  return crypto.createHash('md5').update(base, 'utf8').digest('hex')
}

function pickText(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function mapMergedToPayments(m) {
  const Reporte = m.rep, Historico = m.hist

  const dt = combineDateAndTime(firstNonNull(Reporte, ['Fecha de registro','fecha de registro']), firstNonNull(Reporte, ['Hora','hora']))
  const fecha_de_registro = dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) : null
  const hora =
    dt ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}` : null
  const fecha_de_valor_dt = parseDateTime(firstNonNull(Reporte, ['Fecha de valor','fecha de valor']))
  
  const socio = pickText(firstNonNull(Reporte, ['Socio','socio']))
  const bruto = parseMoney(firstNonNull(Reporte, ['Bruto','bruto']))
  const subtotal = parseMoney(firstNonNull(Reporte, ['Subtotal','subtotal']))
  const descuento = parseMoney(firstNonNull(Reporte, ['Descuento','descuento']))
  const impuesto = parseMoney(firstNonNull(Reporte, ['Impuesto','impuesto']))
  const producto = pickText(firstNonNull(Reporte, ['Producto','producto']))
  const tipo_producto = pickText(firstNonNull(Reporte, ['Tipo producto','tipo producto']))
  const cantidad = parseMoney(firstNonNull(Reporte, ['Cantidad','cantidad'])) ?? parseMoney(firstNonNull(Historico, ['Cantidad','cantidad'])) ?? 1
  const cupon_codigo = pickText(firstNonNull(Reporte, ['Cupón','cupon']))
  const cupon_porcentaje = pickText(firstNonNull(Reporte, ['% cupón','% Cupón']))
  const cupon_monto = parseMoney(firstNonNull(Reporte, ['$ cupón','$ Cupón']))
  const id_cargo = normText(firstNonNull(Reporte, ['ID Cargo','id cargo']))
  const cod_autorizacion = normText(firstNonNull(Reporte, ['Cód. Autorización','Cod. Autorizacion']))
  const tipo_de_pago = normText(firstNonNull(Reporte, ['Tipo metodo de pago']))
  const centro = pickText(firstNonNull(Reporte, ['Centro','centro']))
  const origen_de_pago = pickText(firstNonNull(Reporte, ['Origen de pago']))

  const canal = pickText(firstNonNull(Historico, ['Canal','canal']))
  const empleado = pickText(firstNonNull(Historico, ['Empleado','empleado']))
  const estado = pickText(firstNonNull(Historico, ['Estado','estado']))
  const id_transaccion = pickText(firstNonNull(Historico, ['Id. Transacción','id. transacción','Id Transacción','id_transaccion']))
  const id_suscripcion = pickText(firstNonNull(Historico, ['Id. Suscripción','id. suscripción','Id Suscripción','id_suscripcion']))
  const no_de_tarjeta = pickText(firstNonNull(Historico, ['Nº de Tarjeta','No. de Tarjeta','no_de_tarjeta']))
  const tipo_de_tarjeta = pickText(firstNonNull(Historico, ['Tipo de tarjeta','tipo de tarjeta','tipo_de_tarjeta']))
  const total = parseMoney(firstNonNull(Historico, ['Total','total'])) ?? parseMoney(firstNonNull(R, ['Total','total'])) ?? bruto
  const nombre = pickText(firstNonNull(Historico, ['Nombre','nombre']))
  const apellidos = pickText(firstNonNull(Historico, ['Apellidos','apellidos']))
  const concepto = pickText(firstNonNull(Historico, ['Concepto','concepto', 'Producto','producto']))
  const email = normText(firstNonNull(Historico, ['email','correo']))
  const tipo = normText(firstNonNull(Historico, ['Tipo','Type']))
  const notas = pickText(firstNonNull(Historico, ['Notas','notas']))

  const metodo_from_rep = normText(firstNonNull(Reporte, ['Método de pago','metodo de pago','Método de pago','Metodo de pago']))
  const metodo_from_his = normText(firstNonNull(Historico, ['Método de pago','metodo de pago','Método de pago','Metodo de pago']))
  const metodo_de_pago = pickText(metodo_from_rep || metodo_from_his)

  const out = {
    factura: null,
    id_cargo,
    cod_autorizacion,
    socio,
    nombre,
    apellidos,
    email,
    ine_curp: null,
    producto,
    tipo_producto,
    concepto,
    tipo,
    precio: subtotal,
    cantidad,
    descuento,
    subtotal,
    bruto,
    impuesto,
    total,
    metodo_de_pago,
    tipo_de_pago,
    cupon_codigo,
    cupon_porcentaje,
    cupon_monto,
    tarjeta: tipo_de_tarjeta,
    no_de_tarjeta,
    origen_de_pago,
    canal,
    centro,
    empleado,
    estado,
    facturado: null,
    fecha_de_registro,
    fecha_de_valor: fecha_de_valor_dt ? new Date(fecha_de_valor_dt.getFullYear(), fecha_de_valor_dt.getMonth(), fecha_de_valor_dt.getDate()) : null,
    hora,
    notas,
    img: null,
    id_transaccion,
    id_suscripcion,
  }
  out.ingest_sig = buildIngestSig(out)
  return out
}

async function upsertPayments(rows, { schema='reportes_sukhavati', table='pagos' } = {}) {
  if (!rows?.length) return { inserted: 0, updated: 0 }
  const cols = [
    'factura','id_cargo','cod_autorizacion','socio','nombre','apellidos','email','ine_curp',
    'producto','tipo_producto','concepto','tipo','precio','cantidad','descuento','subtotal',
    'bruto','impuesto','total','metodo_de_pago','tipo_de_pago','cupon_codigo',
    'cupon_porcentaje','cupon_monto','tarjeta','no_de_tarjeta','origen_de_pago','canal',
    'centro','empleado','estado','facturado','fecha_de_registro','fecha_de_valor','hora',
    'notas','img','ingest_sig','id_transaccion','id_suscripcion'
  ]

  const setUpdates = cols
    .filter(c => c !== 'ingest_sig')
    .map(c => `"${c}" = CASE WHEN EXCLUDED."${c}" IS NOT NULL AND (EXCLUDED."${c}"::text IS DISTINCT FROM ''::text) THEN EXCLUDED."${c}" ELSE "${table}"."${c}" END`)
    .join(', ')

  const CHUNK = 300
  let inserted = 0, updated = 0
  for (let i=0; i<rows.length; i+=CHUNK) {
    const chunk = rows.slice(i, i+CHUNK)
    const params = []
    const valuesSql = chunk.map((row, ridx) => {
      cols.forEach(c => params.push(row[c] ?? null))
      const ph = cols.map((_, j) => `$${ridx*cols.length + j + 1}`)
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

export async function mergeAndUpsertpayments(file1, file2, { schema='reportes_sukhavati' } = {}) {
  const sheet1 = readFirstSheet(file1)
  const sheet2 = readFirstSheet(file2)

  const c1 = classifyByHeaders(sheet1)
  const c2 = classifyByHeaders(sheet2)
 
  let repBuf, hisBuf

  if (c1.type === 'reporte' && c2.type === 'historico') {
    repBuf = file1; hisBuf = file2
  } else if (c1.type === 'historico' && c2.type === 'reporte') {
    repBuf = file2; hisBuf = file1
  } else {
    const name1 = file1?.originalname || file1?.name || ''
    const name2 = file2?.originalname || file2?.name || ''
    const f1 = classifyByFilename(name1)
    const f2 = classifyByFilename(name2)

    if (f1 === 'reporte' && f2 === 'historico') {
      repBuf = file1; hisBuf = file2
    } else if (f1 === 'historico' && f2 === 'reporte') {
      repBuf = file2; hisBuf = file1
    } else {
      const repIs1 = (c1.repScore ?? 0) >= (c2.repScore ?? 0)
      repBuf = repIs1 ? file1 : file2
      hisBuf = repIs1 ? file2 : file1
    }
  }

  const rep = readFirstSheet(repBuf)
  const his = readFirstSheet(hisBuf)

  const { merged, misses } = mergePayments(rep, his)
  const paymentsRows = merged.map(mapMergedToPayments)

  const seen = new Set()
  const final = []
  for (const row of paymentsRows) {
    const sig = row.ingest_sig
    if (!sig || seen.has(sig)) continue
    seen.add(sig); final.push(row)
  }

  const res = await upsertPayments(final, { schema })
  return { ...res, merged: merged.length, missesTotal: misses.length, misses: misses }
}
