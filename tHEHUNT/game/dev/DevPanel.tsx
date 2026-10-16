// Development-only test panel. Loaded lazily and only when env.DEV,
// so it never ships in production builds. Toggle with the ` key.
import * as backend from '../services/backend';
import * as sabotage from '../services/sabotage';
import * as casesData from '../data/cases';
import * as routes from '../orchestration/routes';
import * as secrets from '@/game/data/secrets';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { CASES, pad2 } from '../data/cases';
import { useGameStore, wallet, uid } from '../state/gameStore';
import { useSceneStore } from '../state/sceneStore';
import { deliver, processMarketEvents, simulateIncomingMail } from '../services/intelFeed';
import * as marketState from '../services/marketState';
import { resetPhoneEntrance } from '../pages/PhonePage';
import { IMPORTANT_CALL_ID } from '../data/phone';
import { useUiStore } from '../state/uiStore';
import { buildMarketMail } from '../data/mail';
import { deskController } from '../scenes/desk/deskController';
import { marketController } from '../scenes/market/marketController';
import { paths } from '../orchestration/routes';
import { PerfPanel } from './PerfPanel';
import * as catalog from '../data/market';
import { useQuality, type QualityChoice } from '../perf/quality';
import './dev.css';

declare global {
  interface Window {
    simulateIncomingMail?: typeof simulateIncomingMail;
    THE_GAME_DEV?: Record<string, unknown>;
  }
}

export default function DevPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState({ c: 2, l: 2 });
  const desk = useSceneStore((s) => s.deskState);
  const deskPhase = useSceneStore((s) => s.deskPhase);
  const market = useSceneStore((s) => s.marketState);
  const balance = useGameStore((s) => s.wallet.balance);
  const phoneUnlocked = useGameStore((s) => s.phone.unlocked);
  const normal = marketState.useMarketStore((s) => s.normalMarketStatus);
  const black = marketState.useMarketStore((s) => s.blackMarketStatus);
  const [log, setLog] = useState('');

  useEffect(() => {
    window.simulateIncomingMail = simulateIncomingMail;
    window.THE_GAME_DEV = { catalog, useQuality, deskController, marketController, wallet, useGameStore, useSceneStore, useUiStore, gsap, marketState, processMarketEvents, sabotage, backend, cases: casesData, routes, secrets };
    const onKey = (e: KeyboardEvent) => { if (e.key === '`' && !(e.target as Element)?.closest?.('input,textarea')) setOpen((o) => !o); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const say = (s: string) => setLog(s);

  if (!open) return <button type="button" className="dev-tab" onClick={() => setOpen(true)} title="Development panel (`)">DEV</button>;

  return (
    <aside className="dev" aria-label="Development controls">
      <header><b>DEV · THE GAME</b><button type="button" onClick={() => setOpen(false)} aria-label="Close panel">×</button></header>
      <div className="dev__stat"><span>Desk</span><code>{deskPhase} · {desk ?? '—'}</code></div>
      <div className="dev__stat"><span>Market</span><code>{market}</code></div>
      <div className="dev__stat"><span>Balance</span><code>{balance}</code></div>
      <div className="dev__stat"><span>Markets</span><code>normal {normal} · black {black}</code></div>
      <div className="dev__stat"><span>Phone</span><code>{phoneUnlocked ? 'unlocked' : 'locked'}</code></div>

      <h4>Performance</h4>
      <PerfPanel />
      <div className="dev__row">
        {(['auto', 'low', 'medium', 'high'] as QualityChoice[]).map((q) => (
          <button key={q} type="button" onClick={() => { useQuality.getState().setChoice(q); say(`Graphics: ${q}`); }}>{q}</button>
        ))}
      </div>

      <h4>Cinematics</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => {
          useGameStore.getState().completeIntro();
          useSceneStore.getState().set({ pendingFlicker: true });
          navigate(paths.desk, { replace: true });
        }}>Skip phone intro</button>
        <button type="button" onClick={() => {
          useGameStore.getState().restartIntro();
          deskController.resetForNewSession();
          marketController.resetForNewSession();
          useSceneStore.getState().set({ pendingFlicker: false, introPhase: 'idle' });
          navigate(paths.intro, { state: { replay: true } });
        }}>Replay phone intro</button>
        <button type="button" onClick={() => navigate(paths.blackMarket)}>Enter Black Market</button>
        <button type="button" onClick={async () => {
          const m = marketController.instance;
          if (!m || !m.state.is('MARKET_IDLE', 'ITEM_HOVER', 'ITEM_INSPECTED')) { say('Enter the market and wait for the table view first.'); return; }
          const id = m.inspected?.id ?? [...m.desk.items.values()].find((i) => !i.transferred)?.id;
          if (!id) { say('Nothing left on the table.'); return; }
          say(`Playing purchase animation for ${id} (no charge).`);
          await m.playPurchaseAnimation(id);
        }}>Test purchase animation</button>
      </div>

      <h4>Folders &amp; cases</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => {
          if (!deskController.replayLanding()) { navigate(paths.desk); say('The entrance replays from the idle desk — try again once it settles.'); } else say(`${CASES.length}-folder entrance replayed.`);
        }}>Replay {CASES.length}-folder entrance</button>
        <button type="button" onClick={() => {
          if (!deskController.replayLanding()) { navigate(paths.desk); say('Open the idle desk first.'); return; }
          const seq = (deskController.instance as unknown as { seq?: gsap.core.Timeline })?.seq;
          seq?.timeScale(0.3);
          say('Landing at 0.3× speed — watch the first folder settle.');
        }}>Test first-folder landing</button>
        <button type="button" onClick={() => navigate(paths.case(CASES[CASES.length - 1].id))}>Open Case {pad2(CASES[CASES.length - 1].id)}</button>
        <button type="button" onClick={() => {
          const scene = deskController.instance as unknown as { resetDesk?: () => void } | null;
          if (!scene?.resetDesk) { say('The desk is not built yet.'); return; }
          navigate(paths.desk);
          scene.resetDesk();
          say('Folders reset to their rest positions.');
        }}>Reset folder positions</button>
      </div>
      <h4>Cases</h4>
      <div className="dev__row">
        {CASES.map((c) => <button key={c.id} type="button" onClick={() => navigate(paths.case(c.id))}>{pad2(c.id)}</button>)}
      </div>
      <div className="dev__row">
        <select value={level.c} onChange={(e) => setLevel({ ...level, c: Number(e.target.value) })} aria-label="Case">{CASES.map((c) => <option key={c.id} value={c.id}>Case {pad2(c.id)}</option>)}</select>
        <select value={level.l} onChange={(e) => setLevel({ ...level, l: Number(e.target.value) })} aria-label="Level">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Level {pad2(n)}</option>)}</select>
        <button type="button" onClick={() => navigate(paths.level(level.c, level.l))}>Open level</button>
      </div>

      <h4>Evidence phone</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => navigate(paths.phone)}>Open evidence phone</button>
        <button type="button" onClick={() => { useGameStore.getState().setPhoneUnlocked(false); useUiStore.getState().setPhoneCallId(null); resetPhoneEntrance(); say('Phone locked; entrance will play again.'); }}>Reset phone lock</button>
        <button type="button" onClick={() => { useGameStore.getState().setPhoneUnlocked(true); navigate(paths.phone); say('Phone unlocked (dev).'); }}>Auto-unlock phone</button>
        <button type="button" onClick={() => {
          useGameStore.getState().setPhoneUnlocked(true);
          useUiStore.getState().setPhoneCallId(IMPORTANT_CALL_ID);
          navigate(paths.phone);
          say('Showing the most recent outgoing call.');
        }}>Inspect call history</button>
      </div>

      <h4>Markets</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => navigate(paths.market)}>Open Normal Market</button>
        <button type="button" onClick={() => say(marketState.closeNormalMarket() ? 'Normal Market shut down.' : 'Already closed.')}>Shut down Normal Market</button>
        <button type="button" onClick={() => say(marketState.openNormalMarket() ? 'Normal Market reopened.' : 'Already open.')}>Reopen Normal Market</button>
        <button type="button" onClick={() => say(marketState.activateBlackMarket() ? 'Black Market activated.' : 'Already active.')}>Activate Black Market</button>
        <button type="button" onClick={() => say(marketState.deactivateBlackMarket() ? 'Black Market deactivated.' : 'Already locked.')}>Deactivate Black Market</button>
        <button type="button" onClick={() => {
          // a preview of the three templates; ids are unique so this never collides with real events
          const id = uid('dev-mkt');
          deliver(buildMarketMail(normal === 'open' ? 'normal-closed' : 'normal-reopened', `${id}-n`, Date.now()));
          deliver(buildMarketMail('black-activated', `${id}-b`, Date.now()));
          say('Market event emails queued (preview only — market state unchanged).');
        }}>Simulate market event email</button>
        <button type="button" className="danger" onClick={() => {
          marketState.resetMarketState();
          useGameStore.setState({ marketMail: { processed: [] } });
          say('Markets reset: Normal open, Black locked.');
        }}>Reset market state</button>
      </div>

      <h4>Wallet</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => { const r = wallet.earnCoins(100, uid('dev-grant'), 'Dev grant'); say(r.ok ? `+100 → ${r.balance}` : r.reason); }}>Add 100 coins</button>
        <button type="button" onClick={() => { useGameStore.getState().resetWallet(); say('Wallet reset to 850.'); }}>Reset wallet</button>
      </div>

      <h4>Mail</h4>
      <div className="dev__grid">
        <button type="button" onClick={() => { simulateIncomingMail('general'); say('General update queued.'); }}>Simulate email</button>
        <button type="button" onClick={() => { simulateIncomingMail('deadDrop'); say('Dead Drop queued.'); }}>Simulate Dead Drop</button>
        <button type="button" onClick={() => { simulateIncomingMail('blackMarket'); say('Black Market update queued.'); }}>Black Market update</button>
        <button type="button" onClick={() => { simulateIncomingMail('system'); say('System alert queued.'); }}>System alert</button>
      </div>

      <h4>State</h4>
      <div className="dev__grid">
        <button type="button" className="danger" onClick={() => {
          marketState.resetMarketState();
          useGameStore.getState().resetAll();
          useUiStore.getState().setPhoneCallId(null);
          resetPhoneEntrance();
          deskController.syncProgress();
          say('All mock data reset: progress, wallet, mail, phone, markets.');
        }}>Reset all mock data</button>
      </div>
      <p className="dev__log">{log}</p>
    </aside>
  );
}
