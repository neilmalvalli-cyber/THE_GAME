// Reduced-complexity desk for devices without WebGL: the same files and
// levels as paper objects in CSS, so navigation and play still work.
import { useNavigate } from 'react-router-dom';
import { CASES, getCase, levelKey, pad2 } from '../data/cases';
import { useGameStore } from '../state/gameStore';
import { paths } from '../orchestration/routes';
import './flat-desk.css';

export function FlatDesk({ caseId }: { caseId?: number }) {
  const navigate = useNavigate();
  const completed = useGameStore((s) => s.progress.completed);
  const selectedLevel = useGameStore((s) => s.progress.selectedLevel);
  const selectLevel = useGameStore((s) => s.selectLevel);
  const def = caseId != null ? getCase(caseId) : undefined;

  return (
    <div className="flat-desk">
      <p className="flat-desk__note">3D is unavailable on this device — showing the simplified desk.</p>
      {!def && (
        <div className="flat-desk__files">
          {CASES.map((c, i) => (
            <button key={c.id} type="button" className="flat-file" style={{ transform: `rotate(${[-2, 1.5, -1, 2, -1.5][i]}deg)` }} onClick={() => navigate(paths.case(c.id))}>
              <span className="flat-file__tab">CASE {pad2(c.id)}</span>
              <span className="flat-file__stamp">CASE {pad2(c.id)}</span>
              <span className="flat-file__title">{c.title}</span>
            </button>
          ))}
        </div>
      )}
      {def && (
        <div className="flat-case">
          <button type="button" className="btn" onClick={() => navigate(paths.desk)}>← Back to Desk</button>
          <h2>CASE {pad2(def.id)} — {def.title}</h2>
          <div className="flat-case__photos">
            {def.levels.map((l, i) => {
              const done = levelKey(def.id, l.number) in completed;
              const sel = (selectedLevel[def.id] ?? 1) === l.number;
              return (
                <button key={l.number} type="button" className={`flat-photo${sel ? ' is-selected' : ''}`} style={{ transform: `rotate(${[-3, 2, -1.5, 3][i]}deg)` }}
                  onClick={() => { selectLevel(def.id, l.number); navigate(paths.level(def.id, l.number), { state: { from: paths.case(def.id) } }); }}>
                  <span className="flat-photo__img">{done && <b>VERIFIED</b>}</span>
                  <span className="flat-photo__label">LEVEL {pad2(l.number)}</span>
                  <span className="flat-photo__title">{l.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
