import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import { renderReceiptToBuffer } from '../utils/pdf.js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { query } from '../db/database-connect.js'
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

const buildUserPrefix = (documentType) => {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const base = (process.env.S3_PREFIX || '').replace(/\/+$/, '')
  return `${base ? base + '/' : ''}${documentType}/${yyyy}/${mm}/${dd}`
}

const buildNameFile = (data1, data2) => {
  data1 = sanitize(data1)
  data2 = sanitize(data2)
  return `${data1}-${data2}`
}

function safeParseMaybeJSON(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;

  const s = String(value).trim();
  if (!s || s === '[object Object]') return {};

  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

router.get('/payments', async (req, res) => {
  const { folio, idCargo, socio, producto, notas, idTransaccion, idSuscripcion, limit = 50 } = req.query
  const where = []; const vals = []; let i = 1
  const push = (cond, val) => { where.push(cond); vals.push(val) }

  if (folio)          push(`folio = $${i++}`, folio)
  if (idCargo)        push(`id_cargo = $${i++}`, idCargo)
  if (idTransaccion)  push(`id_transaccion = $${i++}`, idTransaccion)
  if (idSuscripcion)  push(`id_suscripcion = $${i++}`, idSuscripcion)
  if (socio)          push(`socio ILIKE $${i++}`, `%${socio}%`)
  if (producto)       push(`(producto ILIKE $${i} OR concepto ILIKE $${i++})`, `%${producto}%`)
  if (notas)          push(`notas ILIKE $${i++}`, `%${notas}%`)

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const sql = `
    SELECT folio, socio, producto, concepto, metodo_de_pago, notas, fecha_de_registro, total,
           id_cargo, id_transaccion, id_suscripcion, evidencia_pago_url, comprobante_url
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
  const documentType = req.headers['documentyype']

  let nameFile = ''
  if(documentType === 'payments'){
    const documentUser = req.headers['documentuser']
    const documentFolio = req.headers['documentfolio']
    nameFile = buildNameFile(documentUser, documentFolio)
  }
  else if(documentType === 'uploadinfo'){
    const user = (req?.user?.email || "").split("@")[0].replace(/[^a-zA-Z0-9]/g, "")
    const documentDataInfo = req.headers['documentdatainfo']
    nameFile = buildNameFile(user, documentDataInfo)
  }
  else if (documentType === 'receipts') {
    const parsedData = safeParseMaybeJSON(req.body.data)
    if (!parsedData || Object.keys(parsedData).length === 0) {
      return res.status(400).json({ error: 'INVALID_OR_MISSING_DATA' })
    }
    nameFile = buildNameFile(parsedData?.socio || 'recibo', parsedData?.folio)
    const pdfBuffer = await renderReceiptToBuffer(parsedData)
    const fauxFile = {
      buffer: pdfBuffer,
      originalname: `${nameFile}.pdf`,
      mimetype: 'application/pdf'
    }
    req.file = fauxFile;
  }
  else{
    return res.status(400).json({ error: 'NO SE PUEDE ALMACENAR EL DOCUMENTO' })
  }

  if (!req.file) return res.status(400).json({ error: 'NO FILE' })
  const allowedTypes = [
    'application/pdf',
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'text/csv' // .csv
  ]

  const { mimetype } = req.file
  const extension = path.extname(req.file.originalname).toLowerCase()
  if (!allowedTypes.includes(mimetype)) {
    return res.status(400).json({
      error: 'ONLY_PDF_OR_EXCEL',
      contentType: mimetype
    })
  }

  const bucket = process.env.S3_BUCKET
  const userPrefix = buildUserPrefix(documentType)
  const baseName = sanitize(nameFile.replace(/\.[^/.]+$/, '')) || 'documento'
  const key = `${userPrefix}/${baseName}${extension}`

  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: mimetype,
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

// --- GUARDAR URL (EVIDENCIA o COMPROBANTE) ---
router.put('/payments/:folio/:field', async (req, res) => {
  const { folio, field } = req.params
  const { url } = req.body

  if (!url) return res.status(400).json({ error: 'URL_REQUIRED' })

  // Validar campo permitido
  const allowed = ['evidencia', 'comprobante']
  if (!allowed.includes(field))
    return res.status(400).json({ error: 'INVALID_FIELD', allowed })

  // Mapear campo a columna real
  const column =
    field === 'evidencia' ? 'evidencia_pago_url' : 'comprobante_url'

  try {
    const { rowCount } = await query(
      `UPDATE reportes_sukhavati.pagos SET ${column} = $1 WHERE folio = $2`,
      [url, folio]
    )

    if (!rowCount) return res.status(404).json({ error: 'NOT_FOUND' })

    res.json({ ok: true, field, folio, url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'DB_UPDATE_ERROR', details: err.message })
  }
})

export default router
