// Owns the two market scenes — the Black Market and the convenience store (the Normal
// Market) — on ONE engine and one WebGL context. The engine code is lazy-loaded the first
// time the player heads for either door (and prefetched once the desk is idle); each
// scene is built the first time it is needed.
//
// The scenes already know how to enter, exit and run a purchase; this controller only
// supplies the `origin` hooks (the desk going dark / coming back), keeps at most one
// scene active, and moves toward what the route asks for.
import type { BlackMarketScene, MarketState } from './engine/blackmarket/BlackMarketScene.js';
import type { StoreScene } from './engine/store/StoreScene.js';
import type { Engine } from './engine/core/Engine.js';
import type { CinematicAudioController } from './engine/core/CinematicAudioController.js';
import { deskController } from '../desk/deskController';
import { useGameStore } from '../../state/gameStore';
import { useSceneStore, isMarketPurchasing } from '../../state/sceneStore';
import { MARKET_ITEMS, NORMAL_MARKET_ITEMS } from '../../data/market';
import { useMarketStore } from '../../services/marketState';
import { profile, onQuality, useQuality } from '../../perf/quality';
import { env } from '../../env';

export type MarketKind = 'black' | 'store';
/** Where the route wants the player: inside one of the markets, outside, or unchanged. */
export type MarketTarget = MarketKind | 'outside' | 'keep';
/** Legacy shape kept for callers that only know the Black Market. */
export type MarketWant = 'inside' | 'outside' | 'keep';

type Modules = {
  Engine: typeof import('./engine/core/Engine.js').Engine;
  Audio: typeof import('./engine/core/CinematicAudioController.js').CinematicAudioController;
  Black: typeof import('./engine/blackmarket/BlackMarketScene.js').BlackMarketScene;
  Store: typeof import('./engine/store/StoreScene.js').StoreScene;
  flickerIn: typeof import('./engine/ui/flicker.js').flickerIn;
};

let modulesPromise: Promise<Modules> | null = null;

/** Fetch the market code without building anything (cheap; safe to call any time). */
export function prefetchMarket(): Promise<Modules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('./engine/core/Engine.js'),
      import('./engine/core/CinematicAudioController.js'),
      import('./engine/blackmarket/BlackMarketScene.js'),
      import('./engine/store/StoreScene.js'),
      import('./engine/ui/flicker.js'),
    ]).then(([e, a, b, s, f]) => ({ Engine: e.Engine, Audio: a.CinematicAudioController, Black: b.BlackMarketScene, Store: s.StoreScene, flickerIn: f.flickerIn }));
  }
  return modulesPromise;
}

// Cinematics that can be cut short safely if the player navigates away.
const CANCELLABLE: ReadonlySet<MarketState> = new Set(['MARKET_LOADING', 'MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO', 'VIEW_CHANGING']);
const CAN_EXIT: ReadonlySet<MarketState> = new Set(['MARKET_IDLE', 'ITEM_HOVER', 'DEALER_VIEW', 'ITEM_INSPECTED']);
const ENTRANCE: ReadonlySet<MarketState> = new Set(['MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO']);

/** Normal Market catalogue id ↔ the product's id inside the store scene. */
const STORE_ID_TO_ITEM = new Map(NORMAL_MARKET_ITEMS.map((i) => [i.sceneId, i]));
export function storeItemForScene(sceneId: string) { return STORE_ID_TO_ITEM.get(sceneId); }

type AnyScene = BlackMarketScene | StoreScene;

class MarketController {
  readonly el: HTMLDivElement;
  private engine: Engine | null = null;
  private audio: CinematicAudioController | null = null;
  private mods: Modules | null = null;
  private black: BlackMarketScene | null = null;
  private store: StoreScene | null = null;
  private enginePromise: Promise<boolean> | null = null;
  private scenePromise: Partial<Record<MarketKind, Promise<boolean>>> = {};
  private target: MarketKind | 'outside' = 'outside';
  private running = false;
  private deskFade: Promise<void> | null = null;
  private exitedListeners = new Set<(kind: MarketKind) => void>();
  private visits: Record<MarketKind, number> = { black: 0, store: 0 };
  private unsubs: (() => void)[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'scene-layer scene-layer--market';
    this.el.setAttribute('aria-label', 'Market');
    this.el.style.visibility = 'hidden';
  }

  /** The Black Market scene (kept for existing callers). */
  get instance() { return this.black; }
  get storeInstance() { return this.store; }
  /** Diagnostics (dev panel): the shared market renderer, if built. */
  /** Development / profiling only. */
  get debugEngine() { return this.engine; }
  get engineStats() { return this.engine ? { ...this.engine.stats, running: this.running } : null; }
  sceneOf(kind: MarketKind): AnyScene | null { return kind === 'black' ? this.black : this.store; }

  attach(host: HTMLElement) {
    this.el.classList.remove('scene-layer--parked');
    if (this.el.parentElement !== host) host.appendChild(this.el);
  }

  /** The team interface unmounted: keep the built rooms, hidden and stopped. */
  detach() {
    this.show(false);
    this.el.classList.add('scene-layer--parked');
    if (this.el.parentElement !== document.body) document.body.appendChild(this.el);
  }

  /** A new team session: back outside, rooms reset, nothing playing. */
  resetForNewSession() {
    this.target = 'outside';
    this.visits = { black: 0, store: 0 };
    const b = this.black;
    if (b && !b.state.is('MARKET_INACTIVE')) { b.resetBlackMarket(); b.state.force('MARKET_INACTIVE'); }
    const s = this.store;
    if (s && !s.state.is('MARKET_INACTIVE')) { s.resetStore(); s.state.force('MARKET_INACTIVE'); }
    this.audio?.stopAll(0.1);
    this.show(false);
  }

  /** Jump past the entrance cinematic (player-requested skip). */
  skipEntrance(kind: MarketKind = 'black') {
    const m = this.sceneOf(kind);
    if (!m || !m.state.is('MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO')) return;
    void m.skipEntrance().then(() => {
      // ease in from black instead of cutting
      const e = this.engine;
      if (!e) return;
      e.fade = 1;
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 500);
        e.fade = 1 - k * k * (3 - 2 * k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  onExited(cb: (kind: MarketKind) => void) { this.exitedListeners.add(cb); return () => { this.exitedListeners.delete(cb); }; }

  // ---------------------------------------------------------------- building
  private buildEngine(): Promise<boolean> {
    if (this.enginePromise) return this.enginePromise;
    this.enginePromise = (async () => {
      const mods = await prefetchMarket();
      const q = profile();
      const engine = new mods.Engine(this.el, { pixelRatioCap: q.pixelRatio, minPixelRatio: q.pixelRatio <= 1 ? 0.75 : 0.85 });
      engine.fpsCap = q.fpsCap;
      const sceneQuality = (p: typeof q) => ({ shadowScale: p.sceneShadowScale, shadowEvery: p.shadowEvery, pointShadows: p.pointShadows, dof: p.sceneDof });
      engine.setSceneQuality(sceneQuality(q));
      engine.onSlow = () => useQuality.getState().reportSlow();
      this.unsubs.push(onQuality((_t, p) => {
        engine.fpsCap = p.fpsCap;
        engine.setSceneQuality(sceneQuality(p));
        engine.maxPixelRatio = Math.min(window.devicePixelRatio || 1, p.pixelRatio);
        engine.setPixelRatio(Math.min(engine.pixelRatio, engine.maxPixelRatio));
      }));
      if (!engine.supported) { useSceneStore.getState().set({ marketLoaded: false, shopLoaded: false }); return false; }
      const audio = new mods.Audio();
      audio.setMuted(useGameStore.getState().settings.muted);
      engine.fade = 1;
      engine.onContextLost = () => console.error('[market] WebGL context lost');
      this.mods = mods;
      this.engine = engine;
      this.audio = audio;
      this.unsubs.push(useGameStore.subscribe((s, prev) => { if (s.settings.muted !== prev.settings.muted) audio.setMuted(s.settings.muted); }));
      return true;
    })().catch((err) => {
      console.error('[market] engine failed to load', err);
      this.enginePromise = null;
      return false;
    });
    return this.enginePromise;
  }

  private origin() {
    const mods = this.mods!, engine = this.engine!;
    return {
      // the desk goes dark before the black-screen opening
      leave: async () => {
        await (this.deskFade ?? deskController.fadeOut());
        this.deskFade = null;
        deskController.setRunning(false);
        deskController.setVisible(false);
        this.show(true);
        engine.fade = 1;
      },
      // after the lights die: the desk flickers back on, exactly as it was left
      restore: async () => {
        this.show(false);
        await deskController.returnFromMarket((set) => mods.flickerIn(set, { reduced: engine.reducedMotion }));
      },
    };
  }

  private build(kind: MarketKind): Promise<boolean> {
    const existing = this.scenePromise[kind];
    if (existing) return existing;
    const p = (async () => {
      if (!(await this.buildEngine())) return false;
      const mods = this.mods!, engine = this.engine!, audio = this.audio!;
      const debug = env.DEV;
      if (kind === 'black') {
        const market = new mods.Black({ engine, audio, debug, assetBase: '/', origin: this.origin() });
        this.black = market;
        this.unsubs.push(market.onStateChange((next, _prev, meta) => {
          useSceneStore.getState().set({ marketState: next, marketItem: meta?.item ?? (next === 'MARKET_INACTIVE' ? null : useSceneStore.getState().marketItem) });
          if (next === 'MARKET_ENTERING') this.applyBlackStock();
          if (next === 'MARKET_IDLE') market.seq.speed = 1; // only the entrance runs brisker
          queueMicrotask(() => this.reconcile());
        }));
        this.unsubs.push(market.onBlackMarketExited(() => this.afterExit('black')));
        await market.ready;
        if (!this.store || this.store.state.is('MARKET_INACTIVE')) engine.setScene(market.scene);
        useSceneStore.getState().set({ marketLoaded: true });
      } else {
        const store = new mods.Store({ engine, audio, debug, origin: this.origin() });
        this.store = store;
        store.isSoldOut = (sceneId: string) => {
          const item = storeItemForScene(sceneId);
          if (!item) return true;
          return (useGameStore.getState().purchases[item.id] ?? 0) >= item.stock;
        };
        this.unsubs.push(store.onStateChange((next, _prev, meta) => {
          const sceneItem = meta?.item;
          const item = sceneItem ? storeItemForScene(sceneItem)?.id ?? null : null;
          useSceneStore.getState().set({ shopState: next, shopItem: item ?? (next === 'MARKET_INACTIVE' ? null : useSceneStore.getState().shopItem) });
          if (next === 'MARKET_IDLE') store.seq.speed = 1;
          queueMicrotask(() => this.reconcile());
        }));
        this.unsubs.push(store.onStoreExited(() => this.afterExit('store')));
        // the Admin's shutdown / reopen drives the scene (played out if the team is inside)
        await store.setClosed(useMarketStore.getState().normalMarketStatus === 'closed');
        this.unsubs.push(useMarketStore.subscribe((s, prev) => {
          if (s.normalMarketStatus !== prev.normalMarketStatus) void store.setClosed(s.normalMarketStatus === 'closed');
        }));
        await store.ready;
        useSceneStore.getState().set({ shopLoaded: true });
      }
      return true;
    })().catch((err) => {
      console.error(`[market] ${kind} failed to load`, err);
      delete this.scenePromise[kind];
      return false;
    });
    this.scenePromise[kind] = p;
    return p;
  }

  private afterExit(kind: MarketKind) {
    // The scene reports "exited" only after the desk has flickered back on. If the player
    // has already asked to go back in by then, this exit is old news: do not send them
    // to the desk, just go back in.
    if (this.target === kind) { queueMicrotask(() => this.reconcile()); return; }
    this.show(false);
    void this.audio?.ctx?.suspend().catch(() => undefined);
    for (const cb of this.exitedListeners) cb(kind);
    queueMicrotask(() => this.reconcile());
  }

  private show(on: boolean) {
    this.el.style.visibility = on ? 'visible' : 'hidden';
    this.setRunning(on);
  }

  setRunning(on: boolean) {
    if (!this.engine || this.running === on) return;
    this.running = on;
    if (on) this.engine.start(); else this.engine.stop();
  }

  /** Sold-out merchandise is no longer on the Black Market table. */
  private applyBlackStock() {
    const m = this.black;
    if (!m) return;
    const purchases = useGameStore.getState().purchases;
    for (const def of MARKET_ITEMS) {
      const it = m.desk.items.get(def.sceneId);
      if (!it) continue;
      const soldOut = (purchases[def.id] ?? 0) >= def.stock;
      it.transferred = soldOut;
      it.root.visible = !soldOut;
    }
  }

  // ---------------------------------------------------------------- targets
  /** Legacy: the Black Market only. */
  setWant(w: MarketWant) {
    this.setTarget(w === 'inside' ? 'black' : w);
  }

  setTarget(t: MarketTarget) {
    if (t === 'keep') return;
    this.target = t;
    if (t !== 'outside') {
      const active = this.active();
      // the desk light goes down first; a room is built once the screen is black, so the
      // build work (and creating the GL context) never shows as a hitch or a flash
      if (!this.deskFade && !active) this.deskFade = deskController.fadeOut();
      void (this.deskFade ?? Promise.resolve())
        .then(() => (this.target === t ? this.build(t) : false))
        .then((ok) => { if (ok) this.reconcile(); });
    } else {
      // left before a room ever opened: bring the desk light back up
      if (this.deskFade && !this.active()) {
        const pending = this.deskFade;
        this.deskFade = null;
        void pending.then(() => deskController.fadeIn());
      }
      this.reconcile();
    }
  }

  /** The scene that is not idle outside, if any. */
  private active(): { kind: MarketKind; scene: AnyScene } | null {
    if (this.black && !this.black.state.is('MARKET_INACTIVE')) return { kind: 'black', scene: this.black };
    if (this.store && !this.store.state.is('MARKET_INACTIVE')) return { kind: 'store', scene: this.store };
    return null;
  }

  reconcile() {
    const act = this.active();
    // leave whatever is open if the route wants something else
    if (act && act.kind !== this.target) {
      const m = act.scene, st = m.state.state;
      if (st === 'MARKET_EXITING') return;
      if (isMarketPurchasing(st)) return; // a paid purchase always finishes; we leave right after
      if (CAN_EXIT.has(st)) { void (act.kind === 'black' ? (m as BlackMarketScene).exitBlackMarket() : (m as StoreScene).exitStore()); return; }
      if (CANCELLABLE.has(st)) { void m.forceExit(); return; }
      return; // short camera/item moves: wait for them to settle (reconcile runs again)
    }
    if (act || this.target === 'outside') return;
    const kind = this.target;
    const m = this.sceneOf(kind);
    if (!m) return; // still building; build() reconciles when done
    void this.audio?.unlock();
    // the first visit plays the entrance as authored; later visits keep it but quicken it
    (m.seq as { speed: number }).speed = this.visits[kind] > 0 ? 1.6 : 1;
    this.visits[kind]++;
    if (kind === 'black') void (m as BlackMarketScene).enterBlackMarket();
    else void (m as StoreScene).enterStore();
  }

  /** Pause rendering while an opaque page (inbox) covers the room. */
  setCovered(covered: boolean) {
    if (!this.active()) return;
    this.setRunning(!covered);
  }

  isEntering(kind: MarketKind) {
    const m = this.sceneOf(kind);
    return !!m && ENTRANCE.has(m.state.state);
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.black?.dispose();
    this.store?.dispose();
    this.engine?.dispose();
    this.audio?.dispose();
    this.black = null; this.store = null; this.engine = null; this.audio = null; this.mods = null;
    this.enginePromise = null;
    this.scenePromise = {};
    this.running = false;
    this.target = 'outside';
    this.el.style.visibility = 'hidden';
    useSceneStore.getState().set({ marketLoaded: false, marketState: 'MARKET_INACTIVE', marketItem: null, shopLoaded: false, shopState: 'MARKET_INACTIVE', shopItem: null });
  }
}

export const marketController = new MarketController();
