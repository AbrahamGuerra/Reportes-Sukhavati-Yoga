import { requestRegister, login, requestReset, setPassword, resetPassword, setToken } from './api.js'

const $ = s => document.querySelector(s)
const put = (sel, txt='') => { const n=$(sel); if(n) n.textContent = txt }
const normalizeEmail = (raw) => String(raw||'').trim().replace(/[,;]+$/g,'').replace(/\s+/g,'').toLowerCase()
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const mapError = (code) => {
  const c = String(code||'').toUpperCase()
  if (c.includes('EMAIL_REQUIRED')) return 'El correo es obligatorio.'
  if (c.includes('EMAIL_INVALID'))  return 'Escribe un correo válido.'
  if (c.includes('INVALID_CREDENTIALS')) return 'Correo o contraseña incorrectos.'
  if (c.includes('USER_EXISTS')) return 'Ese correo ya tiene acceso.'
  return code || 'Ocurrió un error'
}

const toggleAllOff = () => {
  ['#section-new-register','#section-user-login','#section-set','#section-reset']
    .forEach(id => $(id)?.classList.remove('active'))
  $('#link-new-register')?.classList.remove('active')
  $('#link-user-login')?.classList.remove('active')
}
const toggleSection = (showNuevo) => {
  toggleAllOff()
  if (showNuevo) {
    $('#section-new-register')?.classList.add('active')
    $('#link-new-register')?.classList.add('active')
  } else {
    $('#section-user-login')?.classList.add('active')
    $('#link-user-login')?.classList.add('active')
  }
}

// --- inicio: manejar ?set= y ?reset=
window.addEventListener('DOMContentLoaded', () => {
  const qs = new URLSearchParams(location.search)
  const tokenSet   = qs.get('set')
  const tokenReset = qs.get('reset')

  toggleAllOff()

  if (tokenSet) {
    $('#section-set')?.classList.add('active')
    return
  }
  if (tokenReset) {
    $('#section-reset')?.classList.add('active')
    return
  }
  // si no hay token, no mostramos nada hasta click
})

// Links de pestañas
$('#link-new-register')?.addEventListener('click', () => toggleSection(true))
$('#link-user-login')?.addEventListener('click', () => toggleSection(false))

// Solicitar acceso
$('#btn-request')?.addEventListener('click', async () => {
  put('#req-msg','')
  try {
    const nombre = $('#req-name').value.trim()
    const email  = normalizeEmail($('#req-email').value)
    if (!email) return put('#req-msg','El correo es obligatorio.')
    if (!isEmail(email)) return put('#req-msg','Escribe un correo válido.')

    const btn = $('#btn-request'); btn.disabled = true; btn.textContent = 'Enviando...'
    const { message } = await requestRegister({ email, nombre })
    put('#req-msg', message)
    
    btn.disabled = false; btn.textContent = 'Enviar enlace'
  } catch (e) {
    put('#req-msg', mapError(e.message))
    const btn = $('#btn-request'); if (btn) { btn.disabled = false; btn.textContent = 'Enviar enlace' }
  }
})

// Login
$('#btn-login')?.addEventListener('click', async () => {
  put('#log-msg','')
  try {
    const email = normalizeEmail($('#log-email').value)
    const password = $('#log-pass').value
    if (!email) return put('#log-msg','El correo es obligatorio.')
    if (!isEmail(email)) return put('#log-msg','Escribe un correo válido.')
    if (!password) return put('#log-msg','La contraseña es obligatoria.')

    const btn = $('#btn-login'); btn.disabled = true; btn.textContent = 'Entrando...'
    const { token } = await login({ email, password })
    setToken(token)
    location.href = 'index.html'
  } catch (e) {
    put('#log-msg', mapError(e.message))
    const btn = $('#btn-login'); if (btn) { btn.disabled = false; btn.textContent = 'Entrar' }
  }
})

// Olvidé mi contraseña
$('#btn-reset-ask')?.addEventListener('click', async () => {
  put('#log-msg','')
  try {
    const email = normalizeEmail($('#log-email').value)
    if (!email) return put('#log-msg','El correo es obligatorio.')
    if (!isEmail(email)) return put('#log-msg','Escribe un correo válido.')

    const btn = $('#btn-reset-ask'); btn.disabled = true; btn.textContent = 'Enviando...'
    await requestReset({ email })
    put('#log-msg','Si el correo existe, se envió un enlace.')
    btn.disabled = false; btn.textContent = 'Olvidé mi contraseña'
  } catch (e) {
    put('#log-msg', mapError(e.message))
    const btn = $('#btn-reset-ask'); if (btn) { btn.disabled = false; btn.textContent = 'Olvidé mi contraseña' }
  }
})

// Guardar contraseña (SET)
$('#btn-set')?.addEventListener('click', async () => {
  put('#set-msg','')
  try {
    const pass = $('#set-pass').value
    if (!pass || pass.length < 6) return put('#set-msg','La contraseña debe tener al menos 6 caracteres.')

    const token = new URLSearchParams(location.search).get('set')
    const { token: auth } = await setPassword({ token, password: pass })
    setToken(auth)
    location.href = 'index.html'
  } catch (e) {
    put('#set-msg', mapError(e.message))
  }
})

// Restablecer contraseña (RESET)
$('#btn-reset')?.addEventListener('click', async () => {
  put('#reset-msg','')
  try {
    const pass = $('#reset-pass').value
    if (!pass || pass.length < 6) return put('#reset-msg','La contraseña debe tener al menos 6 caracteres.')

    const token = new URLSearchParams(location.search).get('reset')
    const { token: auth } = await resetPassword({ token, password: pass })
    setToken(auth)
    location.href = 'index.html'
  } catch (e) {
    put('#reset-msg', mapError(e.message))
  }
})
