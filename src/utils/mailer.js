import nodemailer from 'nodemailer'

export const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendMail({ to, subject, html }) {
  try {
    const info = await mailer.sendMail({
      from: `"Reportes Sukhavati Yoga" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    })
    console.log('Correo enviado:', info.messageId)
    return true
  } catch (err) {
    console.error('Error enviando correo:', err)
    return false
  }
}
