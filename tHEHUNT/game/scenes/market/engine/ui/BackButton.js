/**
 * BackButton — a single, context-aware "Back" control.
 *
 *   holding an item  → "Back"  puts it back on the table
 *   at the table     → "Back"  pulls back to the dealer sitting at his desk
 *   dealer view      → "Leave" the lamp fails, everything goes black
 *   during cinematics → hidden (nothing can be interrupted)
 *
 * In the dealer view a second, quieter control ("Look at the table") leans
 * back in; clicking anywhere in the scene does the same.
 *
 * It only calls market.goBack(), so the real website UI can replace this
 * file without touching the scene.
 */
const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

export class BackButton {
  constructor({ market, parent = document.body, labels = {} }) {
    this.market = market;
    this.labels = {
      look: 'Look at the table', put: 'Put the item back on the table',
      step: 'Step back from the table', leave: 'Leave the Black Market', ...labels,
    };
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bm-back';
    el.hidden = true;
    el.innerHTML = `${ARROW}<span class="bm-back__label">Back</span>`;
    parent.appendChild(el);
    this.el = el;

    const table = document.createElement('button');
    table.type = 'button';
    table.className = 'bm-table';
    table.hidden = true;
    table.textContent = this.labels.look;
    parent.appendChild(table);
    table.addEventListener('click', (e) => { e.stopPropagation(); market.showTable(); });
    this.tableBtn = table;
    this.label = el.querySelector('.bm-back__label');

    el.addEventListener('click', (e) => {
      e.stopPropagation(); // never reaches the 3D canvas
      el.disabled = true;
      market.goBack().finally(() => { el.disabled = false; this.refresh(); });
    });
    this._unsub = market.onStateChange(() => this.refresh());
  }

  refresh() {
    const a = this.market.backAction;
    // show only in calm states; fade so it doesn't pop during cinematics
    this.el.hidden = !a;
    this.el.classList.toggle('is-visible', !!a);
    if (a === 'return') {
      this.label.textContent = 'Back';
      this.el.setAttribute('aria-label', this.labels.put);
    } else if (a === 'dealer') {
      this.label.textContent = 'Back';
      this.el.setAttribute('aria-label', this.labels.step);
    } else if (a === 'exit') {
      this.label.textContent = 'Leave';
      this.el.setAttribute('aria-label', this.labels.leave);
    }
    const showTable = a === 'exit';
    this.tableBtn.hidden = !showTable;
    this.tableBtn.classList.toggle('is-visible', showTable);
  }

  dispose() {
    this._unsub?.();
    this.el.remove();
    this.tableBtn.remove();
  }
}
