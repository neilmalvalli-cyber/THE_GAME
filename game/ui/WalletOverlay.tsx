// Compact wallet: reads the one shared balance and history. Never navigates.
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { MOCK_TEAM } from '../data/team';
import { IconClose } from './icons';
import { PowerUps } from './PowerUps';
import { formatTime } from '../lib/time';
import { playPaper } from '../audio/uiAudio';
import './wallet.css';

export function WalletOverlay() {
  const open = useUiStore((s) => s.walletOpen);
  const setOpen = useUiStore((s) => s.setWalletOpen);
  const team = useGameStore((s) => s.team);
  const balance = useGameStore((s) => s.wallet.balance);
  const transactions = useGameStore((s) => s.wallet.transactions);
  const [render, setRender] = useState(open);
  const panel = useRef<HTMLDivElement>(null);

  // keep mounted for the closing animation
  useEffect(() => {
    if (open) { setRender(true); return; }
    const t = window.setTimeout(() => setRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (panel.current && t && !panel.current.contains(t) && !t.closest('.topbar__wallet')) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [open, setOpen]);

  if (!render) return null;
  const recent = transactions.slice(0, 8);

  return (
    <div ref={panel} className={`wallet${open ? ' is-open' : ''}`} role="dialog" aria-modal="false" aria-label="Wallet" tabIndex={-1}>
      <div className="wallet__stitch" aria-hidden="true" />
      <header className="wallet__head">
        <div>
          <div className="wallet__team">{team.name}</div>
          <div className="wallet__teamid">{team.id}</div>
        </div>
        <button type="button" className="wallet__close" onClick={() => { playPaper(); setOpen(false); }} aria-label="Close wallet"><IconClose /></button>
      </header>
      <div className="wallet__balance">
        <div className="wallet__label">Available balance</div>
        <div className="wallet__amount"><span className="coin__dot" />{balance.toLocaleString()} <span className="wallet__unit">coins</span></div>
      </div>
      <PowerUps />
      <div className="wallet__label wallet__label--rule">Recent activity</div>
      <ul className="wallet__list">
        {recent.length === 0 && <li className="wallet__empty">No activity yet. Solve evidence to earn coins.</li>}
        {recent.map((t) => (
          <li key={t.id} className="wallet__row">
            <span className="wallet__desc">{t.label}<time>{formatTime(t.at)}</time></span>
            <span className={`wallet__delta wallet__delta--${t.kind}`}>{t.kind === 'earn' ? '+' : '−'}{t.amount}</span>
          </li>
        ))}
        <li className="wallet__row wallet__row--opening">
          <span className="wallet__desc">Opening allocation</span>
          <span className="wallet__delta">{MOCK_TEAM.startingBalance}</span>
        </li>
      </ul>
      {transactions.length > recent.length && <div className="wallet__more">{transactions.length - recent.length} earlier entries</div>}
    </div>
  );
}
