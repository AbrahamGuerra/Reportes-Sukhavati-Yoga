import { requireAuth } from './guard.js'
import { loadProductsSelect, buildQuery, fetchJSON } from './api.js'
import { toast } from './ui/modal.js'
import { uploadFile, createAndUploadFile } from './utils/utils.js'

const spinner = document.getElementById('spinner')

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin', 'editor'])
  if (!user) return 
})

function showLoading(cols = 10) {
  const tbody = document.querySelector('#tbody')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Cargando...</td></tr>`
}

function showEmpty(msg = 'Sin datos') {
  const tbody = document.querySelector('#tbody')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="10" class="empty">${msg}</td></tr>`
}

function getFilters() {
  let ini = document.getElementById('filter-start-date')?.value || ''
  let fin = document.getElementById('filter-end-date')?.value || ''

  if (ini || fin) {
    if (!ini || !fin) {
      toast('Selecciona Fecha inicio y Fecha fin', 'error')
      return
    }
    if (ini > fin) {
      toast('La Fecha inicio no puede ser mayor que la Fecha fin', 'error')
      return
    }

    ini = new Date(ini).toISOString().slice(0, 10)
    fin = new Date(fin).toISOString().slice(0, 10)

    return {
      idCargo: document.querySelector('#filter-id-charge')?.value?.trim() || '',
      folio: document.querySelector('#filter-folio')?.value?.trim() || '',
      socio: document.querySelector('#filter-partner')?.value?.trim() || '',
      producto: document.querySelector('#filter-product')?.value?.trim() || '',
      notas: document.querySelector('#filter-notes')?.value?.trim() || '',
      idTransaccion: document.querySelector('#filter-id-transaction')?.value?.trim() || '',
      idSuscripcion: document.querySelector('#filter-id-subscription')?.value?.trim() || '',
      fecha_inicio: ini,
      fecha_fin: fin,
      limit: 5,
    }
  }

  return {
    idCargo: document.querySelector('#filter-id-charge')?.value?.trim() || '',
    folio: document.querySelector('#filter-folio')?.value?.trim() || '',
    socio: document.querySelector('#filter-partner')?.value?.trim() || '',
    producto: document.querySelector('#filter-product')?.value?.trim() || '',
    notas: document.querySelector('#filter-notes')?.value?.trim() || '',
    idTransaccion: document.querySelector('#filter-id-transaction')?.value?.trim() || '',
    idSuscripcion: document.querySelector('#filter-id-subscription')?.value?.trim() || '',
    limit: 5,
  }
}

async function searchPayments(filters) {
  const q = buildQuery(filters)
  return await fetchJSON(`/api/bucket/payments${q}`)
}

async function updateEvidencia(folio, url) {
  const res = await fetch(`/api/bucket/payments/${encodeURIComponent(folio)}/evidencia`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error('Error actualizando evidencia')
  return res.json()
}

async function updateComprobante(folio, url) {
  const res = await fetch(`/api/bucket/payments/${encodeURIComponent(folio)}/comprobante`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) throw new Error('Error actualizando comprobante')
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
      <td>${r.folio ?? ''}</td>
      <td>${r.fecha_de_registro ?? ''}</td>
      <td>${r.socio ?? ''}</td>
      <td>${r.producto ?? r.concepto ?? ''}</td>
      <td>${r.metodo_de_pago ?? ''}</td>
      <td>${Number(r.total ?? 0).toFixed(2)}</td>
      <td>${r.id_cargo ?? ''}</td>
      <td>${r.id_transaccion ?? ''}</td>
      <td>${r.id_suscripcion ?? ''}</td>
      <td>
        ${
          r.evidencia_pago_url
            ? `<a class="url" href="${r.evidencia_pago_url}" target="_blank" rel="noopener">ver evidencia</a>`
            : '<span class="muted">—</span>'
        }
      </td>
      <td>
        ${
          r.comprobante_url
            ? `<a class="url" href="${r.comprobante_url}" target="_blank" rel="noopener">ver comprobante</a>`
            : '<span class="muted">—</span>'
        }
      </td>
      <td class="row-actions">
        <input type="file" accept="application/pdf" class="file" />
        <button class="btn-generate">Generar Recibo</button>
      </td>
    `

    const fileInput = tr.querySelector('.file')
    const btnGenerate = tr.querySelector('.btn-generate')

    //Subir PDF de evidencia de pago
    fileInput.addEventListener('change', async (ev) => {
      spinner.classList.remove('hidden')
      ev.preventDefault()
      try {
        const file = fileInput?.files?.[0]
        if (!file) {
          toast('Selecciona un PDF', 'error')
          return
        }
        if (file.type !== 'application/pdf') {
          toast('El archivo debe ser PDF', 'error')
          return
        }

        const { url } = await uploadFile(file, 'payments', r.socio, r.folio, null)
        await updateEvidencia(r.folio, url)
        tr.cells[9].innerHTML = `<a class="url" href="${url}" target="_blank" rel="noopener">ver evidencia</a>`
        toast('Evidencia subida correctamente', 'ok')
      } catch (err) {
        console.error(err)
        toast('Falló la carga de la evidencia', 'error')
      }
      finally { spinner.classList.add('hidden') }
    })

    //Generar y subir comprobante PDF
    btnGenerate.addEventListener('click', async (ev) => {
      spinner.classList.remove('hidden')
      ev.preventDefault()
      try {
        const { url } = await createAndUploadFile(r, 'receipts')
        await updateComprobante(r.folio, url)
        tr.cells[10].innerHTML = `<a class="url" href="${url}" target="_blank" rel="noopener">ver comprobante</a>`
        toast('Comprobante generado correctamente', 'ok')
      } catch (err) {
        console.error(err)
        toast('Falló la generación del comprobante', 'error')
      }
      finally { spinner.classList.add('hidden') }
    })

    tbody.appendChild(tr)
  })
}

async function buscar() {
  showLoading()
  const filters = getFilters()
  try {
    const data = await searchPayments(filters)
    render(data)
  } catch (err) {
    console.error('Error buscando payments', err)
    showEmpty('No se pudo cargar la información')
    toast('Error al cargar los pagos', 'error')
  }
}

function limpiar() {
  ;[
    '#filter-id-charge',
    '#filter-partner',
    '#filter-product',
    '#filter-notes',
    '#filter-id-transaction',
    '#filter-id-subscription',
    '#filter-folio'
  ].forEach((id) => {
    const el = document.querySelector(id)
    if (el) el.value = ''
  })
  showEmpty('Ajusta los filtros y presiona buscar')
  toast('Filtros limpiados', 'ok')
}

window.addEventListener('DOMContentLoaded', () => {
  loadProductsSelect?.()

  document.querySelector('#btn-search')?.addEventListener('click', buscar)
  document.querySelector('#btn-clean')?.addEventListener('click', limpiar)

  buscar()
})
