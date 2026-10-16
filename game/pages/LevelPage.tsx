// /team/case/:caseId/level/:levelId — one shared page for all 24 mock levels.
// Content comes from data/cases.ts (title, briefing, evidence, answer type, rewards).
// Validation is local mock logic only; real answers must be checked server-side.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getCase, getLevel, levelKey, levelScore, pad2, parseId } from '../data/cases';
import { getCaseFragment } from '../services/phone';
import { GENERIC_HINT, useGameStore } from '../state/gameStore';
import { paths } from '../orchestration/routes';
import { playStamp } from '../audio/uiAudio';
import { scheduleFirstSolveDeadDrop } from '../services/intelFeed';
import { IconArrowLeft } from '../ui/icons';
import { useLeave } from '../lib/useLeave';
import './level.css';
import { submitAnswer, usePowerfulHint, useSkipToken } from '../services/backend';

type Feedback = { kind: 'error' | 'success' | 'info'; text: string } | null;

export function LevelPage() {
  const { caseId: rc, levelId: rl } = useParams();
  const caseId = parseId(rc)!, level = parseId(rl)!;
  const def = getCase(caseId)!, lvl = getLevel(caseId, level)!;
  const navigate = useNavigate();
  const location = useLocation();
  const key = levelKey(caseId, level);
  const completedAt = useGameStore((s) => s.progress.completed[key]);
  const skippedAt = useGameStore((s) => s.progress.skipped[key]);
  const hintShown = useGameStore((s) => s.effects.hints.includes(key));
  const hintText = useGameStore((s) => s.effects.hintTexts[key]);
  const hintsOwned = useGameStore((s) => s.inventory.powerful_hint ?? 0);
  const skipsOwned = useGameStore((s) => s.inventory.skip_token ?? 0);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const selectLevel = useGameStore((s) => s.selectLevel);
  const submitting = useRef(false);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [stamped, setStamped] = useState<'fresh' | 'static' | null>(completedAt ? 'static' : null);
  const [shake, setShake] = useState(0);
  const [solvedCase, setSolvedCase] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const casePath = paths.case(caseId);
  const [leaving, leave] = useLeave(200);

  // a deep link selects this level in its case, so Back to Case lands on it
  useEffect(() => { selectLevel(caseId, level); }, [caseId, level, selectLevel]);
  useEffect(() => { setAnswer(''); setFeedback(null); setStamped(useGameStore.getState().progress.completed[key] ? 'static' : null); }, [key]);

  const backToCase = () => leave(() => {
    const from = (location.state as { from?: string } | null)?.from;
    if (from === casePath && window.history.length > 1) navigate(-1); else navigate(casePath);
  });
  const backToDesk = () => leave(() => navigate(paths.desk));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.activeElement !== input.current) backToCase(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!answer.trim()) { setFeedback({ kind: 'error', text: 'Enter an answer before submitting.' }); input.current?.focus(); return; }
    submitting.current = true;
    let r: Awaited<ReturnType<typeof submitAnswer>>;
    try { r = await submitAnswer(caseId, level, answer); } finally { submitting.current = false; }
    if (r.error) { setFeedback({ kind: 'error', text: r.error }); return; }
    if (!r.correct) {
      setFeedback({ kind: 'error', text: 'Incorrect. The evidence does not support that answer — examine it again.' });
      setShake((n) => n + 1);
      input.current?.select();
      return;
    }
    if (r.alreadyCompleted) {
      setFeedback({ kind: 'info', text: 'Correct — this level was already verified. Rewards are paid once.' });
      return;
    }
    setStamped('fresh');
    window.setTimeout(playStamp, 260);
    // the stamp lands below the form: bring it into view on short screens
    window.setTimeout(() => document.querySelector('.verified')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
    setFeedback({ kind: 'success', text: `Verified. +${r.scoreAwarded} score · ${r.awarded} coins credited to your wallet.` });
    scheduleFirstSolveDeadDrop();
    // the last level of the case: the file is solved and pays its code fragment
    if (r.caseSolved) window.setTimeout(() => setSolvedCase(getCaseFragment(caseId)), 1100);
  };

  const useHint = async () => {
    const r = await usePowerfulHint(caseId, level);
    if (!r.ok) setFeedback({ kind: 'error', text: r.message });
  };
  const useSkip = async () => {
    setConfirmSkip(false);
    const r = await useSkipToken(caseId, level);
    setFeedback({ kind: r.ok ? 'info' : 'error', text: r.message });
    if (r.ok && r.caseSolved) window.setTimeout(() => setSolvedCase(getCaseFragment(caseId)), 400);
  };

  return (
    <div className={`level-page${leaving ? ' is-leaving' : ''}`} role="main">
      <div className="level-page__scrim" aria-hidden="true" />
      <article className={`dossier${stamped ? ' dossier--stamped' : ''}`} aria-labelledby="level-title">
        <div className="dossier__clip" aria-hidden="true" />
        <nav className="dossier__nav">
          <button type="button" className="btn btn--ghost" onClick={backToCase}><IconArrowLeft />Back to Case</button>
          <button type="button" className="btn btn--ghost" onClick={backToDesk}>Back to Desk</button>
        </nav>

        <header className="dossier__head">
          <div className="dossier__case">CASE {pad2(caseId)} — {def.title.toUpperCase()}</div>
          <h1 id="level-title" className="dossier__title">LEVEL {pad2(level)} — {lvl.title.toUpperCase()}</h1>
          <dl className="dossier__meta">
            <div><dt>Difficulty</dt><dd>{lvl.difficulty}</dd></div>
            <div><dt>Score</dt><dd>{levelScore(lvl)} pts</dd></div>
            <div><dt>Reward</dt><dd>{lvl.reward} coins</dd></div>
            <div><dt>Status</dt><dd className={completedAt || skippedAt ? 'is-done' : ''}>{completedAt ? 'Completed' : skippedAt ? 'Skipped' : 'Available'}</dd></div>
          </dl>
        </header>

        <section className="dossier__section">
          <h2>Mission briefing</h2>
          <p className="dossier__brief">“{lvl.briefing}”</p>
        </section>

        <section className="dossier__section">
          <h2>Evidence</h2>
          <figure className="evidence">
            <pre className="evidence__strip">{lvl.evidence}</pre>
            {lvl.evidenceAssets?.map((src) => <img key={src} className="evidence__img" src={src} alt="" loading="lazy" />)}
            {lvl.evidenceNote && <figcaption>{lvl.evidenceNote}</figcaption>}
          </figure>
        </section>

        {!completedAt && (hintShown || hintsOwned > 0 || (!skippedAt && skipsOwned > 0)) && (
          <section className="dossier__section powerups" aria-label="Power-ups" data-testid="level-powerups">
            <h2>Power-ups</h2>
            {hintShown ? (
              <p className="powerups__hint" data-testid="powerful-hint"><b>Powerful Hint · </b>{hintText ?? GENERIC_HINT}</p>
            ) : hintsOwned > 0 && (
              <button type="button" className="btn btn--ghost" onClick={useHint}>Use Powerful Hint ({hintsOwned})</button>
            )}
            {!skippedAt && skipsOwned > 0 && (confirmSkip ? (
              <span className="powerups__confirm">Skip this level? No solve points are awarded.
                <button type="button" className="btn btn--primary" onClick={useSkip}>Confirm skip</button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmSkip(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmSkip(true)}>Use Skip Token ({skipsOwned})</button>
            ))}
          </section>
        )}

        <form className="dossier__section answer" onSubmit={submit} noValidate>
          <h2><label htmlFor="answer">Answer</label></h2>
          <div key={shake} className={`answer__row${shake ? ' is-shake' : ''}`}>
            {lvl.answerType === 'choice' && lvl.choices ? (
              <div className="answer__choices" role="radiogroup" aria-label="Choose an answer">
                {lvl.choices.map((c) => (
                  <label key={c} className={`answer__choice${answer === c ? ' is-on' : ''}`}>
                    <input type="radio" name="choice" value={c} checked={answer === c} onChange={() => { setAnswer(c); if (feedback?.kind === 'error') setFeedback(null); }} /> {c}
                  </label>
                ))}
              </div>
            ) : (
              <input id="answer" ref={input} className="answer__input" value={answer} onChange={(e) => { setAnswer(e.target.value); if (feedback?.kind === 'error') setFeedback(null); }}
                inputMode={lvl.answerType === 'numeric' ? 'numeric' : 'text'}
                placeholder={lvl.answerType === 'numeric' ? 'Enter a number' : 'Enter your answer'} autoComplete="off" spellCheck={false} aria-describedby="answer-feedback" aria-invalid={feedback?.kind === 'error'} />
            )}
            <button type="submit" className="btn btn--primary answer__submit">Submit Answer</button>
          </div>
          <p id="answer-feedback" className={`answer__feedback${feedback ? ` is-${feedback.kind}` : ''}`} role={feedback?.kind === 'error' ? 'alert' : 'status'}>
            {feedback?.text ?? ''}
          </p>
          <p className="answer__fine">Prototype: answers are checked locally against mock data and are not secure.</p>
        </form>

        {stamped && (
          <div className={`verified verified--${stamped}`} aria-hidden="true"><span>VERIFIED</span></div>
        )}
      </article>
      {solvedCase !== null && (
        <div className="case-solved" role="status" data-testid="case-solved">
          <div className="case-solved__card">
            <div className="case-solved__case">CASE {pad2(caseId)}</div>
            <div className="case-solved__stamp">SOLVED</div>
            <div className="case-solved__frag">Fragment recovered: <b>{solvedCase.split('').join(' ')}</b></div>
            <p>The digits are written on the file. Collect all nine to open the phone.</p>
            <div className="case-solved__actions">
              <button type="button" className="btn btn--primary" onClick={backToDesk}>Back to Desk</button>
              <button type="button" className="btn btn--ghost" onClick={() => setSolvedCase(null)}>Stay here</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
