// Mock case files. Titles, levels, rewards and answers are prototype content.
// Public case content (what players see). Answers, Powerful Hints and the phone code
// live in data/secrets.ts — never shipped to browsers in the Supabase build.

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/** Answer formats the level page understands (more can be added without changing pages). */
export type AnswerType = 'text' | 'numeric' | 'choice' | 'fields' | 'witness';

/** A block of the investigation page (used instead of briefing/evidence when present). */
export interface LevelSection {
  heading?: string;
  /** Paragraphs. */
  body?: string[];
  /** Shown as a classified document (quoted clue). */
  document?: string[];
  list?: string[];
  ordered?: boolean;
  /** A monospaced line, e.g. a system status. */
  code?: string;
  tone?: 'warning' | 'note';
  table?: { title?: string; subtitle?: string; columns: string[]; rows: string[][] };
  /** External evidence (opens in a new tab). */
  link?: { label: string; url: string };
  /** Optional embedded video (empty url = not shown). */
  video?: { title: string; url: string };
}

// ---- configurable scoring (placeholders) --------------------------------------------
/** Score per level number (competitive ranking). Coins are separate (LevelDef.reward). */
export const LEVEL_SCORE: Record<number, number> = { 1: 100, 2: 150, 3: 200, 4: 250 };

/**
 * How many digits of the nine-digit phone code each case pays out when SOLVED.
 * Three cases pay 1 digit, three pay 2: 3 × 1 + 3 × 2 = 9. Assembly order: case 1 → 6.
 */
export const CASE_FRAGMENT_LENGTH: Record<number, number> = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 2 };

export interface LevelDef {
  /** 1-based level number within its case. */
  number: number;
  title: string;
  difficulty: Difficulty;
  /** Coins paid once on completion (currency). */
  reward: number;
  /** Score paid once on completion (ranking). Defaults to LEVEL_SCORE[number]. */
  score?: number;
  /** Defaults to 'text'. */
  answerType?: AnswerType;
  /** For answerType 'choice'. */
  choices?: string[];
  /** Image / file evidence (paths under /public), shown on the level page. */
  evidenceAssets?: string[];
  /** Shown on the typed report inside the folder. */
  description: string;
  /** Shown on the level page. */
  briefing: string;
  evidence: string;
  evidenceNote?: string;
  /** e.g. 'LOCATION INTELLIGENCE'. */
  classification?: string;
  /** Rich page content (replaces briefing + evidence on the level page). */
  sections?: LevelSection[];
  /** The question asked above the answer box. */
  question?: string;
  placeholder?: string;
  submitLabel?: string;
  /** answerType 'fields': submitted together as one answer, joined with "|". */
  fields?: { key: string; label: string; placeholder: string }[];
  formatHint?: string;
  /** Wrong answers allowed before the level locks (unlimited when absent). */
  maxAttempts?: number;
  /** Two lines shown on success, e.g. ['LOCATION CONFIRMED', 'LEVEL 01 — COMPLETED']. */
  successLines?: [string, string];
}

export interface CaseDef {
  id: number;
  title: string;
  /** Shown on the case overview. */
  classification?: string;
  /** Lines of the CASE CLOSED screen. */
  closedLines?: string[];
  levels: LevelDef[];
}

export const CASES: CaseDef[] = [
  {
    id: 1,
    title: 'The Fractured Truth',
    classification: 'RESTRICTED',
    closedLines: ['ALL FIVE INVESTIGATIONS VERIFIED', 'THE TRUTH HAS BEEN RECOVERED', 'CASE STATUS: COMPLETED'],
    levels: [
      {
        number: 1, title: 'The First Destination', difficulty: 'Easy', reward: 100, score: 100, maxAttempts: 8,
        classification: 'LOCATION INTELLIGENCE',
        description: 'Every investigation begins somewhere. An intelligence report points to a building on campus, described only by the mind it is named after.',
        briefing: 'Identify the building described in the intelligence report.', evidence: '',
        sections: [
          { heading: 'Intelligence report', document: [
            'Every investigation begins somewhere, but the truth rarely waits where the search begins.',
            'You stand where tomorrow’s ideas take shape, yet your next lead lies among those just beginning their journey.',
            'Seek the place named after a mind that explored the mysteries of light and matter. Climb beyond the first two levels, where silent witnesses display notices for those who know where to look.',
          ] },
          { heading: 'Investigation objective', body: ['Identify the building described in the intelligence report.'] },
        ],
        placeholder: 'ENTER LOCATION NAME', submitLabel: 'SUBMIT FINAL ANSWER',
        successLines: ['LOCATION CONFIRMED', 'LEVEL 01 — COMPLETED'],
      },
      {
        number: 2, title: 'The Hidden Honeypot', difficulty: 'Medium', reward: 150, score: 150, maxAttempts: 8,
        classification: 'FIELD INVESTIGATION',
        description: 'The investigation has moved beyond the digital world. A piece of evidence is concealed somewhere on campus.',
        briefing: 'Recover the hidden message from the physical location revealed by the previous clue.', evidence: '',
        sections: [
          { heading: 'Field intelligence required', body: [
            'The investigation has moved beyond the digital world. Your next piece of evidence is concealed somewhere on campus.',
            'Recover the hidden message from the physical location revealed by the previous clue.',
          ] },
        ],
        placeholder: 'ENTER DISCOVERED KEYWORD', submitLabel: 'SUBMIT FINAL ANSWER',
        successLines: ['FIELD EVIDENCE VERIFIED', 'LEVEL 02 — COMPLETED'],
      },
      {
        number: 3, title: 'The Corrupted Access Log', difficulty: 'Medium', reward: 150, score: 150, maxAttempts: 8,
        classification: 'DIGITAL FORENSICS', answerType: 'numeric',
        description: 'Five login attempts under three accounts. The report says every one failed. An anonymous note says the record was tampered with.',
        briefing: 'How many login attempts actually succeeded?', evidence: '',
        sections: [
          { heading: 'Case File 01: The Corrupted Access Log', body: [
            'A suspicious breach has been detected in a restricted system. Five login attempts were recorded under three different accounts, but the final report claims that every attempt failed.',
            'Before the investigation could proceed, an anonymous source recovered a note suggesting that the records may have been tampered with.',
            'Your task is to examine the evidence carefully. Don’t blindly trust what the system reports—sometimes, the truth is hidden in the smallest inconsistency.',
          ] },
          { table: { title: 'INCIDENT 09', subtitle: 'ACCESS LOG — INTEGRITY UNVERIFIED', columns: ['Attempt', 'Account', 'Status'], rows: [
            ['01', 'GUEST', 'FAILED'], ['02', 'ADMIN', 'FAILED'], ['03', 'ARCHIVE', 'FAILED'], ['04', 'GUEST', 'FAILED'], ['05', 'ADMIN', 'FAILED'],
          ] } },
          { heading: 'Recovered note', body: ['The report claims every attempt failed—but reports can lie. Verify the record before you trust the result.'], tone: 'note' },
          { code: 'POSSIBLE LOG TAMPERING', tone: 'warning' },
        ],
        question: 'How many login attempts actually succeeded?',
        placeholder: 'ENTER NUMBER', submitLabel: 'SUBMIT FINAL ANSWER',
        successLines: ['LOG ANALYSIS ACCEPTED', 'LEVEL 03 — COMPLETED'],
      },
      {
        number: 4, title: 'The Ghost Files', difficulty: 'Hard', reward: 200, score: 250, maxAttempts: 8,
        classification: 'EVIDENCE COMPROMISED', answerType: 'fields',
        description: 'The official report claims the case is solved. A folder of logs, backups, notes and a timeline says otherwise.',
        briefing: 'Determine the account, the last valid backup version and the exact access time.', evidence: '',
        sections: [
          { code: 'CASE STATUS: EVIDENCE COMPROMISED', tone: 'warning' },
          { body: [
            'A suspicious digital incident has left behind a collection of records. The official report claims the case is solved, but several details may not be what they seem.',
            'Your team has been granted access to a digital evidence folder containing system logs, backup records, investigator notes, an incident timeline, and a final report.',
            'Your mission is to uncover what actually happened.',
          ] },
          { heading: 'Investigation objectives', ordered: true, list: [
            'Which account last accessed the report successfully?',
            'Which backup version is the last verified, valid preserved version?',
            'At what exact time did that successful access occur?',
          ] },
          { heading: 'Rules of investigation', list: [
            'Examine the files carefully and cross-check information between them.',
            'Do not automatically trust the final report.',
            'A higher version number does not necessarily mean a file is authentic.',
            'Distinguish successful operations from failed attempts.',
            'All timestamps are in UTC.',
            'Base your conclusion on the available evidence, not assumptions.',
          ] },
          { link: { label: 'OPEN EVIDENCE ARCHIVE', url: 'https://drive.google.com/drive/folders/1xe1zbv03Z2v2Ao9YhZZidv-5spEgTFBH?usp=sharing' } },
        ],
        fields: [
          { key: 'account', label: 'ACCOUNT IDENTIFIER', placeholder: 'ACCOUNT' },
          { key: 'version', label: 'BACKUP VERSION', placeholder: 'VERSION' },
          { key: 'time', label: 'ACCESS TIMESTAMP', placeholder: 'HH:MM:SS UTC' },
        ],
        formatHint: 'ACCOUNT | VERSION | HH:MM:SS UTC',
        submitLabel: 'SUBMIT FINAL ANSWER',
        successLines: ['INVESTIGATION REPORT VERIFIED', 'LEVEL 04 — COMPLETED'],
      },
      {
        number: 5, title: 'The Silent Witness', difficulty: 'Hard', reward: 150, score: 200, maxAttempts: 8,
        classification: 'WITNESS INVESTIGATION', answerType: 'witness', choices: ['1', '2', '3', '4'],
        description: 'A golden figure keeps watch over those who come to learn. At his feet: the final witness recording.',
        briefing: 'Which witness is lying?', evidence: '',
        sections: [
          { heading: 'Intelligence report', document: [
            'Seek the man who turned vision into reality and dreams into structures.',
            'He stands unmoving while generations pass, a golden figure watching over those who come to learn.',
            'Where wisdom meets ambition, find the silent guardian. Your next secret awaits at his feet.',
          ] },
          { code: 'RECOVER THE FINAL WITNESS RECORDING' },
          { heading: 'Witness interrogation', body: [
            'A mysterious man was reportedly seen inside a building on a particular day.',
            'Four witnesses claim to have seen him, but their statements don’t all match the available evidence.',
            'The participants receive a video containing four witness interviews and a series of visual clues.',
            'Their task is to identify which witness is lying by analyzing the evidence rather than guessing.',
          ] },
          // Set the URL once the recording is ready (empty = no player; the QR at the location is the main route).
          { video: { title: 'Witness recording', url: '' } },
        ],
        question: 'Which witness is lying?',
        submitLabel: 'SUBMIT FINAL VERDICT',
        successLines: ['FINAL VERDICT ACCEPTED', 'LEVEL 05 — COMPLETED'],
      },
    ],
  },
  {
    id: 2,
    title: 'The Encrypted Trail',
    levels: [
      {
        number: 1, title: 'Static on the Line', difficulty: 'Easy', reward: 100,
        description: 'The wiretap captured nothing but clicks and silences. The technician says the rhythm is too regular to be interference.',
        briefing: 'The clicks are a message. Decode the rhythm.',
        evidence: '.--  ..  .-.  .', evidenceNote: 'Wiretap log, channel 4',
      },
      {
        number: 2, title: 'The Intercepted Message', difficulty: 'Medium', reward: 150,
        description: "An encrypted transmission was intercepted shortly before the investigation began. The sender's identity remains unknown. Examine the evidence and determine the hidden message.",
        briefing: 'An intercepted transmission contains a hidden message that may reveal the next checkpoint.',
        evidence: 'WKLV LV D WHVW PHVVDJH', evidenceNote: 'Intercepted transmission, 23:02',
      },
      {
        number: 3, title: 'Base of Operations', difficulty: 'Medium', reward: 200,
        description: 'A string of characters was found in the margin of a train timetable. It is not a code anyone at the station recognises, but it ends where it begins: with a base.',
        briefing: 'The note names a place. Decode it from its base.',
        evidence: 'VEhFIFZBVUxU', evidenceNote: 'Margin of a train timetable',
      },
      {
        number: 4, title: 'The Mirror Cipher', difficulty: 'Hard', reward: 250,
        description: 'The final transmission on the trail was written backwards through the alphabet. Whoever sent it knew we would be following from the other side.',
        briefing: 'A reflects to Z. B reflects to Y. Find what follows you.',
        evidence: 'HSZWLD', evidenceNote: 'Last transmission on the trail',
      },
    ],
  },
  {
    id: 3,
    title: 'The Ghost File',
    levels: [
      {
        number: 1, title: 'Missing Persons', difficulty: 'Easy', reward: 100,
        description: 'The personnel file has a photograph, a signature and an employee number — and no person. The registry printout lists only six pairs of characters.',
        briefing: 'Six pairs of characters. Who does the file belong to?',
        evidence: '4E 4F 42 4F 44 59', evidenceNote: 'Registry printout',
      },
      {
        number: 2, title: 'The Erased Record', difficulty: 'Medium', reward: 150,
        description: 'Somebody erased an entry from the archive, but the archive keeps a rotated copy of everything it loses. Thirteen steps separate the copy from the truth.',
        briefing: 'The archive kept a rotated copy. Turn it back.',
        evidence: 'ERPBEQ QRYRGRQ', evidenceNote: 'Archive shadow copy',
      },
      {
        number: 3, title: 'Signal in the Noise', difficulty: 'Medium', reward: 200,
        description: 'A handwritten note was recovered from the ghost’s desk. It reads like instructions, but the instructions are not the message.',
        briefing: 'Read only what begins each word.',
        evidence: 'Under Night, Keep Nothing Open. Wait Now.', evidenceNote: 'Recovered handwritten note',
      },
      {
        number: 4, title: 'The Last Sighting', difficulty: 'Hard', reward: 250,
        description: 'The ghost was seen once, by the water. The location was enciphered with a keyword — the same name that appears on every call.',
        briefing: 'A keyed shift hides the place. The key is the name on every call.',
        evidence: 'VIQV', evidenceNote: 'Key: the caller',
      },
    ],
  },
  {
    id: 4,
    title: 'The False Trail',
    levels: [
      {
        number: 1, title: 'The Decoy', difficulty: 'Easy', reward: 100,
        description: 'An old handset was left where we would find it, its keypad worn on only four buttons. The pattern of presses was written down beside it.',
        briefing: 'Old phones spelled with repeated presses. What did the decoy type?',
        evidence: '33 · 777 · 777 · 666 · 777', evidenceNote: 'Written beside the handset',
      },
      {
        number: 2, title: 'Forged Signatures', difficulty: 'Medium', reward: 150,
        description: 'The forger signed every document with a call sign instead of a name. Read together, they admit to what happened.',
        briefing: 'Radio call signs. Spell the admission.',
        evidence: 'LIMA · ECHO · ALFA · KILO', evidenceNote: 'Signatures, four documents',
      },
      {
        number: 3, title: 'The Wrong Address', difficulty: 'Medium', reward: 200,
        description: 'The envelope was addressed with numbers instead of a street. Our clerks counted from A. The sender counted from the other end.',
        briefing: 'Count the alphabet from Z. What happened to the envelope?',
        evidence: '8 · 22 · 13 · 7', evidenceNote: 'Envelope, no return address',
      },
      {
        number: 4, title: 'Double Agent', difficulty: 'Hard', reward: 250,
        description: 'The final memo was written on two rails: every other letter on the top line, the rest below. Put them back together and the trail stops being false.',
        briefing: 'A two-rail fence. Rebuild the warning.',
        evidence: 'MLISD OENIE', evidenceNote: 'Memo, two lines',
      },
    ],
  },
  {
    id: 5,
    title: 'The Final Key',
    levels: [
      {
        number: 1, title: 'The Invitation', difficulty: 'Easy', reward: 100,
        description: 'An envelope with no stamp arrived at the desk. Inside: a single line of characters and a card bearing the eye from the phone screen.',
        briefing: 'The invitation is encoded. What does it ask you to do?',
        evidence: 'UExBWQ==', evidenceNote: 'Card inside an unstamped envelope',
      },
      {
        number: 2, title: 'The Combination', difficulty: 'Medium', reward: 200,
        description: 'The safe has a two-digit dial. Scratched on the door: “Every case, every level.” The investigators who opened it before you all said the answer was on the desk.',
        briefing: 'Add the case numbers on the desk, then multiply by the levels in each case.',
        evidence: '( 1 + 2 + 3 + 4 + 5 ) × 4', evidenceNote: 'Scratched on the safe door',
      },
      {
        number: 3, title: 'The Last Door', difficulty: 'Hard', reward: 250,
        description: 'The final door carries a brass plate engraved in hexadecimal. Engraved underneath, smaller: “Read it and it is already too late.”',
        briefing: 'The brass plate is engraved in hexadecimal.',
        evidence: '47 41 4D 45 20 4F 56 45 52', evidenceNote: 'Brass plate on the last door',
      },
      {
        number: 4, title: 'The Final Key', difficulty: 'Hard', reward: 300,
        description: 'Everything leads here. The last message is mirrored through the alphabet like the trail before it. Whoever reads it ends the game — or begins the next one.',
        briefing: 'The last message is mirrored. Name what comes next.',
        evidence: 'VMWTZNV', evidenceNote: 'Final message',
      },
    ],
  },
  {
    id: 6,
    title: 'The Unknown File',
    levels: [
      {
        number: 1, title: 'Blank Letterhead', difficulty: 'Easy', reward: 100,
        description: 'The sixth file arrived after the others, with no case officer and no origin. Its first page is a letterhead held up to a mirror.',
        briefing: 'Someone wrote this to be read in a mirror.',
        evidence: 'ECNEDIVE', evidenceNote: 'Letterhead, otherwise blank',
      },
      {
        number: 2, title: 'The Missing Page', difficulty: 'Medium', reward: 150,
        description: 'Page two was torn out. What remains is a column of numbers pressed through from the sheet above it — the writer pushed hard on one word.',
        briefing: 'Each number stands for a letter. Who saw what happened?',
        evidence: '23 · 9 · 20 · 14 · 5 · 19 · 19', evidenceNote: 'Impression left on the page beneath',
      },
      {
        number: 3, title: 'Unregistered Number', difficulty: 'Medium', reward: 200,
        description: 'A sticky note on the inside cover: six letters, shifted. The same note appears in the evidence log next to a phone recovered at the scene.',
        briefing: 'Three steps back through the alphabet. Who were they?',
        evidence: 'FDOOHU', evidenceNote: 'Sticky note, inside cover',
      },
      {
        number: 4, title: 'The Last Name', difficulty: 'Hard', reward: 300,
        description: 'The final sheet in the file is typed in a code the archive uses for sealed records. Whoever opens it knows who they are looking for.',
        briefing: 'A sealed record, encoded from its base. Name what you are hunting.',
        evidence: 'VEhFIEtJTExFUg==', evidenceNote: 'Sealed record, final sheet',
      },
    ],
  },
];

export const LEVELS_PER_CASE = 4;

export function getCase(id: number): CaseDef | undefined {
  return CASES.find((c) => c.id === id);
}

export function getLevel(caseId: number, levelNumber: number): LevelDef | undefined {
  return getCase(caseId)?.levels.find((l) => l.number === levelNumber);
}

/** Stable id for progress/reward bookkeeping, e.g. "case-02/level-02". */
export function levelKey(caseId: number, levelNumber: number): string {
  return `case-${pad2(caseId)}/level-${pad2(levelNumber)}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Route params arrive as strings ("3", "03"); anything else is invalid. */
export function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * "Powerful Hint" text per level (case-level): the method, never the answer.
 * Mock content — replace with the final hints together with the final questions.
 */


export function levelScore(l: LevelDef): number {
  return l.score ?? LEVEL_SCORE[l.number] ?? 0;
}

export function caseFragmentLength(caseId: number): number {
  return CASE_FRAGMENT_LENGTH[caseId] ?? 0;
}

/** Max score across all cases (shown in Admin). */
export const MAX_SCORE = CASES.reduce((n, c) => n + c.levels.reduce((m, l) => m + levelScore(l), 0), 0);

export function normaliseAnswer(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
