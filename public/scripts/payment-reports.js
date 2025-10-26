import * as XLSX from "https://esm.sh/xlsx";
import { initFilters, loadproductsSelect, loadEstadosSelect, getFilterValues, toggleFilterVisibility, buildQuery, fetchJSON, renderGroupedTable, cargarConsecutivo } from './api.js';

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
  tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">Cargando…</td></tr>`;
}

let active = 'consecutive';

/* === util local para mostrar/ocultar el bloque de range === */
function toggleRangeVisibility(show) {
  const box = document.getElementById('filters-range');
  if (!box) return;
  box.classList.toggle('hidden', !show);
}

async function cargarMensualFormaPago(filters) {
  const q = buildQuery({ anio: filters.anio, mes: filters.mes, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/mensual-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  renderGroupedTable({
    groups: [{ label: `COBRANZA monthly ${filters.anio}-${String(filters.mes).padStart(2,'0')}`, span: 3 }],
    columns: ['segmento','metodo_de_pago','monto'],
    rows: data,
    sumCols: ['monto'],
  });
}

async function cargarSemanalFormaPago(filters) {
  const q = buildQuery({ iso_anio: filters.anio, iso_semana: filters.iso_semana, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/semanal-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  renderGroupedTable({
    groups: [{ label: `COBRANZA weekly ${filters.anio}${filters.iso_semana ? ' - Sem ' + String(filters.iso_semana).padStart(2,'0') : ''}`, span: 5 }],
    columns: ['iso_anio','iso_semana','segmento','metodo_de_pago','monto'],
    rows: data,
    sumCols: ['monto'],
  });
}

async function cargarQuincenalFormaPago(filters) {
  const q = buildQuery({ anio: filters.anio, mes: filters.mes, quincena: filters.quincena, producto: filters.producto, segmento: filters.segmento, estado: filters.estado || undefined });
  const raw = await fetchJSON(`/api/paymentreports/quincenal-formapago${q}`);
  const data = (raw || []).filter(r => String(r.segmento).toUpperCase() !== 'TOTAL');
  renderGroupedTable({
    groups: [{ label: `COBRANZA fortnightly ${filters.anio}-${String(filters.mes).padStart(2,'0')}${filters.quincena ? ' Q' + filters.quincena : ''}`, span: 5 }],
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

    renderGroupedTable({
      groups: [{ label: `COBRANZA POR RANGO ${ini} a ${fin}`, span: 4 }],
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
    setDefaultWeekIfEmpty();            
    const filters = getFilterValues();    
    await cargarConsecutivo(filters);
    updateExportVisibility(document.querySelector('#table-payment-reports tbody'));
    return;
  }

  if (active === 'monthly') {
    toggleRangeVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: true, showQuincena: false, showWeek: false });
    const filters = getFilterValues();
    await cargarMensualFormaPago(filters);
  }

  if (active === 'weekly') {
    toggleRangeVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: false, showWeek: true, showQuincena: false });
    const filters = getFilterValues();
    await cargarSemanalFormaPago(filters);
  }

  if (active === 'fortnightly') {
    toggleRangeVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: true, showWeek: false, showQuincena: true });
    const filters = getFilterValues();
    await cargarQuincenalFormaPago(filters);
  }

  if (active === 'porlinea') {
    toggleRangeVisibility(false);
    toggleFilterVisibility({ showYear: true, showMonth: true, showWeek: false, showQuincena: false });
    const filters = getFilterValues();
    await cargarmonthlyPorLinea(filters);
  }

  if (active === 'range') {
    toggleFilterVisibility({ showYear: false, showMonth: false, showWeek: false, showQuincena: false });
    toggleRangeVisibility(true);
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

['filter-year','filter-monthly','filter-fortnightly','filter-weekly','filter-product','filter-start-date','filter-end-date','filter-segment','filter-status'].forEach(id => {
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
  const table = document.querySelector('#table-payment-reports');
  if (!table) return alert('No se encontró la tabla');

  const anio = document.querySelector('#filter-year')?.value || '';
  const mes = document.querySelector('#filter-monthly')?.value || '';
  const producto = document.querySelector('#filter-product')?.selectedOptions?.[0]?.text || 'Todos';

  const titulo = `Reporte de cobranza ${anio}-${mes}`;
  const subtitulo = `Producto: ${producto}`;

  // --- Crear hoja base ---
  const ws = XLSX.utils.aoa_to_sheet([[titulo], [subtitulo]]);
  XLSX.utils.sheet_add_dom(ws, table, { origin: 'A3', raw: true });

  // --- range y merges ---
  const range = XLSX.utils.decode_range(ws['!ref']);
  const colCount = range.e.c + 1;
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ];

  // --- Encabezados (fila 2) ---
  const headerRowIndex = 2; // considerando las 2 filas extra arriba
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    const cell = ws[addr];
    if (cell) {
      cell.s = {
        fill: { fgColor: { rgb: "203864" } }, // azul oscuro
        font: { color: { rgb: "FFFFFF" }, bold: true }, // texto blanco negrita
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
  }

  // --- Anchos de columna ---
  ws["!cols"] = Array.from({ length: colCount }, () => ({ wch: 18 }));

  // --- Crear y exportar workbook ---
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reporte");
  const nombre = `reporte_${anio}_${mes}_${producto.replace(/[\\/:*?"<>|]/g, "")}.xlsx`;
  XLSX.writeFile(wb, nombre, { bookType: "xlsx", compression: true });
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
loadActive();

