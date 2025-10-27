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
app.use('/sukhavati/users', express.static(path.join(__dirname, '../uploads/sukhavati/users')))
app.use(cors())
app.use(express.json({ limit: '1mb' }))   
app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))

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
