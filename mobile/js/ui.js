// Petits utilitaires d'interface : éléments, icônes, curseurs, feuilles, toasts.

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const P = {
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  split: '<path d="M12 3v18"/><path d="M8 7l-4 5 4 5"/><path d="M16 7l4 5-4 5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  color: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M19 6a8 8 0 0 1 0 12"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.3"/><path d="M20 4v5h-5"/>',
  flip: '<path d="M12 3v18"/><path d="M8 7L3 17h5z"/><path d="M16 7l5 10h-5z"/>',
  aspect: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4M7 9v3M17 15h-4M17 15v-3"/>',
  fade: '<path d="M3 20L12 4l9 16"/><path d="M7.5 12h9"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
  shift: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/>',
  export: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
};

export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

export function toolButton(ic, label, onclick, opts = {}) {
  return h('button', { class: 'tool' + (opts.danger ? ' danger' : '') + (opts.active ? ' active' : ''), onclick, disabled: opts.disabled }, icon(ic), h('span', {}, label));
}

// Curseur avec libellé, valeur, et double-tap pour réinitialiser.
export function slider({ label, min, max, step = 1, value, format = v => String(v), reset = 0, onInput, onChange }) {
  const val = h('span', { class: 'sval' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value });
  const set = v => { input.value = v; val.textContent = format(Number(v)); };
  input.addEventListener('input', () => { val.textContent = format(Number(input.value)); onInput && onInput(Number(input.value)); });
  input.addEventListener('change', () => onChange && onChange(Number(input.value)));
  let lastTap = 0;
  const lab = h('label', {
    class: 'slabel',
    onclick: () => {
      const now = Date.now();
      if (now - lastTap < 350) {
        set(reset);
        onInput && onInput(reset);
        onChange && onChange(reset);
      }
      lastTap = now;
    },
  }, label);
  const root = h('div', { class: 'slider' }, h('div', { class: 'shead' }, lab, val), input);
  root.setValue = set;
  return root;
}

export function chips(options, current, onPick) {
  const wrap = h('div', { class: 'chips' });
  const render = cur => {
    wrap.replaceChildren(...options.map(o => h('button', {
      class: 'chip' + (o.id === cur ? ' on' : ''),
      disabled: o.disabled,
      onclick: () => { render(o.id); onPick(o.id); },
    }, o.label)));
  };
  render(current);
  wrap.setValue = render;
  return wrap;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

let sheetClose = null;
export function openSheet(title, body, { onClose, wide = false } = {}) {
  closeSheet();
  const sheet = document.getElementById('sheet');
  document.getElementById('sheetTitle').textContent = title;
  const b = document.getElementById('sheetBody');
  b.replaceChildren(body);
  sheet.classList.toggle('wide', wide);
  sheet.classList.remove('hidden');
  document.body.classList.add('sheet-open');
  sheetClose = onClose || null;
}

export function closeSheet() {
  const sheet = document.getElementById('sheet');
  if (sheet.classList.contains('hidden')) return;
  sheet.classList.add('hidden');
  document.body.classList.remove('sheet-open');
  const cb = sheetClose;
  sheetClose = null;
  if (cb) cb();
}

export function isSheetOpen() {
  return !document.getElementById('sheet').classList.contains('hidden');
}

export function fmtBytes(b) {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} Ko`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} Mo`;
  return `${(b / 1024 ** 3).toFixed(2)} Go`;
}

export function fmtDuration(s) {
  if (s == null || !isFinite(s)) return '…';
  s = Math.max(0, Math.round(s));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}
