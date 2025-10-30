import express from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from '../DB/db.js'
import { sendMail } from '../utils/mailer.js'
import { authRequired } from '../auth/middleware.js'
import { audit } from '../middleware/audit.js'

const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const TOKEN_TTL_HOURS = 24

function signUser(user) {
  const payload = { id: user.id, email: user.email, role: user.code_role }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

/**
 * 1) Solicitar registro (usuario no registrado)
 * - Crea usuario con rol "views" si no existe (password_hash NULL)
 * - Genera token de registro (enlace para setear contraseña)
 * - En esta versión devolvemos la URL para que integres tu mailer
 */
router.post('/request-register', async (req, res) => {
  try {
    const { email, name } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) return res.status(400).json({ ok: false, error: 'EMAIL_REQUIRED' });

    // 🔹 Verificar cantidad actual de usuarios
    const { rows: countRows } = await query(`
      SELECT COUNT(*) AS total
      FROM reportes_sukhavati.users
    `);
    const totalUsuarios = parseInt(countRows[0].total, 10);
    if (totalUsuarios >= 10) {
      return res.status(403).json({
        ok: false,
        error: 'USER_LIMIT_REACHED',
        message: 'No se pueden registrar más de 10 usuarios.'
      });
    }

    // 🔹 ¿Ya existe el usuario?
    const { rows: urows } = await query(
      `SELECT id FROM reportes_sukhavati.users WHERE email = $1`,
      [cleanEmail]
    );
    if (urows.length) {
      return res.json({ ok: true, message: 'ALREADY_REGISTERED' });
    }

    // 🔹 Buscar rol "views"
    const { rows: roleRows } = await query(
      `SELECT id FROM reportes_sukhavati.roles WHERE code = $1`,
      ['views']
    );
    if (!roleRows.length) {
      return res.status(500).json({ ok: false, error: 'ROLE_VIEWS_NOT_FOUND' });
    }
    const rolId = roleRows[0].id;

    // 🔹 Crear usuario preliminar
    const { rows: newUserRows } = await query(
      `INSERT INTO reportes_sukhavati.users (name, email, password_hash, id_role, email_verified, active)
       VALUES ($1, $2, NULL, $3, false, true)
       RETURNING id`,
      [name || null, cleanEmail, rolId]
    );
    const userId = newUserRows[0].id;

    // 🔹 Token de registro (2 horas)
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const { rows: tokenRows } = await query(
      `INSERT INTO reportes_sukhavati.auth_tokens_register (id_user, expires_in)
       VALUES ($1, $2)
       RETURNING token`,
      [userId, expiresAt]
    );
    const token = tokenRows[0].token;

    // 🔹 Enviar correo
    const url = `${process.env.APP_BASE_URL}/register.html?token=${token}`;
    const html = `
      <h2>Registro en Sukhavati</h2>
      <p>Hola ${name ? name + ',' : ''} haz clic en el siguiente botón para completar tu registro:</p>
      <p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b82f6;color:#fff;text-decoration:none">Crear contraseña</a></p>
      <p>Si el botón no funciona, copia y pega esta URL en tu navegador:</p>
      <p><code>${url}</code></p>
      <p>Este enlace expira en 2 horas.</p>
    `;
    await sendMail({ to: cleanEmail, subject: 'Completa tu registro', html });

    return res.json({ ok: true, message: 'CORREO ENVIADO' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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
router.post('/login', audit('login_attempt'), async (req,res) => {
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
 * 7) // Listar solicitudes de cambio de rol
 */
router.get('/admin/role-requests', authRequired, async (req,res) => {
  try {
    const status = (req.query.status || 'pendiente').toLowerCase()
    const { rows } = await query(
      `SELECT rr.id,
              rr.id_user,
              u.email,
              u.name,
              rr.id_requested_role,
              r.code AS requested_role_code,
              r.name AS requested_role_name,
              rr.reason,
              rr.status,
              rr.create_in AS requested_in,  -- 👈 en tu DDL es "create_in"
              rr.solved_in
         FROM reportes_sukhavati.requests_change_role rr
         JOIN reportes_sukhavati.users u  ON u.id = rr.id_user
         JOIN reportes_sukhavati.roles r  ON r.id = rr.id_requested_role
        WHERE rr.status = $1
        ORDER BY rr.create_in DESC`,
      [status]
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ ok:false, error:e.message })
  }
})

/**
 * 8) Aprobar/Rechazar cambio de rol (requiere rol admin – aquí lo validamos vía JWT)
 */
router.post('/resolve-role-change', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').trim().toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const { id, action } = req.body;
  if (!id) return res.status(400).json({ ok: false, error: 'ID_REQUIRED' });

  // Normaliza booleanos del front
  const approveBool =
    typeof action === 'boolean'
      ? action
      : String(action).toLowerCase() === 'approve' || String(action).toLowerCase() === 'true';

  try {
    // Valida que exista la solicitud y esté pendiente
    const { rows: reqRows } = await query(
      `SELECT id, id_user, id_requested_role
         FROM reportes_sukhavati.requests_change_role
        WHERE id = $1 AND status = 'pendiente'`,
      [id]
    );
    
    if (!reqRows.length) {
      return res.status(404).json({ ok: false, error: 'REQUEST_NOT_FOUND' });
    }

    let affectedUser = 0;

    if (approveBool) {
      // Actualiza id_role del usuario usando UPDATE ... FROM
      const upUser = await query(
        `UPDATE reportes_sukhavati.users AS u
            SET id_role = rcr.id_requested_role
           FROM reportes_sukhavati.requests_change_role AS rcr
          WHERE rcr.id = $1
            AND rcr.status = 'pendiente'
            AND u.id = rcr.id_user`,
        [id]
      );
      affectedUser = upUser.rowCount;

      // Marca la solicitud como aprobada
      await query(
        `UPDATE reportes_sukhavati.requests_change_role
            SET status = 'aprobada',
                solved_in = now(),
                solved_by_id = $1
          WHERE id = $2`,
        [req.user.id, id]
      );

      // Si no encontró usuario, revierte
      if (affectedUser === 0) {
        return res.status(409).json({
          ok: false,
          error: 'USER_NOT_UPDATED',
          detail: 'No se encontró el usuario vinculado a la solicitud.'
        });
      }
    } else {
      // Rechazo
      await query(
        `UPDATE reportes_sukhavati.requests_change_role
            SET status = 'rechazada',
                solved_in = now(),
                solved_by_id = $1
          WHERE id = $2`,
        [req.user.id, id]
      );
    }

    // Consulta final para verificar rol actualizado
    const { rows: userNow } = await query(
      `SELECT u.id, u.id_role
         FROM reportes_sukhavati.users u
         JOIN reportes_sukhavati.requests_change_role rcr ON rcr.id_user = u.id
        WHERE rcr.id = $1`,
      [id]
    );

    try {
      const subject = 'Sukhavati | Cambio de rol'
      const message = approveBool
        ? `<p>Tu cambio de rol fue <strong>aprobado</strong>. ¡Ya puedes disfrutar de tus nuevos permisos!</p>`
        : `<p>Tu cambio de rol <strong>no fue aprobado</strong>. Si crees que se trata de un error, puedes comunicarte con el administrador.</p>`

      await sendMail({
        to: user.email,
        subject,
        html: message,
      })
    } catch (_) {}

    return res.json({
      ok: true,
      affected_user_rows: affectedUser,
      user_after: userNow[0] || null
    });
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
});


/**
 * 9) Registro completado
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
 * 10) Reenviar registro
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

    return res.json({ ok:true, message:'CORREO ENVIADO' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ ok:false, error: err.message })
  }
})

/**
 * 11) GET límite actual de usuarios
 */
router.get('/admin/user-limit', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  const { rows } = await query(`
    SELECT COALESCE(NULLIF(value, '')::int, 10) AS user_max
    FROM reportes_sukhavati.settings
    WHERE key='user_max'
  `);
  const user_max = rows.length ? rows[0].user_max : 10;
  res.json({ ok:true, user_max });
});

/**
 * 12) PUT actualizar límite de usuarios
 */
router.put('/admin/user-limit', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  const value = parseInt(req.body?.value, 10);
  if (!Number.isInteger(value) || value < 1) {
    return res.status(400).json({ ok:false, error:'INVALID_LIMIT' });
  }
  await query(`
    INSERT INTO reportes_sukhavati.settings (key, value)
    VALUES ('user_max', $1::text)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_in = now()
  `, [String(value)]);

  res.json({ ok:true, message:'USER_LIMIT_UPDATED', value });
});

/**
 * 13) GET listar usuarios (búsqueda simple)
 */
router.get('/admin/users', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  const q = String(req.query.q || '').trim().toLowerCase();
  const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : null;

  const params = [];
  let where = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.name,'')) LIKE $${params.length})`);
  }
  if (active !== null) {
    params.push(active);
    where.push(`u.active = $${params.length}`);
  }
  const sql = `
    SELECT 
      u.id,
      u.name,
      u.email,
      u.active,
      r.code AS role_code,
      r.name AS role_name
    FROM reportes_sukhavati.users u
    LEFT JOIN reportes_sukhavati.roles r 
      ON r.id = u.id_role
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.created_in DESC NULLS LAST, u.id DESC
    LIMIT 200;
  `;
  const { rows } = await query(sql, params);
  res.json(rows);
});

/**
 * 14) PATCH actualizar usuario (name, role, active)
 */
router.patch('/admin/users/:id', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  const id = req.params.id;
  const { name, role, active } = req.body || {};

  // Resuelve rol si viene 'role'
  let id_role = null;
  if (role) {
    const { rows } = await query(`SELECT id FROM reportes_sukhavati.roles WHERE code=$1`, [String(role).toLowerCase()]);
    if (!rows.length) return res.status(400).json({ ok:false, error:'ROLE_NOT_FOUND' });
    id_role = rows[0].id;
  }

  const fields = [];
  const vals = [];
  if (typeof name !== 'undefined') { vals.push(name || null); fields.push(`name=$${vals.length}`); }
  if (id_role !== null)         { vals.push(id_role);       fields.push(`id_role=$${vals.length}`); }
  if (typeof active === 'boolean') { vals.push(active);     fields.push(`active=$${vals.length}`); }
  if (!fields.length) return res.status(400).json({ ok:false, error:'NO_FIELDS' });

  vals.push(id);
  const sql = `
    UPDATE reportes_sukhavati.users
       SET ${fields.join(', ')}, updated_in=now()
     WHERE id=$${vals.length}
     RETURNING id, name, email, active
  `;
  try {
    const { rows } = await query(sql, vals);
    return res.json({ ok:true, user: rows[0] });
  } catch (e) {
    return res.status(400).json({ ok:false, error: e.message });
  }
});

/**
 * 15) DELETE desactivar (soft-delete)
 */
router.delete('/admin/users/:id', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  const id = req.params.id;
  const { rows } = await query(`
    UPDATE reportes_sukhavati.users
       SET active=false, updated_in=now()
     WHERE id=$1
     RETURNING id, email
  `, [id]);

  if (!rows.length) return res.status(404).json({ ok:false, error:'USER_NOT_FOUND' });
  res.json({ ok:true, message:'USER_DEACTIVATED', id: rows[0].id });
});

/**
 * 16) Listar roles disponibles (solo admin)
 */
router.get('/admin/roles', authRequired, async (req, res) => {
  const isAdmin = String(req.user?.role || '').trim().toLowerCase() === 'admin';
  if (!isAdmin) return res.status(403).json({ ok:false, error:'FORBIDDEN' });

  try {
    const { rows } = await query(`
      SELECT id, code, name
      FROM reportes_sukhavati.roles
      ORDER BY id
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

/**
 * 16) GET /api/auth/admin/audit-logs
 */
router.get('/admin/audit-logs', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase()
    if (role !== 'admin') return res.status(403).json({ ok:false, error:'FORBIDDEN' })

    const {
      q = '',                // busca en email/route/action
      action = '',           // ej: login_attempt, role_update
      outcome = '',          // success | fail
      from,                  // YYYY-MM-DD
      to,                    // YYYY-MM-DD
      limit = 50,
      offset = 0
    } = req.query

    const params = []
    const where = []

    if (q) {
      params.push(`%${q.toLowerCase()}%`)
      where.push(`(lower(email::text) LIKE $${params.length} OR lower(route) LIKE $${params.length} OR lower(action) LIKE $${params.length})`)
    }
    if (action) {
      params.push(action.toLowerCase())
      where.push(`lower(action) = $${params.length}`)
    }
    if (outcome) {
      params.push(outcome.toLowerCase())
      where.push(`lower(outcome) = $${params.length}`)
    }
    if (from) {
      params.push(from)
      where.push(`occurred_at::date >= $${params.length}`)
    }
    if (to) {
      params.push(to)
      where.push(`occurred_at::date <= $${params.length}`)
    }

    params.push(Number(limit)); const limitIdx = params.length
    params.push(Number(offset)); const offsetIdx = params.length

    const sql = `
      WITH base AS (
        SELECT
          occurred_at, user_id, email, action, outcome, reason,
          route, http_status, ip, user_agent, latency_ms, meta
        FROM reportes_sukhavati.auth_audit_log
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY occurred_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )
      SELECT jsonb_build_object(
        'rows', jsonb_agg(to_jsonb(base)),
        'limit', $${limitIdx},
        'offset', $${offsetIdx}
      ) AS payload
      FROM base;
    `

    const { rows } = await query(sql, params)
    const payload = rows?.[0]?.payload || { rows: [], limit, offset }
    res.json(payload)
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message })
  }
})

/**
 * 17) DELETE Elimina todos los registros de auditoría (solo admin)
 */
router.delete('/admin/audit-logs', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

    await query(`DELETE FROM reportes_sukhavati.auth_audit_log;`);
    res.json({ ok: true, message: 'AUDIT_LOGS_CLEARED' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router
