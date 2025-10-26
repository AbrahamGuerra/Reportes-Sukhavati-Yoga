import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { query } from '../DB/db.js'
import { authRequired } from '../auth/middleware.js'

const router = express.Router()
router.use(cors())
router.use(express.json())

const s3 = new S3Client({ region: process.env.AWS_REGION })
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }) // 20MB

// ——— helpers ———
const sanitize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const sanitizeFilename = (s) =>
  String(s || '')
    .replace(/\.pdf$/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const buildPagosPrefix = (socio) => {
  const s = sanitize(socio || '')
  if (!s) throw new Error('SOCIO_REQUIRED')
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const base = (process.env.S3_PREFIX || '').replace(/\/+$/, '') // opcional
  const root = base ? `${base}/` : ''
  return `${root}pagos/${s}/${yyyy}/${mm}`
}

// --- BÚSQUEDA (igual) ---
router.get('/payments', async (req, res) => {
  const { idCargo, socio, producto, notas, idTransaccion, idSuscripcion, limit = 50 } = req.query
  const where = []; const vals = []; let i = 1
  const push = (cond, val) => { where.push(cond); vals.push(val) }

  if (idCargo)        push(`id_cargo = $${i++}`, idCargo)
  if (idTransaccion)  push(`id_transaccion = $${i++}`, idTransaccion)
  if (idSuscripcion)  push(`id_suscripcion = $${i++}`, idSuscripcion)
  if (socio)          push(`socio ILIKE $${i++}`, `%${socio}%`)
  if (producto)       push(`(producto ILIKE $${i} OR concepto ILIKE $${i++})`, `%${producto}%`)
  if (notas)          push(`notas ILIKE $${i++}`, `%${notas}%`)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sql = `
    SELECT fecha_de_registro, socio, producto, concepto, metodo_de_pago, total,
           id_cargo, id_transaccion, id_suscripcion, evidencia_pago_url
    FROM reportes_sukhavati.pagos
    ${whereSql}
    ORDER BY fecha_de_registro DESC NULLS LAST
    LIMIT ${Number(limit) || 50};
  `

  try {
    const { rows } = await query(sql, vals)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'DB_SEARCH_ERROR' })
  }
})

// --- UPLOAD A S3 (con carpeta por usuario) ---
router.post('/upload', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'NO_FILE' })
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ ok:false, error:'ONLY_PDF' })
    }

    const { socio, id_cargo, id_transaccion } = req.body || {}
    if (!socio) return res.status(400).json({ ok:false, error:'SOCIO_REQUIRED' })

    const prefix = buildPagosPrefix(socio)

    const baseName = sanitizeFilename(req.file.originalname)
    const ids = [id_cargo, id_transaccion].filter(Boolean).map(sanitize).join('_')
    const fileName = `${ids ? ids + '-' : ''}${baseName}.pdf`

    const key = `${prefix}/${fileName}`

    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: 'application/pdf',
    }))

    const url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
    res.json({ ok:true, url, key })
  } catch (err) {
    if (err.message === 'SOCIO_REQUIRED') {
      return res.status(400).json({ ok:false, error:'SOCIO_REQUIRED' })
    }
    console.error('S3_UPLOAD_ERROR', err)
    res.status(500).json({ ok:false, error:'S3_UPLOAD_ERROR' })
  }
})

// --- GUARDAR URL EN DB (igual) ---
router.put('/payments/:idTransaccion/evidencia', async (req, res) => {
  const { idTransaccion } = req.params
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'URL_REQUIRED' })

  try {
    const { rowCount } = await query(
      `UPDATE reportes_sukhavati.pagos SET evidencia_pago_url = $1 WHERE id_transaccion = $2`,
      [url, idTransaccion]
    )
    if (!rowCount) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'DB_UPDATE_ERROR' })
  }
})

export default router
