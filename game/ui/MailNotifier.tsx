// Incoming intelligence notices. Shown only at a safe moment (no cinematic,
// no purchase, no folder in motion); never steals focus or navigates by itself.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUiStore } from '../state/uiStore';
import { useSceneStore, isCinematicBusy } from '../state/sceneStore';
import { useGameStore } from '../state/gameStore';
import { playIncomingMail } from '../audio/uiAudio';
import { paths } from '../orchestration/routes';
import { IconClose } from './icons';
import './notifier.css';

const SHOW_MS = 7000;

export function MailNotifier() {
  const navigate = useNavigate();
  const location = useLocation();
  const queueLen = useUiStore((s) => s.queue.length);
  const active = useUiStore((s) => s.active);
  const busy = useSceneStore(isCinematicBusy);
  const onIntro = location.pathname === paths.intro;
  const [leaving, setLeaving] = useState(false);
  const hover = useRef(false);

  // deliver the next notice once the scene is calm
  useEffect(() => {
    if (active || queueLen === 0 || busy || onIntro) return;
    const t = window.setTimeout(() => {
      const st = useSceneStore.getState();
      if (isCinematicBusy(st) || useUiStore.getState().active) return;
      const n = useUiStore.getState().showNext();
      if (n) playIncomingMail();
    }, 650);
    return () => window.clearTimeout(t);
  }, [active, queueLen, busy, onIntro]);

  // let it go on its own
  useEffect(() => {
    if (!active) return;
    setLeaving(false);
    let t = 0;
    const arm = () => {
      t = window.setTimeout(() => {
        if (hover.current) { arm(); return; }
        setLeaving(true);
        window.setTimeout(() => useUiStore.getState().dismiss(), 380);
      }, SHOW_MS);
    };
    arm();
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;
  const open = () => {
    useGameStore.getState().setRead(active.messageId, true);
    useUiStore.getState().dismiss();
    navigate(paths.message(active.messageId));
  };

  return (
    <div className={`notice${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite"
      onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}>
      <div className="notice__signal" aria-hidden="true"><span /><span /><span /></div>
      <button type="button" className="notice__body" onClick={open}>
        <span className="notice__kicker">Incoming intelligence</span>
        <span className="notice__line"><b>From:</b> {active.from}</span>
        <span className="notice__line notice__subject"><b>Subject:</b> {active.subject}</span>
      </button>
      <button type="button" className="notice__close" aria-label="Dismiss" onClick={() => { setLeaving(true); window.setTimeout(() => useUiStore.getState().dismiss(), 300); }}>
        <IconClose />
      </button>
    </div>
  );
}
