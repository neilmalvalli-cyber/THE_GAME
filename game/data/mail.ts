// Intelligence mail: message model, seed inbox and templates for simulated arrivals.
import { MOCK_TEAM } from './team';

export type MailCategory = 'general' | 'deadDrop' | 'blackMarket' | 'system' | 'warning' | 'market';

export interface DeadDropInfo {
  title: string;
  briefing: string;
  clue: string;
  location: string;
  reward: number;
  /** Absolute epoch ms — countdowns derive from this, they never restart. */
  expiresAt: number;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  preview: string;
  body: string;
  category: MailCategory;
  /** Epoch ms. */
  at: number;
  read: boolean;
  starred: boolean;
  archived: boolean;
  deadDrop?: DeadDropInfo;
}

const MIN = 60_000;

/** The inbox a new team starts with. Timestamps are anchored to the first session. */
export function seedInbox(anchor: number): MailMessage[] {
  const to = MOCK_TEAM.name;
  return [
    {
      id: 'msg-01', from: 'THE GAME', to, category: 'general', at: anchor - 2 * MIN, read: false, starred: true, archived: false,
      subject: 'Welcome to the Investigation',
      preview: 'Your case files have been delivered. The investigation begins now.',
      body: 'Your case files have been delivered. The investigation begins now.\n\nSeven files are on your desk. Each holds its own pieces of evidence. Solve them, and you will be paid. Fail, and nobody will remember you tried.\n\nTrust no one who calls twice.\n\n— THE GAME',
    },
    {
      id: 'msg-02', from: 'UNKNOWN SOURCE', to, category: 'deadDrop', at: anchor - 3 * 60 * MIN, read: false, starred: false, archived: false,
      subject: 'Something Was Left Behind',
      preview: 'A package has been discovered near an undisclosed checkpoint.',
      body: 'A package has been discovered near an undisclosed checkpoint. It was meant for another team. They were too slow.',
      deadDrop: {
        title: 'Package Recovered — Checkpoint 0',
        briefing: 'A package was left near the old lecture theatre before the investigation opened.',
        clue: 'WKH ROG FORFN',
        location: 'Undisclosed checkpoint (north wing)',
        reward: 150,
        expiresAt: anchor - 60 * MIN,
      },
    },
    {
      id: 'msg-03', from: 'SYSTEM', to, category: 'system', at: anchor - 40 * MIN, read: false, starred: false, archived: false,
      subject: 'The Market Is Open',
      preview: 'Licensed hints and evidence services are available to every team.',
      body: 'Licensed hints and evidence services are available to every team from the Market.\n\nPrices are fixed. Receipts are kept. Everything sold there is above board.',
    },
    {
      id: 'msg-04', from: 'SYSTEM', to, category: 'system', at: anchor - 25 * MIN, read: true, starred: false, archived: false,
      subject: 'Case 01 Progress Updated',
      preview: 'Your latest evidence submission has been verified.',
      body: 'Your latest evidence submission has been verified.\n\nProgress on every case is recorded automatically. Rewards are paid once per level.',
    },
    {
      id: 'msg-05', from: 'THE GAME', to, category: 'deadDrop', at: anchor - 5 * MIN, read: false, starred: false, archived: false,
      subject: 'DEAD DROP — LIMITED TIME',
      preview: 'A temporary intelligence package is now available.',
      body: 'A temporary intelligence package is now available. It will not wait for you.',
      deadDrop: {
        title: 'Package Recovered',
        briefing: 'A package has been left somewhere on campus. The location can be discovered by decoding the following message.',
        clue: 'GHFRGH WKLV: OLEUDUB, VHFRQG IORRU',
        location: 'Somewhere on campus',
        reward: 200,
        expiresAt: anchor + 45 * MIN,
      },
    },
  ];
}

export type SimulatedMailType = 'general' | 'deadDrop' | 'blackMarket' | 'system';

export const SIMULATED_MAIL_LABELS: Record<SimulatedMailType, string> = {
  general: 'General Update',
  deadDrop: 'Dead Drop',
  blackMarket: 'Black Market Update',
  system: 'System Alert',
};

/** Builds a fresh message for a simulated arrival. `id` must be unique. */
export function buildSimulatedMail(type: SimulatedMailType, id: string, now: number): MailMessage {
  const to = MOCK_TEAM.name;
  const base = { id, to, at: now, read: false, starred: false, archived: false };
  switch (type) {
    case 'deadDrop':
      return {
        ...base, category: 'deadDrop', from: 'UNKNOWN SOURCE',
        subject: 'DEAD DROP — NEW INTELLIGENCE',
        preview: 'A package has been left for whoever moves first.',
        body: 'Someone has left a package for whoever moves first. Decode the clue, find the drop, and report back before it is collected.',
        deadDrop: {
          title: 'New Intelligence',
          briefing: 'A package has been left somewhere on campus. The location can be discovered by decoding the following message.',
          clue: 'XQGHU WKH VWDLUV, ZHVW HQWUDQFH',
          location: 'Somewhere on campus',
          reward: 200,
          expiresAt: now + 15 * MIN,
        },
      };
    case 'blackMarket':
      return {
        ...base, category: 'blackMarket', from: 'BLACK MARKET',
        subject: 'The Dealer Is Expecting You',
        preview: 'Stock is limited. The dealer has set something aside.',
        body: 'Stock is limited. The dealer has set something aside for a team that pays on time.\n\nYou know where the door is.',
      };
    case 'system':
      return {
        ...base, category: 'system', from: 'SYSTEM',
        subject: 'System Alert — Evidence Locker Synchronised',
        preview: 'All case files have been synchronised with the evidence locker.',
        body: 'All case files have been synchronised with the evidence locker. No action is required.',
      };
    default:
      return {
        ...base, category: 'general', from: 'THE GAME',
        subject: 'The Board Has Moved',
        preview: 'Another team has closed a case. You are being watched.',
        body: 'Another team has closed a case tonight. You are being watched more closely than you think.\n\nKeep going.',
      };
  }
}

// ---- market events → mail ---------------------------------------------------------
// One message per market event, with an id derived from the event id, so the same event
// can never produce two messages (in this tab, another tab, or after a refresh).
export type MarketMailEvent = 'normal-closed' | 'normal-reopened' | 'black-activated';

export function marketMailId(eventId: string): string {
  return `mail-${eventId}`;
}

export function buildMarketMail(type: MarketMailEvent, eventId: string, at: number): MailMessage {
  const base = { id: marketMailId(eventId), to: MOCK_TEAM.name, at, read: false, starred: false, archived: false };
  switch (type) {
    case 'normal-closed':
      return {
        ...base, category: 'general', from: 'THE GAME',
        subject: 'MARKET SHUT DOWN',
        preview: 'The market has been sealed following an ongoing investigation.',
        body: 'The market has been sealed following an ongoing investigation. All purchases are suspended until further notice.',
      };
    case 'normal-reopened':
      return {
        ...base, category: 'system', from: 'SYSTEM',
        subject: 'MARKET REOPENED',
        preview: 'Market operations have resumed.',
        body: 'Market operations have resumed. Merchandise is available once again.',
      };
    case 'black-activated':
      return {
        ...base, category: 'blackMarket', from: 'UNKNOWN SOURCE',
        subject: 'AN ALTERNATIVE HAS OPENED',
        preview: 'When the official channels close, other doors open.',
        body: 'When the official channels close, other doors open. Someone is waiting for you.',
      };
  }
}
