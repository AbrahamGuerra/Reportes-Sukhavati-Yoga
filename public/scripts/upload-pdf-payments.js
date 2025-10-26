import { requireAuth } from './guard.js'
import { loadproductsSelect, buildQuery, fetchJSON, getToken } from './api.js'

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin', 'editor'])
  if (!user) return 
})

function showLoading(cols = 10) {
  const tbody = document.querySelector('#tbody')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Cargando…</td></tr>`
}

function showEmpty(msg = 'Sin datos') {
  const tbody = document.querySelector('#tbody')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="10" class="empty">${msg}</td></tr>`
}

function getFilters() {
  let ini = document.getElementById('filter-start-date')?.value || '';
  let fin = document.getElementById('filter-end-date')?.value || '';

  if (ini || fin) {
    if (!ini || !fin) {
      alert('Selecciona Fecha inicio y Fecha fin');
      return;
    }
    if (ini > fin) {
      alert('La Fecha inicio no puede ser mayor que la Fecha fin');
      return;
    }

    ini = new Date(ini).toISOString().slice(0, 10);
    fin = new Date(fin).toISOString().slice(0, 10);

    return {
      idCargo: document.querySelector('#filtro-id-charge')?.value?.trim() || '',
      socio: document.querySelector('#filtro-partner')?.value?.trim() || '',
      producto: document.querySelector('#filter-product')?.value?.trim() || '',
      notas: document.querySelector('#filter-notes')?.value?.trim() || '',
      idTransaccion: document.querySelector('#filter-id-transaction')?.value?.trim() || '',
      idSuscripcion: document.querySelector('#filter-id-subscription')?.value?.trim() || '',
      fecha_inicio: ini,
      fecha_fin: fin,
      limit: 5
    }
  }

  return {
    idCargo: document.querySelector('#filtro-id-charge')?.value?.trim() || '',
    socio: document.querySelector('#filtro-partner')?.value?.trim() || '',
    producto: document.querySelector('#filter-product')?.value?.trim() || '',
    notas: document.querySelector('#filter-notes')?.value?.trim() || '',
    idTransaccion: document.querySelector('#filter-id-transaction')?.value?.trim() || '',
    idSuscripcion: document.querySelector('#filter-id-subscription')?.value?.trim() || '',
    limit: 5
  }
}

async function searchpayments(filters) {
  const q = buildQuery(filters)
  return await fetchJSON(`/api/bucket/payments${q}`)
}

async function uploadFile(file) {
  const fd = new FormData()
  fd.append('file', file)

  const res = await fetch('/api/bucket/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken?.() || ''}`,
    },
    body: fd,
  })
  if (!res.ok) throw new Error('Error subiendo PDF')
  return res.json() // { url, key }
}

async function updateEvidencia(idTransaccion, url) {
  const res = await fetch(`/api/bucket/payments/${encodeURIComponent(idTransaccion)}/evidencia`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error('Error actualizando evidencia')
  return res.json()
}

function render(rows) {
  const tbody = document.querySelector('#tbody')
  if (!tbody) return

  if (!Array.isArray(rows) || rows.length === 0) {
    showEmpty()
    return
  }

  tbody.innerHTML = ''

  rows.forEach((r) => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${r.fecha_de_registro ?? ''}</td>
      <td>${r.socio ?? ''}</td>
      <td>${r.producto ?? r.concepto ?? ''}</td>
      <td>${r.metodo_de_pago ?? ''}</td>
      <td>${Number(r.total ?? 0).toFixed(2)}</td>
      <td>${r.id_cargo ?? ''}</td>
      <td>${r.id_transaccion ?? ''}</td>
      <td>${r.id_suscripcion ?? ''}</td>
      <td>
        ${r.evidencia_pago_url ? `<a class="url" href="${r.evidencia_pago_url}" target="_blank" rel="noopener">ver PDF</a>` : '<span class="muted">—</span>'}
      </td>
      <td class="row-actions">
        <input type="file" accept="application/pdf" class="file" />
      </td>
    `
    const fileInput = tr.querySelector('input[type="file"]')

    fileInput.addEventListener('change', async (ev) => {
      ev.preventDefault()          
      ev.stopPropagation()
      try {
        const file = fileInput?.files?.[0]
        if (!file) {
          alert('Selecciona un PDF')
          return
        }
        if (file.type !== 'application/pdf') {
          alert('El archivo debe ser PDF')
          return
        }
        
        const { url } = await uploadFile(file)
        await updateEvidencia(r.id_transaccion, url) 

        tr.cells[8].innerHTML = `<a class="url" href="${url}" target="_blank" rel="noopener">ver PDF</a>`
        alert('El archivo fue subido correctamente')
      } catch (err) {
        console.error(err)
        alert('Falló la carga/actualización')
      }
    })

    tbody.appendChild(tr)
  })
}

async function buscar() {
  showLoading()
  const filters = getFilters()
  try {
    const data = await searchpayments(filters)
    render(data)
  } catch (err) {
    console.error('Error buscando payments', err)
    showEmpty('No se pudo cargar la información')
  }
}

function limpiar() {
  ;['#filtro-id-charge', '#filtro-partner', '#filter-product', '#filter-notes', '#filter-id-transaction', '#filter-id-subscription']
    .forEach((id) => {
      const el = document.querySelector(id)
      if (el) el.value = ''
    })
  showEmpty('Ajusta los filters y presiona Buscar')
}

window.addEventListener('DOMContentLoaded', () => {
  loadproductsSelect?.()

  document.querySelector('#btn-search')?.addEventListener('click', buscar)
  document.querySelector('#btn-clean')?.addEventListener('click', limpiar)

  buscar()
})
