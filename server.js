import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRoutes from './src/routes/auth.js'
import uploadInformation from './src/routes/upload-information.js'
import paymentReports from './src/routes/payment-reports.js'
import bucket from './src/routes/bucket.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Archivos públicos y subidas
app.use('/sukhavati/users', express.static(path.join(__dirname, '../uploads/sukhavati/users')))
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ✅ Servir SOLO bajo /Sukhavati-Yoga
app.use('/Sukhavati-Yoga', express.static(path.join(__dirname, 'public')))

// ✅ Redirigir SIEMPRE lo que llegue a raíz → /Sukhavati-Yoga (con query intacto)
app.get('/', (req, res) => res.redirect(301, '/Sukhavati-Yoga/'))

// ✅ Redirigir cualquier ruta de raíz (html o sin extensión) hacia /Sukhavati-Yoga/...
app.use((req, res, next) => {
  // no tocar API ni uploads ni cuando ya está en /Sukhavati-Yoga
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/sukhavati/') ||
    req.path.startsWith('/Sukhavati-Yoga/')
  ) return next()

  // Construye destino conservando path y query string
  const location = `/Sukhavati-Yoga${req.originalUrl}`
  return res.redirect(301, location)
})

// ✅ Rutas sin .html cuando ya estás bajo /Sukhavati-Yoga
app.use((req, res, next) => {
  if (!req.path.startsWith('/Sukhavati-Yoga/') || path.extname(req.path)) return next()

  const sub = req.path.replace(/^\/Sukhavati-Yoga\/?/, '/')
  const fileA = path.join(__dirname, 'public', sub + '.html')
  const fileB = path.join(__dirname, 'public', sub, 'index.html')

  res.sendFile(fileA, errA => {
    if (errA) res.sendFile(fileB, errB => errB && next())
  })
})

// API
app.use('/api/information', uploadInformation)
app.use('/api/paymentreports', paymentReports)
app.use('/api/bucket', bucket)
app.use('/api/auth', authRoutes)

app.get('/api/health', (req, res) => {
  res.status(200).send('ok')
})

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  console.log(`Sukhavati on port: ${port}`)
})
