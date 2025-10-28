import XLSX from 'xlsx'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import crypto from 'crypto'
import { query } from '../DB/db.js'
import { filterLastNDays } from '../utils/utils.js'

dayjs.extend(customParseFormat)

function toISODateString(d) {
  if (!(d instanceof Date)) return String(d ?? '');
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// --- Parsers robustos de fecha y hora ---
function parseExcelSerialDate(n) {
  // Excel serial date (con base 1899-12-30)
  const base = new Date(Date.UTC(1899, 11, 30));
  const ms = Math.round(Number(n)) * 24 * 60 * 60 * 1000;
  return new Date(base.getTime() + ms);
}

function parseDateStringFlexible(s) {
  if (!s) return null;
  const str = String(s).trim();

  // ISO yyyy-mm-dd
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  let m = iso.exec(str);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    return new Date(y, mo - 1, d);
  }

  // dd/mm/yy|yyyy o mm/dd/yy|yyyy -> detectamos por rango
  const sl = /^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})$/;
  m = sl.exec(str);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
    // normaliza año de 2 dígitos
    if (c < 100) c += 2000;

    // si el primer número > 12, es DD/MM/YYYY
    // si el tercer número > 31, imposible para día; asume MM/DD/YYYY
    // si ambos <= 12, asumimos MM/DD/YYYY (estilo U.S.) porque tu ejemplo es 10/20/25
    let day, month, year = c;
    if (a > 12) {           // DD/MM/YYYY
      day = a; month = b;
    } else if (b > 12) {    // MM/DD/YYYY
      month = a; day = b;
    } else {
      // ambiguo -> preferimos MM/DD/YYYY por tus archivos
      month = a; day = b;
    }
    return new Date(year, month - 1, day);
  }

  // Intento final: Date.parse
  const dt = new Date(str);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseExcelLikeDate(v) {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() === String(n)) {
    // Parece serial Excel
    const d = parseExcelSerialDate(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return parseDateStringFlexible(v);
}

function parseTimeToHMS(str) {
  if (!str) return { h:0, m:0, s:0 };
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { h:0, m:0, s:0 };
  return { h: Number(m[1])||0, m: Number(m[2])||0, s: Number(m[3])||0 };
}

function mergeDateAndTime(dateOnly, timeStr) {
  if (!dateOnly) return null;
  const { h, m, s } = parseTimeToHMS(timeStr);
  return new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate(),
    h, m, s, 0
  );
}

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
    String(row.idSocio?.toLowerCase() ?? ''),
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
  const hash = crypto.createHash('md5').update(base, 'utf8').digest('hex')
  return hash
}

function pickText(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// === Resolver id_socio cuando falta ===
async function findIdSocioByGuess({ socio, nombre, apellidos }) {
  const qSocio   = (socio || '').trim();
  const qNomApe  = [nombre || '', apellidos || ''].join(' ').trim();

  // Sin nada que buscar
  if (!qSocio && !qNomApe) return null;

  // Preferimos coincidencia exacta (case-insensitive), si no, LIKE con %
  const sql = `
    WITH cand AS (
      SELECT
        s.id_socio,
        s.socio,
        -- scores para ordenar mejores matches
        (lower(btrim(s.socio)) = lower(btrim($1)))::int                                       AS exact_soc,
        (lower(btrim(s.socio)) = lower(btrim($2)))::int                                       AS exact_na,
        (lower(btrim(s.socio)) LIKE ('%' || lower(btrim($1)) || '%'))::int                    AS like_soc,
        (lower(btrim(s.socio)) LIKE ('%' || lower(btrim($2)) || '%'))::int                    AS like_na
      FROM reportes_sukhavati.socios s
      WHERE
        ($1 <> '' AND lower(btrim(s.socio)) LIKE ('%' || lower(btrim($1)) || '%'))
        OR
        ($2 <> '' AND lower(btrim(s.socio)) LIKE ('%' || lower(btrim($2)) || '%'))
    )
    SELECT id_socio
    FROM cand
    ORDER BY exact_soc DESC, exact_na DESC, like_soc DESC, like_na DESC
    LIMIT 1;
  `;
  const params = [qSocio, qNomApe];
  const { rows } = await query(sql, params);
  return rows[0]?.id_socio ?? null;
}

async function enrichRowsWithIdSocio(rows) {
  const cache = new Map(); // clave: "soc|nombre apellidos" -> id_socio/null

  for (const r of rows) {
    // Normalizamos ambos: si ya viene uno, úsalo para poblar el otro.
    if (r.id_socio && !r.idSocio) r.idSocio = r.id_socio;
    if (r.idSocio && !r.id_socio) r.id_socio = r.idSocio;

    if (!r.id_socio) {
      const key = `${(r.socio || '').toLowerCase()}|${(r.nombre || '').toLowerCase()} ${(r.apellidos || '').toLowerCase()}`;
      if (!cache.has(key)) {
        const found = await findIdSocioByGuess({
          socio: r.socio || '',
          nombre: r.nombre || '',
          apellidos: r.apellidos || '',
        });
        cache.set(key, found);
      }
      const idFound = cache.get(key) || null;
      r.id_socio = idFound;   // lo que inserta el upsert
      r.idSocio  = idFound;   // por consistencia con la ingest_sig actual
    }
  }
  return rows;
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

  const idSocio = pickText(firstNonNull(Reporte, ['idMember','id_Member']))

  const out = {
    factura: null,
    id_cargo,
    cod_autorizacion,
    idSocio,
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
    'factura','id_cargo','cod_autorizacion','id_socio','socio','nombre','apellidos','email','ine_curp',
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

export async function mergeAndUpsertpayments(file1, file2, { schema='reportes_sukhavati', role='' } = {}) {
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

  //Si el rol es diferente de ADMIN filtrar solo pagos de los últimos 7 días 
  let rowsToUpsert = final

  if (role !== 'admin') {
    rowsToUpsert = filterLastNDays(final, ['fecha_de_registro'], 7)
    if (!rowsToUpsert.length) {
      return { ok: false, error: 'No hay pagos dentro de los últimos 7 días.' }
    }
  }

  await enrichRowsWithIdSocio(final);
  const res = await upsertPayments(rowsToUpsert, { schema })
  return { ...res, merged: merged.length, missesTotal: misses.length, misses: misses }
}

// Ingesta directa desde Plantilla BD (1 archivo)
function getCell(obj, names = []) {
  return firstNonNull(obj, names);
}

function mapTemplateRowToPayment(row) {
  
  const dt = combineDateAndTime(firstNonNull(row, ['fecha_de_registro','fecha de registro']), firstNonNull(row, ['Hora','hora']))
  const fecha_de_registro = dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) : null
  const hora =
    dt ? `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}` : null
  const fecha_de_valor_dt = parseDateTime(firstNonNull(row, ['fecha_de_valor','fecha de valor']))

  const factura          = pickText(getCell(row, ['Factura','factura']));
  const id_cargo         = pickText(getCell(row, ['ID Cargo','Id Cargo','id cargo','id_cargo']));
  const cod_autorizacion = pickText(getCell(row, ['Cód. Autorización','Codigo Autorizacion','cod. autorización','Cod. Autorizacion','cod_autorizacion']));
  const id_transaccion   = pickText(getCell(row, ['Id. Transacción','ID Transaccion','id_transaccion','Id Transacción']));
  const id_suscripcion   = pickText(getCell(row, ['Id. Suscripción','ID Suscripcion','id_suscripcion','Id Suscripción']));
  const evidencia_pago_url = pickText(getCell(row, ['Evidencia URL','evidencia','evidencia_pago_url']));

  const idSocioFile = pickText(getCell(row, ['Id Socio','id_socio','idSocio','id_member','idMember','id_Member']));
  const socio       = pickText(getCell(row, ['Socio','socio']));
  const nombre      = pickText(getCell(row, ['Nombre','nombre']));
  const apellidos   = pickText(getCell(row, ['Apellidos','apellidos']));
  const email       = pickText(getCell(row, ['Email','Correo','email','correo']));
  const ine_curp    = pickText(getCell(row, ['INE/Curp','INE_CURP','ine_curp']));

  const producto      = pickText(getCell(row, ['Producto','producto']));
  const tipo_producto = pickText(getCell(row, ['Tipo producto','tipo producto','tipo_producto']));
  const concepto      = pickText(getCell(row, ['Concepto','concepto'])) || producto;
  const tipo          = pickText(getCell(row, ['Tipo','tipo']));

  const precio     = parseMoney(getCell(row, ['Precio','precio']));
  const cantidad   = parseMoney(getCell(row, ['Cantidad','cantidad'])) ?? 1;
  const descuento  = parseMoney(getCell(row, ['Descuento','descuento']));
  const subtotal   = parseMoney(getCell(row, ['Subtotal','subtotal']));
  const bruto      = parseMoney(getCell(row, ['Bruto','bruto']));
  const impPct     = parseMoney(getCell(row, ['Impuesto %','Impuesto%','impuesto_porcentaje']));
  const impuesto   = parseMoney(getCell(row, ['Impuesto','impuesto']));
  const total      = parseMoney(getCell(row, ['Total','total'])) ?? bruto ?? subtotal ?? null;

  const metodo_de_pago = pickText(getCell(row, ['Método de pago','Metodo de pago','metodo de pago','metodo_de_pago']));
  const tipo_de_pago   = pickText(getCell(row, ['Tipo de pago','tipo de pago','tipo_de_pago']));
  const tipo_de_tarjeta= pickText(getCell(row, ['Tipo de tarjeta','tipo de tarjeta','tipo_de_tarjeta','tarjeta']));
  const no_de_tarjeta  = pickText(getCell(row, ['No. de Tarjeta','Nº de Tarjeta','no_de_tarjeta']));
  const origen_de_pago = pickText(getCell(row, ['Origen de pago','origen_de_pago']));
  const canal          = pickText(getCell(row, ['Canal','canal']));
  const centro         = pickText(getCell(row, ['Centro','centro']));
  const empleado       = pickText(getCell(row, ['Empleado','empleado']));
  const estado         = pickText(getCell(row, ['Estado','estado']));
  const facturado      = pickText(getCell(row, ['Facturado','facturado']));
  const cupon_codigo   = pickText(getCell(row, ['Cupón','cupon','cupon_codigo']));
  const cupon_porcentaje = parseMoney(getCell(row, ['% cupón','% Cupón','cupon_porcentaje']));
  const cupon_monto    = parseMoney(getCell(row, ['$ cupón','$ Cupón','cupon_monto']));
  const notas          = pickText(getCell(row, ['Notas','notas']));
  const img            = pickText(getCell(row, ['Img','img','Imagen','imagen']));

  const out = {
    factura,
    id_cargo,
    cod_autorizacion,
    id_socio: idSocioFile || null,
    socio,
    nombre,
    apellidos,
    email,
    ine_curp,
    producto,
    tipo_producto,
    concepto,
    tipo,
    precio,
    cantidad,
    descuento,
    subtotal,
    bruto,
    impuesto_porcentaje: impPct,
    impuesto,
    total,
    metodo_de_pago,
    tipo_de_pago,
    cupon_codigo,
    cupon_porcentaje,
    cupon_monto,
    tarjeta: tipo_de_tarjeta,      // (tipo_de_tarjeta y tarjeta)
    tipo_de_tarjeta,
    no_de_tarjeta,
    origen_de_pago,
    canal,
    centro,
    empleado,
    estado,
    facturado,
    fecha_de_registro,
    fecha_de_valor: fecha_de_valor_dt ? new Date(fecha_de_valor_dt.getFullYear(), fecha_de_valor_dt.getMonth(), fecha_de_valor_dt.getDate()) : null,
    hora,
    notas,
    img,
    evidencia_pago_url,
    id_transaccion,
    id_suscripcion,
  };
  out.idSocio = out.id_socio;
  out.ingest_sig = buildIngestSig(out);
  return out;
}

export async function upsertPaymentsFromTemplateXlsx(xlsxBuffer, { schema='reportes_sukhavati', role='' } = {}) {
  const rows = readFirstSheet(xlsxBuffer);
  if (!rows?.length) return { ok:false, error:'La plantilla no tiene filas' };

  const mapped = [];
  const skipped = [];
  for (const r of rows) {
    try {
      const m = mapTemplateRowToPayment(r);
      // Validaciones mínimas
      if (!(m.socio || (m.nombre && m.apellidos))) throw new Error('Falta socio/nombre');
      if (!m.fecha_de_registro) throw new Error('Falta fecha de registro');
      if (m.total == null && m.bruto == null && m.subtotal == null) throw new Error('Falta total/bruto/subtotal');
      if (!m.producto && !m.concepto) throw new Error('Falta producto/concepto');
      if (!m.ingest_sig) throw new Error('No se pudo generar ingest_sig');

      mapped.push(m);
    } catch (e) {
      skipped.push({ row: r, reason: e.message });
    }
  }

  if (!mapped.length) return { ok:false, error:'No hay filas válidas para insertar', skipped };

  // Enriquecer id_socio
  await enrichRowsWithIdSocio(mapped);

  // Rol ≠ admin: filtrar últimos 7 días
  let rowsToUpsert = mapped;
  if (role !== 'admin') {
    rowsToUpsert = filterLastNDays(mapped, ['fecha_de_registro'], 7);
    if (!rowsToUpsert.length) return { ok:false, error:'No hay pagos dentro de los últimos 7 días.', skipped };
  }

  // UPSERT con la misma función reutilizada
  const res = await upsertPayments(rowsToUpsert, { schema });

  return { ok:true, ...res, total_read: rows.length, total_mapped: mapped.length, total_skipped: skipped.length, skipped };
}

export async function upsertPaymentsByNaturalKey(file, { schema='reportes_sukhavati', table='pagos' } = {}) {
  const rows = readFirstSheet(file);
  const mapped = [];
  const skipped = [];

  for (const r of rows) {
    try {
      const m = mapTemplateRowToPayment(r);
      mapped.push(m);
    } catch (e) {
      skipped.push({ row: r, reason: String(e.message || e) });
    }
  }

  if (!rows.length) {
    return { ok:false, error:'No hay filas válidas para insertar', total_read:0, total_mapped:0, total_skipped:skipped.length, skipped };
  }

  // Pre-normaliza: convierte '' a null donde aplica (números/fechas/tiempo)
  const norm = rows.map(r => ({
    // --- LLAVE NATURAL (tipos) ---
    id_cargo:           r.id_cargo ?? null,                                       // text
    id_transaccion:     r.id_transaccion ?? null,                                 // text
    id_socio:           r.id_socio ?? null,                                       // text
    metodo_de_pago:     r.metodo_de_pago ?? null,                                 // text
    total:              r.total === '' ? null : (r.total ?? null),                // numeric
    producto:           r.producto ?? null,                                       // text
    fecha_de_registro:  r.fecha_de_registro || null,                              // date (YYYY-MM-DD)
    fecha_de_valor:     r.fecha_de_valor || null,                                 // date (YYYY-MM-DD)

    // --- OTRAS COLUMNAS ---
    factura:            r.factura ?? null,
    cod_autorizacion:   r.cod_autorizacion ?? null,
    socio:              r.socio ?? null,
    nombre:             r.nombre ?? null,
    apellidos:          r.apellidos ?? null,
    email:              r.email ?? null,
    ine_curp:           r.ine_curp ?? null,
    tipo_producto:      r.tipo_producto ?? null,
    concepto:           r.concepto ?? null,
    tipo:               r.tipo ?? null,
    precio:             r.precio === '' ? null : (r.precio ?? null),              // numeric
    cantidad:           r.cantidad === '' ? null : (r.cantidad ?? null),          // numeric
    descuento:          r.descuento === '' ? null : (r.descuento ?? null),
    subtotal:           r.subtotal === '' ? null : (r.subtotal ?? null),
    bruto:              r.bruto === '' ? null : (r.bruto ?? null),
    impuesto:           r.impuesto === '' ? null : (r.impuesto ?? null),
    cupon_codigo:       r.cupon_codigo ?? null,
    cupon_porcentaje:   r.cupon_porcentaje === '' ? null : (r.cupon_porcentaje ?? null),
    cupon_monto:        r.cupon_monto === '' ? null : (r.cupon_monto ?? null),
    tarjeta:            r.tarjeta ?? null,
    no_de_tarjeta:      r.no_de_tarjeta ?? null,
    origen_de_pago:     r.origen_de_pago ?? null,
    canal:              r.canal ?? null,
    centro:             r.centro ?? null,
    empleado:           r.empleado ?? null,
    estado:             r.estado ?? null,
    facturado:          r.facturado ?? null,
    hora:               r.hora || null,                                           // 'HH:mm:ss'
    notas:              r.notas ?? null,
    img:                r.img ?? null,
    id_suscripcion:     r.id_suscripcion ?? null,
    evidencia_pago_url: r.evidencia_pago_url ?? null,
    impuesto_porcentaje:r.impuesto_porcentaje === '' ? null : (r.impuesto_porcentaje ?? null)
  }));

  const CHUNK = 400;
  let inserted = 0;
  let updated  = 0;

  for (let i = 0; i < norm.length; i += CHUNK) {
    const chunk = norm.slice(i, i + CHUNK);
    const payload = JSON.stringify(chunk);

    const sql = `
      WITH v AS (
        SELECT
          -- LLAVE
          (NULLIF(v->>'id_cargo',''))::text            AS id_cargo,
          (NULLIF(v->>'id_transaccion',''))::text      AS id_transaccion,
          (NULLIF(v->>'id_socio',''))::text            AS id_socio,
          (NULLIF(v->>'metodo_de_pago',''))::text      AS metodo_de_pago,
          (NULLIF(v->>'total',''))::numeric            AS total,
          (NULLIF(v->>'producto',''))::text            AS producto,
          (NULLIF(v->>'fecha_de_registro',''))::date   AS fecha_de_registro,
          (NULLIF(v->>'fecha_de_valor',''))::date      AS fecha_de_valor,

          -- DEMÁS CAMPOS
          (NULLIF(v->>'factura',''))::text             AS factura,
          (NULLIF(v->>'cod_autorizacion',''))::text    AS cod_autorizacion,
          (NULLIF(v->>'socio',''))::text               AS socio,
          (NULLIF(v->>'nombre',''))::text              AS nombre,
          (NULLIF(v->>'apellidos',''))::text           AS apellidos,
          (NULLIF(v->>'email',''))::text               AS email,
          (NULLIF(v->>'ine_curp',''))::text            AS ine_curp,
          (NULLIF(v->>'tipo_producto',''))::text       AS tipo_producto,
          (NULLIF(v->>'concepto',''))::text            AS concepto,
          (NULLIF(v->>'tipo',''))::text                AS tipo,
          (NULLIF(v->>'precio',''))::numeric           AS precio,
          (NULLIF(v->>'cantidad',''))::numeric         AS cantidad,
          (NULLIF(v->>'descuento',''))::numeric        AS descuento,
          (NULLIF(v->>'subtotal',''))::numeric         AS subtotal,
          (NULLIF(v->>'bruto',''))::numeric            AS bruto,
          (NULLIF(v->>'impuesto',''))::numeric         AS impuesto,
          (NULLIF(v->>'cupon_codigo',''))::text        AS cupon_codigo,
          (NULLIF(v->>'cupon_porcentaje',''))::numeric AS cupon_porcentaje,
          (NULLIF(v->>'cupon_monto',''))::numeric      AS cupon_monto,
          (NULLIF(v->>'tarjeta',''))::text             AS tarjeta,
          (NULLIF(v->>'no_de_tarjeta',''))::text       AS no_de_tarjeta,
          (NULLIF(v->>'origen_de_pago',''))::text      AS origen_de_pago,
          (NULLIF(v->>'canal',''))::text               AS canal,
          (NULLIF(v->>'centro',''))::text              AS centro,
          (NULLIF(v->>'empleado',''))::text            AS empleado,
          (NULLIF(v->>'estado',''))::text              AS estado,
          (NULLIF(v->>'facturado',''))::text           AS facturado,
          (NULLIF(v->>'hora',''))::time                AS hora,
          (NULLIF(v->>'notas',''))::text               AS notas,
          (NULLIF(v->>'img',''))::text                 AS img,
          (NULLIF(v->>'id_suscripcion',''))::text      AS id_suscripcion,
          (NULLIF(v->>'evidencia_pago_url',''))::text  AS evidencia_pago_url,
          (NULLIF(v->>'impuesto_porcentaje',''))::numeric AS impuesto_porcentaje
        FROM jsonb_array_elements($1::jsonb) AS v
      ),
      u AS (  -- UPDATE primero
        UPDATE ${schema}.${table} t
        SET
          factura             = COALESCE(v.factura, t.factura),
          cod_autorizacion    = COALESCE(v.cod_autorizacion, t.cod_autorizacion),
          socio               = COALESCE(v.socio, t.socio),
          nombre              = COALESCE(v.nombre, t.nombre),
          apellidos           = COALESCE(v.apellidos, t.apellidos),
          email               = COALESCE(v.email, t.email),
          ine_curp            = COALESCE(v.ine_curp, t.ine_curp),
          tipo_producto       = COALESCE(v.tipo_producto, t.tipo_producto),
          concepto            = COALESCE(v.concepto, t.concepto),
          tipo                = COALESCE(v.tipo, t.tipo),
          precio              = COALESCE(v.precio, t.precio),
          cantidad            = COALESCE(v.cantidad, t.cantidad),
          descuento           = COALESCE(v.descuento, t.descuento),
          subtotal            = COALESCE(v.subtotal, t.subtotal),
          bruto               = COALESCE(v.bruto, t.bruto),
          impuesto            = COALESCE(v.impuesto, t.impuesto),
          cupon_codigo        = COALESCE(v.cupon_codigo, t.cupon_codigo),
          cupon_porcentaje    = COALESCE(v.cupon_porcentaje, t.cupon_porcentaje),
          cupon_monto         = COALESCE(v.cupon_monto, t.cupon_monto),
          tarjeta             = COALESCE(v.tarjeta, t.tarjeta),
          no_de_tarjeta       = COALESCE(v.no_de_tarjeta, t.no_de_tarjeta),
          origen_de_pago      = COALESCE(v.origen_de_pago, t.origen_de_pago),
          canal               = COALESCE(v.canal, t.canal),
          centro              = COALESCE(v.centro, t.centro),
          empleado            = COALESCE(v.empleado, t.empleado),
          estado              = COALESCE(v.estado, t.estado),
          facturado           = COALESCE(v.facturado, t.facturado),
          hora                = COALESCE(v.hora, t.hora),
          notas               = COALESCE(v.notas, t.notas),
          img                 = COALESCE(v.img, t.img),
          id_suscripcion      = COALESCE(v.id_suscripcion, t.id_suscripcion),
          evidencia_pago_url  = COALESCE(v.evidencia_pago_url, t.evidencia_pago_url),
          impuesto_porcentaje = COALESCE(v.impuesto_porcentaje, t.impuesto_porcentaje)
        FROM v
        WHERE t.id_cargo          IS NOT DISTINCT FROM v.id_cargo
          AND t.id_transaccion    IS NOT DISTINCT FROM v.id_transaccion
          AND t.id_socio          IS NOT DISTINCT FROM v.id_socio
          AND t.metodo_de_pago    IS NOT DISTINCT FROM v.metodo_de_pago
          AND t.total             IS NOT DISTINCT FROM v.total
          AND t.producto          IS NOT DISTINCT FROM v.producto
          AND t.fecha_de_registro IS NOT DISTINCT FROM v.fecha_de_registro
          AND t.fecha_de_valor    IS NOT DISTINCT FROM v.fecha_de_valor
        RETURNING 1
      ),
      i AS (  -- INSERT de los que no existen por llave natural
        INSERT INTO ${schema}.${table} (
          id_cargo, id_transaccion, id_socio, metodo_de_pago, total, producto, fecha_de_registro, fecha_de_valor,
          factura, cod_autorizacion, socio, nombre, apellidos, email, ine_curp, tipo_producto, concepto, tipo,
          precio, cantidad, descuento, subtotal, bruto, impuesto, cupon_codigo, cupon_porcentaje, cupon_monto,
          tarjeta, no_de_tarjeta, origen_de_pago, canal, centro, empleado, estado, facturado, hora, notas, img,
          id_suscripcion, evidencia_pago_url, impuesto_porcentaje
        )
        SELECT
          v.id_cargo, v.id_transaccion, v.id_socio, v.metodo_de_pago, v.total, v.producto, v.fecha_de_registro, v.fecha_de_valor,
          v.factura, v.cod_autorizacion, v.socio, v.nombre, v.apellidos, v.email, v.ine_curp, v.tipo_producto, v.concepto, v.tipo,
          v.precio, v.cantidad, v.descuento, v.subtotal, v.bruto, v.impuesto, v.cupon_codigo, v.cupon_porcentaje, v.cupon_monto,
          v.tarjeta, v.no_de_tarjeta, v.origen_de_pago, v.canal, v.centro, v.empleado, v.estado, v.facturado, v.hora, v.notas, v.img,
          v.id_suscripcion, v.evidencia_pago_url, v.impuesto_porcentaje
        FROM v
        LEFT JOIN ${schema}.${table} t
          ON t.id_cargo          IS NOT DISTINCT FROM v.id_cargo
         AND t.id_transaccion    IS NOT DISTINCT FROM v.id_transaccion
         AND t.id_socio          IS NOT DISTINCT FROM v.id_socio
         AND t.metodo_de_pago    IS NOT DISTINCT FROM v.metodo_de_pago
         AND t.total             IS NOT DISTINCT FROM v.total
         AND t.producto          IS NOT DISTINCT FROM v.producto
         AND t.fecha_de_registro IS NOT DISTINCT FROM v.fecha_de_registro
         AND t.fecha_de_valor    IS NOT DISTINCT FROM v.fecha_de_valor
        WHERE t.id_cargo IS NULL
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM u) AS updated,
        (SELECT count(*) FROM i) AS inserted;
    `;

    const { rows: [{ updated: updN, inserted: insN }] } = await query(sql, [payload]);
    updated  += Number(updN)  || 0;
    inserted += Number(insN)  || 0;
  }

  return {
    ok: true,
    inserted,
    updated,
    total_read: rows.length,
    total_mapped: rows.length,      
    total_skipped: skipped.length,
    skipped
  };
}
