import express from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from '../DB/db.js'
import { sendMail } from '../utils/mailer.js'
const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const TOKEN_TTL_HOURS = 24

function signUser(user) {
  const payload = { id: user.id, email: user.email, role: user.code_role }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return res.status(401).json({ ok:false, error:'NO_TOKEN' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ ok:false, error:'INVALID_TOKEN' })
  }
}

/**
 * 1) Solicitar registro (usuario no registrado)
 * - Crea usuario con rol "views" si no existe (password_hash NULL)
 * - Genera token de registro (enlace para setear contraseña)
 * - En esta versión devolvemos la URL para que integres tu mailer
 */
router.post('/request-register', async (req, res) => {
  try {
    const { email, name } = req.body || {}
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) return res.status(400).json({ ok: false, error: 'EMAIL_REQUIRED' })
    
    // ¿Ya existe?
    const { rows: urows } = await query(
      `SELECT id FROM reportes_sukhavati.users WHERE email = $1`,
      [cleanEmail]
    )
    if (urows.length) {
      // Ya hay usuario: responde ok para no filtrar existencia
      return res.json({ ok: true, message: 'ALREADY_REGISTERED' })
    }

    // Buscar rol por código (por ejemplo 'views')
    const { rows: roleRows } = await query(
      `SELECT id FROM reportes_sukhavati.roles WHERE code = $1`,
      ['views']
    )
    if (!roleRows.length) {
      return res.status(500).json({ ok: false, error: 'ROLE_VIEWS_NOT_FOUND' })
    }
    const rolId = roleRows[0].id

    // Crear usuario preliminar (email_verified=false, password_hash NULL)
    const { rows: newUserRows } = await query(
      `INSERT INTO reportes_sukhavati.users (name, email, password_hash, id_role, email_verified, active)
       VALUES ($1, $2, NULL, $3, false, true)
       RETURNING id`,
      [name || null, cleanEmail, rolId]
    )
    const userId = newUserRows[0].id

    // Crear token de registro con vencimiento (2 horas)
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const { rows: tokenRows } = await query(
      `INSERT INTO reportes_sukhavati.auth_tokens_register (id_user, expires_in)
       VALUES ($1, $2)
       RETURNING token`,
      [userId, expiresAt]
    )
    const token = tokenRows[0].token // <- UUID generado por Postgres

    const url = `${process.env.APP_BASE_URL}/register.html?token=${token}`
    const html = `
      <h2>Registro en Sukhavati</h2>
      <p>Hola ${name ? name + ',' : ''} haz clic en el siguiente botón para completar tu registro:</p>
      <p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b82f6;color:#fff;text-decoration:none">Crear contraseña</a></p>
      <p>Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p><code>${url}</code></p>
      <p>Este enlace expira en 2 horas.</p>
    `
    await sendMail({ to: cleanEmail, subject: 'Completa tu registro', html })

    return res.json({ ok: true, message: 'REGISTER_EMAIL_SENT' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok: false, error: err.message })
  }
})


/**
 * 2) Establecer contraseña por primera vez (con token)
 */
router.post('/set-password', async (req,res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ ok:false, error:'TOKEN_AND_PASSWORD_REQUIRED' })

    const { rows } = await query(
      `SELECT t.id_user, u.email, r.code AS code_role, t.expires_in, t.used_in
       FROM reportes_sukhavati.auth_tokens_register t
       JOIN reportes_sukhavati.users u ON u.id=t.id_user
       JOIN reportes_sukhavati.roles r ON r.id=u.id_role
       WHERE t.token=$1 LIMIT 1`,
      [token]
    )
    if (!rows.length) return res.status(400).json({ ok:false, error:'TOKEN_INVALID' })
    const tk = rows[0]
    if (tk.used_in) return res.status(400).json({ ok:false, error:'TOKEN_USED' })
    if (new Date(tk.expires_in) < new Date()) return res.status(400).json({ ok:false, error:'TOKEN_EXPIRED' })

    const hash = await bcrypt.hash(password, 10)
    await query('BEGIN')
    await query(
      `UPDATE reportes_sukhavati.users SET password_hash=$1, email_verified=true, updated_in=now()
       WHERE id=$2`,
      [hash, tk.id_user]
    )
    await query(`UPDATE reportes_sukhavati.auth_tokens_register SET used_in=now() WHERE token=$1`, [token])
    await query('COMMIT')

    const jwtToken = signUser({ id: tk.id_user, email: tk.email, code_role: tk.code_role })
    return res.json({ ok:true, token: jwtToken })
  } catch (err) {
    await query('ROLLBACK').catch(()=>{})
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 3) Login normal (usuario ya registrado)
 */
router.post('/login', async (req,res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ ok:false, error:'EMAIL_AND_PASSWORD_REQUIRED' })

    const { rows } = await query(
      `SELECT u.id, u.email, u.password_hash, r.code AS code_role
       FROM reportes_sukhavati.users u
       JOIN reportes_sukhavati.roles r ON r.id=u.id_role
       WHERE u.email=LOWER($1) AND u.active=true LIMIT 1`,
      [email]
    )
    if (!rows.length || !rows[0].password_hash) return res.status(401).json({ ok:false, error:'INVALID_CREDENTIALS' })

    const ok = await bcrypt.compare(password, rows[0].password_hash)
    if (!ok) return res.status(401).json({ ok:false, error:'INVALID_CREDENTIALS' })

    const token = signUser(rows[0])
    return res.json({ ok:true, token })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 4) Solicitar cambio de contraseña (envía token de reset)
 */
router.post('/request-reset', async (req,res) => {
  try {
    const { email } = req.body || {}
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) return res.status(400).json({ ok:false, error:'EMAIL_REQUIRED' })

    // Buscar usuario activo
    const { rows: urows } = await query(
      `SELECT id FROM reportes_sukhavati.users WHERE email = LOWER($1) AND active = true LIMIT 1`,
      [cleanEmail]
    )

    // No reveles existencia
    if (!urows.length) return res.json({ ok:true })

    const userId = urows[0].id

    // Invalidar tokens previos sin usar
    await query(
      `UPDATE reportes_sukhavati.auth_tokens_reset
         SET used_in = now()
       WHERE id_user = $1 AND used_in IS NULL`,
      [userId]
    )

    // Crear token con vencimiento (24h)
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000)
    const { rows: trows } = await query(
      `INSERT INTO reportes_sukhavati.auth_tokens_reset (id_user, expires_in)
       VALUES ($1, $2)
       RETURNING token`,
      [userId, expiresAt]
    )
    const token = trows[0].token

    // URL hacia el formulario de reset (nuevo reset.html)
    const base = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
    const url  = `${base}/reset.html?token=${token}`

    // Enviar correo
    const html = `
      <h2>Restablecer contraseña</h2>
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b82f6;color:#fff;text-decoration:none">Crear nueva contraseña</a></p>
      <p>Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p><code>${url}</code></p>
      <p>Este enlace expira en ${TOKEN_TTL_HOURS} horas.</p>
    `
    await sendMail({ to: cleanEmail, subject: 'Restablece tu contraseña', html })

    return res.json({ ok: true, message: 'REQUEST_RESET_PASSWORD' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})


/**
 * 5) Reset de contraseña con token
 */
router.post('/reset-password', async (req,res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return res.status(400).json({ ok:false, error:'TOKEN_AND_PASSWORD_REQUIRED' })
    const { rows } = await query(
      `SELECT t.id_user, u.email, r.code AS code_role, t.expires_in, t.used_in
       FROM reportes_sukhavati.auth_tokens_reset t
       JOIN reportes_sukhavati.users u ON u.id=t.id_user
       JOIN reportes_sukhavati.roles r ON r.id=u.id_role
       WHERE t.token=$1 LIMIT 1`,
      [token]
    )
    if (!rows.length) return res.status(400).json({ ok:false, error:'TOKEN_INVALID' })
    const tk = rows[0]
    if (tk.used_in) return res.status(400).json({ ok:false, error:'TOKEN_USED' })
    if (new Date(tk.expires_in) < new Date()) return res.status(400).json({ ok:false, error:'TOKEN_EXPIRED' })

    const hash = await bcrypt.hash(password, 10)
    await query('BEGIN')
    await query(`UPDATE reportes_sukhavati.users SET password_hash=$1, updated_in=now() WHERE id=$2`, [hash, tk.id_user])
    await query(`UPDATE reportes_sukhavati.auth_tokens_reset SET used_in=now() WHERE token=$1`, [token])
    await query('COMMIT')

    const jwtToken = signUser({ id: tk.id_user, email: tk.email, code_role: tk.code_role })
    return res.json({ ok:true, token: jwtToken })
  } catch (err) {
    await query('ROLLBACK').catch(()=>{})
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 6) Solicitar cambio de rol (auth requerido)
 */
router.post('/request-role-change', authRequired, async (req, res) => {
  try {
    const rolRaw = req.body?.rol ?? req.body?.role
    const rol = typeof rolRaw === 'string' ? rolRaw.trim().toLowerCase() : ''
    if (!rol) return res.status(400).json({ ok:false, error:'ROL_REQUIRED' })

    const { rows: roleRows } = await query(
      `SELECT id FROM reportes_sukhavati.roles WHERE code = $1`,
      [rol]
    )
    if (!roleRows.length) {
      return res.status(400).json({ ok:false, error:'ROL_NOT_FOUND' })
    }

    await query(
      `INSERT INTO reportes_sukhavati.requests_change_role (id_user, id_requested_role, status)
       VALUES ($1,$2,'pendiente')`,
      [req.user.id, roleRows[0].id]
    )

    // === Enviar correo ===
    const html = `
      <h2>Solicitud de cambio de rol</h2>
      <p><b>Usuario:</b> ${req.user.email}</p>
      <p><b>Rol solicitado:</b> ${rol}</p>
      <p><b>Fecha:</b> ${new Date().toLocaleString()}</p>
      <p>Revisa esta solicitud en el panel de administración.</p>
    `
    await sendMail({
      to: process.env.NOTIFY_TO,
      subject: `Nueva solicitud de cambio de rol: ${rol}`,
      html,
    })

    await sendMail({
      to: req.user.email,
      subject: 'Solicitud de cambio de rol recibida',
      html: `
        <p>Hola ${req.user.name || ''},</p>
        <p>Hemos recibido tu solicitud para cambiar tu rol a <b>${rol}</b>.</p>
        <p>Te notificaremos cuando sea aprobada.</p>
      `,
    })

    return res.json({ ok:true, message:'ROLE_CHANGE_REQUESTED' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 7) Aprobar/Rechazar cambio de rol (requiere rol admin – aquí lo validamos vía JWT)
 */
router.post('/resolve-role-change', authRequired, async (req,res) => {
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ ok:false, error:'FORBIDDEN' })
    const { id, approve } = req.body
    if (!id) return res.status(400).json({ ok:false, error:'ID_REQUIRED' })

    const { rows } = await query(
      `SELECT scr.id_user, scr.id_requested_role, r.code AS code_role
       FROM reportes_sukhavati.requests_change_role scr
       JOIN reportes_sukhavati.roles r ON r.id = scr.id_requested_role
       WHERE scr.id=$1 AND scr.status='pendiente'`,
      [id]
    )
    if (!rows.length) return res.status(404).json({ ok:false, error:'REQUEST_NOT_FOUND' })

    await query('BEGIN')
    if (approve) {
      await query(`UPDATE reportes_sukhavati.users SET id_role=$1, updated_in=now() WHERE id=$2`, [rows[0].id_requested_role, rows[0].id_user])
      await query(`UPDATE reportes_sukhavati.requests_change_role SET status='aprobada', solved_in=now(), solved_by_id=$1 WHERE id=$2`, [req.user.id, id])
    } else {
      await query(`UPDATE reportes_sukhavati.requests_change_role SET status='rechazada', solved_in=now(), solved_by_id=$1 WHERE id=$2`, [req.user.id, id])
    }
    await query('COMMIT')
    return res.json({ ok:true })
  } catch (err) {
    await query('ROLLBACK').catch(()=>{})
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 8) Registro completado
 */
router.post('/register-complete', async (req, res) => {
  try {
    const { token, password } = req.body || {}
    if (!token || !password) {
      return res.status(400).json({ ok:false, error:'TOKEN_AND_PASSWORD_REQUIRED' })
    }

    // 1) Buscar el token por su UUID (SIN hash) en la tabla real
    const { rows: toks } = await query(
      `SELECT token, id_user, expires_in, used_in
         FROM reportes_sukhavati.auth_tokens_register
        WHERE token = $1`,
      [String(token)]
    )
    if (!toks.length) {
      return res.status(400).json({ ok:false, error:'TOKEN_INVALID' })
    }

    const t = toks[0]
    if (t.used_in) {
      return res.status(400).json({ ok:false, error:'TOKEN_USED' })
    }
    if (new Date(t.expires_in) < new Date()) {
      return res.status(400).json({ ok:false, error:'TOKEN_EXPIRED' })
    }

    // 2) Traer al usuario dueño del token
    const { rows: urows } = await query(
      `SELECT id, email, password_hash, email_verified, active
         FROM reportes_sukhavati.users
        WHERE id = $1`,
      [t.id_user]
    )
    if (!urows.length) {
      // Inconsistencia: hay token a un usuario inexistente
      return res.status(500).json({ ok:false, error:'USER_NOT_FOUND_FOR_TOKEN' })
    }

    const user = urows[0]
    if (user.email_verified && user.password_hash) {
      // Ya estaba registrado; marcamos el token como usado y devolvemos estado
      await query(
        `UPDATE reportes_sukhavati.auth_tokens_register SET used_in = now() WHERE token = $1`,
        [t.token]
      )
      return res.json({ ok:true, message:'ALREADY_REGISTERED' })
    }

    // 3) Setear contraseña y verificar email
    const passHash = await bcrypt.hash(String(password), 10)
    await query(
      `UPDATE reportes_sukhavati.users
          SET password_hash = $2,
              email_verified = true,
              updated_in = now()
        WHERE id = $1`,
      [user.id, passHash]
    )

    // 4) Marcar token como usado
    await query(
      `UPDATE reportes_sukhavati.auth_tokens_register
          SET used_in = now()
        WHERE token = $1`,
      [t.token]
    )

    // (Opcional) correo de bienvenida
    try {
      await sendMail({
        to: user.email,
        subject: '¡Bienvenido a Sukhavati!',
        html: `<p>Tu cuenta fue creada con éxito.</p>`,
      })
    } catch (_) {}

    return res.json({ ok:true, message:'REGISTER_COMPLETED', userId: user.id })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 9) Reenviar registro
 */
router.post('/register-resend', async (req, res) => {
  try {
    const { email } = req.body || {}
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) return res.status(400).json({ ok:false, error:'EMAIL_REQUIRED' })

    // (Opcional) verifica si ya existe usuario
    const { rows: urows } = await query(
      `SELECT id FROM reportes_sukhavati.users WHERE email = $1`, [cleanEmail]
    )
    if (urows.length) {
      // si ya existe, puedes responder ok para no filtrar existencia
      return res.json({ ok:true, message:'ALREADY_REGISTERED' })
    }

    // Genera token (32 bytes) y guarda hash sha256
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 horas

    await query(
      `INSERT INTO reportes_sukhavati.auth_tokens_register (email, token_hash, expires_at, meta)
       VALUES ($1,$2,$3,$4)`,
      [cleanEmail, tokenHash, expires, JSON.stringify({ name: name || null })]
    )

    const url = `${process.env.APP_BASE_URL}/register.html?token=${token}`
    const html = `
      <h2>Registro en Sukhavati</h2>
      <p>Hola ${name ? name : ''}${name ? ',' : ''} haz clic en el siguiente botón para completar tu registro:</p>
      <p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b82f6;color:#fff;text-decoration:none">Crear contraseña</a></p>
      <p>Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p><code>${url}</code></p>
      <p>Este enlace expira en 2 horas.</p>
    `
    await sendMail({ to: cleanEmail, subject: 'Completa tu registro', html })

    return res.json({ ok:true, message:'REGISTER_EMAIL_SENT' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})


export default router
