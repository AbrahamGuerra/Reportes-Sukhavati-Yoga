import {
  adminListRoles,
  adminFindUserByEmail,
  adminGrantRole,
  adminListRoleRequests,
  adminResolveRoleRequest
} from './api.js'

const $ = s => document.querySelector(s)
const put = (s, t = '') => { const el = $(s); if (el) el.textContent = t }

let foundUser = null
let roles = []

// Carga los roles disponibles
async function loadRoles() {
  try {
    roles = await adminListRoles()
    const sel = $('#sel-role')
    sel.innerHTML = ''
    for (const r of roles) {
      const opt = document.createElement('option')
      opt.value = r.code
      opt.textContent = `${r.name} (${r.code})`
      sel.appendChild(opt)
    }
  } catch (e) {
    put('#msg', e.message || 'Error cargando roles')
  }
}

// 👤 Muestra info del usuario buscado
function showUser(u) {
  const box = $('#user-box')
  if (!u) {
    box.style.display = 'none'
    box.innerHTML = ''
    return
  }
  box.style.display = 'block'
  box.innerHTML = `
    <div><b>Usuario:</b> ${u.name || '(sin nombre)'} &lt;${u.email}&gt;</div>
    <div><b>Rol actual:</b> ${u.role_name} (${u.role_code})</div>
  `
  $('#sel-role').value = u.role_code
}

// 🔍 Buscar usuario por correo
$('#btn-find')?.addEventListener('click', async () => {
  put('#msg', '')
  try {
    const email = $('#inp-email').value.trim().toLowerCase()
    if (!email) return put('#msg', 'Escribe un correo')
    const u = await adminFindUserByEmail(email)
    foundUser = u
    showUser(u)
  } catch (e) {
    foundUser = null
    showUser(null)
    put('#msg', e.message)
  }
})

// 🔁 Aplicar cambio de rol manual
$('#btn-apply')?.addEventListener('click', async () => {
  put('#msg', '')
  try {
    if (!foundUser) return put('#msg', 'Primero busca un usuario')
    const role = $('#sel-role').value
    const reason = $('#inp-reason').value
    const { message } = await adminGrantRole({ email: foundUser.email, role, reason })
    put('#msg', message || 'Rol actualizado correctamente')

    // Refresca los datos del usuario
    const u = await adminFindUserByEmail(foundUser.email)
    foundUser = u
    showUser(u)
  } catch (e) {
    put('#msg', e.message)
  }
})

// 🗂️ Cargar solicitudes pendientes de cambio de rol
async function loadReqs() {
  put('#msg', '')
  const status = $('#sel-req-status').value
  try {
    const reqs = await adminListRoleRequests(status)
    const tbody = $('#tb-reqs')
    tbody.innerHTML = ''

    if (!reqs.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Sin solicitudes para “${status}”.</td></tr>`
      return
    }

    for (const r of reqs) {
      const tr = document.createElement('tr')
      const fecha = r.requested_in ? new Date(r.requested_in).toLocaleString() : '—'
      tr.innerHTML = `
        <td>${fecha}</td>
        <td>${r.name || '(sin nombre)'}</td>
        <td>${r.email}</td>
        <td>${r.requested_role_name} (${r.requested_role_code})</td>
        <td>${r.reason || '—'}</td>
        <td>${r.status}</td>
        <td>
          ${r.status === 'pendiente'
            ? `<button class="btn small success" data-act="approve" data-id="${r.id}">Aprobar</button>
               <button class="btn small danger" data-act="reject" data-id="${r.id}">Rechazar</button>`
            : '<span class="muted">—</span>'}
        </td>
      `
      tbody.appendChild(tr)
    }
  } catch (e) {
    put('#msg', e.message || 'Error cargando solicitudes')
  }
}

// 🎯 Delegación de eventos para aprobar/rechazar
$('#tb-reqs')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]')
  if (!btn) return
  const id = btn.getAttribute('data-id')
  const act = btn.getAttribute('data-act')
  try {
    const statusMap = { approve: 'aprobada', reject: 'rechazada' }
    await adminResolveRoleRequest({ idRequest: id, action: act, status: statusMap[act] })
    await loadReqs()
    put('#msg', act === 'approve' ? 'Solicitud aprobada' : 'Solicitud rechazada')
  } catch (e) {
    put('#msg', e.message || 'Error resolviendo solicitud')
  }
})

$('#btn-reload-reqs')?.addEventListener('click', loadReqs)
$('#sel-req-status')?.addEventListener('change', loadReqs)

// 🚀 Inicialización
window.addEventListener('DOMContentLoaded', () => {
  loadRoles()
  loadReqs()
})
