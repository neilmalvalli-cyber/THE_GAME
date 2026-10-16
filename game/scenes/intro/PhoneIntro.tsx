// The original phone-call intro, mounted as a React component.
// Markup and CSS are the original (introMarkup.ts / intro.css); the 1280×720
// stage is scaled to the viewport. `onIntroComplete` is the original hook.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { INTRO_MARKUP } from './introMarkup';
import { IntroController, WALK_STEPS, type IntroMode, type IntroViewState } from './introController';
import { prepareIntroWood, swapInWood } from './woodBitmap';
import './intro.css';

interface Props {
  /** Start immediately (the Team Login click is the user gesture). */
  autoStart: boolean;
  sound: boolean;
  onIntroComplete: () => void;
  onModeChange?: (mode: IntroMode) => void;
}

const W = 1280, H = 720;

function fitScale(): number {
  const vw = window.innerWidth, vh = window.innerHeight;
  // fill the screen; on portrait screens keep the phone (centre ~760px) in view
  let s = Math.max(vw / W, vh / H);
  if (vw / vh < 1) s = Math.min(s, vw / 760);
  return s;
}

export function PhoneIntro({ autoStart, sound, onIntroComplete, onModeChange }: Props) {
  const [view, setView] = useState<IntroViewState | null>(null);
  const [scale, setScale] = useState(fitScale);
  const ctrl = useRef<IntroController | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onIntroComplete);
  const modeRef = useRef(onModeChange);
  completeRef.current = onIntroComplete;
  modeRef.current = onModeChange;

  useLayoutEffect(() => {
    const c = new IntroController(setView, () => completeRef.current(), (m) => modeRef.current?.(m));
    ctrl.current = c;
    setView(c.state);
    if (autoStart) c.begin(sound);
    return () => c.teardown();
    // the controller lives for the lifetime of the mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the table as a pre-rendered bitmap instead of live noise filters (same pixels, far cheaper)
  const mounted = view !== null;
  useLayoutEffect(() => {
    if (!mounted) return;
    let alive = true;
    void prepareIntroWood().then((url) => { if (alive && url && stage.current) swapInWood(stage.current, url); });
    return () => { alive = false; };
  }, [mounted]);

  useEffect(() => {
    const onResize = () => setScale(fitScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!view) return null;
  const mode = view.mode;
  const rootClass = `tg-stage m-${mode} ${view.flags}${view.rm ? ' s-rm' : ''}`;
  const style = {
    width: W, height: H, position: 'absolute', left: '50%', top: '50%', overflow: 'hidden', background: '#000',
    fontFamily: 'Figtree, system-ui, sans-serif',
    transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: '50% 50%',
    '--tg-walk': WALK_STEPS[Math.min(view.walk || 0, WALK_STEPS.length - 1)],
  } as CSSProperties;

  return (
    <div className="phone-intro" aria-label="Incoming call — intro sequence">
      <div className={rootClass} style={style}>
        <div className="tg-sr" aria-live="polite">{view.live}</div>
        <div ref={stage} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: INTRO_MARKUP }} />
        {mode === 'idle' && (
          <div className="tg-gate">
            <div className="tg-kicker">Sound on · headphones recommended</div>
            <button type="button" className="tg-begin" onClick={() => ctrl.current?.begin(true)} autoFocus>Begin</button>
            <button type="button" className="tg-quiet" onClick={() => ctrl.current?.begin(false)}>Play without sound</button>
          </div>
        )}
        {mode === 'play' && (
          <button type="button" className="tg-skip" onClick={() => ctrl.current?.skip()}>
            Skip intro{' '}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5l8 7-8 7zM14 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

export type { IntroMode };
