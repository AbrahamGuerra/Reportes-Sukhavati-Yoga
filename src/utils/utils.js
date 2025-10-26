export function normalizeIdentifier(name) {
  let s = String(name ?? '').trim().toLowerCase();
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // remove accents
  s = s.replace(/[^\w]+/g, '_'); // non-word to underscore
  s = s.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (/^\d/.test(s)) s = `col_${s}`;
  const reserved = new Set(['user','order','select','where','group','from','to','as','table','schema']);
  if (reserved.has(s)) s = `${s}_col`;
  return s || 'col_unnamed';
}

export function normalizeIdentifier(name) {
  if (!name && name !== 0) return ''
  let s = String(name).trim()
  s = s.replace(/\s+/g, ' ').trim()
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.replace(/[^A-Za-z0-9 _\-./]/g, '') // ← corregida (sin doble backslash)
  s = s.replace(/[ .-/]+/g, '_').toLowerCase()
  s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return s
}

export function parseNumberLike(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  const s = String(value).trim()
  if (!s) return null
  const euLike =
    /[0-9]\.[0-9]{3},[0-9]+$/.test(s) ||
    (s.includes('.') && s.includes(',') && /,[0-9]{1,3}$/.test(s))
  let t = s.replace(/[ $%]/g, '')
  if (euLike) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parseBooleanLike(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  const s = String(value).trim().toLowerCase()
  if (!s) return null
  if (['true', 't', '1', 'sí', 'si', 'y', 'yes', 'on'].includes(s)) return true
  if (['false', 'f', '0', 'no', 'off', 'n'].includes(s)) return false
  return null
}

const DATE_PATTERNS = [
  'DD/MM/YYYY HH:mm:ss',
  'DD/MM/YYYY HH:mm',
  'DD/MM/YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD',
]
export function parseDateLike(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return isNaN(value) ? null : value
  const s = String(value).trim()
  if (!s) return null
  for (const fmt of DATE_PATTERNS) {
    const d = dayjsLib(s, fmt, true)
    if (d.isValid()) return d.toDate()
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t) : null
}

export function parseTimeLike(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0')
  const mm = String(Math.min(59, parseInt(m[2], 10))).padStart(2, '0')
  const ss = String(Math.min(59, parseInt(m[3] || '0', 10))).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function parseJsonLike(value) {
  if (value === null || value === undefined || typeof value === 'object')
    return value ?? null
  const s = String(value).trim()
  if (!s) return null
  if (
    (s.startsWith('{') && s.endsWith('}')) ||
    (s.startsWith('[') && s.endsWith(']'))
  ) {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  return null
}

const NUMERIC_TYPES = new Set([
  'numeric',
  'decimal',
  'double precision',
  'real',
  'integer',
  'int',
  'int4',
  'bigint',
  'int8',
  'smallint',
  'int2',
])
const BOOL_TYPES = new Set(['boolean', 'bool'])
const DATE_TYPES = new Set([
  'date',
  'timestamp without time zone',
  'timestamp with time zone',
  'timestamp',
])
const TIME_TYPES = new Set([
  'time without time zone',
  'time with time zone',
  'time',
])
const JSON_TYPES = new Set(['json', 'jsonb'])