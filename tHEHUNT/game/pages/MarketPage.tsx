// /team/black-market — controls around the existing room. The scene plays its
// own entrance, inspection, purchase ritual (with the two knocks) and exit.
// This page adds: Back to Desk, the context "back", the item card and the
// purchase request against the one shared wallet.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { marketController } from '../scenes/market/marketController';
import { useSceneStore, isMarketPurchasing } from '../state/sceneStore';
import { useGameStore, uid } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { getMarketItem } from '../data/market';
import { useMarketStore } from '../services/marketState';
import { IconLock } from '../ui/icons';
import { IconArrowLeft, IconBack } from '../ui/icons';
import './market.css';
import { purchase } from '../services/backend';

const CALM = new Set(['MARKET_IDLE', 'ITEM_HOVER', 'DEALER_VIEW', 'ITEM_INSPECTED']);
const ENTERING = new Set(['MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO']);

export function MarketPage() {
  const active = useMarketStore((s) => s.blackMarketStatus === 'active');
  const inside = useSceneStore((s) => s.marketState !== 'MARKET_INACTIVE');
  // Locked and not already inside: no door, no room — the route is blocked.
  if (!active && !inside) return <BlackMarketLocked />;
  return <BlackMarketRoom active={active} />;
}

function BlackMarketLocked() {
  const navigate = useNavigate();
  const lastDeskPath = useUiStore((s) => s.lastDeskPath);
  return (
    <div className="hud bm-locked" role="main" aria-labelledby="bm-locked-title">
      <div className="bm-locked__card">
        <span className="bm-locked__icon"><IconLock /></span>
        <h1 id="bm-locked-title" className="bm-locked__title">Nothing here</h1>
        <p className="bm-locked__text">This door is locked. There is no market behind it — not tonight.</p>
        <button type="button" className="btn" onClick={() => navigate(lastDeskPath)}>Back to Desk</button>
      </div>
    </div>
  );
}

function BlackMarketRoom({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const state = useSceneStore((s) => s.marketState);
  const itemId = useSceneStore((s) => s.marketItem);
  const loaded = useSceneStore((s) => s.marketLoaded);
  const balance = useGameStore((s) => s.wallet.balance);
  const purchases = useGameStore((s) => s.purchases);
  const lastDeskPath = useUiStore((s) => s.lastDeskPath);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noWebgl, setNoWebgl] = useState(false);

  useEffect(() => { setError(null); }, [itemId, state === 'ITEM_INSPECTED']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!receipt) return;
    const t = window.setTimeout(() => setReceipt(null), 4200);
    return () => window.clearTimeout(t);
  }, [receipt]);
  useEffect(() => {
    // the market needs WebGL 2; if it cannot be built, say so instead of hanging in the dark
    const t = window.setTimeout(() => { if (!useSceneStore.getState().marketLoaded) setNoWebgl(!document.createElement('canvas').getContext('webgl2')); }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const market = marketController.instance;
  const calm = CALM.has(state);
  const item = itemId ? getMarketItem(itemId, 'black') : undefined;
  const bought = item ? purchases[item.id] ?? 0 : 0;
  const left = item ? Math.max(0, item.stock - bought) : 0;

  const leave = () => navigate(lastDeskPath);

  const buy = async () => {
    if (!market || !item || pending.current) return;
    setError(null);
    // 1–3. validate before anything moves: funds, stock, eligibility
    const check = useGameStore.getState().checkPurchase(item.id, 'black');
    if (!check.ok) { setError(check.message); return; }
    // 4. one id per purchase request: a retry or double-click can never charge twice
    const purchaseId = uid('purchase');
    pending.current = purchaseId;
    setBusy(true);
    let charged = false;
    try {
      // 5–7. the scene only starts the ritual if the (mock) transaction succeeds
      const played = await market.requestPurchase(item.sceneId, async () => {
        const r = await purchase(item.id, purchaseId, 'black'); // re-checks availability at commit (server-side with Supabase)
        if (!r.ok) setError(r.message);
        charged = r.ok;
        return r.ok;
      });
      if (charged) setReceipt(`${item.name} acquired · −${item.price} coins`);
      if (charged && !played) {
        // the animation was interrupted after payment: keep the one transaction, put the room back in order
        market.resetBlackMarket();
      }
    } finally {
      pending.current = null;
      setBusy(false);
    }
  };

  const purchasing = isMarketPurchasing(state);
  const back = market?.backAction ?? null;

  return (
    <div className="hud hud--market">
      {!loaded && noWebgl && (
        <div className="market-msg" role="alert">
          <p>The Black Market needs WebGL 2, which this browser does not provide.</p>
          <button type="button" className="btn" onClick={leave}>Back to Desk</button>
        </div>
      )}

      <div className={`market-nav${calm ? ' is-on' : ''}`}>
        <button type="button" className="market-btn" onClick={leave} disabled={!calm}><IconArrowLeft /><span>Back to Desk</span></button>
        {back === 'return' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void market?.returnToMarketDesk()}><IconBack /><span>Put it back</span></button>}
        {back === 'dealer' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void market?.showDealer()}><IconBack /><span>Step back</span></button>}
        {back === 'exit' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void market?.showTable()}><span>Look at the table</span></button>}
      </div>

      <div className={`market-caption${state === 'ITEM_HOVER' && item ? ' is-on' : ''}`} aria-hidden="true">
        {item && <><span className="market-caption__name">{item.name}</span><span className="market-caption__price"><span className="coin__dot" />{item.price}</span></>}
      </div>

      {item && (state === 'ITEM_INSPECTED' || purchasing) && (
        <aside className={`ledger${purchasing ? ' is-dim' : ''}`} aria-label={`${item.name} — inspection`}>
          <div className="ledger__kicker">{item.rarity === 'legendary' ? 'Legendary · one use' : 'Merchandise'}</div>
          <h2 className="ledger__name">{item.name}</h2>
          <p className="ledger__desc">{item.description}</p>
          {item.rules && <ul className="ledger__rules">{item.rules.map((r) => <li key={r}>{r}</li>)}</ul>}
          <dl className="ledger__facts">
            <div><dt>Price</dt><dd>{item.listPrice > item.price && <s className="ledger__list">{item.listPrice}</s>}<span className="coin__dot" />{item.price} coins</dd></div>
            <div><dt>Stock</dt><dd>{left > 0 ? `${left} of ${item.stock}` : 'Sold out'}</dd></div>
            <div><dt>Your balance</dt><dd>{balance} coins</dd></div>
          </dl>
          {error && <p className="ledger__error" role="alert">{error}</p>}
          {!purchasing && (
            <div className="ledger__actions">
              <button type="button" className="btn btn--primary" onClick={() => void buy()} disabled={busy || left === 0 || !active}>
                {!active ? 'Dealer has stopped trading' : left === 0 ? 'Sold out' : `Purchase · ${item.price}`}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void market?.returnToMarketDesk()} disabled={busy}>Put it back</button>
            </div>
          )}
          {purchasing && <p className="ledger__wait">The dealer is accepting your payment…</p>}
        </aside>
      )}

      {ENTERING.has(state) && (
        <button type="button" className="market-skip" onClick={() => marketController.skipEntrance()}>
          Skip entrance <span aria-hidden="true">›</span>
        </button>
      )}

      {!active && (
        <div className="bm-closing" role="alert">
          <b>The dealer is packing up.</b> No more deals tonight — finish looking and leave.
          <button type="button" className="market-btn" onClick={leave}><IconArrowLeft /><span>Leave now</span></button>
        </div>
      )}

      {receipt && <div className="market-receipt" role="status">{receipt}</div>}
      {state === 'MARKET_IDLE' && !receipt && <div className="market-hint" aria-hidden="true">Hover the merchandise · click to inspect</div>}
    </div>
  );
}
