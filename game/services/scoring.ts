// ScoreService / CaseService (mock). Score is DERIVED from completed levels, so it can never
// be awarded twice and always agrees with progress. Coins are a separate ledger (wallet).
// A backend should compute both server-side; this module is the seam.
import { CASES, levelKey, levelScore, getCase } from '../data/cases';

export type Completed = Record<string, number>;

/** A case is SOLVED when every level is completed or skipped (Skip Token / Master Key). */
export function isCaseSolved(caseId: number, completed: Completed, skipped: Completed = {}): boolean {
  const c = getCase(caseId);
  return !!c && c.levels.length > 0 && c.levels.every((l) => { const k = levelKey(caseId, l.number); return k in completed || k in skipped; });
}

export function caseProgress(caseId: number, completed: Completed, skipped: Completed = {}) {
  const c = getCase(caseId);
  const done = c ? c.levels.filter((l) => { const k = levelKey(caseId, l.number); return k in completed || k in skipped; }).length : 0;
  const total = c?.levels.length ?? 0;
  return { done, total, status: done === 0 ? 'NOT STARTED' : done === total ? 'SOLVED' : 'IN PROGRESS' } as const;
}

export interface ScoreLine { key: string; caseId: number; level: number; title: string; score: number; at: number }

export function scoreBreakdown(completed: Completed, skipped: Completed = {}) {
  const lines: ScoreLine[] = [];
  const byCase: Record<number, number> = {};
  for (const c of CASES) {
    byCase[c.id] = 0;
    for (const l of c.levels) {
      const key = levelKey(c.id, l.number);
      const at = completed[key];
      if (at == null) continue;
      const sc = levelScore(l);
      byCase[c.id] += sc;
      lines.push({ key, caseId: c.id, level: l.number, title: l.title, score: sc, at });
    }
  }
  const total = lines.reduce((n, l) => n + l.score, 0);
  // skipped levels count toward solving the case but never toward score
  return { total, byCase, lines, levelsCompleted: lines.length, levelsSkipped: Object.keys(skipped).length, casesSolved: CASES.filter((c) => isCaseSolved(c.id, completed, skipped)).length };
}

export const teamScore = (completed: Completed) => scoreBreakdown(completed).total;
