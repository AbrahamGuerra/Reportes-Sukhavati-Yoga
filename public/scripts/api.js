export async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
  return res.json();
}

const selYear      = () => document.getElementById('filter-year');
const selMonth     = () => document.getElementById('filter-monthly');
const selQ         = () => document.getElementById('filter-fortnightly');
const selWeek      = () => document.getElementById('filter-weekly');
const selProd      = () => document.getElementById('filter-product');
const selFechaIni  = () => document.getElementById('filter-start-date');
const selFechaFin  = () => document.getElementById('filter-end-date');
const selSegmen  = () => document.getElementById('filter-segment');
const selEstado  = () => document.getElementById('filter-status');

const rangeBox     = () => document.getElementById('filters-range');
const btnMonthly   = () => document.getElementById('btn-monthly');
const btnWeekly   = () => document.getElementById('btn-weekly');
const btnFortnightly = () => document.getElementById('btn-fortnightly');
const btnRange     = () => document.getElementById('btn-range') || document.getElementById('btnRange');
const btnConsecutive = () => document.getElementById('btn-consecutive');

// --- Estado de tabla/paginación ---
const tableState = {
  rows: [],
  columns: [],
  groups: [],
  sumCols: [],
  page: 1,
  pageSize: 10,
  totalsCache: null,
};

function clampPage() {
  const totalPages = Math.max(1, Math.ceil(tableState.rows.length / tableState.pageSize));
  if (tableState.page > totalPages) tableState.page = totalPages;
  if (tableState.page < 1) tableState.page = 1;
  return totalPages;
}

function setupPagerOnce() {
  const pgSize = document.getElementById('pg-size');
  if (!pgSize || pgSize.dataset.bound) return; // ya está
  pgSize.dataset.bound = '1';

  const pgFirst = document.getElementById('pg-first');
  const pgPrev  = document.getElementById('pg-prev');
  const pgNext  = document.getElementById('pg-next');
  const pgLast  = document.getElementById('pg-last');

  const go = (to) => {
    const totalPages = Math.max(1, Math.ceil(tableState.rows.length / tableState.pageSize));
    if (to === 'first') tableState.page = 1;
    if (to === 'prev')  tableState.page = Math.max(1, tableState.page - 1);
    if (to === 'next')  tableState.page = Math.min(totalPages, tableState.page + 1);
    if (to === 'last')  tableState.page = totalPages;
    renderTableBodyPage();
  };

  pgFirst?.addEventListener('click', () => go('first'));
  pgPrev?.addEventListener('click',  () => go('prev'));
  pgNext?.addEventListener('click',  () => go('next'));
  pgLast?.addEventListener('click',  () => go('last'));
  pgSize?.addEventListener('change', () => {
    tableState.pageSize = parseInt(pgSize.value, 10) || 10;
    tableState.page = 1;
    renderTableBodyPage();
  });
}

function updatePagerUI() {
  const info = document.getElementById('pg-info');
  const totalPages = clampPage();
  const totalRows = tableState.rows.length;

  if (info) {
    info.textContent = `Página ${tableState.page} de ${totalPages} (${totalRows} filas)`;
  }

  ['pg-first','pg-prev','pg-next','pg-last'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = (id==='pg-first'||id==='pg-prev') ? tableState.page<=1
                 : tableState.page>=totalPages;
  });

  const pgSize = document.getElementById('pg-size');
  if (pgSize && !pgSize.value) pgSize.value = String(tableState.pageSize);
}

function computeTotals(rows, sumCols) {
  const totals = {};
  for (const c of sumCols) totals[c] = 0;
  for (const r of rows) {
    for (const c of sumCols) {
      const n = coerceNumber(r?.[c]);
      if (Number.isFinite(n)) totals[c] += n;
    }
  }
  return totals;
}


export const PeriodMode = {
  monthly:   'monthly',
  weekly:   'weekly',
  fortnightly: 'fortnightly',
  range:     'range',
  consecutive: 'consecutive',
};

let currentMode = PeriodMode.consecutive;
export function getCurrentMode() { return currentMode; }

export function initFilters({ yearsBack = 3, yearsForward = 1 } = {}) {
  const now = new Date();
  const yCurrent = now.getFullYear();
  const mCurrent = now.getMonth() + 1;

  const ySel = selYear();
  ySel.innerHTML = '';
  for (let y = yCurrent + yearsForward; y >= yCurrent - yearsBack; y--) {
    const opt = document.createElement('option');
    opt.value = String(y); opt.textContent = String(y);
    if (y === yCurrent) opt.selected = true;
    ySel.appendChild(opt);
  }

  const mSel = selMonth();
  const meses = Array.from({length:12}, (_,i)=>i+1);
  mSel.innerHTML = '';
  for (const m of meses) {
    const opt = document.createElement('option');
    opt.value = String(m);
    opt.textContent = String(m).padStart(2,'0');
    if (m === mCurrent) opt.selected = true;
    mSel.appendChild(opt);
  }

  const wSel = selWeek();
  wSel.innerHTML = '<option value="">Todas</option>';
  for (let w = 1; w <= 53; w++) {
    const opt = document.createElement('option');
    opt.value = String(w);
    opt.textContent = String(w).padStart(2,'0');
    wSel.appendChild(opt);
  }

  initPeriodoSwitch();
}

export function initPeriodoSwitch() {
  const mapping = [
    [btnConsecutive(), PeriodMode.consecutive],
    [btnMonthly(),   PeriodMode.monthly],
    [btnWeekly(),   PeriodMode.weekly],
    [btnFortnightly(), PeriodMode.fortnightly],
    [btnRange(),     PeriodMode.range],
  ];

  mapping.forEach(([btn, mode]) => {
    if (!btn) return;
    btn.dataset.mode = mode;
    btn.addEventListener('click', () => setMode(mode));
  });

  setMode(currentMode);
}

function setMode(mode) {
  currentMode = mode;

  const buttons = [btnMonthly(), btnWeekly(), btnFortnightly(), btnRange()].filter(Boolean);
  buttons.forEach(b => b.classList.toggle('primary', b.dataset.mode === mode));

  if (mode === PeriodMode.consecutive) {
    toggleFilterVisibility({ showYear: false, showMonth: false, showWeek: false, showQuincena: false });
    showRangeSection(true);
  }
  else if (mode === PeriodMode.monthly) {
    toggleFilterVisibility({ showYear: true, showMonth: true,  showWeek: false, showQuincena: false });
    showRangeSection(false);
    setDefaultRangeThisMonth();
  } else if (mode === PeriodMode.weekly) {
    toggleFilterVisibility({ showYear: true, showMonth: false, showWeek: true,  showQuincena: false });
    showRangeSection(false);
  } else if (mode === PeriodMode.fortnightly) {
    toggleFilterVisibility({ showYear: true, showMonth: true,  showWeek: false, showQuincena: true  });
    showRangeSection(false);
  } else { 
    toggleFilterVisibility({ showYear: false, showMonth: false, showWeek: false, showQuincena: false });
    showRangeSection(true);
  }
}

function showRangeSection(show) {
  const box = rangeBox();
  if (box) box.classList.toggle('hidden', !show);
}

export function getFilterValues() {
  const base = {
    mode: getCurrentMode(),
    anio: parseInt(selYear().value, 10),
    mes: parseInt(selMonth().value, 10),
    quincena: selQ().value ? parseInt(selQ().value, 10) : undefined,
    iso_semana: selWeek().value ? parseInt(selWeek().value, 10) : undefined,
    producto: selProd().value || undefined,
    segmento: selSegmen().value || undefined,
    estado: selEstado().value || undefined,
  };

  if (base.mode === PeriodMode.consecutive || base.mode === PeriodMode.range) {
    const ini = selFechaIni()?.value || '';
    const fin = selFechaFin()?.value || '';
    if (!ini || !fin) throw new Error('Selecciona Fecha inicio y Fecha fin');
    if (ini > fin) throw new Error('La Fecha inicio no puede ser mayor que la Fecha fin');

    base.fecha_inicio = ini;
    base.fecha_fin    = fin;
  }

  return base;
}

export function buildQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

function coerceNumber(v){
  if(typeof v==='number') return v;
  if(typeof v==='string' && v.trim()!=='' && !isNaN(Number(v.replace(/,/g,''))))
    return Number(v.replace(/,/g,''));
  return v;
}

// --- Helpers dinámicos ---
function classifyAndOrderColumns(columns, rows) {
  // Si no te pasan columns, infiérelas
  const cols = (columns && columns.length)
    ? columns.slice()
    : Object.keys(rows?.[0] || []);

  // 1) Detectar montos por nombre (flexible)
  const isMoney = (c) =>
    /(precio|descuento|subtotal|impuesto(?!_porcentaje)|bruto|total(_mxn)?|monto)/i.test(c);

  // 2) Partir columnas
  const money    = cols.filter(isMoney);
  const nonMoney = cols.filter((c) => !isMoney(c));

  // 3) Empujar `notas` al final de los no-montos (si existe)
  const iNotas = nonMoney.indexOf('notas');
  if (iNotas > -1) {
    nonMoney.splice(iNotas, 1);
    nonMoney.push('notas');
  }

  // 4) Orden final: todo lo no-monto (con notas al final) y luego montos
  const ordered = [...nonMoney, ...money];

  // 5) Columnas a sumar (evita porcentajes)
  const sumCols = money.filter((c) => !/porcentaje|%/i.test(c));

  // 6) Grupos automáticos si no te pasan unos
  const groupsAuto = [
    { label: 'DATOS',  span: nonMoney.length },
    { label: 'MONTOS', span: money.length    },
  ].filter(g => g.span > 0);

  return { ordered, sumCols, groupsAuto };
}

export function renderGroupedTable({ groups, columns, rows, sumCols = ['monto'] }) {
  // Guardar estado
  tableState.rows = rows || [];

  const { ordered, sumCols: autoSums, groupsAuto } =
    classifyAndOrderColumns(columns, tableState.rows);

  tableState.columns   = ordered;
  tableState.sumCols   = (sumCols && sumCols.length) ? sumCols : autoSums;
  tableState.groups    = (groups && groups.length) ? groups : groupsAuto;
  tableState.page      = 1;
  tableState.totalsCache = computeTotals(tableState.rows, tableState.sumCols);

  // Pintar encabezados (una sola vez por dataset)
  const theadGroup = document.getElementById('thead-group');
  const theadRow = document.getElementById('thead-row');
  if (theadGroup && theadRow) {
    theadGroup.innerHTML = '';
    for (const g of tableState.groups) {
      const th = document.createElement('th');
      th.textContent = g.label;
      th.colSpan = g.span;
      theadGroup.appendChild(th);
    }
    theadRow.innerHTML = '';
    for (const col of tableState.columns) {
      const th = document.createElement('th');
      th.textContent = col.toUpperCase();
      theadRow.appendChild(th);
    }
  }

  // Preparar paginador
  setupPagerOnce();
  renderTableBodyPage();
}

function renderTableBodyPage() {
  const tbody = document.querySelector('#table-payment-reports tbody');
  if (!tbody) return;

  const { rows, columns, page, pageSize, sumCols, totalsCache } = tableState;
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">Sin datos</td></tr>`;
    updatePagerUI();
    return;
  }

  const start = (page - 1) * pageSize;
  const end   = start + pageSize;
  const slice = rows.slice(start, end);

  const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

  for (const r of slice) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      let val = r[col];
      if (/monto|total(_mxn)?|total_linea|total_monthly|precio|descuento/i.test(col)) {
        const n = coerceNumber(val);
        td.textContent = (typeof n === 'number') ? fmt.format(n) : (val ?? '');
      } else {
        td.textContent = val ?? '';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  if (sumCols?.length) {
    const tr = document.createElement('tr')
    tr.classList.add('total-row')

    // ¿dónde empieza la primera columna sumable?
    const sumIdxs = sumCols
      .map(c => columns.indexOf(c))
      .filter(i => i >= 0)
      .sort((a,b) => a - b)

    // Si no encontró ninguna, deja una fila informativa
    if (sumIdxs.length === 0) {
      const td = document.createElement('td')
      td.colSpan = columns.length
      td.textContent = 'TOTAL'
      tr.appendChild(td)
      tbody.appendChild(tr)
      updatePagerUI()
      return
    }

    const firstSumIdx = sumIdxs[0]

    // Celda "TOTAL" que ocupa desde col 0 hasta antes de la primera col sumable
    const tdL = document.createElement('td')
    tdL.colSpan = Math.max(1, firstSumIdx)
    tdL.textContent = 'TOTAL'
    tr.appendChild(tdL)

    // Rellenar el resto de columnas, poniendo el total SOLO donde corresponda
    for (let i = firstSumIdx; i < columns.length; i++) {
      const colName = columns[i]
      const td = document.createElement('td')

      if (sumCols.includes(colName)) {
        const n = totalsCache?.[colName]
        td.textContent =
          typeof n === 'number'
            ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)
            : ''
      } else {
        td.textContent = ''
      }
      tr.appendChild(td)
    }

    tbody.appendChild(tr)
  }

  updatePagerUI();
}

export function toggleFilterVisibility({
  showYear = true,
  showMonth = false,
  showWeek = false,
  showQuincena = false
} = {}) {
  const config = [
    ['filter-year',     showYear],
    ['filter-monthly',      showMonth],
    ['filter-weekly',   showWeek],
    ['filter-fortnightly', showQuincena],
  ];

  for (const [id, show] of config) {
    const sel = document.getElementById(id);
    const box = sel ? sel.closest('.filter-item') || sel.parentElement : null;
    if (box) box.classList.toggle('hidden', !show);
  }
}

export async function loadEstadosSelect({ preserve = true } = {}) {
  const sel = document.getElementById('filter-status');
  if (!sel) return;

  const prev = preserve ? (sel.value ?? '') : '';

  try {
    const res = await fetch('/api/paymentreports/estados');
    let estados = await res.json();

    estados = Array.from(new Set(
      (estados || []).map(e => String(e ?? '').trim())
    )).filter(Boolean).sort((a, b) => a.localeCompare(b));

    sel.replaceChildren(new Option('Todos', ''));
    for (const e of estados) {
      sel.appendChild(new Option(e, e));
    }

    if (preserve && prev && estados.includes(prev)) {
      sel.value = prev;
    }
  } catch (err) {
    console.error('Error cargando estados:', err);
    if (!sel.options.length) sel.appendChild(new Option('Todos', ''));
  }
}

export async function loadproductsSelect({ preserve = true } = {}) {
  const sel = document.getElementById('filter-product');
  if (!sel) return;

  const prev = preserve ? (sel.value ?? '') : '';

  try {
    const res = await fetch('/api/paymentreports/products');
    let products = await res.json();

    products = Array.from(
      new Set((products || []).map(p => String(p ?? '').trim()))
    ).filter(Boolean).sort((a, b) => a.localeCompare(b));

    sel.replaceChildren(new Option('Todos', ''));
    for (const p of products) {
      sel.appendChild(new Option(p, p));
    }

    if (preserve && prev && products.includes(prev)) {
      sel.value = prev;
    }
  } catch (err) {
    console.error('Error cargando products:', err);
    if (!sel.options.length) sel.appendChild(new Option('Todos', ''));
  }
}

export function setDefaultRangeThisMonth() {
  const ini = document.getElementById('filter-start-date');
  const fin = document.getElementById('filter-end-date');
  if (!ini || !fin) return;

  if (!ini.value || !fin.value) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const toISO = d => d.toISOString().slice(0,10);
    ini.value = toISO(first);
    fin.value = toISO(last);
  }
}

export async function cargarConsecutivo(filters) {
  const q = buildQuery({
    fecha_inicio: filters.fecha_inicio,
    fecha_fin: filters.fecha_fin,
    producto: filters.producto || undefined,
    segmento: filters.segmento || undefined,
    metodo: filters.metodo || undefined,
    estado: filters.estado || undefined,
  });
  const rows = await fetchJSON(`/api/paymentreports/consecutivo${q}`);
  const columns = [
    'id_transaccion','id_suscripcion','id_cargo',
    'nombre','apellidos','concepto','precio','descuento','estado',
    'total','metodo_pago','fecha','notas'
  ];
  const groups = [
    { label:'Identificadores', span:3 },
    { label:'Datos',           span: columns.length - 3 },
  ];
  renderGroupedTable({
    groups,
    columns,
    rows,
    sumCols: ['total'],
  });
}

// api.js (ESM)
export function setToken(t){ localStorage.setItem('auth_token', t) }
export function getToken(){ return localStorage.getItem('auth_token') }
export function clearToken(){ localStorage.removeItem('auth_token') }

async function postForm(path, data) {
  const params = new URLSearchParams()
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.append(k, String(v))
  })
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || json.code || res.statusText)
  return json
}

export function requestRegister({ email, nombre }) {
  return postForm('/api/auth/request-register', { email, correo: email, name: nombre, nombre })
}
export function setPassword({ token, password }) {
  return postForm('/api/auth/set-password', { token, password })
}
export function login({ email, password }) {
  return postForm('/api/auth/login', { email, correo: email, password })
}
export function requestReset({ email }) {
  return postForm('/api/auth/request-reset', { email, correo: email })
}
export function resetPassword({ token, password }) {
  return postForm('/api/auth/reset-password', { token, password })
}
export async function requestRoleChange({ role }) {
  const token = getToken()
  const res = await fetch('/api/auth/request-role-change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ role }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || json.code || res.statusText)
  return json
}
