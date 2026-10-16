// GameBackend — the one seam between the game UI and where the game's truth lives.
//
//   mock      (default) everything runs in this browser, as in the prototype;
//   supabase  NEXT_PUBLIC_GAME_BACKEND=supabase: every rule runs on the server
//             (actions/game.ts → SQL functions in supabase/migrations/004_the_game.sql)
//             and this browser mirrors the team's state by polling `gameState`.
//
// Pages call these async functions; they never need to know which backend is active.
import { create } from 'zustand';
import { env } from '../env';
import * as server from '@/actions/game';
import { useGameStore, uid, type SubmitResult, type PowerUpResult, type Transaction } from '../state/gameStore';
import { useMarketStore, type MarketEvent, type MarketType, type NormalMarketStatus, type BlackMarketStatus } from './marketState';
import { getMarketItem } from '../data/market';
import { deliver } from './intelFeed';
import type { MailCategory, MailMessage } from '../data/mail';

export const isServerBackend = env.BACKEND === 'supabase';

export type PurchaseOutcome = { ok: true; balance: number } | { ok: false; reason: string; message: string };
type Raw = Record<string, unknown>;

const FAIL = 'The server could not complete that. Try again.';
const ms = (v: unknown) => (typeof v === 'number' ? v : v ? new Date(String(v)).getTime() : 0);
const msMap = (o: unknown) => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => [k, ms(v)]));

// ---------------------------------------------------------------- rivals (for sabotage)
export const useRivals = create<{ rivals: { id: string; name: string }[] }>()(() => ({ rivals: [] }));

// ---------------------------------------------------------------- sync (supabase)
let lastMessageAt: string | null = null;
let sessionLost: (() => void) | null = null;

/** Called when the server says the session ended (cookie expired / logged out elsewhere). */
export function onSessionLost(fn: () => void) { sessionLost = fn; }

function applyState(st: Raw) {
  const game = useGameStore.getState();
  const balance = Number(st.balance ?? 0);
  // ledger newest first; rebuild the running balance from the current one backwards
  let running = balance;
  const transactions: Transaction[] = ((st.transactions ?? []) as Raw[]).map((t) => {
    const amount = Number(t.amount);
    const kind = t.kind === 'spend' ? 'spend' : 'earn';
    const tx: Transaction = { id: String(t.id), kind, amount, sourceId: String(t.sourceId), label: String(t.label), at: ms(t.at), balanceAfter: running };
    running += kind === 'earn' ? -amount : amount;
    return tx;
  });
  const effects = (st.effects ?? {}) as Raw;
  const hints = (st.hints ?? {}) as Record<string, string>;
  const phone = (st.phone ?? {}) as Raw;
  const team = (st.team ?? {}) as Raw;
  const teamCreated = ms(team.createdAt);
  useGameStore.setState({
    wallet: { ...game.wallet, teamId: game.team.id, balance, transactions },
    progress: { ...game.progress, completed: msMap(st.completed), skipped: msMap(st.skipped) },
    purchases: (st.purchases ?? {}) as Record<string, number>,
    inventory: (st.inventory ?? {}) as Record<string, number>,
    effects: {
      hints: Object.keys(hints),
      hintTexts: hints,
      overclockArmed: !!effects.overclockArmed,
      masterKeyUsedOn: effects.masterKeyUsedOn == null ? null : Number(effects.masterKeyUsedOn),
      glitchUntil: Number(effects.glitchUntil ?? 0),
      freezeUntil: Number(effects.freezeUntil ?? 0),
      frozenMs: Number(effects.frozenMs ?? 0),
    },
    fragments: (st.fragments ?? {}) as Record<string, string>,
    introSeen: !!st.introSeen || game.introSeen,
    phone: { unlocked: !!phone.unlocked, unlockedAt: phone.unlockedAt ? ms(phone.unlockedAt) : null, failedAttempts: Number(phone.failedAttempts ?? 0) },
  });
  const market = (st.market ?? {}) as Raw;
  const events: MarketEvent[] = ((st.marketLog ?? []) as Raw[])
    .map((e) => ({ id: `srv-mkt-${e.id}`, type: e.type as MarketEvent['type'], at: ms(e.at) }))
    .filter((e) => e.at >= teamCreated); // old switches are not news to a new team
  useMarketStore.setState({
    normalMarketStatus: (market.normal === 'closed' ? 'closed' : 'open') as NormalMarketStatus,
    blackMarketStatus: (market.black === 'active' ? 'active' : 'locked') as BlackMarketStatus,
    events: [{ id: 'mkt-init', type: 'initialized', at: teamCreated }, ...events],
  });
  for (const m of (st.messages ?? []) as Raw[]) {
    const body = String(m.body ?? '');
    const mail: MailMessage = {
      id: `srv-${m.id}`, from: String(m.from ?? 'THE GAME'), to: game.team.name, subject: String(m.subject ?? ''),
      preview: body.split('\n')[0].slice(0, 120), body, category: (m.category ?? 'general') as MailCategory,
      at: ms(m.at), read: false, starred: false, archived: false,
    };
    deliver(mail);
    if (!lastMessageAt || String(m.at) > lastMessageAt) lastMessageAt = String(m.at);
  }
  useRivals.setState({ rivals: (st.rivals ?? []) as { id: string; name: string }[] });
}

/** Pull the team's state from the server into this browser. */
export async function syncTeam(): Promise<boolean> {
  if (!isServerBackend) return true;
  const r = await server.gameState(lastMessageAt);
  if (!r.ok) {
    if (r.code === 'NO_SESSION' || r.code === 'NO_TEAM') sessionLost?.();
    return false;
  }
  applyState(r.value as Raw);
  return true;
}

/** Team pages: keep in step with the server (other teams' attacks, admin mail, market switches). */
export function connectTeamSync(intervalMs = 4000): () => void {
  if (!isServerBackend) return () => {};
  lastMessageAt = null;
  void syncTeam();
  const t = window.setInterval(() => { void syncTeam(); }, intervalMs);
  const onFocus = () => { if (document.visibilityState === 'visible') void syncTeam(); };
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('focus', onFocus);
  return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
}

// ---------------------------------------------------------------- team actions

export async function submitAnswer(caseId: number, level: number, answer: string): Promise<SubmitResult & { error?: string }> {
  if (!isServerBackend) return useGameStore.getState().submitAnswer(caseId, level, answer);
  const r = await server.gameSubmit({ caseId, level, answer });
  const none = { correct: false, awarded: 0, scoreAwarded: 0, alreadyCompleted: false, caseSolved: false };
  if (!r.ok) return { ...none, error: r.error };
  const v = r.value as Raw;
  if (v.error) return { ...none, error: v.error === 'rate_limited' ? 'Slow down — one attempt per second.' : FAIL };
  await syncTeam();
  return { correct: !!v.correct, awarded: Number(v.awarded ?? 0), scoreAwarded: Number(v.scoreAwarded ?? 0), alreadyCompleted: !!v.alreadyCompleted, caseSolved: !!v.caseSolved };
}

/** `itemId` is the market purchase key (`store_<id>` in the Normal Market). */
export async function purchase(itemId: string, purchaseId: string, market: MarketType): Promise<PurchaseOutcome> {
  if (!isServerBackend) {
    const r = useGameStore.getState().purchaseItem(itemId, purchaseId, market);
    return r.ok ? { ok: true, balance: r.balance } : { ok: false, reason: r.reason, message: r.message };
  }
  const item = getMarketItem(itemId, market);
  if (!item) return { ok: false, reason: 'unknown-item', message: 'That item is not sold here.' };
  const r = await server.gamePurchase({ catalogId: item.catalogId, market, purchaseKey: purchaseId });
  if (!r.ok) return { ok: false, reason: 'error', message: r.error };
  const v = r.value as Raw;
  await syncTeam();
  return v.ok ? { ok: true, balance: Number(v.balance) } : { ok: false, reason: String(v.reason), message: String(v.message) };
}

async function serverUse(call: Promise<server.GameResult<unknown>>): Promise<PowerUpResult> {
  const r = await call;
  if (!r.ok) return { ok: false, message: r.error };
  const v = r.value as Raw;
  await syncTeam();
  return v.ok ? { ok: true, caseSolved: !!v.caseSolved, message: String(v.message ?? 'Done.') } : { ok: false, message: String(v.message ?? FAIL) };
}

export const spendSkipToken = (caseId: number, level: number) =>
  isServerBackend ? serverUse(server.gameUseSkipToken({ caseId, level })) : Promise.resolve(useGameStore.getState().useSkipToken(caseId, level));
export const spendMasterKey = (caseId: number) =>
  isServerBackend ? serverUse(server.gameUseMasterKey({ caseId })) : Promise.resolve(useGameStore.getState().useMasterKey(caseId));
export const revealPowerfulHint = (caseId: number, level: number) =>
  isServerBackend ? serverUse(server.gameUsePowerfulHint({ caseId, level })) : Promise.resolve(useGameStore.getState().usePowerfulHint(caseId, level));
export const armOverclock = () =>
  isServerBackend ? serverUse(server.gameArmOverclock()) : Promise.resolve(useGameStore.getState().armOverclock());

export async function launchSabotageRemote(kind: 'glitch' | 'freeze', targetId: string): Promise<{ ok: boolean; message: string }> {
  const r = await serverUse(server.gameLaunchSabotage({ kind, targetId }));
  return { ok: r.ok, message: r.message };
}

export async function verifyPhoneRemote(code: string): Promise<{ ok: true } | { ok: false; reason: 'incomplete' | 'wrong' }> {
  const r = await server.gameVerifyPhone({ code });
  if (!r.ok) return { ok: false, reason: 'wrong' };
  const v = r.value as Raw;
  await syncTeam();
  return v.ok ? { ok: true } : { ok: false, reason: v.reason === 'incomplete' ? 'incomplete' : 'wrong' };
}

export function markIntroSeenRemote() {
  if (isServerBackend) void server.gameSetIntroSeen();
}

// ---------------------------------------------------------------- admin

export interface ServerTeam {
  id: string; name: string; createdAt: number; coins: number; lastActivity: number; phoneUnlocked: boolean;
  completed: Record<string, number>; skipped: Record<string, number>; inventory: Record<string, number>; fragments: string[];
}

export async function adminTeams(): Promise<ServerTeam[] | null> {
  const r = await server.gameAdminTeams();
  if (!r.ok) return null;
  return ((r.value ?? []) as Raw[]).map((t) => ({
    id: String(t.id), name: String(t.name), createdAt: ms(t.createdAt), coins: Number(t.coins ?? 0), lastActivity: ms(t.lastActivity),
    phoneUnlocked: !!t.phoneUnlocked, completed: msMap(t.completed), skipped: msMap(t.skipped),
    inventory: (t.inventory ?? {}) as Record<string, number>, fragments: (t.fragments ?? []) as string[],
  }));
}

function applyAdminMarket(v: Raw) {
  const market = (v.market ?? {}) as Raw;
  const patch: Partial<{ normalMarketStatus: NormalMarketStatus; blackMarketStatus: BlackMarketStatus; events: MarketEvent[] }> = {
    normalMarketStatus: market.normal === 'closed' ? 'closed' : 'open',
    blackMarketStatus: market.black === 'active' ? 'active' : 'locked',
  };
  if (Array.isArray(v.log)) patch.events = (v.log as Raw[]).map((e) => ({ id: `srv-mkt-${e.id}`, type: e.type as MarketEvent['type'], at: ms(e.at) }));
  useMarketStore.setState(patch);
}

export async function adminSyncMarket(): Promise<void> {
  const r = await server.gameAdminMarket();
  if (r.ok) applyAdminMarket(r.value as Raw);
}

export async function adminSetMarket(action: 'shutdown' | 'reopen' | 'activate' | 'deactivate'): Promise<boolean> {
  const r = await server.gameAdminMarket(action);
  if (!r.ok) return false;
  await adminSyncMarket();
  return !!(r.value as Raw).ok;
}

export interface ServerSent { id: string; to: 'all' | string[]; toLabel: string; subject: string; body: string; type: string; at: number }

export async function adminSend(draft: { draftId: string; to: 'all' | { id: string; name: string }[]; subject: string; body: string; type: string }): Promise<{ ok: boolean; error?: string }> {
  const r = await server.gameAdminSend({ ...draft, to: draft.to === 'all' ? 'all' : draft.to.map((t) => t.id) });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function adminSent(): Promise<ServerSent[]> {
  const r = await server.gameAdminSent();
  if (!r.ok) return [];
  return ((r.value ?? []) as Raw[]).map((m) => ({
    id: String(m.id), to: (m.to === 'all' ? 'all' : (m.to ?? [])) as 'all' | string[], toLabel: String(m.toLabel ?? ''),
    subject: String(m.subject), body: String(m.body), type: String(m.type), at: ms(m.at),
  }));
}

export const newPurchaseId = () => uid('purchase');
