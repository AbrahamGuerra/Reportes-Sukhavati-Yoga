import { requireAuth } from './guard.js'
import { getToken, clearToken, requestRoleChange } from './api.js'
import { formModal, toast } from './ui/modal.js'

document.addEventListener('DOMContentLoaded', async () => {
  const payload = await requireAuth() // Verifica login

  if (!payload) return

  document.getElementById('user-info').textContent =
    `Conectado como: ${payload.email} | Rol: ${payload.rol}`

  const btnCarga = document.getElementById('btn-go-load')
  const btnCargarFile = document.getElementById('btn-go-upload-pdf-payments')
  const btnSolicitarRol = document.getElementById('btn-request-rol')

  if (payload.rol === 'views') {
    btnCarga.style.display = 'none'
    btnCargarFile.style.display = 'none'
    btnSolicitarRol.style.display = 'none'
  }
})

document.getElementById('btn-go-load')?.addEventListener('click', () => {
  window.location.href = 'upload-information.html'
})

document.getElementById('btn-go-upload-pdf-payments')?.addEventListener('click', () => {
  window.location.href = 'upload-pdf-payments.html'
})

document.getElementById('btn-go-payment-reports')?.addEventListener('click', () => {
  window.location.href = 'payment-reports.html'
})

// === Mostrar info del usuario ===
const token = getToken()
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    document.getElementById('user-info').textContent =
      `Conectado como: ${payload.email} | Rol: ${payload.rol}`
  } catch (e) {
    console.warn('Token inválido')
    clearToken()
    window.location.href = 'login.html'
  }
}

// === Cerrar sesión ===
document.getElementById('btn-logout')?.addEventListener('click', () => {
  clearToken()
  window.location.href = 'login.html'
})

// === Solicitar cambio de rol ===
document.getElementById('btn-request-rol')?.addEventListener('click', async () => {
  const data = await formModal({
    title: 'Solicitar cambio de rol',
    message: 'Indica el rol al que deseas cambiarte (por ejemplo: "editor" o "admin").',
    fields: [
      { name: 'rol', label: 'Rol solicitado', required: true, placeholder: 'editor' },
      { name: 'reason', label: 'Motivo (opcional)', placeholder: '¿Por qué necesitas el cambio?' },
    ],
    confirmText: 'Enviar',
  })

  // Validación básica antes de enviar
  if (!data || !data.rol || !data.rol.trim()) {
    toast('Debes ingresar un rol válido', 'error')
    return
  }

  try {
    console.log("data: ", data)
    const resp = await requestRoleChange({ rol: data.rol.trim() })
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido')
    toast('Solicitud enviada correctamente')
  } catch (e) {
    toast('Error: ' + e.message, 'error')
  }
})