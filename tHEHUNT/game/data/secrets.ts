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
  // Case 1
  '1-1': 'THE START IS HIDDEN',
  '1-2': 'KEY',
  '1-3': 'LIGHT',
  '1-4': 'DESK',
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
  '1-1': 'It is written backwards. Read it from the last letter to the first.',
  '1-2': 'Only the first letter of each surname matters.',
  '1-3': 'A = 1, B = 2 … Z = 26.',
  '1-4': 'Eight-bit binary. Each group is one ASCII character.',
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

export const UNLOCK_CODE = '042719583';
