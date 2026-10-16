// The signed-in team's game: session flags, progress, the ONE wallet, purchases, inbox,
// phone and settings. Each team is saved under its own key ("the-game:team:<id>"); the
// auth service loads a team on login and unloads it on logout. Persisted locally with a
// versioned schema; a backend will become the authority later.
//
// High-frequency animation state does NOT live here (see sceneStore.ts).
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MOCK_TEAM } from '../data/team';
import { checkAnswer } from '../services/levels';
import { isCaseSolved } from '../services/scoring';
import { getCase, getLevel, levelKey, levelScore } from '../data/cases';
import { getCatalogItem, getMarketItem } from '../data/market';
import { canPurchase, type MarketType } from '../services/marketState';
import { seedInbox, type MailMessage } from '../data/mail';
import { DEBRIEFS, HINTS } from '@/game/data/secrets';

export const GENERIC_HINT = 'Study the format of the evidence: it names the method.';

export const SCHEMA_VERSION = 4;
export const teamStorageKey = (teamId: string) => `the-game:team:${teamId}`;
/** Where the store points while nobody is signed in (never holds a team's data). */
const NO_TEAM_KEY = 'the-game:team:-';

export type Role = 'team' | 'admin' | null;

export interface Transaction {
  id: string;
  kind: 'earn' | 'spend';
  amount: number;
  /** Reward source (level key, dead drop id) or purchase id. */
  sourceId: string;
  label: string;
  at: number;
  balanceAfter: number;
}

export interface WalletState {
  teamId: string;
  balance: number;
  transactions: Transaction[];
  claimedRewards: string[];
  purchaseIds: string[];
}

export interface Session {
  id: string;
  startedAt: number;
  introCompleted: boolean;
  /** The five-file landing has been seen this session. */
  deskLanded: boolean;
}

export type WalletResult =
  | { ok: true; balance: number; transaction: Transaction }
  | { ok: false; reason: 'duplicate' | 'insufficient-funds' | 'invalid-amount'; balance: number };

export type PurchaseResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'unknown-item' | 'sold-out' | 'insufficient-funds' | 'duplicate' | 'market-closed'; message: string };

export interface SubmitResult {
  correct: boolean;
  /** Coins awarded by this submission (0 when already claimed). */
  awarded: number;
  /** Score awarded by this submission (0 when already completed). */
  scoreAwarded: number;
  alreadyCompleted: boolean;
  /** This submission completed the case's last level. */
  caseSolved: boolean;
  /** Wrong answers left on this level (undefined = unlimited). */
  attemptsRemaining?: number;
  /** The level accepts no more answers (wrong-attempt limit reached). */
  locked?: boolean;
}

export type PowerUpResult = { ok: true; caseSolved?: boolean; message: string } | { ok: false; message: string };

interface GameData {
  schemaVersion: number;
  role: Role;
  session: Session | null;
  team: { id: string; name: string; createdAt: number };
  /** The phone intro has been played for this team (returning teams skip it). */
  introSeen: boolean;
  /** Last time this team did something (admin dashboard). */
  lastActivity: number;
  progress: {
    /** caseId → last selected level number. */
    selectedLevel: Record<number, number>;
    /** levelKey → completion time. */
    completed: Record<string, number>;
    /** levelKey → skip time (Skip Token / Master Key): counts toward solving, never toward score. */
    skipped: Record<string, number>;
    /** levelKey → wrong answers submitted (levels with an attempt limit lock at the limit). */
    attempts: Record<string, number>;
  };
  /** levelKey → what the evidence shows, revealed after the level is solved. */
  debriefs: Record<string, string>;
  /** Power-ups owned and not yet used: catalogue id → count. */
  inventory: Record<string, number>;
  /** Power-up state on this team. */
  effects: {
    /** levelKeys whose Powerful Hint is revealed. */
    hints: string[];
    /** levelKey → revealed hint text. */
    hintTexts: Record<string, string>;
    overclockArmed: boolean;
    masterKeyUsedOn: number | null;
    /** Incoming sabotage, active until these times. */
    glitchUntil: number;
    freezeUntil: number;
    /** Total time this team's progress timer has been frozen. */
    frozenMs: number;
  };
  wallet: WalletState;
  /** itemId → units bought. */
  purchases: Record<string, number>;
  inbox: { messages: MailMessage[]; seeded: boolean };
  settings: { muted: boolean };
  story: { firstSolveDropSent: boolean };
  /** Market events already turned into mail (by event id) — survives reloads, so no duplicates. */
  marketMail: { processed: string[] };
  /** caseId → code fragment, as paid by the server for solved cases (Supabase backend only). */
  fragments: Record<string, string>;
  /** The recovered evidence phone. Unlocked once per team. */
  phone: { unlocked: boolean; unlockedAt: number | null; failedAttempts: number };
}

interface GameActions {
  /** Switch the store to a team's own save (fresh for a new team). Called by the auth service. */
  /** `resume`: a refresh inside the same tab session (keeps the session, no landing replay). */
  loadTeam(team: { id: string; name: string; createdAt: number }, isNew: boolean, resume?: boolean): void;
  /** Detach from the team's save after logout (its data stays saved). */
  unloadTeam(): void;
  touch(): void;
  completeIntro(): void;
  restartIntro(): void;
  markDeskLanded(): void;

  selectLevel(caseId: number, level: number): void;
  submitAnswer(caseId: number, level: number, answer: string): SubmitResult;

  earnCoins(amount: number, sourceId: string, label?: string): WalletResult;
  spendCoins(amount: number, purchaseId: string, label?: string): WalletResult;
  getBalance(): number;
  getTransactionHistory(): Transaction[];
  hasClaimedReward(sourceId: string): boolean;
  /** Validates market availability, stock + funds, then spends once for this purchaseId. */
  purchaseItem(itemId: string, purchaseId: string, market?: MarketType): PurchaseResult;
  checkPurchase(itemId: string, market?: MarketType): PurchaseResult;
  markMarketEventMailed(eventId: string): void;
  setPhoneUnlocked(unlocked: boolean): void;
  recordPhoneFailure(): void;

  addMessage(msg: MailMessage): boolean;
  setRead(id: string, read: boolean): void;
  setStarred(id: string, starred: boolean): void;
  setArchived(id: string, archived: boolean): void;

  setMuted(muted: boolean): void;
  markStory(key: keyof GameData['story']): void;

  /** Power-ups. Each consumes one owned unit; nothing is spent when it fails. */
  useSkipToken(caseId: number, level: number): PowerUpResult;
  useMasterKey(caseId: number): PowerUpResult;
  usePowerfulHint(caseId: number, level: number): PowerUpResult;
  armOverclock(): PowerUpResult;
  /** Mini-game payout: doubled (and Overclock consumed) when armed. */
  claimMinigameReward(amount: number, sourceId: string, label?: string): WalletResult;
  /** Remove one owned unit (sabotage launch / Firewall block). */
  consumeItem(id: string): boolean;
  applySabotage(kind: 'glitch' | 'freeze', until: number): void;

  resetWallet(): void;
  resetAll(): void;
}

export type GameStore = GameData & GameActions;

let seq = 0;
export function uid(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${rand}${seq.toString(36)}`;
}

function freshWallet(teamId: string = MOCK_TEAM.id): WalletState {
  return { teamId, balance: MOCK_TEAM.startingBalance, transactions: [], claimedRewards: [], purchaseIds: [] };
}

function freshData(team: { id: string; name: string; createdAt: number } = { id: '', name: '', createdAt: 0 }): GameData {
  return {
    schemaVersion: SCHEMA_VERSION,
    role: null,
    session: null,
    team,
    introSeen: false,
    lastActivity: Date.now(),
    progress: { selectedLevel: {}, completed: {}, skipped: {}, attempts: {} },
    debriefs: {},
    inventory: {},
    effects: freshEffects(),
    wallet: freshWallet(team.id || MOCK_TEAM.id),
    purchases: {},
    inbox: { messages: [], seeded: false },
    settings: { muted: false },
    story: { firstSolveDropSent: false },
    marketMail: { processed: [] },
    fragments: {},
    phone: { unlocked: false, unlockedAt: null, failedAttempts: 0 },
  };
}

function freshEffects(): GameData['effects'] {
  return { hints: [], hintTexts: {}, overclockArmed: false, masterKeyUsedOn: null, glitchUntil: 0, freezeUntil: 0, frozenMs: 0 };
}

function newSession(introCompleted: boolean): Session {
  return { id: uid('session'), startedAt: Date.now(), introCompleted, deskLanded: false };
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => {
      const seeded = (s: GameData) => (s.inbox.seeded ? s.inbox : { messages: seedInbox(Date.now()), seeded: true });

      return {
        ...freshData(),

        loadTeam(team, isNew, resume = false) {
          // clear memory while still pointing at the no-team key (a write there is harmless),
          // THEN switch to the team's save: never write a blank state over a saved game
          useGameStore.persist.setOptions({ name: NO_TEAM_KEY });
          set(freshData(team));
          useGameStore.persist.setOptions({ name: teamStorageKey(team.id) });
          if (!isNew) void useGameStore.persist.rehydrate(); // synchronous with localStorage
          const s = get();
          set({
            role: 'team',
            team: { ...team },
            wallet: s.wallet.teamId === team.id ? s.wallet : { ...s.wallet, teamId: team.id },
            session: resume && s.session ? s.session : newSession(s.introSeen),
            inbox: seeded(s),
            lastActivity: Date.now(),
          });
        },
        unloadTeam() {
          // detach first, so the reset below never overwrites the team's saved game
          useGameStore.persist.setOptions({ name: NO_TEAM_KEY });
          set(freshData());
        },
        touch() {
          set({ lastActivity: Date.now() });
        },
        completeIntro() {
          set((s) => (s.session ? { introSeen: true, session: { ...s.session, introCompleted: true } } : { introSeen: true }));
        },
        restartIntro() {
          set((s) => (s.session ? { session: { ...s.session, introCompleted: false, deskLanded: false } } : {}));
        },
        markDeskLanded() {
          set((s) => (s.session && !s.session.deskLanded ? { session: { ...s.session, deskLanded: true } } : {}));
        },

        selectLevel(caseId, level) {
          if (get().progress.selectedLevel[caseId] === level) return;
          set((s) => ({ progress: { ...s.progress, selectedLevel: { ...s.progress.selectedLevel, [caseId]: level } } }));
        },

        submitAnswer(caseId, level, answer) {
          const def = getLevel(caseId, level);
          const key = levelKey(caseId, level);
          const alreadyCompleted = key in get().progress.completed;
          set({ lastActivity: Date.now() });
          const max = def?.maxAttempts;
          const used = get().progress.attempts?.[key] ?? 0;
          const left = (n: number) => (max ? Math.max(0, max - n) : undefined);
          // a locked level (limit reached) takes no more answers and its counter never moves
          if (max && used >= max && !alreadyCompleted) {
            return { correct: false, awarded: 0, scoreAwarded: 0, alreadyCompleted, caseSolved: false, attemptsRemaining: 0, locked: true };
          }
          if (!def || !checkAnswer(caseId, level, answer)) {
            // a solved level never consumes attempts
            const n = alreadyCompleted ? used : used + 1;
            if (!alreadyCompleted && max) set((s) => ({ progress: { ...s.progress, attempts: { ...s.progress.attempts, [key]: n } } }));
            return { correct: false, awarded: 0, scoreAwarded: 0, alreadyCompleted, caseSolved: false, attemptsRemaining: left(n), locked: !!max && n >= max && !alreadyCompleted };
          }
          const debrief = DEBRIEFS[`${caseId}-${level}`];
          if (debrief) set((s) => ({ debriefs: { ...s.debriefs, [key]: debrief } }));
          // score is derived from completed levels (once per level); coins go through the ledger (once per level)
          const wasSolved = isCaseSolved(caseId, get().progress.completed, get().progress.skipped);
          if (!alreadyCompleted) {
            set((s) => ({ progress: { ...s.progress, completed: { ...s.progress.completed, [key]: Date.now() } } }));
          }
          const r = get().earnCoins(def.reward, key, `Level completed · Case ${String(caseId).padStart(2, '0')} / ${String(level).padStart(2, '0')}`);
          const caseSolved = !wasSolved && isCaseSolved(caseId, get().progress.completed, get().progress.skipped);
          return { correct: true, awarded: r.ok ? def.reward : 0, scoreAwarded: alreadyCompleted ? 0 : levelScore(def), alreadyCompleted, caseSolved, attemptsRemaining: left(used) };
        },

        earnCoins(amount, sourceId, label = 'Reward') {
          const { wallet } = get();
          if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid-amount', balance: wallet.balance };
          if (wallet.claimedRewards.includes(sourceId)) return { ok: false, reason: 'duplicate', balance: wallet.balance };
          const balance = wallet.balance + amount;
          const transaction: Transaction = { id: uid('tx'), kind: 'earn', amount, sourceId, label, at: Date.now(), balanceAfter: balance };
          set({ wallet: { ...wallet, balance, transactions: [transaction, ...wallet.transactions], claimedRewards: [...wallet.claimedRewards, sourceId] } });
          return { ok: true, balance, transaction };
        },

        spendCoins(amount, purchaseId, label = 'Purchase') {
          const { wallet } = get();
          if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid-amount', balance: wallet.balance };
          if (wallet.purchaseIds.includes(purchaseId)) return { ok: false, reason: 'duplicate', balance: wallet.balance };
          if (wallet.balance < amount) return { ok: false, reason: 'insufficient-funds', balance: wallet.balance };
          const balance = wallet.balance - amount;
          const transaction: Transaction = { id: uid('tx'), kind: 'spend', amount, sourceId: purchaseId, label, at: Date.now(), balanceAfter: balance };
          set({ wallet: { ...wallet, balance, transactions: [transaction, ...wallet.transactions], purchaseIds: [...wallet.purchaseIds, purchaseId] } });
          return { ok: true, balance, transaction };
        },

        getBalance: () => get().wallet.balance,
        getTransactionHistory: () => get().wallet.transactions,
        hasClaimedReward: (sourceId) => get().wallet.claimedRewards.includes(sourceId),

        checkPurchase(itemId, market = 'black') {
          const item = getMarketItem(itemId, market);
          if (!item) return { ok: false, reason: 'unknown-item', message: market === 'normal' ? 'That item is not sold here.' : 'The dealer does not sell that.' };
          if (!canPurchase(market)) {
            return { ok: false, reason: 'market-closed', message: market === 'normal' ? 'The market is closed. All transactions are suspended.' : 'The Black Market is closed.' };
          }
          const bought = get().purchases[itemId] ?? 0;
          if (bought >= item.stock) return { ok: false, reason: 'sold-out', message: market === 'normal' ? 'Out of stock.' : 'Sold out. The dealer has nothing more of this.' };
          const balance = get().wallet.balance;
          if (balance < item.price) {
            return { ok: false, reason: 'insufficient-funds', message: `Insufficient funds — ${item.price} coins required, ${balance} available.` };
          }
          return { ok: true, balance };
        },

        purchaseItem(itemId, purchaseId, market = 'black') {
          // the commit point: availability, stock, funds and idempotency are all checked here,
          // synchronously, immediately before the single deduction
          if (get().wallet.purchaseIds.includes(purchaseId)) return { ok: false, reason: 'duplicate', message: 'This purchase has already been processed.' };
          const check = get().checkPurchase(itemId, market);
          if (!check.ok) return check;
          const item = getMarketItem(itemId, market)!;
          const r = get().spendCoins(item.price, purchaseId, item.ledgerLabel);
          if (!r.ok) {
            return r.reason === 'insufficient-funds'
              ? { ok: false, reason: 'insufficient-funds', message: 'Insufficient funds.' }
              : { ok: false, reason: 'duplicate', message: 'This purchase has already been processed.' };
          }
          // the team now owns the power-up (a bundle unpacks into its contents)
          const cat = getCatalogItem(item.catalogId);
          const gained = cat?.contains ?? [item.catalogId];
          set((s) => {
            const inventory = { ...s.inventory };
            for (const g of gained) inventory[g] = (inventory[g] ?? 0) + 1;
            return { purchases: { ...s.purchases, [itemId]: (s.purchases[itemId] ?? 0) + 1 }, inventory, lastActivity: Date.now() };
          });
          return { ok: true, balance: r.balance };
        },

        addMessage(msg) {
          if (get().inbox.messages.some((m) => m.id === msg.id)) return false;
          set((s) => ({ inbox: { ...s.inbox, messages: [msg, ...s.inbox.messages] } }));
          return true;
        },
        setRead(id, read) {
          set((s) => ({ inbox: { ...s.inbox, messages: s.inbox.messages.map((m) => (m.id === id && m.read !== read ? { ...m, read } : m)) } }));
        },
        setStarred(id, starred) {
          set((s) => ({ inbox: { ...s.inbox, messages: s.inbox.messages.map((m) => (m.id === id ? { ...m, starred } : m)) } }));
        },
        setArchived(id, archived) {
          set((s) => ({ inbox: { ...s.inbox, messages: s.inbox.messages.map((m) => (m.id === id ? { ...m, archived } : m)) } }));
        },

        markMarketEventMailed(eventId) {
          if (get().marketMail.processed.includes(eventId)) return;
          set((s) => ({ marketMail: { processed: [...s.marketMail.processed, eventId].slice(-200) } }));
        },
        setPhoneUnlocked(unlocked) {
          set((s) => ({ phone: { ...s.phone, unlocked, unlockedAt: unlocked ? Date.now() : null, failedAttempts: unlocked ? s.phone.failedAttempts : 0 } }));
        },
        recordPhoneFailure() {
          set((s) => ({ phone: { ...s.phone, failedAttempts: s.phone.failedAttempts + 1 } }));
        },

        setMuted(muted) {
          set((s) => ({ settings: { ...s.settings, muted } }));
        },
        markStory(key) {
          set((s) => ({ story: { ...s.story, [key]: true } }));
        },

        consumeItem(id) {
          if ((get().inventory[id] ?? 0) < 1) return false;
          set((s) => ({ inventory: { ...s.inventory, [id]: s.inventory[id] - 1 }, lastActivity: Date.now() }));
          return true;
        },

        useSkipToken(caseId, level) {
          const key = levelKey(caseId, level);
          const { progress } = get();
          if (!getLevel(caseId, level)) return { ok: false, message: 'Unknown level.' };
          if (key in progress.completed || key in progress.skipped) return { ok: false, message: 'This level is already cleared.' };
          if (!get().consumeItem('skip_token')) return { ok: false, message: 'You have no Skip Token.' };
          const wasSolved = isCaseSolved(caseId, progress.completed, progress.skipped);
          set((s) => ({ progress: { ...s.progress, skipped: { ...s.progress.skipped, [key]: Date.now() } } }));
          const caseSolved = !wasSolved && isCaseSolved(caseId, get().progress.completed, get().progress.skipped);
          return { ok: true, caseSolved, message: 'Level skipped. No solve points awarded.' };
        },

        useMasterKey(caseId) {
          const c = getCase(caseId);
          const { progress, effects } = get();
          if (!c) return { ok: false, message: 'Unknown case.' };
          if (effects.masterKeyUsedOn != null) return { ok: false, message: 'Your team has already used its Master Key.' };
          if (isCaseSolved(caseId, progress.completed, progress.skipped)) return { ok: false, message: 'That case is already completed.' };
          if (!get().consumeItem('master_key')) return { ok: false, message: 'You have no Master Key.' };
          const now = Date.now();
          const skipped = { ...progress.skipped };
          for (const l of c.levels) { const k = levelKey(caseId, l.number); if (!(k in progress.completed)) skipped[k] = now; }
          set((s) => ({ progress: { ...s.progress, skipped }, effects: { ...s.effects, masterKeyUsedOn: caseId } }));
          return { ok: true, caseSolved: true, message: `Case ${String(caseId).padStart(2, '0')} opened. Fragment revealed.` };
        },

        usePowerfulHint(caseId, level) {
          const key = levelKey(caseId, level);
          if (!getLevel(caseId, level)) return { ok: false, message: 'Unknown level.' };
          if (get().effects.hints.includes(key)) return { ok: false, message: 'The hint for this level is already revealed.' };
          if (!get().consumeItem('powerful_hint')) return { ok: false, message: 'You have no Powerful Hint.' };
          set((s) => ({ effects: { ...s.effects, hints: [...s.effects.hints, key], hintTexts: { ...s.effects.hintTexts, [key]: HINTS[`${caseId}-${level}`] ?? GENERIC_HINT } } }));
          return { ok: true, message: 'Hint revealed.' };
        },

        armOverclock() {
          if (get().effects.overclockArmed) return { ok: false, message: 'Overclock is already armed.' };
          if (!get().consumeItem('overclock')) return { ok: false, message: 'You have no Overclock.' };
          set((s) => ({ effects: { ...s.effects, overclockArmed: true } }));
          return { ok: true, message: 'Overclock armed for your next mini-game.' };
        },

        claimMinigameReward(amount, sourceId, label = 'Mini-game reward') {
          const armed = get().effects.overclockArmed;
          const r = get().earnCoins(armed ? amount * 2 : amount, sourceId, armed ? `${label} · Overclock ×2` : label);
          if (r.ok && armed) set((s) => ({ effects: { ...s.effects, overclockArmed: false } }));
          return r;
        },

        applySabotage(kind, until) {
          set((s) => {
            const e = { ...s.effects };
            if (kind === 'glitch') e.glitchUntil = Math.max(e.glitchUntil, until);
            else {
              // only count the newly frozen time
              const from = Math.max(Date.now(), e.freezeUntil);
              if (until > from) e.frozenMs += until - from;
              e.freezeUntil = Math.max(e.freezeUntil, until);
            }
            return { effects: e };
          });
        },

        resetWallet() {
          set({ wallet: freshWallet(get().team.id), purchases: {}, inventory: {} });
        },
        resetAll() {
          const { role, session, team } = get();
          set({ ...freshData(team), role, session: session ? { ...session } : null });
          set((s) => ({ inbox: seeded(s) }));
        },
      };
    },
    {
      name: NO_TEAM_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      // nothing loads until a team signs in (auth service → loadTeam)
      skipHydration: true,
      partialize: (s) => {
        const { schemaVersion, session, team, introSeen, lastActivity, progress, wallet, purchases, inventory, effects, inbox, settings, story, marketMail, phone, fragments, debriefs } = s;
        return { schemaVersion, session, team, introSeen, lastActivity, progress, wallet, purchases, inventory, effects, inbox, settings, story, marketMail, phone, fragments, debriefs };
      },
      // Unknown/older schemas start clean rather than half-loading.
      migrate: (persisted, version) => {
        if (version === SCHEMA_VERSION) return persisted as GameData;
        // older saves: Case 1 changed completely (new levels), so its progress starts fresh
        if (version === 2 || version === 3) {
          const p = persisted as GameData;
          const keep = (o: Record<string, number> = {}) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('case-01/')));
          return {
            ...p, schemaVersion: SCHEMA_VERSION,
            progress: { ...p.progress, completed: keep(p.progress.completed), skipped: version === 3 ? keep(p.progress.skipped) : {}, attempts: {} },
            inventory: version === 3 ? p.inventory : {}, effects: version === 3 ? { ...freshEffects(), ...p.effects, hintTexts: p.effects?.hintTexts ?? {} } : freshEffects(),
            fragments: {}, debriefs: {},
          };
        }
        return freshData();
      },
    },
  ),
);

// Another tab (e.g. the admin view, or a second team tab) wrote the game state: adopt it,
// so two tabs never overwrite each other's wallet or inbox with stale copies.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const name = useGameStore.persist.getOptions().name;
    if (e.key === name && name !== NO_TEAM_KEY) void useGameStore.persist.rehydrate();
  });
}

/** Wallet API (spec names). All operate on the single store above. */
export const wallet = {
  earnCoins: (amount: number, sourceId: string, label?: string) => useGameStore.getState().earnCoins(amount, sourceId, label),
  spendCoins: (amount: number, purchaseId: string, label?: string) => useGameStore.getState().spendCoins(amount, purchaseId, label),
  getBalance: () => useGameStore.getState().getBalance(),
  getTransactionHistory: () => useGameStore.getState().getTransactionHistory(),
  hasClaimedReward: (sourceId: string) => useGameStore.getState().hasClaimedReward(sourceId),
};

export const selectUnreadCount = (s: GameStore) => s.inbox.messages.reduce((n, m) => n + (!m.read && !m.archived ? 1 : 0), 0);
