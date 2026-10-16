// AuthService — team registration / login, admin login, logout, session.
//
// Two adapters: `serverAdapter` (NEXT_PUBLIC_GAME_BACKEND=supabase — Supabase Auth through
// actions/game.ts, session in an httpOnly cookie) and `mockAdapter` (the default).
//
// MOCK ADAPTER. Everything below runs in the browser and is NOT security:
//   · teams live in localStorage ("the-game:teams") with a salted SHA-256 of the password
//     (never the password itself), so nothing readable is stored — but anyone with the
//     browser can still edit that storage;
//   · the admin password is a development-only mock read from the build environment
//     (NEXT_PUBLIC_MOCK_ADMIN_PASSWORD). It is not a real credential and must never be one.
// A real deployment replaces `mockAdapter` with an HTTP adapter: the server hashes
// passwords (bcrypt/argon2), issues expiring sessions, enforces unique names, rate-limits
// attempts and authorises every admin action. The UI only uses the exported functions.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useGameStore } from '../state/gameStore';
import * as server from '@/actions/game';
import { isServerBackend, onSessionLost, syncTeam } from './backend';
import { env } from '../env';

export const TEAM_NAME_MIN = 3;
export const TEAM_NAME_MAX = 24;
export const PASSWORD_MIN = 6;

export interface TeamRecord { id: string; name: string; key: string; salt: string; hash: string; createdAt: number }
export interface TeamSession { teamId: string; teamName: string; createdAt: number; startedAt: number; isNew: boolean }

export type AuthResult<T = TeamSession> = { ok: true; value: T } | { ok: false; error: string };

export interface AuthAdapter {
  registerTeam(name: string, password: string): Promise<AuthResult>;
  loginTeam(name: string, password: string): Promise<AuthResult>;
  loginAdmin(password: string, email?: string): Promise<AuthResult<true>>;
  listTeams(): TeamRecord[];
}

const REGISTRY_KEY = 'the-game:teams';

const nameKey = (n: string) => n.trim().replace(/\s+/g, ' ').toUpperCase();

export function validateTeamName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, ' ');
  if (!n) return 'Enter a team name.';
  if (n.length < TEAM_NAME_MIN) return `Team names need at least ${TEAM_NAME_MIN} characters.`;
  if (n.length > TEAM_NAME_MAX) return `Team names can be at most ${TEAM_NAME_MAX} characters.`;
  if (!/^[\p{L}\p{N} ._\-']+$/u.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
  return null;
}

async function digest(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // insecure-context fallback (mock only): FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv-${(h >>> 0).toString(16)}`;
}

function randomSalt() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readRegistry(): TeamRecord[] {
  try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]') as TeamRecord[]; } catch { return []; }
}
function writeRegistry(list: TeamRecord[]) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(list));
}

const mockAdapter: AuthAdapter = {
  async registerTeam(rawName, password) {
    const err = validateTeamName(rawName);
    if (err) return { ok: false, error: err };
    if (password.length < PASSWORD_MIN) return { ok: false, error: `Passwords need at least ${PASSWORD_MIN} characters.` };
    const name = rawName.trim().replace(/\s+/g, ' ');
    const list = readRegistry();
    if (list.some((t) => t.key === nameKey(name))) return { ok: false, error: 'That team name is taken. Choose another, or log in.' };
    const salt = randomSalt();
    let n = list.length + 1, id = '';
    do { id = `TEAM-${String(n).padStart(3, '0')}`; n++; } while (list.some((t) => t.id === id));
    const rec: TeamRecord = { id, name, key: nameKey(name), salt, hash: await digest(`${salt}:${password}`), createdAt: Date.now() };
    writeRegistry([...readRegistry(), rec]);
    return { ok: true, value: { teamId: id, teamName: name, createdAt: rec.createdAt, startedAt: Date.now(), isNew: true } };
  },
  async loginTeam(rawName, password) {
    const rec = readRegistry().find((t) => t.key === nameKey(rawName));
    // one message for both cases: do not reveal which team names exist
    if (!rec || (await digest(`${rec.salt}:${password}`)) !== rec.hash) return { ok: false, error: 'Team name or password is incorrect.' };
    return { ok: true, value: { teamId: rec.id, teamName: rec.name, createdAt: rec.createdAt, startedAt: Date.now(), isNew: false } };
  },
  async loginAdmin(password) {
    // DEVELOPMENT-ONLY mock: the real admin password is not part of this frontend.
    const mock = env.MOCK_ADMIN_PASSWORD;
    if (!mock) return { ok: false, error: 'Admin login is not configured in this build (no mock admin password set).' };
    if (password !== mock) return { ok: false, error: 'Incorrect admin password.' };
    return { ok: true, value: true };
  },
  listTeams: readRegistry,
};

const toSession = (r: server.GameResult<server.TeamIdentity>, isNew: boolean): AuthResult =>
  r.ok ? { ok: true, value: { ...r.value, startedAt: Date.now(), isNew } } : { ok: false, error: r.error };

const serverAdapter: AuthAdapter = {
  registerTeam: async (name, password) => toSession(await server.gameRegisterTeam({ name, password }).catch(() => offline()), true),
  loginTeam: async (name, password) => toSession(await server.gameLoginTeam({ name, password }).catch(() => offline()), false),
  async loginAdmin(password, email = '') {
    const r = await server.gameLoginAdmin({ email, password }).catch(() => offline());
    return r.ok ? { ok: true, value: true } : { ok: false, error: r.error };
  },
  listTeams: () => [],
};

function offline() { return { ok: false as const, error: 'Cannot reach the game server. Check your connection and try again.' }; }

/** The adapter in use. */
export const authAdapter: AuthAdapter = isServerBackend ? serverAdapter : mockAdapter;

// ---- sessions (team and admin kept apart: one browser may run both in two tabs) --------
interface AuthState {
  team: TeamSession | null;
  admin: { startedAt: number } | null;
  set(patch: Partial<Pick<AuthState, 'team' | 'admin'>>): void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({ team: null, admin: null, set: (patch) => set(patch) }),
    {
      name: 'the-game:session',
      storage: createJSONStorage(() => sessionStorageSafe()),
      partialize: ({ team, admin }) => ({ team, admin }),
    },
  ),
);

/** Sessions live per browser tab (sessionStorage): two tabs can be two different teams. */
function sessionStorageSafe(): Storage {
  try { return window.sessionStorage; } catch { return window.localStorage; }
}

// ---- API ---------------------------------------------------------------------------
async function startTeam(r: AuthResult): Promise<AuthResult> {
  if (!r.ok) return r;
  useAuth.getState().set({ team: r.value });
  useGameStore.getState().loadTeam({ id: r.value.teamId, name: r.value.teamName, createdAt: r.value.createdAt }, r.value.isNew);
  if (isServerBackend) {
    // the server knows this team's progress (another device may have played it)
    await syncTeam();
    if (useGameStore.getState().introSeen) useGameStore.getState().completeIntro();
  }
  return r;
}

export const registerTeam = (name: string, password: string) => authAdapter.registerTeam(name, password).then(startTeam);
export const loginTeam = (name: string, password: string) => authAdapter.loginTeam(name, password).then(startTeam);

export async function loginAdmin(password: string, email?: string): Promise<AuthResult<true>> {
  const r = await authAdapter.loginAdmin(password, email);
  if (r.ok) useAuth.getState().set({ admin: { startedAt: Date.now() } });
  return r;
}

/** Ends the team session. Progress stays saved under the team. */
export function logoutTeam() {
  useAuth.getState().set({ team: null });
  useGameStore.getState().unloadTeam();
  if (isServerBackend) void server.gameLogout();
}

export function logoutAdmin() {
  useAuth.getState().set({ admin: null });
  if (isServerBackend) void server.gameLogout();
}

// the server ended the session (expired, or logged out elsewhere): leave the team view
onSessionLost(() => {
  if (!useAuth.getState().team) return;
  useAuth.getState().set({ team: null });
  useGameStore.getState().unloadTeam();
});

export const getTeamSession = () => useAuth.getState().team;
export const isAdmin = () => !!useAuth.getState().admin;
export const listTeamRecords = () => authAdapter.listTeams();

// a refresh inside a team session: load that team's saved game
if (typeof window !== 'undefined') {
  const t = useAuth.getState().team;
  if (t) useGameStore.getState().loadTeam({ id: t.teamId, name: t.teamName, createdAt: t.createdAt }, false, true);
}
