import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { query } from '../DB/db.js'
import { authRequired } from '../auth/middleware.js'

const router = express.Router()
router.use(cors())
router.use(express.json())

export const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
})
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }) // 20MB

// ——— helpers ———
const sanitize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const buildUserPrefix = (user) => {
  const idOrEmail = user?.id || user?.email || 'anon'
  const u = sanitize(idOrEmail)
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const base = (process.env.S3_PREFIX || '').replace(/\/+$/, '')
  // ej: "", "sukhavati", etc.
  return `${base ? base + '/' : ''}users/${u}/${yyyy}/${mm}`
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
    SELECT socio, producto, concepto, metodo_de_pago, notas, fecha_de_registro, total,
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
  if (!req.file) return res.status(400).json({ error: 'NO_FILE' })
  if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'ONLY_PDF' })

  const bucket = process.env.S3_BUCKET
  const userPrefix = buildUserPrefix(req.user) // <- users/<user>/<yyyy>/<mm>

  const baseName = sanitize(req.file.originalname.replace(/\.pdf$/i, '')) || 'documento'
  const key = `${userPrefix}/${Date.now()}-${baseName}.pdf`

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: 'application/pdf',
      // ⚠️ si tu bucket NO es público, quita ACL y sirve por presigned URL o CloudFront
      // ACL: 'public-read',
    }))

    const base = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com`
    const url = `${base}/${key}`
    res.json({ url, key })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'S3_UPLOAD_ERROR' })
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
