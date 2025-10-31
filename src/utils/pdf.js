import PDFDocument from 'pdfkit'

// === genera PDF en buffer ===
export function renderReceiptToBuffer(data = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 })
      const chunks = []

      // recolectamos los fragmentos de datos PDF
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve(buffer)
      })
      doc.on('error', reject)

      // --- contenido del comprobante ---
      const safeFolio = String(data.folio ?? 'sin-folio')
      doc.fontSize(18).text('Comprobante de pago', { align: 'center' })
      doc.moveDown()

      const line = (label, value) => {
        if (!value) return
        doc.fontSize(12)
          .text(`${label}: `, { continued: true })
          .font('Helvetica-Bold')
          .text(String(value))
          .font('Helvetica')
      }

      line('Folio', safeFolio)
      line('Socio', data.socio || '—')
      line('Email', data.email || '—')
      line('Móvil', data.movil || '—')
      line('Producto', data.producto || '—')
      line('Total', data.total ?? '—')

      doc.moveDown()
      doc.fontSize(10).text(`Fecha de generación: ${new Date().toLocaleString()}`)
      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}