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

/** --- Static files --- **/

// Subidas públicas (corrige el path relativo y deja URL estable)
app.use(
  '/sukhavati/users',
  express.static(path.join(__dirname, 'uploads/sukhavati/users'))
)

// Frontend: sirve exactamente la subcarpeta Reportes-Sukhavati-Yoga
app.use(
  '/Reportes-Sukhavati-Yoga',
  express.static(path.join(__dirname, 'public/Reportes-Sukhavati-Yoga'))
)

// Si alguien entra al root del API por HTTP directo, redirige al front
app.get('/', (_req, res) => res.redirect('/Reportes-Sukhavati-Yoga/'))

/** --- Middlewares --- **/
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

/** --- API (con prefijo /api) --- **/
app.use('/api/information', uploadInformation)
app.use('/api/paymentreports', paymentReports)
app.use('/api/bucket', bucket)
app.use('/api/auth', authRoutes)

app.get('/api/health', (_req, res) => {
  res.status(200).send('ok')
})

/** --- Start --- **/
const port = Number(process.env.PORT || 3000) // <-- 3000 por defecto
app.listen(port, () => {
  console.log(`Reports Sukhavati on port: ${port}`)
})
