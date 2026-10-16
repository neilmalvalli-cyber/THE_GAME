// ════════════════════════════════════════════════════════════════════════════
//  THE GAME — SECRETS. Edit this file to set the real puzzle.
//
//  ANSWERS      one per level, keyed 'case-level' (case 1–6, level 1–4).
//               Compared after normalisation: case, spaces and punctuation ignored;
//               numeric answers also ignore leading zeros.
//  HINTS        the Powerful Hint for each level (a method, never the answer).
//  UNLOCK_CODE  the phone passcode, as a STRING. Its digits are paid out by the
//               solved cases in order: CASE_FRAGMENT_LENGTH in data/cases.ts says how
//               many digits each case pays (they must add up to the code's length).
//
//  Mock build (NEXT_PUBLIC_GAME_BACKEND=mock): checked in the browser — NOT secure.
//  Supabase build: this file is replaced by an empty stub (next.config.ts) and never
//  reaches a browser. Run `npm run seed` to write supabase/seed/the_game_seed.sql from
//  this file and data/cases.ts, then run that SQL in Supabase.
// ════════════════════════════════════════════════════════════════════════════

export const ANSWERS: Record<string, string> = {
  // Case 1 — THE FRACTURED TRUTH
  '1-1': 'cv raman',
  '1-2': 'honeypot',
  '1-3': '2',
  '1-4': 'archive_02|v3|14:29:08 UTC', // account | version | time — all three must match
  '1-5': '2', // the lying witness (accepts 2, witness 2, witness 02)
  // Case 2
  '2-1': 'WIRE',
  '2-2': 'THIS IS A TEST MESSAGE',
  '2-3': 'THE VAULT',
  '2-4': 'SHADOW',
  // Case 3
  '3-1': 'NOBODY',
  '3-2': 'RECORD DELETED',
  '3-3': 'UNKNOWN',
  '3-4': 'PIER',
  // Case 4
  '4-1': 'ERROR',
  '4-2': 'LEAK',
  '4-3': 'SENT',
  '4-4': 'MOLE INSIDE',
  // Case 5
  '5-1': 'PLAY',
  '5-2': '60',
  '5-3': 'GAME OVER',
  '5-4': 'ENDGAME',
  // Case 6
  '6-1': 'EVIDENCE',
  '6-2': 'WITNESS',
  '6-3': 'CALLER',
  '6-4': 'THE KILLER',
};

export const HINTS: Record<string, string> = {
  '1-1': 'Think of the Indian physicist whose work on the scattering of light won a Nobel Prize, and of the campus building that carries his name.',
  '1-2': 'Read the card\'s riddle literally: a container that "carries" something sweet. The keyword is the name, not the sweetness.',
  '1-3': 'Do not trust the STATUS column. Look for the inconsistency between what the log reports and what the recovered note says about tampering.',
  '1-4': 'Separate successful events from failed ones, and check each backup\'s integrity before trusting its version number. Match the time to the successful event.',
  '1-5': 'Compare each witness\'s statement with the visual clues in the recording: only one account contradicts what the evidence shows.',
  '2-1': 'Morse code: dots and dashes, one letter per group.',
  '2-2': 'A Caesar shift. Try moving every letter three places back.',
  '2-3': 'Base64. The trailing letters give it away.',
  '2-4': 'Atbash: the alphabet reversed (A↔Z, B↔Y …).',
  '3-1': 'Hexadecimal ASCII: two characters per letter.',
  '3-2': 'ROT13: rotate each letter thirteen places.',
  '3-3': 'An acrostic. Take the first letter of every word.',
  '3-4': 'A Vigenère cipher. The key is printed on every file of this case.',
  '4-1': 'Multi-tap phone keypad: the digit is the key, the count is the letter.',
  '4-2': 'NATO phonetic alphabet: take the first letter of each word.',
  '4-3': 'Reverse numbering: Z = 1, Y = 2 …',
  '4-4': 'A rail fence with two rails. Interleave the two halves.',
  '5-1': 'Base64 — the padding at the end is the clue.',
  '5-2': 'Plain arithmetic. Brackets first.',
  '5-3': 'Hexadecimal ASCII; 20 is a space.',
  '5-4': 'Atbash, the mirrored alphabet.',
  '6-1': 'Mirror writing: reverse the letters.',
  '6-2': 'A = 1, B = 2 … Z = 26.',
  '6-3': 'Caesar shift of three, backwards.',
  '6-4': 'Base64 again. Decode it and read the name.',
};

/** Shown to a team only AFTER it solves the level (Supabase: sent by the server, never in the bundle). */
export const DEBRIEFS: Record<string, string> = {
  '1-4': 'Account: ARCHIVE_02 — the last successful access to REP-09 is recorded as event E105.\nVersion: V3 — V3 is the last verified preserved version. V4 failed its integrity check.\nTime: 14:29:08 UTC — event E105 records the successful access.',
};

export const UNLOCK_CODE = '042719583';
