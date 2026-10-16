// Market availability: the Normal Market (open / closed as a crime scene) and the
// Black Market (locked / active). Two independent values, never one boolean, so all four
// combinations are possible. Changes are recorded as events with stable ids; the team
// interface turns each event into one intelligence mail.
//
// PROTOTYPE LIMITS — read before relying on this:
//   · State lives in this browser (localStorage). Admin and team views stay in sync only
//     when they run in the same browser on the same origin (other tabs update live via the
//     `storage` event and a BroadcastChannel). Admin actions do NOT reach other computers.
//   · A real backend must own this state and validate market availability at the moment of
//     purchase. Swap the transport below (see MarketTransport) — the UI only uses the API
//     functions at the bottom of this file.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type NormalMarketStatus = 'open' | 'closed';
export type BlackMarketStatus = 'locked' | 'active';
export type MarketType = 'normal' | 'black';

export type MarketEventType = 'initialized' | 'normal-closed' | 'normal-reopened' | 'black-activated' | 'black-deactivated';

export interface MarketEvent {
  id: string;
  type: MarketEventType;
  at: number;
}

export interface MarketState {
  normalMarketStatus: NormalMarketStatus;
  blackMarketStatus: BlackMarketStatus;
  events: MarketEvent[];
}

/** Future server adapter: load the authoritative state, apply an action, push updates. */
export interface MarketTransport {
  load(): Promise<MarketState>;
  apply(action: MarketEventType): Promise<MarketState>;
  subscribe(cb: (s: MarketState) => void): () => void;
}

export const MARKET_STORAGE_KEY = 'the-game:market';

const initial = (): MarketState => ({
  normalMarketStatus: 'open',
  blackMarketStatus: 'locked',
  events: [{ id: 'mkt-init', type: 'initialized', at: Date.now() }],
});

function eventId(type: MarketEventType): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `mkt-${type}-${Date.now().toString(36)}-${r}`;
}

interface Store extends MarketState {
  record(type: MarketEventType, patch: Partial<MarketState>): void;
  reset(): void;
}

export const useMarketStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initial(),
      record(type, patch) {
        set({ ...patch, events: [...get().events, { id: eventId(type), type, at: Date.now() }].slice(-60) });
        broadcast();
      },
      reset() {
        set(initial());
        broadcast();
      },
    }),
    {
      name: MARKET_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ normalMarketStatus, blackMarketStatus, events }) => ({ normalMarketStatus, blackMarketStatus, events }),
    },
  ),
);

// ---- same-origin live sync (other tabs / the admin window) --------------------------
let channel: BroadcastChannel | null = null;
function broadcast() {
  try { channel?.postMessage('changed'); } catch { /* closed */ }
}
// Apply what another tab stored, directly (not only via rehydrate, which proved unreliable
// under load): the stored value is the source of truth for this browser.
function adoptStored(raw: string | null) {
  try {
    const parsed = raw ? (JSON.parse(raw) as { state?: Partial<MarketState> }).state : null;
    if (!parsed?.normalMarketStatus || !parsed.blackMarketStatus || !Array.isArray(parsed.events)) return;
    const cur = useMarketStore.getState();
    const last = (e: MarketEvent[]) => e[e.length - 1]?.id;
    if (cur.normalMarketStatus === parsed.normalMarketStatus && cur.blackMarketStatus === parsed.blackMarketStatus && last(cur.events) === last(parsed.events)) return;
    useMarketStore.setState({ normalMarketStatus: parsed.normalMarketStatus, blackMarketStatus: parsed.blackMarketStatus, events: parsed.events });
  } catch { /* unreadable: keep the current state */ }
}
const syncFromStorage = () => { try { adoptStored(localStorage.getItem(MARKET_STORAGE_KEY)); } catch { /* storage blocked */ } };

if (typeof window !== 'undefined') {
  try {
    channel = new BroadcastChannel('the-game-market');
    channel.onmessage = syncFromStorage;
  } catch { channel = null; }
  window.addEventListener('storage', (e) => { if (e.key === MARKET_STORAGE_KEY) adoptStored(e.newValue); });
  window.addEventListener('focus', syncFromStorage);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncFromStorage(); });
}

// ---- API (the only thing the UI uses) ----------------------------------------------
export function getMarketState(): MarketState {
  const { normalMarketStatus, blackMarketStatus, events } = useMarketStore.getState();
  return { normalMarketStatus, blackMarketStatus, events };
}

export function closeNormalMarket(): boolean {
  if (useMarketStore.getState().normalMarketStatus === 'closed') return false;
  useMarketStore.getState().record('normal-closed', { normalMarketStatus: 'closed' });
  return true;
}

export function openNormalMarket(): boolean {
  if (useMarketStore.getState().normalMarketStatus === 'open') return false;
  useMarketStore.getState().record('normal-reopened', { normalMarketStatus: 'open' });
  return true;
}

export function activateBlackMarket(): boolean {
  if (useMarketStore.getState().blackMarketStatus === 'active') return false;
  useMarketStore.getState().record('black-activated', { blackMarketStatus: 'active' });
  return true;
}

export function deactivateBlackMarket(): boolean {
  if (useMarketStore.getState().blackMarketStatus === 'locked') return false;
  useMarketStore.getState().record('black-deactivated', { blackMarketStatus: 'locked' });
  return true;
}

/** Checked at the commit point of every purchase (and by a future server, again). */
export function canPurchase(market: MarketType): boolean {
  const s = useMarketStore.getState();
  return market === 'normal' ? s.normalMarketStatus === 'open' : s.blackMarketStatus === 'active';
}

export function subscribeToMarketState(cb: (s: MarketState) => void): () => void {
  return useMarketStore.subscribe((s, prev) => {
    if (s.normalMarketStatus !== prev.normalMarketStatus || s.blackMarketStatus !== prev.blackMarketStatus || s.events !== prev.events) cb(getMarketState());
  });
}

export function resetMarketState(): void {
  useMarketStore.getState().reset();
}

export const MARKET_EVENT_LABEL: Record<MarketEventType, string> = {
  initialized: 'Markets initialised: Normal open, Black locked',
  'normal-closed': 'Normal Market shut down',
  'normal-reopened': 'Normal Market reopened',
  'black-activated': 'Black Market activated',
  'black-deactivated': 'Black Market deactivated',
};
