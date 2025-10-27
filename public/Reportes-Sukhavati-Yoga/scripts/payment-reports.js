import { requireAuth } from './guard.js'
import * as XLSX from "https://esm.sh/xlsx";
import { initFilters, loadproductsSelect, loadEstadosSelect, loadFormaPagoSelect, getFilterValues, 
  toggleFilterVisibility, buildQuery, fetchJSON, renderGroupedTable, cargarConsecutivo, dataToExport } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin', 'editor', 'views'])
  if (!user) return
})

window.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('report-nav');
  if (!nav) {
    console.warn('⚠️ No se encontró #report-nav en el DOM');
    return;
  }

  nav.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || !nav.contains(btn)) return;

    nav.querySelectorAll('.btn').forEach(b => b.classList.remove('primary'));
    btn.classList.add('primary');

    active = btn.id.replace('btn-', '');
    await loadActive();
  });
});

function showLoading(cols = 6) {
  let tbody = document.querySelector('#table-payment-reports tbody');
  if (!tbody) {
    const t = document.getElementById('table-payment-reports');
    tbody = document.createElement('tbody');
    t.appendChild(tbody);
  }
  tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Cargando...</td></tr>`;
}

let active = 'consecutive';

/* === util local para mostrar/ocultar el bloque de range === */
function toggleRangeVisibility(show) {
  const box = document.getElementById('filters-range');
  if (!box) return;
  box.classList.toggle('hidden', !show);
}

function togglePaymentMethodVisibility(show) {
  const box = document.getElementById('filter-payment-method');
  if (!box) return;

  const label = box.closest('label'); // obtiene el label contenedor
  if (label) label.classList.toggle('hidden', !show);
}

async function cargarMensualFormaPago(filters) {
  const q = buildQuery({ anio: filters.anio, mes: filters.mes, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/mensual-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  const titulo = `PAGOS mensual ${filters.anio}-${String(filters.mes).padStart(2,'0')}`
  dataToExport(titulo, data)
  renderGroupedTable({
    groups: [{ label: titulo, span: 3 }],
    columns: ['segmento','metodo_de_pago','monto'],
    rows: data,
    sumCols: ['monto'],
  });
}

async function cargarSemanalFormaPago(filters) {
  const q = buildQuery({ iso_anio: filters.anio, iso_semana: filters.iso_semana, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/semanal-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  const titulo = `PAGOS semanal ${filters.anio}${filters.iso_semana ? ' - Sem ' + String(filters.iso_semana).padStart(2,'0') : ''}`
  dataToExport(titulo, data)
  renderGroupedTable({
    groups: [{ label: titulo, span: 5 }],
    columns: ['iso_anio','iso_semana','segmento','metodo_de_pago','monto'],
    rows: data,
    sumCols: ['monto'],
  });
}

async function cargarQuincenalFormaPago(filters) {
  const q = buildQuery({ anio: filters.anio, mes: filters.mes, quincena: filters.quincena, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/quincenal-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  const titulo = `PAGOS por quincena ${filters.anio}-${String(filters.mes).padStart(2,'0')}${filters.quincena ? ' Q' + filters.quincena : ''}`
  dataToExport(titulo, data)
  renderGroupedTable({
    groups: [{ label: titulo, span: 5 }],
    columns: ['anio','mes','quincena','segmento','metodo_de_pago','monto'],
    rows: data,
    sumCols: ['monto'],
  });
}

async function cargarRangoFormaPago(filters) {
  const tbody = document.querySelector('#table-payment-reports tbody');
  const fmtMsg = (msg) => {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty">${msg}</td></tr>`;
  };

  const ini = filters?.fecha_inicio;
  const fin = filters?.fecha_fin;

  if (!ini || !fin) {
    fmtMsg('Selecciona Fecha inicio y Fecha fin.');
    return;
  }

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO.test(ini) || !ISO.test(fin)) {
    fmtMsg('Las fechas deben tener formato YYYY-MM-DD.');
    return;
  }
  if (ini > fin) {
    fmtMsg('La Fecha inicio no puede ser mayor que la Fecha fin.');
    return;
  }

  const q = buildQuery({
    fecha_inicio: ini,
    fecha_fin: fin,
    producto: filters.producto || undefined,
    segmento: filters.segmento, 
    estado: filters.estado || undefined
  });

  try {
    const rows = await fetchJSON(`/api/paymentreports/rango${q}`);
    const data = (Array.isArray(rows) ? rows : []).filter(
      r => String(r.metodo_de_pago).toUpperCase() !== 'TOTAL'
    );
    const titulo = `FORMA DE PAGO ${ini} a ${fin}`
    dataToExport(titulo, data)
    renderGroupedTable({
      groups: [{ label: titulo, span: 4 }],
      columns: ['linea_producto', 'producto', 'metodo_de_pago', 'total_mxn'],
      rows: data,
      sumCols: ['total_mxn'],
    });
  } catch (err) {
    console.error('Error /api/paymentreports/rango:', err);
    fmtMsg(`No se pudo cargar el reporte (400). Revisa las fechas y filters.`);
  }
}

async function loadActive() {
  showLoading();

  if (active === 'consecutive') {
    toggleFilterVisibility({ showYear: false, showMonth: false, showWeek: false, showQuincena: false });
    toggleRangeVisibility(true);
    togglePaymentMethodVisibility(true);
    setDefaultWeekIfEmpty();            
    const filters = getFilterValues();    
    await cargarConsecutivo(filters);
    updateExportVisibility(document.querySelector('#table-payment-reports tbody'));
    return;
  }

  if (active === 'monthly') {
    toggleRangeVisibility(false);
    togglePaymentMethodVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: true, showQuincena: false, showWeek: false });
    const filters = getFilterValues();
    await cargarMensualFormaPago(filters);
  }

  if (active === 'weekly') {
    toggleRangeVisibility(false);
    togglePaymentMethodVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: false, showWeek: true, showQuincena: false });
    const filters = getFilterValues();
    await cargarSemanalFormaPago(filters);
  }

  if (active === 'fortnightly') {
    toggleRangeVisibility(false);
    togglePaymentMethodVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: true, showWeek: false, showQuincena: true });
    const filters = getFilterValues();
    await cargarQuincenalFormaPago(filters);
  }

  if (active === 'range') {
    toggleFilterVisibility({ showYear: false, showMonth: false, showWeek: false, showQuincena: false });
    toggleRangeVisibility(true);
    togglePaymentMethodVisibility(false);
    const ini = document.getElementById('filter-start-date')?.value;
    const fin = document.getElementById('filter-end-date')?.value;
    if (!ini || !fin) {
      const tbody = document.querySelector('#table-payment-reports tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty">Selecciona Fecha inicio y Fecha fin.</td></tr>`;
      return;
    }
    const filters = getFilterValues();
    await cargarRangoFormaPago(filters);
  }

  updateExportVisibility(document.querySelector('#table-payment-reports tbody'));
}

document.getElementById('btn-monthly')?.addEventListener('click', async (e) => {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('primary'));
  e.target.classList.add('primary');
  active = 'monthly';
  await loadActive();
});

document.getElementById('btn-weekly')?.addEventListener('click', async (e) => {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('primary'));
  e.target.classList.add('primary');
  active = 'weekly';
  await loadActive();
});

document.getElementById('btn-fortnightly')?.addEventListener('click', async (e) => {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('primary'));
  e.target.classList.add('primary');
  active = 'fortnightly';
  await loadActive();
});

document.getElementById('btn-range')?.addEventListener('click', async (e) => {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('primary'));
  e.target.classList.add('primary');
  active = 'range';
  await loadActive();
});

['filter-year','filter-monthly','filter-fortnightly','filter-weekly','filter-product','filter-start-date',
  'filter-end-date','filter-segment','filter-status','filter-payment-method'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', loadActive);
});

function updateExportVisibility(tbody) {
  const btn = document.getElementById('btn-export');
  if (!btn) return;

  if (typeof tbody === 'string') tbody = document.querySelector(tbody);
  if (tbody instanceof HTMLCollection) tbody = tbody[0];

  if (!tbody) {
    btn.hidden = true;
    btn.style.display = 'none';
    return;
  }

  const hasData = Array.from(tbody.rows).some(tr => {
    const td = tr.querySelector('td');
    const isEmpty = td?.classList.contains('empty') || /Sin datos/i.test(td?.textContent || '');
    return !isEmpty;
  });

  // Mostrar u ocultar
  btn.hidden = !hasData;
  btn.style.display = hasData ? '' : 'none';
}

document.getElementById('btn-export').addEventListener('click', () => {
  const rows = window.exportRows || [];
  const meta = window.exportMeta || {};
  if (!rows.length) return alert('No hay datos para exportar');

  // 1) detectar columna a sumar (en este orden)
  const sumKey = ['total', 'monto', 'total_mxn'].find(k => k in (rows[0] || {})) || 'total';

  // 2) headers = unión de llaves de todo el dataset (y forzamos sumKey)
  const headersSet = new Set();
  for (const r of rows) Object.keys(r || {}).forEach(k => headersSet.add(k));
  headersSet.add(sumKey);
  const headers = Array.from(headersSet);

  // 3) hoja: título, subtítulo, encabezados
  const ws = XLSX.utils.aoa_to_sheet([
    [meta.titulo || 'Reporte'],
    [meta.subtitulo || ''],
    headers
  ]);

  // 4) datos (A4) con orden de columnas fijo
  XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4', header: headers, skipHeader: true });

  const colCount = headers.length;

  // 5) merges del título/subtítulo
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ];

  // 6) calcular suma
  const sum = rows.reduce((acc, r) => {
    const val = r?.[sumKey];
    const num = typeof val === 'number'
      ? val
      : parseFloat(String(val ?? '').replace(/[^0-9.-]/g, '')) || 0;
    return acc + num;
  }, 0);

  // 7) escribir fila TOTAL al final
  const headerRowIdx = 2;     // fila de encabezados (0-based)
  const dataStartIdx = 3;     // A4 => índice 3
  const dataRows = rows.length;
  const totalRowIdx = dataStartIdx + dataRows;  // inmediatamente debajo de los datos

  const sumColIdx = headers.indexOf(sumKey);

  // etiqueta "TOTAL" (columna A)
  ws[XLSX.utils.encode_cell({ r: totalRowIdx, c: 0 })] = { t: 's', v: 'TOTAL' };
  // valor del total en la columna sumKey
  ws[XLSX.utils.encode_cell({ r: totalRowIdx, c: sumColIdx })] = { t: 'n', v: sum, z: '#,##0.00' };

  // 🔧 FIX CLAVE: ampliar el rango de la hoja para que Excel muestre la fila TOTAL
  const endCell = XLSX.utils.encode_cell({ r: totalRowIdx, c: colCount - 1 });
  ws['!ref'] = `A1:${endCell}`;

  // (Opcional) ancho de columnas
  ws['!cols'] = headers.map(h => ({ wch: Math.max(12, String(h).length + 2) }));

  // (Opcional) estilos de encabezados y TOTAL (SheetJS Pro aplica estilos; Community los ignora)
  for (let c = 0; c < colCount; c++) {
    const headAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    if (ws[headAddr]) {
      ws[headAddr].s = {
        fill: { fgColor: { rgb: '203864' } },
        font: { color: { rgb: 'FFFFFF' }, bold: true },
        alignment: { horizontal: 'center', vertical: 'center' },
      };
    }
    const totalAddr = XLSX.utils.encode_cell({ r: totalRowIdx, c });
    ws[totalAddr] = ws[totalAddr] || { t: 's', v: '' };
    ws[totalAddr].s = { ...(ws[totalAddr].s || {}), font: { bold: true } };
  }

  // 8) guardar
  // const anio = document.querySelector('#filter-year')?.value || '';
  // const mes = document.querySelector('#filter-monthly')?.value || '';
  const producto = document.querySelector('#filter-product')?.selectedOptions?.[0]?.text || 'Todos';
  const ini = document.getElementById('filter-start-date')?.value;
  const fin = document.getElementById('filter-end-date')?.value;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  const nombre = `reporte_${ini}_${fin}_${producto.replace(/[\\/:*?"<>|]/g, '')}.xlsx`;
  XLSX.writeFile(wb, nombre, { bookType: 'xlsx', compression: true });
});

function setDefaultWeekIfEmpty() {
  const ini = document.getElementById('filter-start-date');
  const fin = document.getElementById('filter-end-date');
  if (!ini || !fin || (ini.value && fin.value)) return;

  const today = new Date();
  const monday = new Date(today);
  
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toISO = d => d.toISOString().slice(0, 10);
  ini.value = toISO(monday);
  fin.value = toISO(sunday);
}


// carga inicial
initFilters();
loadEstadosSelect();
loadproductsSelect();
loadFormaPagoSelect();
loadActive();

