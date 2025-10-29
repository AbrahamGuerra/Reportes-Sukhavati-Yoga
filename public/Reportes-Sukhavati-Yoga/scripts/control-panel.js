import { requireAuth } from './guard.js'
import {
  adminListRoles, adminFindUserByEmail,
  adminGrantRole, adminListRoleRequests,
  adminResolveRoleRequest, adminGetUserLimit, 
  adminSetUserLimit, adminListUsers, 
  adminPatchUser, adminDeleteUser,
  adminListAuditLogs
} from './api.js'

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin'])
  if (!user) return
  
  const warningBox = document.getElementById('editor-warning')
  if (String(user.role || '').trim().toLowerCase() !== 'admin') {
    warningBox.style.display = 'block'
  }
})

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

// Muestra info del usuario buscado
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

// Buscar usuario por correo
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

// Aplicar cambio de rol manual
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

// Delegación de eventos para aprobar/rechazar
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

// ====== LÍMITE DE USUARIOS ======
async function loadUserLimit() {
  try {
    const max = await adminGetUserLimit();
    const inp = document.getElementById('inp-user-max');
    const msg = document.getElementById('msg-user-max');
    if (inp) inp.value = String(max);
    if (msg) msg.textContent = `Límite actual: ${max}`;
  } catch (e) {
    const msg = document.getElementById('msg-user-max');
    if (msg) msg.textContent = e.message || 'Error cargando límite';
  }
}

document.getElementById('btn-save-user-max')?.addEventListener('click', async () => {
  const inp = document.getElementById('inp-user-max');
  const msg = document.getElementById('msg-user-max');
  try {
    const val = parseInt(inp.value, 10);
    const saved = await adminSetUserLimit(val);
    msg.textContent = `Límite actualizado a ${saved}`;
  } catch (e) {
    msg.textContent = e.message || 'Error guardando límite';
  }
});

// ====== GESTIÓN DE USUARIOS ======
function userRow(u) {
  const tr = document.createElement('tr');
  tr.dataset.id = u.id;

  tr.innerHTML = `
    <td>
      <input class="inp-name" type="text" value="${u.name || ''}" placeholder="(sin nombre)" />
    </td>
    <td>${u.email}</td>
    <td>
      <select class="sel-role">
        ${roles.map(r => `<option value="${r.code}" ${u.role_code===r.code?'selected':''}>${r.name}</option>`).join('')}
      </select>
    </td>
    <td>
      <select class="sel-active">
        <option value="true"  ${u.active ? 'selected' : ''}>Sí</option>
        <option value="false" ${!u.active ? 'selected' : ''}>No</option>
      </select>
    </td>
    <td>
      <button class="btn small success" data-act="save">Guardar</button>
      <button class="btn small danger" data-act="delete">Desactivar</button>
    </td>
  `;
  return tr;
}

async function loadUsers() {
  const q = document.getElementById('inp-user-q')?.value.trim() || '';
  const active = document.getElementById('sel-user-active')?.value || '';
  const tbody = document.getElementById('tb-users');
  const msg = document.getElementById('msg-users');
  if (msg) msg.textContent = '';
  if (tbody) tbody.innerHTML = '';
  try {
    const list = await adminListUsers({ q, active });
    if (!list.length) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Sin resultados</td></tr>`;
      return;
    }
    for (const u of list) tbody.appendChild(userRow(u));
  } catch (e) {
    if (msg) msg.textContent = e.message || 'Error cargando usuarios';
  }
}

document.getElementById('btn-user-search')?.addEventListener('click', loadUsers);

document.getElementById('tb-users')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = tr?.dataset?.id;
  const act = btn.getAttribute('data-act');

  const name = tr.querySelector('.inp-name').value.trim();
  const role = tr.querySelector('.sel-role').value;
  const active = tr.querySelector('.sel-active').value === 'true';

  const msg = document.getElementById('msg-users');
  if (msg) msg.textContent = '';

  try {
    if (act === 'save') {
      const updated = await adminPatchUser(id, { name, role, active });
      if (msg) msg.textContent = `Usuario ${updated.email} actualizado`;
    } else if (act === 'delete') {
      if (!confirm('¿Desactivar este usuario?')) return;
      await adminDeleteUser(id);
      if (msg) msg.textContent = 'Usuario desactivado';
      await loadUsers();
    }
  } catch (e) {
    if (msg) msg.textContent = e.message || 'Operación fallida';
  }
});

// ====== AUDITORÍA ======
let auditOffset = 0;
const auditLimit = 50;

function setDefaultAuditDates() {
  const to = document.getElementById('log-to');
  const from = document.getElementById('log-from');
  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  to.value = today.toISOString().slice(0,10);
  from.value = weekAgo.toISOString().slice(0,10);
}

function auditRow(r) {
  const tr = document.createElement('tr');
  const when = r.occurred_at ? new Date(r.occurred_at).toLocaleString() : '—';
  tr.innerHTML = `
    <td>${when}</td>
    <td>${r.email || r.user_id || '—'}</td>
    <td>${r.action}</td>
    <td>${r.outcome}</td>
    <td title="${r.route || ''}">${(r.route || '—')}</td>
    <td>${r.http_status ?? '—'}</td>
    <td>${r.ip || '—'}</td>
    <td title="${r.user_agent || ''}">${(r.user_agent || '—').slice(0,24)}${(r.user_agent && r.user_agent.length>24)?'…':''}</td>
    <td>${r.latency_ms ?? '—'}</td>
  `;
  return tr;
}

async function loadAudit() {
  const msg = document.getElementById('msg-audit');
  const tbody = document.getElementById('tb-audit');
  msg.textContent = ''; tbody.innerHTML = '';

  const q = document.getElementById('log-q').value.trim();
  const action = document.getElementById('log-action').value.trim();
  const outcome = document.getElementById('log-outcome').value;
  const from = document.getElementById('log-from').value;
  const to = document.getElementById('log-to').value;

  try {
    const { rows = [] } = await adminListAuditLogs({ q, action, outcome, from, to, limit: auditLimit, offset: auditOffset });
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">Sin resultados</td></tr>`;
      return;
    }
    for (const r of rows) tbody.appendChild(auditRow(r));
  } catch (e) {
    msg.textContent = e.message || 'Error cargando auditoría';
  }
}

document.getElementById('log-search')?.addEventListener('click', () => { auditOffset = 0; loadAudit(); });
document.getElementById('log-prev')?.addEventListener('click', () => { auditOffset = Math.max(0, auditOffset - auditLimit); loadAudit(); });
document.getElementById('log-next')?.addEventListener('click', () => { auditOffset += auditLimit; loadAudit(); });

window.addEventListener('DOMContentLoaded', async () => {
  await loadRoles();
  await loadReqs();
  await loadUserLimit();
  await loadUsers();

  setDefaultAuditDates();
  await loadAudit();
});
