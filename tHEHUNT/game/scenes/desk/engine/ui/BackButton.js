// In-scene "back to the five case files" control, shown only while a file is open.
// A small paper label, typed, so it belongs to the desk rather than to a web page.

const CSS = `
.tg-back {
  position: absolute; z-index: 4;
  top: calc(18px + env(safe-area-inset-top, 0px)); left: 18px;
  display: inline-flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 10px 16px 10px 12px;
  font: 400 15px/1 "Special Elite", "Courier New", monospace; letter-spacing: .08em; text-transform: uppercase;
  color: #2a1d14;
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,.35), rgba(255,255,255,0) 60%),
    #e6dbc2;
  border: 0; border-radius: 2px;
  box-shadow: 0 1px 0 rgba(255,255,255,.4) inset, 0 6px 14px rgba(0,0,0,.45), 0 1px 2px rgba(0,0,0,.5);
  transform: rotate(-1.2deg) translateY(-8px);
  opacity: 0; visibility: hidden; pointer-events: none;
  transition: opacity .35s ease, transform .35s ease, visibility .35s, box-shadow .2s ease;
  cursor: pointer;
}
.tg-back::before { /* red index strip, like the file tabs */
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: #7c1f19; border-radius: 2px 0 0 2px;
}
.tg-back svg { width: 18px; height: 18px; flex: none; margin-left: 4px; }
.tg-back.on { opacity: 1; visibility: visible; pointer-events: auto; transform: rotate(-1.2deg) translateY(0); }
.tg-back.on:hover { transform: rotate(-1.2deg) translateY(-2px); box-shadow: 0 1px 0 rgba(255,255,255,.4) inset, 0 10px 20px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.5); }
.tg-back:focus-visible { outline: 2px solid #f0c27a; outline-offset: 3px; }
.tg-back kbd { font: inherit; font-size: 11px; opacity: .55; margin-left: 4px; }
@media (max-width: 520px) { .tg-back { font-size: 13px; padding: 9px 12px 9px 10px; } .tg-back kbd { display: none; } }
@media (prefers-reduced-motion: reduce) { .tg-back, .tg-back.on, .tg-back.on:hover { transition: opacity .15s linear; transform: rotate(-1.2deg); } }
`;

export class BackButton {
  constructor(container, onBack) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (!document.getElementById('tg-back-style')) {
      const st = document.createElement('style');
      st.id = 'tg-back-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const b = (this.el = document.createElement('button'));
    b.type = 'button';
    b.className = 'tg-back';
    b.setAttribute('aria-label', 'Back to the case files');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/><path d="M8 12h12"/></svg><span>Case files</span><kbd>Esc</kbd>';
    b.tabIndex = -1;
    this._click = (e) => { e.stopPropagation(); onBack(); };
    b.addEventListener('click', this._click);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    container.appendChild(b);
  }

  show(v) {
    this.el.classList.toggle('on', v);
    this.el.tabIndex = v ? 0 : -1;
    if (!v && document.activeElement === this.el) this.el.blur();
  }

  dispose() {
    this.el.removeEventListener('click', this._click);
    this.el.remove();
  }
}
