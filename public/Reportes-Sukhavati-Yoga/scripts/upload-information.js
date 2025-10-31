import { requireAuth } from './guard.js'
import { uploadFile } from './utils/utils.js'

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin', 'editor'])
  if (!user) return
  
  const warningBox = document.getElementById('editor-warning')
  if (String(user.role || '').trim().toLowerCase() !== 'admin') {
    warningBox.style.display = 'block'
  }
})

const helpBox       = document.getElementById('import-help');
const tplList       = document.getElementById('tpl-list');
const sourceBox   = document.getElementById('source-box');
const sourceLinks = document.getElementById('source-links');
const examplesBox   = document.getElementById('examples');
const fileInput    = document.getElementById('file');
const chooseBtn    = document.getElementById('btn-choose');
const browseBtn    = document.getElementById('btn-browse');
const fileName     = document.getElementById('file-name');
const form         = document.getElementById('form');
const result       = document.getElementById('result');
const typeSel      = document.getElementById('type');
const businessUnit = document.getElementById('business-unit');

const IMPORT_INFO = {
  products: {
    title: 'Productos',
    templates: [
      { label: 'Plantilla Productos.xlsx', href: '/assets/templates/Plantilla_Productos.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Productos.png', caption: 'Ejemplo de productos' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Productos', href: 'https://app.tgmanager.com/payments/products' }
    ]
  },

  coupons: {
    title: 'Cupones',
    templates: [
      { label: 'Plantilla Cupones.xlsx', href: '/assets/templates/Plantilla_Cupones.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Cupones.png', caption: 'Ejemplo de cupones' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Cupones', href: 'https://app.tgmanager.com/payments/coupons' }
    ]
  },

  partners: {
    title: 'Socios',
    templates: [
      { label: 'Plantilla Socios.xlsx', href: '/assets/templates/Plantilla_Socios.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Socios.png', caption: 'Ejemplo de socios' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Socios', href: 'https://app.tgmanager.com/reports/member' }
    ]
  },

  subscriptions: {
    title: 'Suscripciones',
    templates: [
      { label: 'Plantilla Suscripciones.xlsx', href: '/assets/templates/Plantilla_Suscripciones.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Suscripciones.png', caption: 'Ejemplo de suscripciones' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Suscripciones', href: 'https://app.tgmanager.com/subscriptions' }
    ]
  },

  activities: {
    title: 'Actividades',
    templates: [
      { label: 'Plantilla Actividades.xlsx', href: '/assets/templates/Plantilla_Actividades.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Actividades.png', caption: 'Ejemplo de actividades' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Actividades', href: 'https://app.tgmanager.com/payments/transactions' }
    ]
  },

  payments: {
    title: 'Pagos',
    templates: [
      { label: 'Plantilla Reporte.xlsx',  href: '/assets/templates/Plantilla_Reporte_Detallado_Pagos.xlsx' },
      { label: 'Plantilla Histórico.xlsx', href: '/assets/templates/Plantilla_Historico_Pagos.xlsx' }
    ],
    examples: [
      { src: './assets/examples/Ejemplo_Reporte_Detallado_Pagos.png',            caption: 'Ejemplo de reporte detallado' },
      { src: './assets/examples/Ejemplo_Historico_Pagos.png',    caption: 'Ejemplo de histórico' }
    ],
    sourceUrls: [
      { label: 'Trainingym Manager · Reporte de pagos', href: 'https://app.tgmanager.com/reports/payments' },
      { label: 'Trainingym Manager · Histórico',        href: 'https://app.tgmanager.com/payments/historical' }
    ]
  },

  payments_template: {
    title: 'Pagos (plantilla BD)',
    templates: [
      { label: 'Plantilla Pagos.xlsx', href: '/assets/templates/Plantilla_Pagos.xlsx' }
    ],
    examples: [
    ],
    sourceUrls: []
  },
};

function resetFileUI(placeholderText) {
  if (!fileInput || !fileName) return;
  fileInput.value = '';
  fileName.textContent = placeholderText;
}

function updateFileMode() {
  if (!typeSel) return;
  if (typeSel.value === 'payments') {
    if (fileInput) fileInput.multiple = true;
    resetFileUI('Ningún archivo seleccionado (se requieren 2 archivos .xlsx)');
  } else {
    if (fileInput) fileInput.multiple = false;
    resetFileUI('Ningún archivo seleccionado');
  }
}

function renderImportHelp() {
  if (!typeSel || !helpBox) return;

  const key = typeSel.value;
  const info = IMPORT_INFO[key];

  if (!info) {
    helpBox.hidden = true;
    return;
  }

  // --- Plantillas ---
  tplList.innerHTML = '';
  (info.templates || []).forEach(t => {
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = t.href;
    a.download = '';
    a.textContent = `Descargar ${t.label}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.textDecoration = 'none';
    a.style.color = 'inherit';
    tplList.appendChild(a);
  });

  // --- URLs Fuente ---
  sourceLinks.innerHTML = '';
  if (info.sourceUrls?.length) {
    info.sourceUrls.forEach(u => {
      const a = document.createElement('a');
      a.className = 'btn';
      a.href = u.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.textDecoration = 'none';
      a.style.color = 'inherit';
      a.textContent = u.label || 'Abrir fuente';
      sourceLinks.appendChild(a);
    });
    sourceBox.style.display = 'flex';
  } else {
    sourceBox.style.display = 'none';
  }

  // --- Imágenes Ejemplo ---
  examplesBox.innerHTML = '';
  if (info.examples?.length) {
    info.examples.forEach(ex => {
      const figure = document.createElement('figure');
      const img = document.createElement('img');
      const cap = document.createElement('figcaption');
      const br = document.createElement('br');

      img.src = ex.src;
      img.alt = ex.caption || 'Ejemplo';
      img.className = 'example-img';

      cap.textContent = ex.caption || '';

      figure.appendChild(cap);
      figure.appendChild(br);
      figure.appendChild(img);
      examplesBox.appendChild(figure);
    });
  }

  helpBox.hidden = false;
}

updateFileMode();
renderImportHelp();

const toggleBtn = document.getElementById('toggle-help');
const helpBody  = document.getElementById('import-help-body');

toggleBtn?.addEventListener('click', () => {
  const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
  toggleBtn.setAttribute('aria-expanded', String(!expanded));
  helpBody.classList.toggle('hidden', expanded);
});

typeSel?.addEventListener('change', () => {
  updateFileMode();                
  renderImportHelp();               
});

chooseBtn?.addEventListener('click', () => fileInput?.click());
browseBtn?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    fileName.textContent = typeSel.value === 'payments'
      ? 'Ningún archivo seleccionado (se requieren 2 archivos .xlsx)'
      : 'Ningún archivo seleccionado';
    return;
  }
  const names = files.map(f => f.name);
  fileName.textContent = names.join(' · ');
  if (typeSel.value === 'payments' && files.length !== 2) {
    fileName.textContent += '  — Debes seleccionar exactamente 2 archivos';
  }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const tipo  = typeSel?.value;
  const files = Array.from(fileInput?.files || []);

  if (tipo === 'payments') {
    if (files.length !== 2) {
      result.textContent = JSON.stringify(
        { ok: false, error: 'Para "pagos" debes seleccionar exactamente 2 archivos .xlsx.' },
        null, 2
      );
      return;
    }
  } else {
    if (files.length !== 1) {
      result.textContent = JSON.stringify(
        { ok: false, error: 'Selecciona un (1) archivo .xlsx.' },
        null, 2
      );
      return;
    }
  }

  const fd = new FormData();
  fd.append('table', tipo);
  fd.append('schema', businessUnit?.value || '');

  files.forEach(f => fd.append('file', f));

  result.textContent = 'Subiendo y procesando...';
  try {
    const token = localStorage.getItem('auth_token')
    const resp = await fetch('/api/information/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: fd
    })
    const json = await resp.json();
    result.textContent = JSON.stringify(json, null, 2);
    files.forEach(async file => await uploadFile(file, 'uploadinfo', null, null, tipo));
  } catch (err) {
    result.textContent = JSON.stringify({ ok: false, error: String(err) }, null, 2);
  }
});