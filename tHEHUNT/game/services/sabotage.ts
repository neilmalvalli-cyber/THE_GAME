// SabotageService (mock): Glitch Attack and Freeze aimed at a rival team.
//
// Attacks go into one shared log ("the-game:sabotage"). The target's tab resolves each
// attack once: an owned Firewall is consumed and blocks it, otherwise the effect applies
// for 60 seconds. Both teams get mail about the outcome. Effects are cosmetic / timer-only:
// they never block solving or submitting.
//
// PROTOTYPE LIMIT: local only. A target that is not signed in on this browser resolves the
// attack when it next signs in here. A server must resolve attacks atomically and push them.
import { useGameStore, uid } from '../state/gameStore';
import { listTeamRecords } from './auth';
import { deliver } from './intelFeed';
import type { MailMessage } from '../data/mail';

export type SabotageKind = 'glitch' | 'freeze';
export const SABOTAGE_MS = 60_000;
const KEY = 'the-game:sabotage';
const ITEM: Record<SabotageKind, string> = { glitch: 'glitch_attack', freeze: 'freeze' };
const LABEL: Record<SabotageKind, string> = { glitch: 'Glitch Attack', freeze: 'Freeze' };

export interface SabotageEntry {
  id: string;
  kind: SabotageKind;
  fromId: string; fromName: string;
  toId: string; toName: string;
  at: number;
  outcome?: 'hit' | 'blocked';
  resolvedAt?: number;
}

const read = (): SabotageEntry[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') as SabotageEntry[]; } catch { return []; } };
const write = (list: SabotageEntry[]) => { localStorage.setItem(KEY, JSON.stringify(list.slice(-300))); ping(); };

let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();
function ping() { try { channel?.postMessage('x'); } catch { /* closed */ } }
if (typeof window !== 'undefined') {
  try { channel = new BroadcastChannel('the-game-sabotage'); channel.onmessage = () => listeners.forEach((f) => f()); } catch { channel = null; }
  window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((f) => f()); });
}

export const listRivals = () => {
  const me = useGameStore.getState().team.id;
  return listTeamRecords().filter((t) => t.id !== me).map((t) => ({ id: t.id, name: t.name }));
};

export const sabotageLog = read;

function mail(id: string, subject: string, body: string, to: string): MailMessage {
  return { id, from: 'SYSTEM', to, subject, preview: body.slice(0, 120), body, category: 'warning', at: Date.now(), read: false, starred: false, archived: false };
}

export function launchSabotage(kind: SabotageKind, targetId: string): { ok: boolean; message: string } {
  const game = useGameStore.getState();
  const target = listRivals().find((t) => t.id === targetId);
  if (!target) return { ok: false, message: 'Choose a rival team.' };
  if (!game.consumeItem(ITEM[kind])) return { ok: false, message: `You have no ${LABEL[kind]}.` };
  const e: SabotageEntry = { id: uid('sab'), kind, fromId: game.team.id, fromName: game.team.name, toId: target.id, toName: target.name, at: Date.now() };
  write([...read(), e]);
  return { ok: true, message: `${LABEL[kind]} sent to ${target.name}.` };
}

/** Resolve attacks on this team and report outcomes of its own attacks. */
export function processSabotage() {
  const game = useGameStore.getState();
  const me = game.team.id;
  if (!me) return;
  const list = read();
  let changed = false;
  for (const e of list) {
    if (e.toId === me && !e.outcome) {
      const blocked = useGameStore.getState().consumeItem('firewall');
      e.outcome = blocked ? 'blocked' : 'hit';
      e.resolvedAt = Date.now();
      changed = true;
      if (!blocked) useGameStore.getState().applySabotage(e.kind, e.resolvedAt + SABOTAGE_MS);
      deliver(mail(`sab-${e.id}-in`,
        blocked ? `Firewall blocked a ${LABEL[e.kind]}` : `${LABEL[e.kind]} hit your team`,
        blocked
          ? `${e.fromName} launched a ${LABEL[e.kind]} at you. Your Firewall absorbed it and is now used up.`
          : e.kind === 'glitch'
            ? `${e.fromName} glitched your interface for 60 seconds. You can still solve and submit normally.`
            : `${e.fromName} froze your progress timer for 60 seconds. Your dashboard and clues stay usable.`,
        game.team.name));
    }
    if (e.fromId === me && e.outcome) {
      deliver(mail(`sab-${e.id}-out`,
        e.outcome === 'blocked' ? `${LABEL[e.kind]} blocked by ${e.toName}` : `${LABEL[e.kind]} landed on ${e.toName}`,
        e.outcome === 'blocked' ? `${e.toName} had a Firewall up. Your ${LABEL[e.kind]} was absorbed.` : `Your ${LABEL[e.kind]} hit ${e.toName} for 60 seconds.`,
        game.team.name));
    }
  }
  if (changed) write(list);
}

/** Team side: catch up, then follow new attacks. */
export function connectSabotage(): () => void {
  processSabotage();
  listeners.add(processSabotage);
  const t = window.setInterval(processSabotage, 5000);
  return () => { listeners.delete(processSabotage); window.clearInterval(t); };
}
