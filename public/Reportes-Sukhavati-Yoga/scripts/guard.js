import { getToken, clearToken } from './api.js'

export async function requireAuth(allowedRols = []) {
  const token = getToken()
  if (!token) {
    const here = encodeURIComponent(location.pathname + location.search)
    location.href = `/Reportes-Sukhavati-Yoga/login.html?next=${here}`
    return null
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const { email, role } = payload

    // Verifica roles permitidos
    if (allowedRols.length > 0 && !allowedRols.includes(role)) {
      await showPermissionDeniedModal()
      return null
    }

    return payload
  } catch (err) {
    console.warn('Token inválido o corrupto', err)
    clearToken()
    location.href = '/Reportes-Sukhavati-Yoga/login.html'
    return null
  }
}

async function showPermissionDeniedModal() {
  await formModal({
    title: 'Acceso restringido',
    message: 'No tienes permisos para usar este apartado.',
    confirmText: 'Volver al inicio',
    cancelText: 'Cerrar',
  })
}