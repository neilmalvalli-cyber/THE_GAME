// Incoming intelligence. Every new message — simulated today, pushed by a
// server tomorrow — goes through deliver(): stored once in the shared inbox,
// marked unread, then queued as a notice that the UI shows at a safe moment.
//
// Future: implement IntelTransport over WebSocket or Server-Sent Events and
// call connectIntelFeed(transport). Nothing else needs to change.
import { buildMarketMail, buildSimulatedMail, type MailMessage, type MarketMailEvent, type SimulatedMailType } from '../data/mail';
import { getMarketState, subscribeToMarketState, type MarketEvent } from './marketState';
import { uid, useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';

export interface IntelTransport {
  /** Starts delivering messages; returns a disconnect function. */
  connect(onMessage: (msg: MailMessage) => void): () => void;
}

/** Adds the message (deduplicated by id) and queues its notice. Returns false for duplicates. */
export function deliver(msg: MailMessage): boolean {
  const added = useGameStore.getState().addMessage({ ...msg, read: false, archived: false });
  if (!added) return false;
  useUiStore.getState().enqueue({ id: uid('notice'), messageId: msg.id, from: msg.from, subject: msg.subject });
  return true;
}

let disconnect: (() => void) | null = null;

export function connectIntelFeed(transport: IntelTransport): () => void {
  disconnect?.();
  disconnect = transport.connect(deliver);
  return () => { disconnect?.(); disconnect = null; };
}

/** Development: a new mock message of the given type with a unique id. */
export function simulateIncomingMail(type: SimulatedMailType = 'general'): MailMessage {
  const msg = buildSimulatedMail(type, uid('mail'), Date.now());
  deliver(msg);
  return msg;
}

/** Scripted story beat: the first verified level draws attention — once per team. */
export function scheduleFirstSolveDeadDrop(delayMs = 7000): void {
  const s = useGameStore.getState();
  if (s.story.firstSolveDropSent) return;
  s.markStory('firstSolveDropSent');
  window.setTimeout(() => simulateIncomingMail('deadDrop'), delayMs);
}

// ---- market events → mail ---------------------------------------------------------
const MAILED: Record<string, MarketMailEvent | undefined> = {
  'normal-closed': 'normal-closed',
  'normal-reopened': 'normal-reopened',
  'black-activated': 'black-activated',
};

/** Delivers one message per market event not yet handled. Safe to call repeatedly. */
export function processMarketEvents(events: MarketEvent[] = getMarketState().events): number {
  let n = 0;
  for (const ev of events) {
    const type = MAILED[ev.type];
    const game = useGameStore.getState();
    if (!type || game.marketMail.processed.includes(ev.id)) continue;
    game.markMarketEventMailed(ev.id); // mark first: a second listener can never deliver it again
    if (deliver(buildMarketMail(type, ev.id, ev.at))) n++;
  }
  return n;
}

/**
 * Team side: turns admin market actions into intelligence mail. Catches up on events
 * recorded while the team view was closed, then follows live changes (same browser only).
 */
export function connectMarketMail(): () => void {
  processMarketEvents();
  return subscribeToMarketState((s) => processMarketEvents(s.events));
}
