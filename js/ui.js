// DOM side of the game: on-screen keyboard, the lever, toasts, banners and modal screens.
const $ = (sel, root = document) => root.querySelector(sel);
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const RANK = { miss: 1, near: 2, hit: 3 };
const BACK_SVG = '<svg viewBox="0 0 24 24"><path d="M9 5h11v14H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// ---------------------------------------------------------------- keyboard
export class Keyboard {
  constructor(el, { onLetter, onBack }) {
    this.el = el;
    this.keys = {};
    this.state = {};
    el.innerHTML = '';
    ROWS.forEach((row, r) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      for (const ch of row) rowEl.appendChild(this.makeKey(ch, ch, () => onLetter(ch)));
      if (r === 2) {
        const b = this.makeKey('BACK', BACK_SVG, onBack, true);
        b.classList.add('wide');
        b.setAttribute('aria-label', 'Delete letter');
        rowEl.appendChild(b);
      }
      el.appendChild(rowEl);
    });
  }
  makeKey(id, label, fn, html) {
    const b = document.createElement('button');
    b.className = 'key';
    b.dataset.key = id;
    if (html) b.innerHTML = label; else b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('pressed');
      fn();
    });
    const up = () => b.classList.remove('pressed');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    this.keys[id] = b;
    return b;
  }
  press(id) {
    const b = this.keys[id];
    if (!b) return;
    b.classList.add('pressed');
    setTimeout(() => b.classList.remove('pressed'), 90);
  }
  /** Upgrade a key's color; never downgrade (green beats blue beats gray). */
  mark(ch, result, flash = true) {
    const prev = this.state[ch];
    if (prev && RANK[prev] >= RANK[result]) return;
    this.state[ch] = result;
    const b = this.keys[ch];
    if (!b) return;
    b.classList.remove('hit', 'near', 'miss', 'flash');
    b.classList.add(result);
    if (flash) { void b.offsetWidth; b.classList.add('flash'); }
  }
  reset() {
    this.state = {};
    for (const b of Object.values(this.keys)) b.classList.remove('hit', 'near', 'miss', 'flash');
  }
}

// ---------------------------------------------------------------- lever
export class Lever {
  constructor(el, { onPull, onGrab, onLocked }) {
    this.el = el;
    this.knob = $('.lever-knob', el);
    this.shaft = $('.lever-shaft', el);
    this.label = $('.lever-label', el);
    this.onPull = onPull;
    this.onGrab = onGrab;
    this.onLocked = onLocked;
    this.locked = true;
    this.rattleT = 0;
    this.p = 0;         // 0 = up, 1 = pulled all the way down
    this.vel = 0;
    this.dragging = false;
    this.auto = null;   // scripted pull animation
    this.busy = false;
    this.fired = false;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    this.measure();
    this.draw();
  }
  measure() {
    const h = this.el.clientHeight || 200;
    this.h = h;
    this.top = h * 0.14;
    this.bottom = h * 0.74;
    this.pivot = h * 0.66;
  }
  /** Locked until the row holds a real word. A locked lever rattles instead of pulling. */
  setLocked(on) {
    const was = this.locked;
    this.locked = on;
    this.el.classList.toggle('locked', on);
    this.el.setAttribute('aria-disabled', on ? 'true' : 'false');
    if (on) this.el.classList.remove('unlocking');
    if (was && !on && !this.busy) {
      this.el.classList.remove('unlocking');
      void this.el.offsetWidth;
      this.el.classList.add('unlocking');
    }
    this.syncLabel();
  }
  setBusy(on) { this.busy = on; this.el.classList.toggle('busy', on); this.syncLabel(); }
  syncLabel() {
    const ready = !this.locked && !this.busy;
    this.el.classList.toggle('ready', ready);
    this.label.textContent = this.busy ? 'PULL' : this.locked ? 'LOCKED' : 'PULL!';
  }
  rattle() {
    this.rattleT = 0.4;
    this.onLocked && this.onLocked();
  }

  down(e) {
    if (this.busy || this.auto) return;
    e.preventDefault();
    if (this.locked) { this.onGrab && this.onGrab(); this.rattle(); return; }
    this.el.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.startY = e.clientY;
    this.startP = this.p;
    this.moved = false;
    this.downT = performance.now();
    this.fired = false;
    this.onGrab && this.onGrab();
  }
  move(e) {
    if (!this.dragging) return;
    const dy = e.clientY - this.startY;
    if (Math.abs(dy) > 6) this.moved = true;
    this.p = Math.min(1, Math.max(0, this.startP + dy / (this.bottom - this.top)));
    if (this.p > 0.92 && !this.fired) this.fire();
    this.draw();
  }
  up() {
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.fired) {
      if (!this.moved || this.p > 0.5) this.pull(); // a tap pulls it for you
    }
  }
  fire() {
    this.fired = true;
    this.onPull && this.onPull();
  }
  /** Animate a full pull (used for taps and the Enter key). */
  pull() {
    if (this.auto || this.busy) return;
    if (this.locked) { this.rattle(); return; }
    this.fired = false;
    this.auto = { phase: 'down' };
  }
  update(dt) {
    if (this.rattleT > 0) {
      // tug against the lock: a short, fading jiggle that never gets anywhere
      this.rattleT = Math.max(0, this.rattleT - dt);
      const k = this.rattleT / 0.4;
      this.p = Math.abs(Math.sin((0.4 - this.rattleT) * 48)) * 0.07 * k;
      this.vel = 0;
    } else if (this.auto) {
      if (this.auto.phase === 'down') {
        this.p += dt * 6.5;
        if (this.p >= 1) { this.p = 1; if (!this.fired) this.fire(); this.auto.phase = 'hold'; this.auto.t = 0.08; }
      } else if (this.auto.phase === 'hold') {
        this.auto.t -= dt;
        if (this.auto.t <= 0) { this.auto = null; this.vel = 0; }
      }
    } else if (!this.dragging && this.p !== 0) {
      // spring back up with a wobble
      this.vel += (-this.p * 260 - this.vel * 13) * dt;
      this.p += this.vel * dt;
      if (Math.abs(this.p) < 0.001 && Math.abs(this.vel) < 0.01) { this.p = 0; this.vel = 0; }
    }
    this.draw();
  }
  draw() {
    const y = this.top + this.p * (this.bottom - this.top);
    const s = 1 + 0.28 * Math.sin(Math.max(0, Math.min(1, this.p)) * Math.PI);
    this.knob.style.top = `${y}px`;
    this.knob.style.transform = `translate(-50%, -50%) scale(${s})`;
    const a = Math.min(y, this.pivot), b = Math.max(y, this.pivot);
    this.shaft.style.top = `${a}px`;
    this.shaft.style.height = `${Math.max(2, b - a)}px`;
  }
}

// ---------------------------------------------------------------- toasts & banner
export function toast(msg, ms = 1600) {
  const layer = $('#toast-layer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  layer.appendChild(t);
  while (layer.children.length > 3) layer.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

export function banner(html, cls = '', ms = 2200) {
  const root = $('#banner');
  root.innerHTML = '';
  const b = document.createElement('div');
  b.className = `banner-text ${cls}`;
  b.innerHTML = html;
  root.appendChild(b);
  return new Promise((resolve) => {
    setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => { b.remove(); resolve(); }, 450);
    }, ms);
  });
}

// ---------------------------------------------------------------- modals
let openModal = null;
export function isModalOpen() { return !!openModal; }

export function showModal(title, bodyHtml, { onClose, wide } = {}) {
  closeModal(true);
  const root = $('#modal-root');
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <button class="close" aria-label="Close">${CLOSE_SVG}</button>
      <h2>${title}</h2>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  root.appendChild(bd);
  const m = { el: bd, onClose };
  openModal = m;
  bd.addEventListener('pointerdown', (e) => { if (e.target === bd) closeModal(); });
  $('.close', bd).addEventListener('click', () => closeModal());
  return bd;
}

export function closeModal(instant) {
  const m = openModal;
  if (!m) return;
  openModal = null;
  if (instant) m.el.remove();
  else { m.el.classList.add('out'); setTimeout(() => m.el.remove(), 200); }
  m.onClose && m.onClose();
}

export function miniTiles(word, results, big) {
  return `<div class="mini-tiles">${word.split('').map((ch, i) =>
    `<div class="mtile${big ? ' big' : ''} ${results ? results[i] : ''}">${ch.toUpperCase()}</div>`).join('')}</div>`;
}

export function segHtml(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, label]) =>
    `<button data-v="${v}" class="${String(v) === String(value) ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}

export function switchHtml(name, on) {
  return `<button class="switch${on ? ' on' : ''}" data-switch="${name}" role="switch" aria-checked="${on}"></button>`;
}

export function statsHtml(st, highlight, rows) {
  const pct = st.played ? Math.round((st.won / st.played) * 100) : 0;
  const dist = st.dist.slice(0, rows);
  const max = Math.max(1, ...dist);
  return `<div class="stat-grid">
      <div><div class="stat-num">${st.played}</div><div class="stat-lbl">PLAYED</div></div>
      <div><div class="stat-num">${pct}</div><div class="stat-lbl">WIN %</div></div>
      <div><div class="stat-num">${st.streak}</div><div class="stat-lbl">STREAK</div></div>
      <div><div class="stat-num">${st.best}</div><div class="stat-lbl">BEST</div></div>
    </div>
    <div class="dist-title">SPINS TO WIN</div>
    <div class="dist">${dist.map((n, i) => `<div class="dist-row"><span>${i + 1}</span>
        <div class="dist-bar${highlight === i + 1 ? ' current' : ''}" data-w="${Math.max(8, (n / max) * 100)}">${n}</div></div>`).join('')}
    </div>`;
}

/** Bars animate from 0 to their width once the modal is on screen. */
export function growBars(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.dist-bar').forEach((b) => { b.style.width = `${b.dataset.w}%`; });
  }));
}
