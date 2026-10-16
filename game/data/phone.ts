// The recovered evidence phone — every value the puzzle depends on lives here.
//
//   UNLOCK_CODE   The 9-digit passcode, as a STRING (leading zeros are significant).
//   KILLER_NUMBER The number on the device's most recent OUTGOING call — the clue.
//
// Both are PLACEHOLDERS for the prototype. They ship in the browser bundle, so anyone who
// reads the source can find them; a real event must verify the passcode on a server
// (see services/phone.ts) and only then send the call log.
export const CODE_LENGTH = 9;
export const KILLER_NUMBER = '9876543210';

export const DEVICE = {
  evidenceTag: 'EV-0427',
  label: 'Mobile phone, recovered at the scene',
  owner: 'Unidentified',
  /** What the lock screen shows: the night the device was recovered. */
  lockDate: 'Tuesday, October 13',
  lockTime: '02:14',
};

export type CallDirection = 'incoming' | 'outgoing' | 'missed';

export interface CallRecord {
  id: string;
  /** Saved contact name, or null when the number is not in the contacts. */
  name: string | null;
  number: string;
  direction: CallDirection;
  /** Absolute time of the call (local time of the story). */
  at: string;
  /** Seconds. 0 for missed calls. */
  duration: number;
  notes: string;
}

// Newest first, as a phone shows them. The killer's call is the newest OUTGOING call —
// not the newest call: two missed calls arrived after it.
export const CALLS: CallRecord[] = [
  { id: 'c01', name: 'Mum', number: '9123405566', direction: 'missed', at: '2026-10-13T01:58:00', duration: 0,
    notes: 'Missed. Third attempt from this contact since midnight.' },
  { id: 'c02', name: null, number: '8001200450', direction: 'missed', at: '2026-10-13T00:41:00', duration: 0,
    notes: 'Missed. Registered to an automated delivery service.' },
  { id: 'c03', name: null, number: KILLER_NUMBER, direction: 'outgoing', at: '2026-10-12T23:52:00', duration: 47,
    notes: 'Placed from this device. Number not saved in contacts. No earlier calls to or from this number on the device.' },
  { id: 'c04', name: 'Mum', number: '9123405566', direction: 'missed', at: '2026-10-12T23:40:00', duration: 0,
    notes: 'Missed.' },
  { id: 'c05', name: 'R. Malhotra', number: '9988776655', direction: 'incoming', at: '2026-10-12T22:16:00', duration: 194,
    notes: 'Answered. Longest call of the evening.' },
  { id: 'c06', name: 'Mum', number: '9123405566', direction: 'missed', at: '2026-10-12T21:30:00', duration: 0,
    notes: 'Missed.' },
  { id: 'c07', name: 'Campus Security', number: '8040011223', direction: 'outgoing', at: '2026-10-12T20:03:00', duration: 12,
    notes: 'Placed from this device. Call ended after 12 seconds.' },
  { id: 'c08', name: 'Arjun', number: '9001234567', direction: 'incoming', at: '2026-10-12T18:47:00', duration: 326,
    notes: 'Answered.' },
  { id: 'c09', name: null, number: '7012345678', direction: 'missed', at: '2026-10-12T17:15:00', duration: 0,
    notes: 'Missed. Number not saved in contacts.' },
  { id: 'c10', name: 'Arjun', number: '9001234567', direction: 'outgoing', at: '2026-10-12T14:22:00', duration: 88,
    notes: 'Placed from this device.' },
  { id: 'c11', name: 'Library Desk', number: '8022334455', direction: 'incoming', at: '2026-10-11T11:05:00', duration: 41,
    notes: 'Answered.' },
];

/** The call the puzzle is about (derived, so it follows the data). */
export const IMPORTANT_CALL_ID = CALLS.find((c) => c.direction === 'outgoing')!.id;

export function formatNumber(n: string): string {
  return n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;
}

export function formatDuration(s: number): string {
  if (!s) return '—';
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

const parse = (iso: string) => new Date(iso);

/** "23:52" */
export function callTime(iso: string): string {
  const d = parse(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Relative to the night the phone was recovered (13 Oct): "Today" / "Yesterday" / "Sun 11 Oct". */
export function callDay(iso: string): string {
  const d = parse(iso);
  const day = d.getDate();
  if (d.getMonth() === 9 && day === 13) return 'Today';
  if (d.getMonth() === 9 && day === 12) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function callDateLong(iso: string): string {
  return parse(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---- the rest of the phone (mock, deliberately no answer to the main challenge) ----------
export interface Contact { id: string; name: string; number: string; label: string; note?: string }

export const CONTACTS: Contact[] = [
  { id: 'k01', name: 'Arjun', number: '9001234567', label: 'mobile', note: 'Lab partner. Owes me 200.' },
  { id: 'k02', name: 'Campus Security', number: '8040011223', label: 'work' },
  { id: 'k03', name: 'Library Desk', number: '8022334455', label: 'work' },
  { id: 'k04', name: 'Mum', number: '9123405566', label: 'home' },
  { id: 'k05', name: 'Neha (Hostel B)', number: '9811122233', label: 'mobile' },
  { id: 'k06', name: 'Print Shop', number: '8045566778', label: 'work', note: 'Closes at 9.' },
  { id: 'k07', name: 'R. Malhotra', number: '9988776655', label: 'mobile' },
  { id: 'k08', name: 'Taxi (late)', number: '8099911100', label: 'other' },
];

export interface SmsThread { id: string; with: string; messages: { from: 'me' | 'them'; text: string; at: string }[] }

export const THREADS: SmsThread[] = [
  { id: 't01', with: 'Mum', messages: [
    { from: 'them', text: 'Did you eat?', at: '2026-10-12T19:02:00' },
    { from: 'me', text: 'Yes. Working late tonight, will call tomorrow.', at: '2026-10-12T19:10:00' },
    { from: 'them', text: 'Call me when you reach.', at: '2026-10-12T23:41:00' },
    { from: 'them', text: 'Why aren’t you picking up?', at: '2026-10-13T01:59:00' },
  ] },
  { id: 't02', with: 'R. Malhotra', messages: [
    { from: 'them', text: 'The files are not where you said they would be.', at: '2026-10-12T21:48:00' },
    { from: 'me', text: 'I moved them. Call me.', at: '2026-10-12T22:05:00' },
    { from: 'them', text: 'Calling now.', at: '2026-10-12T22:15:00' },
  ] },
  { id: 't03', with: 'Arjun', messages: [
    { from: 'me', text: 'Can you cover the 2pm lab?', at: '2026-10-12T13:58:00' },
    { from: 'them', text: 'Fine. You owe me.', at: '2026-10-12T14:01:00' },
    { from: 'them', text: 'Someone was asking about you at the canteen.', at: '2026-10-12T18:40:00' },
  ] },
  { id: 't04', with: 'Print Shop', messages: [
    { from: 'them', text: 'Your order is ready for pickup. Ref #4471.', at: '2026-10-11T16:20:00' },
  ] },
];

export interface Note { id: string; title: string; body: string; at: string }

export const NOTES: Note[] = [
  { id: 'n01', title: 'Groceries', body: 'Milk\nBread\nBatteries (AA)\nPrint shop — pick up', at: '2026-10-10T09:12:00' },
  { id: 'n02', title: 'Do not forget', body: 'Return the library key before Friday.\nAsk Arjun about the lab notes.', at: '2026-10-11T22:40:00' },
  { id: 'n03', title: 'Meeting?', body: 'He said “late, after the last bus”.\nWhere? He didn’t say.', at: '2026-10-12T20:31:00' },
];

/** Lightweight "photos": drawn with CSS gradients, no image downloads. */
export const PHOTOS: { id: string; caption: string; at: string; css: string }[] = [
  { id: 'p01', caption: 'Hostel corridor', at: '2026-10-12T22:58:00', css: 'linear-gradient(180deg,#2a2622 0%,#5d5245 55%,#2c2722 100%)' },
  { id: 'p02', caption: 'Sunset from the roof', at: '2026-10-11T17:44:00', css: 'linear-gradient(180deg,#f2a65a 0%,#c4574b 45%,#3b2a4a 100%)' },
  { id: 'p03', caption: 'Lab whiteboard', at: '2026-10-12T14:12:00', css: 'repeating-linear-gradient(0deg,#e9ecef 0 18px,#cfd4da 18px 19px)' },
  { id: 'p04', caption: 'Blurry — street at night', at: '2026-10-12T23:31:00', css: 'radial-gradient(circle at 30% 40%,#ffd27a 0 6%,transparent 7%),radial-gradient(circle at 70% 55%,#ff6b5b 0 5%,transparent 6%),linear-gradient(180deg,#0d1220,#1f2638)' },
  { id: 'p05', caption: 'Canteen receipt', at: '2026-10-12T18:36:00', css: 'linear-gradient(90deg,#f5f1e6 0 70%,#d9d2c3 70%)' },
  { id: 'p06', caption: 'Library steps', at: '2026-10-11T11:20:00', css: 'repeating-linear-gradient(170deg,#8d8070 0 22px,#6f6458 22px 26px)' },
];

export const DEVICE_INFO = [
  ['Model', 'Mobile phone (evidence EV-0427)'],
  ['Software', 'v12.4.1'],
  ['Storage', '41.2 of 64 GB used'],
  ['Battery', '6 %'],
  ['Last backup', 'Never'],
] as const;
