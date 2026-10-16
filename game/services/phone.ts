// Passcode verification for the evidence phone. Asynchronous on purpose: the UI already
// waits for an answer, so moving the check to a server is a change to this file only.
//
// Supabase backend: the server verifies the code (game_verify_phone). Mock backend: the
// comparison happens in the browser against data/secrets.ts — fine for a demo only.
import { CODE_LENGTH } from '../data/phone';
import { UNLOCK_CODE } from '@/game/data/secrets';
import { useGameStore } from '../state/gameStore';
import { isServerBackend, verifyPhoneRemote } from './backend';
import { CASES, caseFragmentLength } from '../data/cases';
import { env } from '../env';

export type VerifyResult = { ok: true } | { ok: false; reason: 'incomplete' | 'wrong' };

export async function verifyPhoneCode(code: string): Promise<VerifyResult> {
  // strings, never numbers: "042719583" must not become 42719583
  if (!/^\d+$/.test(code) || code.length !== CODE_LENGTH) return { ok: false, reason: 'incomplete' };
  if (isServerBackend) return verifyPhoneRemote(code);
  await new Promise((r) => setTimeout(r, 260)); // the device "thinks"
  return code === UNLOCK_CODE ? { ok: true } : { ok: false, reason: 'wrong' };
}

/**
 * The digits a SOLVED case pays out (mock: sliced from the code in case order 1 → 6).
 * PROTOTYPE: the whole code is in the bundle, so this is not secret. In production the
 * server returns a fragment only to a team that has solved that case.
 */
export function getCaseFragment(caseId: number): string {
  // the server pays a fragment only to a team that solved the case
  if (isServerBackend) return useGameStore.getState().fragments[String(caseId)] ?? '';
  let at = 0;
  for (const c of CASES) {
    const n = caseFragmentLength(c.id);
    if (c.id === caseId) return UNLOCK_CODE.slice(at, at + n);
    at += n;
  }
  return '';
}

if (env.DEV && !isServerBackend) {
  const total = CASES.reduce((n, c) => n + caseFragmentLength(c.id), 0);
  if (total !== CODE_LENGTH) console.warn(`[phone] case fragments add up to ${total} digits, the code has ${CODE_LENGTH}`);
}
