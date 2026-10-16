// /team/market — controls around the 3D convenience store (the Normal Market). The scene
// plays its own entrance (street → sliding doors → counter), inspection, checkout
// (scanner, coins, register, receipt, bag) and exit. This page adds Back to Desk, the
// context "back", the product card and the purchase against the one shared wallet.
//
// Closed by the Admin: the scene keeps the doors shut and shows the sealed store behind
// police tape; this page adds the notice and offers only the way back.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { marketController } from '../scenes/market/marketController';
import { useSceneStore, isMarketPurchasing } from '../state/sceneStore';
import { useGameStore, uid } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { useMarketStore } from '../services/marketState';
import { getMarketItem } from '../data/market';
import { IconArrowLeft, IconBack } from '../ui/icons';
import './market.css';
import { purchase } from '../services/backend';

const CALM = new Set(['MARKET_IDLE', 'ITEM_HOVER', 'DEALER_VIEW', 'ITEM_INSPECTED']);
const ENTERING = new Set(['MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO']);

export function ShopPage() {
  const navigate = useNavigate();
  const state = useSceneStore((s) => s.shopState);
  const itemId = useSceneStore((s) => s.shopItem);
  const loaded = useSceneStore((s) => s.shopLoaded);
  const closed = useMarketStore((s) => s.normalMarketStatus === 'closed');
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
    const t = window.setTimeout(() => { if (!useSceneStore.getState().shopLoaded) setNoWebgl(!document.createElement('canvas').getContext('webgl2')); }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const store = marketController.storeInstance;
  const calm = CALM.has(state);
  const item = itemId ? getMarketItem(itemId, 'normal') : undefined;
  const left = item ? Math.max(0, item.stock - (purchases[item.id] ?? 0)) : 0;

  const leave = () => navigate(lastDeskPath);

  const buy = async () => {
    if (!store || !item || pending.current || closed) return;
    setError(null);
    // 1–3. validate before anything moves: market open, funds, stock
    const check = useGameStore.getState().checkPurchase(item.id, 'normal');
    if (!check.ok) { setError(check.message); return; }
    // 4. one id per purchase request: a retry or double click can never charge twice
    const purchaseId = uid('purchase');
    pending.current = purchaseId;
    setBusy(true);
    let charged = false;
    try {
      // 5–7. the checkout plays only if the transaction succeeds (re-checked at commit)
      const played = await store.requestPurchase(item.sceneId ?? item.id, async () => {
        const r = await purchase(item.id, purchaseId, 'normal');
        if (!r.ok) setError(r.message);
        charged = r.ok;
        return r.ok;
      });
      if (charged) setReceipt(`${item.name} purchased · −${item.price} coins`);
      if (charged && !played && !store.closed) store.resetStore(); // interrupted after payment: one transaction, a tidy counter
    } finally {
      pending.current = null;
      setBusy(false);
    }
  };

  const purchasing = isMarketPurchasing(state);
  const back = store?.backAction ?? null;
  const sealed = closed && state === 'DEALER_VIEW';

  return (
    <div className="hud hud--market hud--shop" data-testid="shop" data-status={closed ? 'closed' : 'open'} data-state={state}>
      {!loaded && noWebgl && (
        <div className="market-msg" role="alert">
          <p>The Market needs WebGL 2, which this browser does not provide.</p>
          <button type="button" className="btn" onClick={leave}>Back to Desk</button>
        </div>
      )}

      <div className={`market-nav${calm ? ' is-on' : ''}`}>
        <button type="button" className="market-btn" onClick={leave} disabled={!calm}><IconArrowLeft /><span>Back to Desk</span></button>
        {!closed && back === 'return' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void store?.returnToMarketDesk()}><IconBack /><span>Put it back</span></button>}
        {!closed && back === 'dealer' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void store?.showDealer()}><IconBack /><span>Step back</span></button>}
        {!closed && back === 'exit' && <button type="button" className="market-btn market-btn--quiet" onClick={() => void store?.showTable()}><span>Look at the counter</span></button>}
      </div>

      <div className={`market-caption${state === 'ITEM_HOVER' && item ? ' is-on' : ''}`} aria-hidden="true">
        {item && <><span className="market-caption__name">{item.name}</span><span className="market-caption__price"><span className="coin__dot" />{item.price}</span></>}
      </div>

      {item && !closed && (state === 'ITEM_INSPECTED' || purchasing) && (
        <aside className={`ledger ledger--shop${purchasing ? ' is-dim' : ''}`} aria-label={`${item.name} — details`} data-testid="shop-card">
          <div className="ledger__kicker">The Market · Over the counter</div>
          <h2 className="ledger__name">{item.name}</h2>
          <p className="ledger__desc">{item.description}</p>
          <dl className="ledger__facts">
            <div><dt>Price</dt><dd><span className="coin__dot" />{item.price} coins</dd></div>
            <div><dt>In stock</dt><dd>{left > 0 ? `${left} of ${item.stock}` : 'Sold out'}</dd></div>
            <div><dt>Your balance</dt><dd>{balance} coins</dd></div>
          </dl>
          {error && <p className="ledger__error" role="alert">{error}</p>}
          {!purchasing && (
            <div className="ledger__actions">
              <button type="button" className="btn btn--primary" onClick={() => void buy()} disabled={busy || left === 0}>
                {left === 0 ? 'Sold out' : `Buy · ${item.price}`}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void store?.returnToMarketDesk()} disabled={busy}>Put it back</button>
            </div>
          )}
          {purchasing && <p className="ledger__wait">Ringing it up…</p>}
        </aside>
      )}

      {ENTERING.has(state) && (
        <button type="button" className="market-skip" onClick={() => marketController.skipEntrance('store')}>
          Skip <span aria-hidden="true">›</span>
        </button>
      )}

      <div className={`shop-notice${sealed ? ' is-on' : ''}`} role={sealed ? 'alert' : undefined} aria-hidden={!sealed} data-testid="shop-closed-notice">
        <div className="shop-notice__band">Notice</div>
        <h1>Market Closed</h1>
        <p>This area is under investigation</p>
        <p className="shop-notice__red">All transactions suspended</p>
      </div>

      {receipt && <div className="market-receipt" role="status">{receipt}</div>}
      {state === 'MARKET_IDLE' && !closed && !receipt && <div className="market-hint" aria-hidden="true">Hover the counter · click a power-up to pick it up</div>}
    </div>
  );
}
