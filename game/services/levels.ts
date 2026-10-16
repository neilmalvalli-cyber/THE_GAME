// LevelService — MOCK backend only. Supabase builds check answers on the server
// (game_submit); there, data/secrets.ts is an empty stub and never reaches the browser.
import { getLevel, normaliseAnswer } from '../data/cases';
import { ANSWERS } from '@/game/data/secrets';

export type AnswerValidator = (caseId: number, level: number, answer: string) => boolean;

const mockValidator: AnswerValidator = (caseId, level, answer) => {
  const def = getLevel(caseId, level);
  if (!def) return false;
  const given = normaliseAnswer(answer);
  if (!given) return false;
  const expected = ANSWERS[`${caseId}-${level}`];
  if (expected == null) return false;
  if (def.answerType === 'numeric') return given.replace(/^0+(?=\d)/, '') === normaliseAnswer(expected).replace(/^0+(?=\d)/, '');
  return given === normaliseAnswer(expected);
};

export let validator: AnswerValidator = mockValidator;
export function setAnswerValidator(v: AnswerValidator) { validator = v; }
export const checkAnswer: AnswerValidator = (c, l, a) => validator(c, l, a);
