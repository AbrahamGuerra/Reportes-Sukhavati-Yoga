// scripts/register.js
const params = new URLSearchParams(location.search)
const token = params.get('token')
const msgEl = document.getElementById('msg')
const btn = document.getElementById('btn')

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
if (token && !uuidRe.test(token)) {
  msgEl.textContent = 'El enlace de activación es inválido.'
  btn.disabled = true
}

btn.addEventListener('click', async () => {
  const name = document.getElementById('name').value.trim()
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
    const res = await fetch('/api/auth/registercomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: p1, name }),
    })

    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      throw new Error(json.error || res.statusText)
    }

    msgEl.style.color = '#10b981'
    msgEl.textContent = '¡Cuenta activada con éxito! Ya puedes iniciar sesión.'
    btn.textContent = 'Completado'
    setTimeout(() => {
      location.href = '/login.html'
    }, 2000)
  } catch (err) {
    msgEl.style.color = '#ef4444'
    msgEl.textContent = 'Error: ' + err.message
    btn.disabled = false
    btn.textContent = 'Activar cuenta'
  }
})
