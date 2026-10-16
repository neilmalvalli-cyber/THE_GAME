// MailService (mock): the Admin composes; teams receive.
//
// Sent messages go into one outbox ("the-game:admin-mail"). Every signed-in team tab in
// this browser picks up the messages addressed to it (all teams, or its own id), delivers
// each once into its own inbox (id-deduplicated) and the notifier announces it at a safe
// moment. Other tabs follow live via the `storage` event and a BroadcastChannel.
//
// PROTOTYPE LIMIT: this is local delivery. Teams on other computers receive nothing until
// a server stores messages per recipient and pushes them (WebSocket / Server-Sent Events),
// with read-state sync, delivery acknowledgements and admin authorisation.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MailCategory, MailMessage } from '../data/mail';
import { useGameStore, uid } from '../state/gameStore';
import { deliver } from './intelFeed';
import { adminSend, adminSent, isServerBackend } from './backend';

export type AdminMailType = 'general' | 'deadDrop' | 'warning' | 'market' | 'system';

export const ADMIN_MAIL_TYPES: { id: AdminMailType; label: string; category: MailCategory; from: string }[] = [
  { id: 'general', label: 'General Announcement', category: 'general', from: 'THE GAME' },
  { id: 'deadDrop', label: 'Dead Drop', category: 'deadDrop', from: 'UNKNOWN SOURCE' },
  { id: 'warning', label: 'Warning', category: 'warning', from: 'THE GAME' },
  { id: 'market', label: 'Market Update', category: 'market', from: 'MARKET' },
  { id: 'system', label: 'System Message', category: 'system', from: 'SYSTEM' },
];

export interface OutboxMessage {
  id: string;
  to: 'all' | string[];
  /** Names at send time, for the Sent list. */
  toLabel: string;
  subject: string;
  body: string;
  type: AdminMailType;
  at: number;
}

export const SUBJECT_MAX = 120;
export const BODY_MAX = 4000;

interface Outbox { sent: OutboxMessage[]; add(m: OutboxMessage): void; clear(): void }

export const useOutbox = create<Outbox>()(
  persist(
    (set, get) => ({
      sent: [],
      add: (m) => { if (!get().sent.some((x) => x.id === m.id)) { set({ sent: [m, ...get().sent].slice(0, 300) }); ping(); } },
      clear: () => { set({ sent: [] }); ping(); },
    }),
    { name: 'the-game:admin-mail', storage: createJSONStorage(() => localStorage), partialize: ({ sent }) => ({ sent }) },
  ),
);

let channel: BroadcastChannel | null = null;
function ping() { try { channel?.postMessage('sent'); } catch { /* closed */ } }
if (typeof window !== 'undefined') {
  try { channel = new BroadcastChannel('the-game-mail'); channel.onmessage = () => { void useOutbox.persist.rehydrate(); }; } catch { channel = null; }
  window.addEventListener('storage', (e) => { if (e.key === 'the-game:admin-mail') void useOutbox.persist.rehydrate(); });
}

export type SendResult = { ok: true; message: OutboxMessage } | { ok: false; error: string };

/** Validate and send. `draftId` makes repeated clicks on Send produce one message. */
function validateDraft(draft: { to: 'all' | { id: string; name: string }[]; subject: string; body: string }): string | null {
  const subject = draft.subject.trim(), body = draft.body.trim();
  if (draft.to !== 'all' && draft.to.length === 0) return 'Choose at least one team.';
  if (!subject) return 'Write a subject.';
  if (subject.length > SUBJECT_MAX) return `Subjects can be at most ${SUBJECT_MAX} characters.`;
  if (!body) return 'Write a message.';
  if (body.length > BODY_MAX) return `Messages can be at most ${BODY_MAX} characters.`;
  return null;
}

export function sendMessage(draft: { draftId: string; to: 'all' | { id: string; name: string }[]; subject: string; body: string; type: AdminMailType }): SendResult {
  const subject = draft.subject.trim(), body = draft.body.trim();
  const invalid = validateDraft(draft);
  if (invalid) return { ok: false, error: invalid };
  const existing = useOutbox.getState().sent.find((m) => m.id === draft.draftId);
  if (existing) return { ok: true, message: existing };
  const message: OutboxMessage = {
    id: draft.draftId,
    to: draft.to === 'all' ? 'all' : draft.to.map((t) => t.id),
    toLabel: draft.to === 'all' ? 'All teams' : draft.to.map((t) => t.name).join(', '),
    subject, body, type: draft.type, at: Date.now(),
  };
  useOutbox.getState().add(message);
  return { ok: true, message };
}

export const newDraftId = () => uid('adm');

function toMail(m: OutboxMessage, teamName: string): MailMessage {
  const t = ADMIN_MAIL_TYPES.find((x) => x.id === m.type) ?? ADMIN_MAIL_TYPES[0];
  // plain text only: the inbox renders it as text, never as HTML
  return {
    id: `mail-${m.id}`, from: t.from, to: teamName, subject: m.subject,
    preview: m.body.split('\n')[0].slice(0, 120), body: m.body, category: t.category,
    at: m.at, read: false, starred: false, archived: false,
  };
}

/** Deliver what is addressed to the signed-in team (and was sent after it registered). */
export function processAdminMail(): number {
  const game = useGameStore.getState();
  const team = game.team;
  if (!team.id) return 0;
  let n = 0;
  for (const m of [...useOutbox.getState().sent].reverse()) {
    if (m.at < (team.createdAt || 0)) continue;
    if (m.to !== 'all' && !m.to.includes(team.id)) continue;
    if (deliver(toMail(m, team.name))) n++;
  }
  return n;
}

/** Team side: catch up, then follow new sends. */
export function connectAdminMail(): () => void {
  processAdminMail();
  return useOutbox.subscribe((s, prev) => { if (s.sent !== prev.sent) processAdminMail(); });
}

/** Admin, Supabase backend: send on the server, then mirror the server's Sent list. */
export async function sendMessageRemote(draft: Parameters<typeof sendMessage>[0]): Promise<SendResult> {
  const v = validateDraft(draft);
  if (v) return { ok: false, error: v };
  const r = await adminSend({ ...draft, subject: draft.subject.trim(), body: draft.body.trim() });
  if (!r.ok) return { ok: false, error: r.error ?? 'Could not send.' };
  await refreshSentRemote();
  const message = useOutbox.getState().sent.find((m) => m.id === draft.draftId)
    ?? { id: draft.draftId, to: draft.to === 'all' ? 'all' : draft.to.map((t) => t.id), toLabel: draft.to === 'all' ? 'All teams' : draft.to.map((t) => t.name).join(', '), subject: draft.subject.trim(), body: draft.body.trim(), type: draft.type, at: Date.now() };
  return { ok: true, message };
}

export async function refreshSentRemote() {
  const sent = await adminSent();
  useOutbox.setState({ sent: sent.map((m) => ({ ...m, type: (ADMIN_MAIL_TYPES.some((t) => t.id === m.type) ? m.type : 'general') as AdminMailType })) });
}

/** Delivery status for the Sent list (local mock: whether the team's save has it). */
export function deliveryStatus(m: OutboxMessage, teams: { id: string; createdAt: number }[]): string {
  if (isServerBackend) return 'Stored on the server · delivered on the teams\' next sync';
  const ids = m.to === 'all' ? teams.filter((t) => t.createdAt <= m.at).map((t) => t.id) : m.to;
  let got = 0;
  for (const id of ids) {
    try {
      const saved = JSON.parse(localStorage.getItem(`the-game:team:${id}`) || 'null') as { state?: { inbox?: { messages?: { id: string }[] } } } | null;
      if (saved?.state?.inbox?.messages?.some((x) => x.id === `mail-${m.id}`)) got++;
    } catch { /* unreadable */ }
  }
  return ids.length ? `Delivered locally to ${got}/${ids.length}` : 'No teams yet';
}
