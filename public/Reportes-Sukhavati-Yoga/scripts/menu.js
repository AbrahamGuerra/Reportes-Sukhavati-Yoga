import { requireAuth } from './guard.js'
import { getToken, clearToken, requestRoleChange } from './api.js'
import { formModal, toast } from './ui/modal.js'

document.addEventListener('DOMContentLoaded', async () => {
  const payload = await requireAuth() // Verifica login

  if (!payload) return

  document.getElementById('user-info').textContent =
    `${payload.email} | Rol: ${payload.role}`

  const btnUploadInformation = document.getElementById('btn-go-load')
  const btnUploadPDFPayments = document.getElementById('btn-go-upload-pdf-payments')
  const btnAcceptRequestRole = document.getElementById('btn-accept-request-role')
  const btnRequestRole = document.getElementById('btn-request-role')

  if(payload.role === 'admin'){
    btnRequestRole.style.display = 'none'
  }
  if (payload.role === 'views') {
    btnUploadInformation.style.display = 'none'
    btnUploadPDFPayments.style.display = 'none'
  }
  if(payload.role !== 'admin'){
    btnAcceptRequestRole.style.display = 'none'
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

document.getElementById('btn-accept-request-role')?.addEventListener('click', () => {
  window.location.href = 'admin-roles.html'
})

const buttons = document.querySelectorAll('.menu-top .btn-square')

buttons.forEach(btn => {
  btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.remove('primary'))
    btn.classList.add('active')
  })
})

// === Mostrar info del usuario ===
const token = getToken()
if (token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    document.getElementById('user-info').textContent =
      `Conectado como: ${payload.email} | Rol: ${payload.role}`
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
document.getElementById('btn-request-role')?.addEventListener('click', async () => {
  const data = await formModal({
    title: 'Solicitar cambio de rol',
    message: 'Indica el rol al que deseas cambiarte (por ejemplo: "editor").',
    fields: [
      { name: 'role', label: 'Rol solicitado', required: true, placeholder: 'editor' },
      { name: 'reason', label: 'Motivo (opcional)', placeholder: '¿Por qué necesitas el cambio?' },
    ],
    confirmText: 'Enviar',
  })
  
  // Validación básica antes de enviar
  if (!data || !data.role || !data.role.trim()) {
    toast('Debes ingresar un rol válido', 'error')
    return
  }

  try {
    const resp = await requestRoleChange({ role: data.role.trim() })
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido')
    toast('Solicitud enviada correctamente')
  } catch (e) {
    toast('Error: ' + e.message, 'error')
  }
})