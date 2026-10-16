// TeamService (mock): reads every registered team's saved game from this browser's
// storage, so the Admin sees exactly the state the team interface wrote — no separate
// numbers. A backend replaces this with GET /teams and GET /teams/:id.
import { create } from 'zustand';
import { listTeamRecords } from './auth';
import { teamStorageKey } from '../state/gameStore';
import { scoreBreakdown, caseProgress, isCaseSolved } from './scoring';
import { CASES } from '../data/cases';
import { getCaseFragment } from './phone';
import { adminTeams, isServerBackend, type ServerTeam } from './backend';

export interface TeamSummary {
  id: string;
  name: string;
  createdAt: number;
  score: number;
  coins: number;
  casesSolved: number;
  levelsCompleted: number;
  lastActivity: number;
  phoneUnlocked: boolean;
  fragments: string[];
  completed: Record<string, number>;
  skipped: Record<string, number>;
  inventory: Record<string, number>;
  breakdown: ReturnType<typeof scoreBreakdown>;
  cases: { id: number; title: string; done: number; total: number; status: string; score: number }[];
}

interface Saved {
  progress?: { completed?: Record<string, number>; skipped?: Record<string, number> };
  inventory?: Record<string, number>;
  wallet?: { balance?: number };
  lastActivity?: number;
  phone?: { unlocked?: boolean };
}

function readTeam(id: string): Saved | null {
  try { return (JSON.parse(localStorage.getItem(teamStorageKey(id)) || 'null') as { state?: Saved } | null)?.state ?? null; } catch { return null; }
}

export function listTeams(): TeamSummary[] {
  return listTeamRecords().map((r) => {
    const saved = readTeam(r.id);
    const completed = saved?.progress?.completed ?? {};
    const skipped = saved?.progress?.skipped ?? {};
    const breakdown = scoreBreakdown(completed, skipped);
    return {
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      score: breakdown.total,
      coins: saved?.wallet?.balance ?? 0,
      casesSolved: breakdown.casesSolved,
      levelsCompleted: breakdown.levelsCompleted,
      lastActivity: saved?.lastActivity ?? r.createdAt,
      phoneUnlocked: !!saved?.phone?.unlocked,
      fragments: CASES.filter((c) => isCaseSolved(c.id, completed, skipped)).map((c) => getCaseFragment(c.id)),
      completed,
      skipped,
      inventory: saved?.inventory ?? {},
      breakdown,
      cases: CASES.map((c) => ({ id: c.id, title: c.title, ...caseProgress(c.id, completed, skipped), score: breakdown.byCase[c.id] ?? 0 })),
    };
  });
}

function summarise(t: ServerTeam): TeamSummary {
  const breakdown = scoreBreakdown(t.completed, t.skipped);
  return {
    id: t.id, name: t.name, createdAt: t.createdAt, score: breakdown.total, coins: t.coins,
    casesSolved: breakdown.casesSolved, levelsCompleted: breakdown.levelsCompleted, lastActivity: t.lastActivity,
    phoneUnlocked: t.phoneUnlocked, fragments: t.fragments, completed: t.completed, skipped: t.skipped, inventory: t.inventory, breakdown,
    cases: CASES.map((c) => ({ id: c.id, title: c.title, ...caseProgress(c.id, t.completed, t.skipped), score: breakdown.byCase[c.id] ?? 0 })),
  };
}

/** Live list for the Admin. Mock: every team saved in this browser. Supabase: the server. */
export const useTeams = create<{ teams: TeamSummary[]; refresh(): void }>()((set) => ({
  teams: typeof window !== 'undefined' && !isServerBackend ? listTeams() : [],
  refresh: () => {
    if (!isServerBackend) { set({ teams: listTeams() }); return; }
    void adminTeams().then((list) => { if (list) set({ teams: list.map(summarise) }); });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && (e.key === 'the-game:teams' || e.key.startsWith('the-game:team:'))) useTeams.getState().refresh();
  });
}
