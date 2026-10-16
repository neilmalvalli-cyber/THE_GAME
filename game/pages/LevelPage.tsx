// /team/case/:caseId/level/:levelId — one shared page for every level of every case.
// Content comes from data/cases.ts (sections, evidence, answer type, attempt limit, rewards).
// Answers are checked by the backend (server-side with Supabase; locally in the mock).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getCase, getLevel, levelKey, levelScore, pad2, parseId, type LevelSection } from '../data/cases';
import { getCaseFragment } from '../services/phone';
import { GENERIC_HINT, useGameStore } from '../state/gameStore';
import { paths } from '../orchestration/routes';
import { playStamp } from '../audio/uiAudio';
import { scheduleFirstSolveDeadDrop } from '../services/intelFeed';
import { IconArrowLeft } from '../ui/icons';
import { useLeave } from '../lib/useLeave';
import './level.css';
import { submitAnswer, revealPowerfulHint, spendSkipToken } from '../services/backend';

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
  const attemptsUsed = useGameStore((s) => s.progress.attempts?.[key] ?? 0);
  const debrief = useGameStore((s) => s.debriefs?.[key]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const max = lvl.maxAttempts;
  const attemptsLeft = max ? Math.max(0, max - attemptsUsed) : null;
  const locked = !!max && attemptsUsed >= max && !completedAt && !skippedAt;
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
  useEffect(() => { setAnswer(''); setFieldValues({}); setFeedback(null); setStamped(useGameStore.getState().progress.completed[key] ? 'static' : null); }, [key]);

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
    if (submitting.current || locked) return;
    // the whole final answer goes as one submission (several fields = one attempt)
    const value = lvl.answerType === 'fields' && lvl.fields
      ? lvl.fields.map((f) => (fieldValues[f.key] ?? '').trim()).join('|')
      : answer;
    const missing = lvl.answerType === 'fields' ? lvl.fields?.some((f) => !(fieldValues[f.key] ?? '').trim()) : !answer.trim();
    if (missing) {
      setFeedback({ kind: 'error', text: lvl.answerType === 'fields' ? 'Fill in all three fields before submitting.' : lvl.answerType === 'witness' ? 'Select a witness before submitting.' : 'Enter an answer before submitting.' });
      input.current?.focus();
      return;
    }
    submitting.current = true;
    let r: Awaited<ReturnType<typeof submitAnswer>>;
    try { r = await submitAnswer(caseId, level, value); } finally { submitting.current = false; }
    if (r.error) { setFeedback({ kind: 'error', text: r.error }); return; }
    if (r.locked && !r.correct) {
      setFeedback({ kind: 'error', text: 'ATTEMPTS EXHAUSTED — THIS INVESTIGATION IS LOCKED' });
      setShake((n) => n + 1);
      return;
    }
    if (!r.correct) {
      setFeedback({ kind: 'error', text: r.attemptsRemaining != null
        ? `INCORRECT ANSWER — ${r.attemptsRemaining} ATTEMPT${r.attemptsRemaining === 1 ? '' : 'S'} REMAINING`
        : 'Incorrect. The evidence does not support that answer — examine it again.' });
      setShake((n) => n + 1);
      input.current?.select();
      return;
    }
    if (r.alreadyCompleted) {
      setFeedback({ kind: 'info', text: 'ANSWER VERIFIED — this investigation is already completed. Rewards are paid once.' });
      return;
    }
    setStamped('fresh');
    window.setTimeout(playStamp, 260);
    // the stamp lands below the form: bring it into view on short screens
    window.setTimeout(() => document.querySelector('.verified')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
    setFeedback({ kind: 'success', text: `${lvl.successLines ? `${lvl.successLines[0]} · ${lvl.successLines[1]} · ` : 'Verified. '}+${r.scoreAwarded} score · ${r.awarded} coins credited to your wallet.` });
    scheduleFirstSolveDeadDrop();
    // the last level of the case: the file is solved and pays its code fragment
    if (r.caseSolved) window.setTimeout(() => setSolvedCase(getCaseFragment(caseId)), 1100);
  };

  const onHint = async () => {
    const r = await revealPowerfulHint(caseId, level);
    if (!r.ok) setFeedback({ kind: 'error', text: r.message });
  };
  const onSkip = async () => {
    setConfirmSkip(false);
    const r = await spendSkipToken(caseId, level);
    setFeedback({ kind: r.ok ? 'info' : 'error', text: r.message });
    if (r.ok && r.caseSolved) window.setTimeout(() => setSolvedCase(getCaseFragment(caseId)), 400);
  };

  return (
    <div className={`level-page${leaving ? ' is-leaving' : ''}`} role="main">
      <div className="level-page__scrim" aria-hidden="true" />
      <article className={`dossier${stamped ? ' dossier--stamped' : ''}`} aria-labelledby="level-title">
        <div className="dossier__clip" aria-hidden="true" />
        <nav className="dossier__nav">
          <button type="button" className="btn btn--ghost" onClick={backToCase}><IconArrowLeft />Back to Case Files</button>
          <button type="button" className="btn btn--ghost" onClick={backToDesk}>Back to Desk</button>
        </nav>

        <header className="dossier__head">
          <div className="dossier__case">CASE FILE {pad2(caseId)} — {def.title.toUpperCase()}{lvl.classification ? <span className="dossier__class"> · CLASSIFICATION: {lvl.classification}</span> : null}</div>
          <h1 id="level-title" className="dossier__title">LEVEL {pad2(level)} — {lvl.title.toUpperCase()}</h1>
          <dl className="dossier__meta">
            <div><dt>Difficulty</dt><dd>{lvl.difficulty}</dd></div>
            <div><dt>Score</dt><dd>{levelScore(lvl)} pts</dd></div>
            <div><dt>Reward</dt><dd>{lvl.reward} coins</dd></div>
            <div><dt>Status</dt><dd className={completedAt || skippedAt ? 'is-done' : locked ? 'is-locked' : ''} data-testid="level-status">{completedAt ? 'Completed' : skippedAt ? 'Skipped' : locked ? 'Attempts exhausted' : attemptsUsed > 0 ? 'In progress' : 'Not started'}</dd></div>
            {attemptsLeft !== null && <div><dt>Attempts</dt><dd className={locked ? 'is-locked' : ''} data-testid="attempts-left">{attemptsLeft} / {max} left</dd></div>}
          </dl>
        </header>

        {lvl.sections ? lvl.sections.map((sec, i) => <Section key={i} sec={sec} />) : (
          <>
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
          </>
        )}

        {!completedAt && (hintShown || hintsOwned > 0 || (!skippedAt && skipsOwned > 0)) && (
          <section className="dossier__section powerups" aria-label="Power-ups" data-testid="level-powerups">
            <h2>Power-ups</h2>
            {hintShown ? (
              <p className="powerups__hint" data-testid="powerful-hint"><b>Powerful Hint · </b>{hintText ?? GENERIC_HINT}</p>
            ) : hintsOwned > 0 && (
              <button type="button" className="btn btn--ghost" onClick={onHint}>Use Powerful Hint ({hintsOwned})</button>
            )}
            {!skippedAt && skipsOwned > 0 && (confirmSkip ? (
              <span className="powerups__confirm">Skip this level? No solve points are awarded.
                <button type="button" className="btn btn--primary" onClick={onSkip}>Confirm skip</button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmSkip(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmSkip(true)}>Use Skip Token ({skipsOwned})</button>
            ))}
          </section>
        )}

        <form className="dossier__section answer" onSubmit={submit} noValidate>
          <h2><label htmlFor="answer">{lvl.question ?? 'Final answer'}</label></h2>
          {lvl.formatHint && <p className="answer__format">Expected format: <code>{lvl.formatHint}</code></p>}
          <div key={shake} className={`answer__row${shake ? ' is-shake' : ''}${lvl.answerType === 'fields' || lvl.answerType === 'witness' ? ' answer__row--stack' : ''}`}>
            {lvl.answerType === 'fields' && lvl.fields ? (
              <div className="answer__fields">
                {lvl.fields.map((f, i) => (
                  <label key={f.key} className="answer__field"><span>{f.label}</span>
                    <input id={i === 0 ? 'answer' : undefined} ref={i === 0 ? input : undefined} className="answer__input" value={fieldValues[f.key] ?? ''} placeholder={f.placeholder}
                      onChange={(e) => { setFieldValues((v) => ({ ...v, [f.key]: e.target.value })); if (feedback?.kind === 'error') setFeedback(null); }}
                      autoComplete="off" spellCheck={false} disabled={locked} name={`field-${f.key}`} />
                  </label>
                ))}
              </div>
            ) : lvl.answerType === 'witness' && lvl.choices ? (
              <div className="answer__witnesses" role="radiogroup" aria-label="Select the witness">
                {lvl.choices.map((c) => (
                  <label key={c} className={`witness-card${answer === c ? ' is-on' : ''}`}>
                    <input type="radio" name="witness" value={c} checked={answer === c} disabled={locked} onChange={() => { setAnswer(c); if (feedback?.kind === 'error') setFeedback(null); }} />
                    <span className="witness-card__label">WITNESS</span><span className="witness-card__no">{c.padStart(2, '0')}</span>
                  </label>
                ))}
              </div>
            ) : lvl.answerType === 'choice' && lvl.choices ? (
              <div className="answer__choices" role="radiogroup" aria-label="Choose an answer">
                {lvl.choices.map((c) => (
                  <label key={c} className={`answer__choice${answer === c ? ' is-on' : ''}`}>
                    <input type="radio" name="choice" value={c} checked={answer === c} onChange={() => { setAnswer(c); if (feedback?.kind === 'error') setFeedback(null); }} /> {c}
                  </label>
                ))}
              </div>
            ) : (
              <input id="answer" ref={input} className="answer__input" value={answer} onChange={(e) => { setAnswer(e.target.value); if (feedback?.kind === 'error') setFeedback(null); }}
                inputMode={lvl.answerType === 'numeric' ? 'numeric' : 'text'} type={lvl.answerType === 'numeric' ? 'number' : 'text'} disabled={locked}
                placeholder={lvl.placeholder ?? (lvl.answerType === 'numeric' ? 'Enter a number' : 'Enter your answer')} autoComplete="off" spellCheck={false} aria-describedby="answer-feedback" aria-invalid={feedback?.kind === 'error'} />
            )}
            <button type="submit" className="btn btn--primary answer__submit" disabled={locked}>{lvl.submitLabel ?? 'Submit Answer'}</button>
          </div>
          <p id="answer-feedback" className={`answer__feedback${feedback ? ` is-${feedback.kind}` : ''}`} role={feedback?.kind === 'error' ? 'alert' : 'status'}>
            {feedback?.text ?? ''}
          </p>
          {locked && <p className="answer__locked" data-testid="level-locked">ATTEMPTS EXHAUSTED — THIS INVESTIGATION IS LOCKED. The clues stay readable; the other investigations are unaffected.</p>}
          {completedAt && lvl.successLines && <p className="answer__done">{lvl.successLines[0]} · {lvl.successLines[1]}</p>}
          {completedAt && debrief && <div className="answer__debrief" data-testid="debrief">{debrief.split('\n').map((line) => <p key={line}>{line}</p>)}</div>}
        </form>

        {stamped && (
          <div className={`verified verified--${stamped}`} aria-hidden="true"><span>VERIFIED</span></div>
        )}
      </article>
      {solvedCase !== null && (
        <div className="case-solved" role="status" data-testid="case-solved">
          <div className="case-solved__card">
            <div className="case-solved__case">CASE FILE {pad2(caseId)} — {def.title.toUpperCase()}</div>
            <div className="case-solved__stamp">{def.closedLines ? 'CLOSED' : 'SOLVED'}</div>
            {def.closedLines?.map((line) => <div key={line} className="case-solved__line">{line}</div>)}
            <div className="case-solved__frag">Fragment recovered: <b>{solvedCase.split('').join(' ')}</b></div>
            <p>The digits are written on the file. Collect all nine to open the phone.</p>
            <div className="case-solved__actions">
              <button type="button" className="btn btn--primary" onClick={backToDesk}>Back to All Cases</button>
              <button type="button" className="btn btn--ghost" onClick={() => setSolvedCase(null)}>Stay here</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One block of an investigation page (see LevelSection in data/cases.ts). */
function Section({ sec }: { sec: LevelSection }) {
  const List = sec.ordered ? 'ol' : 'ul';
  return (
    <section className={`dossier__section level-sec${sec.tone ? ` level-sec--${sec.tone}` : ''}`}>
      {sec.heading && <h2>{sec.heading}</h2>}
      {sec.document && (
        <blockquote className="classified-doc">
          <div className="classified-doc__stamp" aria-hidden="true">CLASSIFIED</div>
          {sec.document.map((p) => <p key={p}>{p}</p>)}
        </blockquote>
      )}
      {sec.body?.map((p) => <p key={p} className="level-sec__p">{p}</p>)}
      {sec.list && <List className="level-sec__list">{sec.list.map((li) => <li key={li}>{li}</li>)}</List>}
      {sec.code && <p className="level-sec__code">{sec.code}</p>}
      {sec.table && (
        <figure className="evidence-table">
          {(sec.table.title || sec.table.subtitle) && (
            <figcaption>{sec.table.title && <b>{sec.table.title}</b>}{sec.table.subtitle && <span>{sec.table.subtitle}</span>}</figcaption>
          )}
          <table>
            <thead><tr>{sec.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{sec.table.rows.map((r) => <tr key={r.join('|')}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
          </table>
        </figure>
      )}
      {sec.link && (
        <a className="btn btn--primary level-sec__link" href={sec.link.url} target="_blank" rel="noopener noreferrer">{sec.link.label} ↗</a>
      )}
      {sec.video?.url && (
        <figure className="level-sec__video">
          <video src={sec.video.url} controls preload="metadata" playsInline />
          <figcaption>{sec.video.title}</figcaption>
        </figure>
      )}
    </section>
  );
}
