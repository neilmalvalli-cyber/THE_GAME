// Small synthesised UI sounds (no files): incoming intelligence, the light
// switch between scenes, the VERIFIED stamp. Restrained by design and
// silent while muted. The AudioContext is created on the first user gesture.
import { useGameStore } from '../state/gameStore';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (useGameStore.getState().settings.muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockUiAudio(): void {
  ensure();
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(c: AudioContext, out: AudioNode, freq: number, t: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst(c: AudioContext, out: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, q = 1) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, dur + 0.05);
  const f = c.createBiquadFilter();
  f.type = filter; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.05);
}

/** Incoming intelligence: a squelch of static, then two low, distant tones. */
export function playIncomingMail(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.02;
  const bus = c.createGain();
  bus.gain.value = 0.55;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  bus.connect(lp).connect(master);
  burst(c, bus, t, 0.09, 0.05, 'bandpass', 1800, 1.4);
  tone(c, bus, 784, t + 0.1, 0.42, 0.06);
  tone(c, bus, 587.3, t + 0.27, 0.6, 0.05);
  tone(c, bus, 1174.7, t + 0.27, 0.3, 0.012, 'triangle');
  burst(c, bus, t + 0.62, 0.05, 0.02, 'bandpass', 2400, 2);
}

/** A wall switch thrown in a quiet room, with the hum of the lamp catching. */
export function playLightSwitch(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  burst(c, master, t, 0.03, 0.32, 'highpass', 2200);
  burst(c, master, t + 0.012, 0.08, 0.18, 'bandpass', 380, 3);
  tone(c, master, 92, t, 0.12, 0.12);
  const hum = c.createOscillator();
  hum.frequency.value = 60;
  const hg = c.createGain();
  hg.gain.setValueAtTime(0.0001, t + 0.02);
  hg.gain.linearRampToValueAtTime(0.025, t + 0.08);
  hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  hum.connect(hg).connect(master);
  hum.start(t);
  hum.stop(t + 1);
}

/** Rubber stamp on paper. */
export function playStamp(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  tone(c, master, 120, t, 0.16, 0.3);
  burst(c, master, t, 0.07, 0.28, 'lowpass', 900);
  burst(c, master, t + 0.005, 0.03, 0.08, 'bandpass', 3000, 2);
}

/** A soft paper tick for small UI moments (wallet open/close). */
export function playPaper(): void {
  const c = ensure();
  if (!c || !master) return;
  burst(c, master, c.currentTime + 0.01, 0.12, 0.05, 'bandpass', 1500, 0.8);
}

// ---- evidence phone ---------------------------------------------------------------
/** A soft keypad tick. */
export function playKeyTick(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.005;
  burst(c, master, t, 0.03, 0.05, 'bandpass', 3200, 2.2);
  tone(c, master, 1240, t, 0.05, 0.025);
}

/** Wrong passcode: two short, low, buzzy tones. */
export function playAccessDenied(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900;
  lp.connect(master);
  tone(c, lp, 196, t, 0.16, 0.12, 'square');
  tone(c, lp, 164, t + 0.19, 0.26, 0.12, 'square');
}

/** Device unlocked: a vibration hum, the lock giving, then a clean rising chime. */
export function playUnlock(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  const hum = c.createGain();
  hum.gain.value = 0.5;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 260;
  hum.connect(lp).connect(master);
  tone(c, hum, 150, t, 0.22, 0.22, 'sawtooth');
  tone(c, hum, 150, t + 0.3, 0.18, 0.18, 'sawtooth');
  burst(c, master, t + 0.52, 0.05, 0.06, 'highpass', 2400);
  tone(c, master, 880, t + 0.6, 0.5, 0.05);
  tone(c, master, 1318.5, t + 0.72, 0.7, 0.045);
}

/** Overhead lamp: a click and a faint ballast buzz. */
export function playLampOn(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  burst(c, master, t, 0.035, 0.18, 'bandpass', 1400, 1.2);
  tone(c, master, 100, t + 0.03, 0.5, 0.012, 'sawtooth');
}

// ---- normal market ----------------------------------------------------------------
/** A shop bell over the door. */
export function playShopBell(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  for (const [f, d, p] of [[1568, 1.2, 0.05], [2349, 0.9, 0.025], [3136, 0.6, 0.012]] as const) tone(c, master, f, t, d, p);
  for (const [f, d, p] of [[1568, 1.0, 0.035], [2349, 0.7, 0.018]] as const) tone(c, master, f, t + 0.16, d, p);
}

/** Register: a mechanical clack and a small bell. */
export function playRegister(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  burst(c, master, t, 0.06, 0.16, 'bandpass', 900, 1.5);
  burst(c, master, t + 0.12, 0.08, 0.12, 'bandpass', 600, 1.2);
  tone(c, master, 2093, t + 0.26, 0.8, 0.05);
}

/** Crime scene: a low warning tone that pulses twice. */
export function playWarningTone(): void {
  const c = ensure();
  if (!c || !master) return;
  const t = c.currentTime + 0.01;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1200;
  lp.connect(master);
  for (let i = 0; i < 2; i++) {
    tone(c, lp, 440, t + i * 0.62, 0.42, 0.07, 'triangle');
    tone(c, lp, 349, t + i * 0.62 + 0.21, 0.36, 0.06, 'triangle');
  }
}
