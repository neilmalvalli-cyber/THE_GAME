// /team/phone — the recovered evidence phone, lying on the desk under one lamp.
//
// Entrance (first visit this session): darkness → the overhead lamp clicks on → the
// camera leans in → a glint crosses the glass and catches the prints → the screen wakes
// → the keypad. Later visits come straight back to where the team left it.
//
// Locked: a 9-digit passcode (a string — leading zeros count), entered by touch, mouse
// or keyboard (0–9, Backspace, Esc). Unlocked: the phone's Recents, and a record for
// each call. The unlock persists for the team (gameStore.phone).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { PhoneModel, PHONE_H, PHONE_W } from '../scenes/phone/PhoneModel';
import { prepareIntroWood } from '../scenes/intro/woodBitmap';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { verifyPhoneCode } from '../services/phone';
import { CODE_LENGTH, DEVICE } from '../data/phone';
import { playAccessDenied, playKeyTick, playLampOn, playUnlock, unlockUiAudio } from '../audio/uiAudio';
import { IconArrowLeft } from '../ui/icons';
import '../scenes/phone/phone.css';
import { PhoneOS, StatusBar } from '../scenes/phone/PhoneOS';
import { env } from '../env';

type LockStatus = 'idle' | 'verifying' | 'denied' | 'unlocking';

const KEYS: { d: string; l: string }[] = [
  { d: '1', l: '' }, { d: '2', l: 'ABC' }, { d: '3', l: 'DEF' },
  { d: '4', l: 'GHI' }, { d: '5', l: 'JKL' }, { d: '6', l: 'MNO' },
  { d: '7', l: 'PQRS' }, { d: '8', l: 'TUV' }, { d: '9', l: 'WXYZ' },
];

// the cinematic plays once per session; coming back later is immediate
let enteredThisSession = false;
export function resetPhoneEntrance() { enteredThisSession = false; }

function fitScale() {
  const h = window.innerHeight - 56; // top bar
  const w = window.innerWidth;
  return Math.max(0.6, Math.min(1.12, (h - 44) / PHONE_H, (w - 32) / PHONE_W));
}

export function PhonePage() {
  const navigate = useNavigate();
  const unlocked = useGameStore((s) => s.phone.unlocked);
  const lastDeskPath = useUiStore((s) => s.lastDeskPath);
  const [scale, setScale] = useState(fitScale);
  const [ready, setReady] = useState(enteredThisSession); // entrance finished
  const [wood, setWood] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    let alive = true;
    void prepareIntroWood().then((u) => { if (alive) setWood(u); });
    const onResize = () => setScale(fitScale());
    window.addEventListener('resize', onResize);
    return () => { alive = false; window.removeEventListener('resize', onResize); };
  }, []);

  // ---- entrance ------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = root.current!;
    const q = gsap.utils.selector(el);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = gsap.timeline({ defaults: { ease: 'power2.out' }, onComplete: () => { enteredThisSession = true; setReady(true); } });
    tl.current = t;

    if (enteredThisSession || reduced) {
      // straight back to the phone, a short fade so it doesn't pop
      gsap.set(q('.ev-dark'), { opacity: 0.32 });
      gsap.set(q('.ev-light'), { opacity: 1 });
      gsap.set(q('.ev-rig'), { rotateX: 8, scale: 1, y: 0 });
      gsap.set(q('.ev-screenon'), { opacity: 1 });
      gsap.set(q('.ev-deskcam'), { scale: 1.1 });
      gsap.set(q('.pm-blood'), { opacity: 0.85 });
      t.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35 });
      return () => { t.kill(); };
    }

    gsap.set(q('.ev-dark'), { opacity: 1 });
    gsap.set(q('.ev-light'), { opacity: 0 });
    gsap.set(q('.ev-rig'), { rotateX: 38, scale: 0.8, y: 34 });
    gsap.set(q('.ev-deskcam'), { scale: 1.0 });
    gsap.set(q('.ev-screenon'), { opacity: 0 });
    gsap.set(q('.pm-glint span'), { x: 0, xPercent: -160, skewX: -12, opacity: 1 });
    gsap.set(q('.ev-tag'), { opacity: 0, y: 10 });

    t.addLabel('lamp', 0.45)
      .call(() => playLampOn(), [], 'lamp')
      // the lamp catches, stutters once, then holds
      .to(q('.ev-light'), { opacity: 0.55, duration: 0.05, ease: 'none' }, 'lamp')
      .to(q('.ev-light'), { opacity: 0.12, duration: 0.07, ease: 'none' }, 'lamp+=0.07')
      .to(q('.ev-light'), { opacity: 1, duration: 0.55 }, 'lamp+=0.16')
      .to(q('.ev-dark'), { opacity: 0.32, duration: 1.1, ease: 'power1.out' }, 'lamp+=0.1')
      // the camera leans in over the desk
      .addLabel('lean', 'lamp+=0.5')
      .to(q('.ev-rig'), { rotateX: 8, scale: 1, y: 0, duration: 2.1, ease: 'power3.inOut' }, 'lean')
      .to(q('.ev-deskcam'), { scale: 1.1, duration: 2.1, ease: 'power3.inOut' }, 'lean')
      .to(q('.ev-tag'), { opacity: 1, y: 0, duration: 0.8 }, 'lean+=1.2')
      // a glint across the glass — the prints show for a moment
      .addLabel('glint', 'lean+=1.6')
      .to(q('.pm-glint span'), { xPercent: 160, duration: 1.05, ease: 'power2.inOut' }, 'glint')
      .set(q('.pm-glint span'), { opacity: 0 })
      .to(q('.pm-print'), { opacity: 1, duration: 0.35, yoyo: true, repeat: 1, repeatDelay: 0.15, ease: 'sine.inOut' }, 'glint+=0.25')
      .fromTo(q('.pm-blood'), { opacity: 0.3 }, { opacity: 0.85, duration: 0.9 }, 'glint+=0.35')
      // the screen wakes, then the keypad
      .addLabel('wake', 'glint+=1.05')
      .to(q('.ev-screenon'), { opacity: 1, duration: 0.45, ease: 'power1.out' }, 'wake')
      .fromTo(q('.lk-head > *'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 }, 'wake+=0.15')
      .fromTo(q('.lk-key, .rc-row'), { opacity: 0, y: 8, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, stagger: 0.035, ease: 'back.out(1.6)' }, 'wake+=0.3');
    return () => { t.kill(); };
  }, []);

  const skip = () => { if (tl.current && tl.current.progress() < 1) tl.current.progress(1); };
  const backToDesk = () => navigate(lastDeskPath);

  return (
    <div className={`ev${ready ? ' is-ready' : ''}`} ref={root} onPointerDown={unlockUiAudio}>
      <div className="ev-deskcam" aria-hidden="true">
        <div className="ev-desk" style={wood ? { backgroundImage: `url(${wood})` } : undefined} />
      </div>
      <div className="ev-light" aria-hidden="true" />
      <div className="ev-dark" aria-hidden="true" />

      <aside className="ev-tag" aria-label="Evidence label">
        <span className="ev-tag__hole" aria-hidden="true" />
        <span className="ev-tag__kicker">Evidence</span>
        <b className="ev-tag__id">{DEVICE.evidenceTag}</b>
        <span className="ev-tag__line">{DEVICE.label}</span>
        <span className="ev-tag__line">Owner: {DEVICE.owner}</span>
        <span className="ev-tag__line">Seized 13 Oct · 02:14</span>
      </aside>

      <div className="ev-cam">
        <div className="ev-fit" style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})` }}>
        <div className="ev-rig" style={{ width: PHONE_W, height: PHONE_H }}>
          <div className="ev-shadow" aria-hidden="true" />
          <div className="ev-phone">
            <PhoneModel variant="evidence">
              <div className="ev-screenon">
                {unlocked ? <PhoneOS onExit={backToDesk} /> : <LockScreen active={ready} onExit={backToDesk} />}
              </div>
            </PhoneModel>
          </div>
        </div>
        </div>
      </div>

      <button type="button" className="paper-back is-on ev-back" onClick={backToDesk}><IconArrowLeft /><span>Back to Desk</span></button>
      {!ready && <button type="button" className="ev-skip" onClick={skip}>Skip <span aria-hidden="true">›</span></button>}
      {env.DEV && unlocked && (
        <button type="button" className="ev-devlock" onClick={() => useGameStore.getState().setPhoneUnlocked(false)}>Return to Locked View (dev)</button>
      )}
    </div>
  );
}

// ---- lock screen -------------------------------------------------------------------

function LockScreen({ active, onExit }: { active: boolean; onExit(): void }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<LockStatus>('idle');
  const busy = useRef(false);
  const dots = useRef<HTMLDivElement>(null);
  const lockIcon = useRef<SVGGElement>(null);
  const screen = useRef<HTMLDivElement>(null);

  const submit = useCallback(async (value: string) => {
    if (busy.current) return;
    busy.current = true;
    setStatus('verifying');
    const r = await verifyPhoneCode(value);
    if (r.ok) {
      setStatus('unlocking');
      playUnlock();
      try { navigator.vibrate?.([120, 80, 120]); } catch { /* unsupported */ }
      const rig = screen.current?.closest('.ev-phone');
      const t = gsap.timeline({
        onComplete: () => { busy.current = false; useGameStore.getState().setPhoneUnlocked(true); },
      });
      // vibration: the phone buzzes against the wood, twice
      if (rig) {
        t.to(rig, { keyframes: { x: [0, 1.6, -1.4, 1.2, -1.6, 1, -0.6, 0], rotation: [0, 0.3, -0.25, 0.2, -0.3, 0.15, 0] }, duration: 0.24, ease: 'none' }, 0)
          .to(rig, { keyframes: { x: [0, 1.4, -1.2, 1.3, -1, 0], rotation: [0, 0.25, -0.2, 0.2, 0] }, duration: 0.2, ease: 'none' }, 0.3);
      }
      // the shackle lifts and swings open
      if (lockIcon.current) t.to(lockIcon.current, { y: -4, rotation: -28, transformOrigin: '100% 100%', duration: 0.38, ease: 'back.out(2.2)' }, 0.5);
      // the lock screen slides away
      if (screen.current) t.to(screen.current, { yPercent: -100, opacity: 0.2, duration: 0.62, ease: 'power3.in' }, 1.55);
      return;
    }
    setStatus('denied');
    playAccessDenied();
    useGameStore.getState().recordPhoneFailure();
    try { navigator.vibrate?.(200); } catch { /* unsupported */ }
    const rig = screen.current?.closest('.ev-phone');
    const t = gsap.timeline({ onComplete: () => { setCode(''); setStatus('idle'); busy.current = false; } });
    if (dots.current) t.to(dots.current, { keyframes: { x: [0, -14, 12, -10, 8, -5, 3, 0] }, duration: 0.5, ease: 'none' }, 0);
    if (rig) t.to(rig, { keyframes: { x: [0, -2, 2, -1.5, 1.2, 0] }, duration: 0.32, ease: 'none' }, 0);
    t.to({}, { duration: 0.55 }); // hold "ACCESS DENIED" for a beat, then clear
  }, []);

  const press = useCallback((d: string) => {
    if (busy.current) return;
    playKeyTick();
    setCode((c) => {
      if (c.length >= CODE_LENGTH) return c; // never more than nine
      return c + d;
    });
  }, []);
  const back = useCallback(() => { if (!busy.current) setCode((c) => c.slice(0, -1)); }, []);
  const clear = useCallback(() => { if (!busy.current) setCode(''); }, []);
  const codeRef = useRef(code);
  codeRef.current = code;
  /** Unlock / Enter: only with all nine digits, and only once at a time. */
  const unlock = useCallback(() => {
    const c = codeRef.current;
    if (busy.current || c.length !== CODE_LENGTH || !/^\d+$/.test(c)) return;
    void submit(c);
  }, [submit]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element)?.closest?.('input,textarea,select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Delete') { e.preventDefault(); clear(); }
      else if (e.key === 'Enter') { e.preventDefault(); unlock(); }
      else if (e.key === 'Escape') {
        // digits entered: clear them; nothing entered: leave the phone
        e.preventDefault();
        if (busy.current) return;
        if (codeRef.current) clear(); else onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, press, back, clear, unlock, onExit]);

  const message = status === 'denied' ? 'ACCESS DENIED' : status === 'unlocking' ? 'DEVICE UNLOCKED' : status === 'verifying' ? 'Verifying…' : 'Enter Passcode';

  return (
    <div className={`lk lk--${status}`} ref={screen}>
      <div className="lk-bg" aria-hidden="true" />
      <StatusBar time={DEVICE.lockTime} />
      <div className="lk-head">
        <svg className="lk-lock" width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
          <g ref={lockIcon}><path d="M6 12V8a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></g>
          <rect x="3" y="11.5" width="16" height="12.5" rx="2.6" fill="currentColor" />
        </svg>
        <div className="lk-msg" role="status" aria-live="assertive" data-testid="phone-status">{message}</div>
        <div className="lk-dots" ref={dots} aria-label={`${code.length} of ${CODE_LENGTH} digits entered`}>
          {Array.from({ length: CODE_LENGTH }, (_, i) => <span key={i} className={i < code.length ? 'is-on' : ''} />)}
        </div>
      </div>
      <div className="lk-pad" role="group" aria-label="Passcode keypad">
        {KEYS.map((k) => (
          <button key={k.d} type="button" className="lk-key" onClick={() => press(k.d)} disabled={!active || status !== 'idle'} aria-label={k.d}>
            <span className="lk-key__d">{k.d}</span>{k.l && <span className="lk-key__l">{k.l}</span>}
          </button>
        ))}
        <button type="button" className="lk-key lk-key--text" onClick={clear} disabled={!active || status !== 'idle' || !code} aria-label="Clear">Clear</button>
        <button type="button" className="lk-key" onClick={() => press('0')} disabled={!active || status !== 'idle'} aria-label="0"><span className="lk-key__d">0</span><span className="lk-key__l">+</span></button>
        <button type="button" className="lk-key lk-key--text" onClick={back} disabled={!active || status !== 'idle' || !code} aria-label="Backspace">
          <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true"><path d="M8 1h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8L1 9z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M11.5 5.5l7 7M18.5 5.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      <button type="button" className="lk-unlock" onClick={unlock} disabled={!active || status !== 'idle' || code.length !== CODE_LENGTH} data-testid="phone-unlock">Unlock</button>
      <div className="tg-homebar" />
    </div>
  );
}

