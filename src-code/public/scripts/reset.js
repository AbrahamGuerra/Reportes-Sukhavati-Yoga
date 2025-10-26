const params = new URLSearchParams(location.search)
const token = params.get('token')
const msgEl = document.getElementById('msg')
const btn = document.getElementById('btn')

// Acepta UUID v4 (como en register.js)
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (!token || !uuidRe.test(token)) {
  msgEl.textContent = 'El enlace es inválido o está incompleto.'
  btn.disabled = true
}

btn.addEventListener('click', async () => {
  const pass = document.getElementById('password').value
  const pass2 = document.getElementById('password2').value

  msgEl.textContent = ''

  if (!pass || pass.length < 8) {
    msgEl.textContent = 'La contraseña debe tener al menos 8 caracteres.'
    return
  }
  if (pass !== pass2) {
    msgEl.textContent = 'Las contraseñas no coinciden.'
    return
  }

  btn.disabled = true
  btn.textContent = 'Procesando...'

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pass }),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      throw new Error(json.error || res.statusText)
    }

    msgEl.style.color = '#10b981'
    msgEl.textContent = '¡Listo! Tu contraseña se actualizó.'
    btn.textContent = 'Completado'
    setTimeout(() => {
      location.href = '/login.html'
    }, 1500)
  } catch (err) {
    msgEl.style.color = '#ef4444'
    msgEl.textContent = 'Error: ' + err.message
    btn.disabled = false
    btn.textContent = 'Actualizar contraseña'
  }
})
