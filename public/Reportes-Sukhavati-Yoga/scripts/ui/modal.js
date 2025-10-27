export function formModal({
  title = 'Acción',
  message = '',
  fields = [], // [{ name, label, type, placeholder, value, required }]
  confirmText = 'Aceptar',
  cancelText = 'Cancelar',
} = {}) {
  return new Promise((resolve) => {
    const host = document.getElementById('app-modals') || document.body;
    const root = document.createElement('div');
    root.className = 'modal-backdrop';
    root.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-header">${title}</div>
        <div class="modal-body">
          ${message ? `<p>${message}</p>` : ''}
          ${fields.map(f => `
            <div class="field">
              ${f.label ? `<label for="fm-${f.name}">${f.label}</label>` : ''}
              <input id="fm-${f.name}" name="${f.name}" type="${f.type || 'text'}"
                     placeholder="${f.placeholder || ''}"
                     value="${f.value ?? ''}" ${f.required ? 'required' : ''} />
            </div>
          `).join('')}
        </div>
        <div class="modal-footer">
          <button class="modal-btn ghost" data-act="cancel">${cancelText}</button>
          <button class="modal-btn primary" data-act="ok">${confirmText}</button>
        </div>
      </div>
    `;

    // Close helpers
    const cleanup = (result) => { root.remove(); resolve(result); };
    const onBackdrop = (e) => { if (e.target === root) cleanup(null); };

    // Wire events
    root.addEventListener('click', onBackdrop);
    root.querySelector('[data-act="cancel"]').addEventListener('click', () => cleanup(null));
    root.querySelector('[data-act="ok"]').addEventListener('click', () => {
      const data = {};
      root.querySelectorAll('.modal-body input, .modal-body select, .modal-body textarea')
        .forEach(el => { data[el.name] = el.value; });
      cleanup(data);
    });

    // Enter key submits, Esc cancela
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cleanup(null);
      if (e.key === 'Enter') {
        e.preventDefault();
        root.querySelector('[data-act="ok"]').click();
      }
    });

    // Focus primer campo
    setTimeout(() => {
      const first = root.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
      if (first) first.focus();
    }, 0);

    host.appendChild(root);
  });
}

// Azúcar: un pequeño toast no intrusivo
export function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position: fixed; right: 16px; bottom: 16px; z-index:10000;
    background:${type === 'error' ? '#ef4444' : '#10b981'}; color:white;
    padding:10px 14px; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,.25)
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
