// Owned power-ups in the wallet. Skip Token and Powerful Hint are used on a level page;
// Firewall works by itself; the rest are used here.
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { CATALOG } from '../data/market';
import { CASES, pad2 } from '../data/cases';
import { isCaseSolved } from '../services/scoring';
import { launchSabotage, listRivals, type SabotageKind } from '../services/sabotage';
import { armOverclock, isServerBackend, launchSabotageRemote, spendMasterKey, useRivals } from '../services/backend';

export function PowerUps() {
  const inventory = useGameStore((s) => s.inventory);
  const effects = useGameStore((s) => s.effects);
  const progress = useGameStore((s) => s.progress);
  const [target, setTarget] = useState('');
  const [caseId, setCaseId] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const owned = CATALOG.filter((c) => (inventory[c.id] ?? 0) > 0);
  const serverRivals = useRivals((s) => s.rivals);
  const rivals = isServerBackend ? serverRivals : listRivals();
  const [busy, setBusy] = useState(false);
  const open = CASES.filter((c) => !isCaseSolved(c.id, progress.completed, progress.skipped));
  const report = (r: { ok: boolean; message: string }) => setNote({ ok: r.ok, text: r.message });
  const run = async (p: Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string }) => {
    setBusy(true);
    try { report(await p); } finally { setBusy(false); }
  };
  const attack = (kind: SabotageKind) => run(isServerBackend ? launchSabotageRemote(kind, target) : launchSabotage(kind, target));

  return (
    <section className="powerbox" aria-label="Power-ups" data-testid="wallet-powerups">
      <div className="wallet__label wallet__label--rule">Power-ups</div>
      {owned.length === 0 && !effects.overclockArmed && <p className="wallet__empty">None owned. Buy them in the markets.</p>}
      {effects.overclockArmed && <p className="powerbox__state">Overclock armed — next mini-game pays double.</p>}
      <ul className="powerbox__list">
        {owned.map((c) => (
          <li key={c.id} className="powerbox__item" data-testid={`pu-${c.id}`}>
            <span className="powerbox__name">{c.name} <b>×{inventory[c.id]}</b></span>
            {c.id === 'firewall' && <span className="powerbox__state">Active · blocks the next attack</span>}
            {(c.id === 'skip_token' || c.id === 'powerful_hint') && <span className="powerbox__state">Use it on a level page</span>}
            {c.id === 'overclock' && !effects.overclockArmed && (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run(armOverclock())}>Arm</button>
            )}
            {(c.id === 'glitch_attack' || c.id === 'freeze') && (rivals.length === 0 ? <span className="powerbox__state">No rival teams yet</span> : (
              <span className="powerbox__row">
                <select aria-label={`${c.name} target`} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose a rival…</option>
                  {rivals.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button type="button" className="btn btn--ghost" disabled={!target || busy} onClick={() => attack(c.id === 'freeze' ? 'freeze' : 'glitch')}>Launch</button>
              </span>
            ))}
            {c.id === 'master_key' && (effects.masterKeyUsedOn != null ? <span className="powerbox__state">Already used</span> : (
              <span className="powerbox__row">
                <select aria-label="Master Key case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  <option value="">Choose a case…</option>
                  {open.map((k) => <option key={k.id} value={k.id}>Case {pad2(k.id)} — {k.title}</option>)}
                </select>
                <button type="button" className="btn btn--ghost" disabled={!caseId || busy} onClick={() => { void run(spendMasterKey(Number(caseId))); setCaseId(''); }}>Unlock case</button>
              </span>
            ))}
          </li>
        ))}
      </ul>
      {note && <p className={`powerbox__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</p>}
    </section>
  );
}
