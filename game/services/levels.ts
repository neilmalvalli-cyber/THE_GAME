// LevelService — MOCK backend only. Supabase builds check answers on the server
// (game_submit / game_answer_ok); there, data/secrets.ts is an empty stub and never reaches the browser.
import { getLevel, normaliseAnswer, type AnswerType } from '../data/cases';
import { ANSWERS } from '@/game/data/secrets';

export type AnswerValidator = (caseId: number, level: number, answer: string) => boolean;

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');
const timePart = (s: string) => normaliseAnswer(s).replace(/UTC$/, '');

/**
 * One rule set, mirrored in SQL (game_answer_ok):
 *  - text / numeric / choice: letters and digits only, case ignored; numbers ignore leading zeros
 *  - fields: "a|b|c" — every part must match on its own (the last part may omit "UTC")
 *  - witness: "2", "witness 2", "WITNESS 02" are the same answer
 */
export function answerMatches(given: string, expected: string, type: AnswerType = 'text'): boolean {
  if (type === 'fields') {
    const g = given.split('|'), e = expected.split('|');
    if (g.length !== e.length) return false;
    return e.every((part, i) => {
      const isTime = /\d{1,2}:\d{2}/.test(part);
      const a = isTime ? timePart(g[i]) : normaliseAnswer(g[i]);
      return a !== '' && a === (isTime ? timePart(part) : normaliseAnswer(part));
    });
  }
  if (type === 'witness') {
    const w = (s: string) => stripZeros(normaliseAnswer(s).replace(/^WITNESS/, ''));
    return w(given) !== '' && w(given) === w(expected);
  }
  const g = normaliseAnswer(given);
  if (!g) return false;
  const e = normaliseAnswer(expected);
  return g === e || (/^\d+$/.test(e) && stripZeros(g) === stripZeros(e));
}

const mockValidator: AnswerValidator = (caseId, level, answer) => {
  const def = getLevel(caseId, level);
  const expected = ANSWERS[`${caseId}-${level}`];
  if (!def || expected == null) return false;
  return answerMatches(answer, expected, def.answerType);
};

export let validator: AnswerValidator = mockValidator;
export function setAnswerValidator(v: AnswerValidator) { validator = v; }
export const checkAnswer: AnswerValidator = (c, l, a) => validator(c, l, a);
