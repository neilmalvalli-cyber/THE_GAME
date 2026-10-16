// Route vocabulary for the team interface (one place to build and parse paths).
import { getCase, getLevel, parseId } from '../data/cases';

export const paths = {
  roleSelect: '/',
  intro: '/team/intro',
  desk: '/team/desk',
  case: (caseId: number) => `/team/case/${caseId}`,
  level: (caseId: number, level: number) => `/team/case/${caseId}/level/${level}`,
  phone: '/team/phone',
  market: '/team/market',
  blackMarket: '/team/black-market',
  inbox: '/team/inbox',
  message: (id: string) => `/team/inbox/${encodeURIComponent(id)}`,
  admin: '/admin',
};

export type TeamRoute =
  | { kind: 'intro' }
  | { kind: 'desk' }
  | { kind: 'case'; caseId: number }
  | { kind: 'level'; caseId: number; level: number }
  | { kind: 'phone' }
  | { kind: 'shop' }
  | { kind: 'blackMarket' }
  | { kind: 'inbox' }
  | { kind: 'invalid' };

export function parseTeamRoute(pathname: string): TeamRoute {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/team/intro') return { kind: 'intro' };
  if (p === '/team' || p === '/team/desk') return { kind: 'desk' };
  if (p === '/team/phone') return { kind: 'phone' };
  if (p === '/team/market') return { kind: 'shop' };
  if (p === '/team/black-market') return { kind: 'blackMarket' };
  if (p === '/team/inbox' || p.startsWith('/team/inbox/')) return { kind: 'inbox' };
  const m = /^\/team\/case\/([^/]+)(?:\/level\/([^/]+))?$/.exec(p);
  if (m) {
    const caseId = parseId(m[1]);
    if (caseId == null || !getCase(caseId)) return { kind: 'invalid' };
    if (m[2] === undefined) return { kind: 'case', caseId };
    const level = parseId(m[2]);
    if (level == null || !getLevel(caseId, level)) return { kind: 'invalid' };
    return { kind: 'level', caseId, level };
  }
  return { kind: 'invalid' };
}
