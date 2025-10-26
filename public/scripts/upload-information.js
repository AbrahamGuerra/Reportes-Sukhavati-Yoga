import { requireAuth } from './guard.js'

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth(['admin', 'editor'])
  if (!user) return 
})

const fileInput    = document.getElementById('file');
const chooseBtn    = document.getElementById('btn-choose');
const browseBtn    = document.getElementById('btn-browse');
const fileName     = document.getElementById('file-name');
const form         = document.getElementById('form');
const result       = document.getElementById('result');
const typeSel      = document.getElementById('type');
const businessUnit = document.getElementById('business-unit');

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

updateFileMode();
typeSel?.addEventListener('change', updateFileMode);

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
    const resp = await fetch('/api/information/upload', { method: 'POST', body: fd });
    const json = await resp.json();
    result.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    result.textContent = JSON.stringify({ ok: false, error: String(err) }, null, 2);
  }
});