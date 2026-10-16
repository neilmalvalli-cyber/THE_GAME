// /team/desk and /team/case/:caseId — the desk IS the interface.
// These pages only add the slimmest overlays: a caption for the file under
// the pointer, a file index for keyboard/touch, and inside an open file a
// paper "Back to Desk" label. Levels are chosen on the Polaroids themselves
// (click; on touch tap to preview then tap again; keyboard ← → and Enter).
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CASES, getCase, getLevel, levelKey, pad2, parseId } from '../data/cases';
import { useGameStore } from '../state/gameStore';
import { useSceneStore } from '../state/sceneStore';
import { deskController } from '../scenes/desk/deskController';
import { paths } from '../orchestration/routes';
import { IconArrowLeft } from '../ui/icons';
import { FlatDesk } from './FlatDesk';

const INTERACTIVE = new Set(['DESK_IDLE', 'FOLDER_HOVER']);

export function DeskPage() {
  const navigate = useNavigate();
  const deskState = useSceneStore((s) => s.deskState);
  const deskPhase = useSceneStore((s) => s.deskPhase);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const completed = useGameStore((s) => s.progress.completed);

  useEffect(() => {
    const scene = deskController.instance;
    if (!scene) return;
    return scene.onStateChange((next, _prev, ctx) => setHoverId(next === 'FOLDER_HOVER' ? ctx.folderId ?? null : null));
  }, [deskPhase]);

  if (deskPhase === 'error') return <FlatDesk />;
  const ready = deskPhase === 'revealed' && deskState != null && INTERACTIVE.has(deskState);
  const hovered = hoverId != null ? getCase(hoverId) : null;

  return (
    <div className="hud hud--desk">
      <div className={`desk-caption${hovered ? ' is-on' : ''}`} aria-hidden="true">
        {hovered && <><span className="desk-caption__no">CASE {pad2(hovered.id)}</span><span className="desk-caption__title">{hovered.title}</span></>}
      </div>
      <nav className={`file-index${ready ? ' is-on' : ''}`} aria-label="Case files">
        {CASES.map((c) => {
          const solved = c.levels.filter((l) => levelKey(c.id, l.number) in completed).length;
          return (
            <button key={c.id} type="button" className="file-index__tab" disabled={!ready} onClick={() => navigate(paths.case(c.id))}
              aria-label={`Open case ${pad2(c.id)}: ${c.title}. ${solved} of ${c.levels.length} solved.`}
              onMouseEnter={() => setHoverId(c.id)} onMouseLeave={() => setHoverId(null)}>
              <span className="file-index__no">{pad2(c.id)}</span>
              <span className="file-index__dots" aria-hidden="true">{c.levels.map((l) => <i key={l.number} className={levelKey(c.id, l.number) in completed ? 'on' : ''} />)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** The case overview: every investigation, its status and attempts — all open from the start. */
function CaseIndex({ caseId, visible, selected, onOpen }: { caseId: number; visible: boolean; selected: number; onOpen(level: number): void }) {
  const c = getCase(caseId)!;
  const completed = useGameStore((s) => s.progress.completed);
  const skipped = useGameStore((s) => s.progress.skipped);
  const attempts = useGameStore((s) => s.progress.attempts);
  const rows = c.levels.map((l) => {
    const key = levelKey(caseId, l.number);
    const used = attempts?.[key] ?? 0;
    const done = key in completed || key in skipped;
    const status = done ? 'COMPLETED' : l.maxAttempts && used >= l.maxAttempts ? 'ATTEMPTS EXHAUSTED' : used > 0 ? 'IN PROGRESS' : 'NOT STARTED';
    return { l, status, left: l.maxAttempts ? Math.max(0, l.maxAttempts - used) : null };
  });
  const done = rows.filter((r) => r.status === 'COMPLETED').length;
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem('tg.caseIndexFolded') === '1'; } catch { return false; } });
  const toggle = () => setFolded((f) => { try { localStorage.setItem('tg.caseIndexFolded', f ? '0' : '1'); } catch { /* storage blocked */ } return !f; });
  return (
    <aside className={`case-index${visible ? ' is-on' : ''}${folded ? ' is-folded' : ''}`} aria-label={`Case file ${pad2(caseId)} investigations`} data-testid="case-index">
      <header className="case-index__head">
        <button type="button" className="case-index__fold" onClick={toggle} tabIndex={visible ? 0 : -1} aria-expanded={!folded}
          aria-label={folded ? 'Show investigations' : 'Hide investigations'} data-testid="case-index-fold">{folded ? 'SHOW' : 'HIDE'}</button>
        <div className="case-index__kicker">CASE FILE {pad2(caseId)}{c.classification ? ` · ${c.classification}` : ''}</div>
        <div className="case-index__title">{c.title.toUpperCase()}</div>
        <div className="case-index__meta">
          {done === rows.length ? 'CASE STATUS: COMPLETED' : 'CASE STATUS: INVESTIGATION ACTIVE'} · INVESTIGATION PROGRESS: {done} / {rows.length}
        </div>
      </header>
      <ol className="case-index__list">
        {rows.map(({ l, status, left }) => (
          <li key={l.number}>
            <button type="button" className={`case-index__row is-${status.toLowerCase().replace(/ /g, '-')}${selected === l.number ? ' is-selected' : ''}`}
              onClick={() => onOpen(l.number)} tabIndex={visible ? 0 : -1} data-testid={`case-row-${l.number}`}>
              <span className="case-index__no">{pad2(l.number)}</span>
              <span className="case-index__name">{l.title}</span>
              <span className="case-index__status">{status}</span>
              {left !== null && <span className="case-index__left">{left} / {l.maxAttempts}<span className="case-index__unit"> attempts</span></span>}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function CasePage() {
  const { caseId: raw } = useParams();
  const caseId = parseId(raw)!;
  const navigate = useNavigate();
  const location = useLocation();
  const deskState = useSceneStore((s) => s.deskState);
  const deskPhase = useSceneStore((s) => s.deskPhase);
  const openId = useSceneStore((s) => s.deskOpenId);
  const selected = useGameStore((s) => s.progress.selectedLevel[caseId] ?? 1);
  const completed = useGameStore((s) => s.progress.completed);
  const selectLevel = useGameStore((s) => s.selectLevel);
  const isOpen = deskState === 'FOLDER_OPEN' && openId === caseId;

  // returning from a level: the picked photo settles back to "selected"
  useEffect(() => { if (isOpen) deskController.setSelectedLevel(caseId, selected); }, [isOpen, caseId, selected]);

  const openLevel = useCallback(async (level: number) => {
    if (useSceneStore.getState().photoSelecting) return;
    selectLevel(caseId, level);
    deskController.setSelectedLevel(caseId, level);
    await deskController.pickPhoto(caseId, level);
    navigate(paths.level(caseId, level), { state: { from: location.pathname } });
  }, [caseId, location.pathname, navigate, selectLevel]);

  // clicks / taps on the Polaroids in the scene
  useEffect(() => deskController.onPhotoSelect((fid, index, pointerType) => {
    if (fid !== caseId) return;
    const level = index + 1;
    const current = useGameStore.getState().progress.selectedLevel[caseId] ?? 1;
    // touch: first tap previews, a second tap (or the button) opens
    if (pointerType === 'touch' && current !== level) {
      selectLevel(caseId, level);
      deskController.setSelectedLevel(caseId, level);
      return;
    }
    void openLevel(level);
  }), [caseId, openLevel, selectLevel]);

  // keyboard: ← → choose, Enter opens, Esc back to the desk
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest?.('input, textarea, [role="dialog"]')) return;
      if (e.key === 'Escape') { navigate(paths.desk); return; }
      if (!isOpen) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const n = Math.min(getCase(caseId)?.levels.length ?? 4, Math.max(1, selected + (e.key === 'ArrowRight' ? 1 : -1)));
        selectLevel(caseId, n); deskController.setSelectedLevel(caseId, n);
      } else if (e.key === 'Enter' && !(e.target as Element)?.closest?.('button')) {
        void openLevel(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [caseId, isOpen, navigate, openLevel, selectLevel, selected]);

  if (deskPhase === 'error') return <FlatDesk caseId={caseId} />;
  const lvl = getLevel(caseId, selected)!;
  const solved = levelKey(caseId, selected) in completed;

  return (
    <div className="hud hud--case">
      <button type="button" className={`paper-back${isOpen ? ' is-on' : ''}`} onClick={() => navigate(paths.desk)} tabIndex={isOpen ? 0 : -1}>
        <IconArrowLeft /><span>Back to All Cases</span><kbd>Esc</kbd>
      </button>

      <CaseIndex caseId={caseId} visible={isOpen} selected={selected} onOpen={(l) => void openLevel(l)} />

      <div className="sr-only" aria-live="polite">
        {isOpen ? `Level ${pad2(selected)}: ${lvl.title}. ${lvl.difficulty}. Reward ${lvl.reward} coins. ${solved ? 'Completed' : 'Available'}. ${lvl.description}` : ''}
      </div>
    </div>
  );
}
