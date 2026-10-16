// Transient UI state: overlays and the incoming-mail notification queue.
import { create } from 'zustand';

export interface MailNotice {
  id: string;
  messageId: string;
  from: string;
  subject: string;
}

interface UiState {
  walletOpen: boolean;
  /** Notices waiting for a safe moment. */
  queue: MailNotice[];
  active: MailNotice | null;
  /** Increments each time the mail icon should pulse. */
  mailPulse: number;
  /** Last desk route, so leaving the market / inbox returns to the same file. */
  lastDeskPath: string;
  /** The call record open on the evidence phone (kept while the team looks elsewhere). */
  phoneCallId: string | null;
  setPhoneCallId(id: string | null): void;
  setWalletOpen(open: boolean): void;
  enqueue(n: MailNotice): void;
  showNext(): MailNotice | null;
  dismiss(): void;
  setLastDeskPath(p: string): void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  walletOpen: false,
  queue: [],
  active: null,
  mailPulse: 0,
  lastDeskPath: '/team/desk',
  phoneCallId: null,
  setPhoneCallId: (phoneCallId) => set({ phoneCallId }),
  setWalletOpen: (walletOpen) => set({ walletOpen }),
  enqueue: (n) => {
    if (get().queue.some((q) => q.messageId === n.messageId) || get().active?.messageId === n.messageId) return;
    set((s) => ({ queue: [...s.queue, n] }));
  },
  showNext: () => {
    const [next, ...rest] = get().queue;
    if (!next) return null;
    set((s) => ({ queue: rest, active: next, mailPulse: s.mailPulse + 1 }));
    return next;
  },
  dismiss: () => set({ active: null }),
  setLastDeskPath: (lastDeskPath) => set({ lastDeskPath }),
}));
