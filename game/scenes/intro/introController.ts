// Logic of the original phone intro, ported from its DCLogic component.
// Timeline, flags, skip/finish behaviour and the synthesised sound design are
// unchanged; only setState() became a callback into React.

export type IntroMode = 'idle' | 'play' | 'done';

export interface IntroViewState {
  mode: IntroMode;
  flags: string;
  rm: boolean;
  walk: number;
  live: string;
}

const TL = {
  lit: 0.05, placed: 0, dim: 3.8, door: 5.0, call: 6.0, ended: 11.0, out: 12.0, done: 13.0,
  steps: [2.4, 2.95, 3.5, 4.0],
  bursts: [[6.05, 6.65], [6.95, 7.4], [7.52, 8.0], [8.4, 8.95], [9.07, 9.55], [9.85, 10.35], [10.47, 11.0]],
} as const;

export const WALK_STEPS = ['translate(0px,0px) rotate(0deg)', 'translate(0.6px,-0.4px) rotate(0.35deg)', 'translate(1px,-0.5px) rotate(0.55deg)',
  'translate(1.7px,-0.9px) rotate(0.8deg)', 'translate(2.4px,-1.1px) rotate(1.15deg)', 'translate(2.6px,-1.2px) rotate(1.25deg)'];

export class IntroController {
  state: IntroViewState;
  private timers: number[] = [];
  private raf: number | null = null;
  private done = false;
  private key = '';
  private t0 = 0;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor(
    private readonly onState: (s: IntroViewState) => void,
    private readonly onComplete: () => void,
    private readonly onModeChange?: (mode: IntroMode) => void,
  ) {
    let rm = false;
    try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    this.state = { mode: 'idle', flags: '', rm, walk: 0, live: '' };
  }

  private setState(patch: Partial<IntroViewState>, after?: () => void) {
    const prevMode = this.state.mode;
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
    if (this.state.mode !== prevMode) this.onModeChange?.(this.state.mode);
    after?.();
  }

  teardown() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.killAudio(0);
  }

  begin(sound: boolean) {
    this.teardown();
    this.done = false;
    this.key = '';
    if (sound) this.initAudio();
    this.setState({ mode: 'play', flags: '', walk: 0, live: '' }, () => {
      this.t0 = performance.now();
      if (this.ctx) this.scheduleAudio();
      this.raf = requestAnimationFrame(() => this.tick());
    });
  }

  private tick() {
    const e = (performance.now() - this.t0) / 1000;
    const T = TL;
    const f: string[] = [];
    if (e >= T.lit) f.push('s-lit');
    if (e >= T.placed) f.push('s-placed');
    if (e >= T.dim) f.push('s-dim');
    if (e >= T.call && e < T.ended) f.push('s-call');
    if (e >= T.call) f.push('s-pushed');
    if (e >= T.ended) f.push('s-ended');
    if (e >= T.out) f.push('s-out');
    let walk = 0, buzz = false;
    T.bursts.forEach((b) => { if (e >= b[0] && e < b[1]) buzz = true; if (e >= b[1]) walk++; });
    if (buzz) f.push('s-buzz');
    const flags = f.join(' ');
    const key = flags + '|' + walk;
    if (key !== this.key) {
      this.key = key;
      const live = (e >= T.call && e < T.ended) ? 'Incoming call from THE GAME' : ((e >= T.ended && e < T.out) ? 'The call ended.' : '');
      this.setState({ flags, walk, live });
    }
    if (e >= T.done) { this.finish(); return; }
    this.raf = requestAnimationFrame(() => this.tick());
  }

  skip() {
    if (this.done || this.state.mode !== 'play') return;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    const keep = (this.state.flags || '').split(' ').filter((c) => c && c !== 's-buzz' && c !== 's-call');
    ['s-lit', 's-out', 's-skip'].forEach((c) => { if (keep.indexOf(c) < 0) keep.push(c); });
    this.setState({ flags: keep.join(' '), live: '' });
    this.killAudio(0.35);
    this.timers.push(window.setTimeout(() => this.finish(), 480));
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.killAudio(0.2);
    this.setState({ mode: 'done', flags: 's-out', live: '' });
    try { this.onComplete(); } catch { /* ignore */ }
  }

  /* ---------- sound design (synthesised, no files) ---------- */
  private initAudio() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = new AC();
      const master = c.createGain();
      master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(c.destination);
      if (c.state === 'suspended' && c.resume) void c.resume();
      this.ctx = c;
      this.master = master;
    } catch { this.ctx = null; }
  }

  private killAudio(fade: number) {
    const c = this.ctx;
    if (!c) return;
    this.ctx = null;
    const m = this.master!;
    try {
      const now = c.currentTime;
      m.gain.cancelScheduledValues(now);
      m.gain.setValueAtTime(m.gain.value, now);
      m.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fade));
    } catch { /* ignore */ }
    setTimeout(() => { try { void c.close(); } catch { /* ignore */ } }, Math.max(60, fade * 1000 + 80));
  }

  private noise(seconds: number, brown: boolean) {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else { d[i] = w; }
    }
    return buf;
  }

  private filt(type: BiquadFilterType, freq: number, q?: number) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    return f;
  }

  private scheduleAudio() {
    const c = this.ctx!, M = this.master!, T = TL;
    const t0 = c.currentTime + 0.03;
    const white = this.noise(2, false), brown = this.noise(4, true);

    // 1. room tone
    const amb = c.createBufferSource(); amb.buffer = brown; amb.loop = true;
    const ambG = c.createGain();
    ambG.gain.setValueAtTime(0.0001, t0);
    ambG.gain.exponentialRampToValueAtTime(0.09, t0 + 1.6);
    ambG.gain.setValueAtTime(0.09, t0 + T.out);
    ambG.gain.linearRampToValueAtTime(0.0001, t0 + T.done);
    amb.connect(this.filt('lowpass', 380)).connect(ambG).connect(M);
    amb.start(t0);
    const hum = c.createOscillator(); hum.frequency.value = 58;
    const humG = c.createGain();
    humG.gain.setValueAtTime(0.0001, t0);
    humG.gain.linearRampToValueAtTime(0.004, t0 + 1.6);
    humG.gain.setValueAtTime(0.004, t0 + T.out);
    humG.gain.linearRampToValueAtTime(0.0001, t0 + T.done);
    hum.connect(humG).connect(M);
    hum.start(t0); hum.stop(t0 + T.done + 0.1);

    // 2. someone walks off; a door closes; a door closes somewhere in the room
    const verb = c.createConvolver();
    verb.buffer = this.impulse(1.6);
    const verbG = c.createGain(); verbG.gain.value = 0.55;
    verb.connect(verbG).connect(M);
    T.steps.forEach((st, i) => this.step(white, t0 + st, 0.5 - i * 0.09, verb));
    this.door(white, t0 + T.door, verb);

    // 4. ringtone, 5. vibration — both cut hard when the call ends
    this.ring(t0 + T.call, t0 + T.ended);
    const vib = c.createGain(); vib.gain.value = 1; vib.connect(M);
    vib.gain.setValueAtTime(1, t0 + T.ended);
    vib.gain.linearRampToValueAtTime(0, t0 + T.ended + 0.006);
    T.bursts.forEach((b) => this.buzz(white, vib, t0 + b[0], t0 + b[1]));
  }

  private impulse(seconds: number) {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return buf;
  }

  private step(buf: AudioBuffer, t: number, amp: number, verb: AudioNode) {
    const c = this.ctx!;
    const out = c.createGain(); out.gain.value = 1;
    const lp = this.filt('lowpass', 900);
    out.connect(lp); lp.connect(this.master!); lp.connect(verb);
    const o = c.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.22 * amp, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.15);
    const n = c.createBufferSource(); n.buffer = buf;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(0.12 * amp, t + 0.01); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(this.filt('bandpass', 420, 1.2)).connect(ng).connect(out);
    n.start(t, Math.random()); n.stop(t + 0.12);
  }

  private door(buf: AudioBuffer, t: number, verb: AudioNode) {
    const c = this.ctx!, M = this.master!;
    const out = c.createGain(); out.gain.value = 1;
    const lp = this.filt('lowpass', 2200);
    out.connect(lp); lp.connect(M); lp.connect(verb);
    // air pushed by the swinging door
    const a = c.createBufferSource(); a.buffer = buf;
    const ag = c.createGain();
    ag.gain.setValueAtTime(0.0001, t - 0.35); ag.gain.linearRampToValueAtTime(0.03, t - 0.05); ag.gain.linearRampToValueAtTime(0.0001, t + 0.02);
    a.connect(this.filt('bandpass', 500, 0.7)).connect(ag).connect(out);
    a.start(t - 0.35, Math.random()); a.stop(t + 0.05);
    // heavy body hitting the frame
    const o = c.createOscillator(); o.frequency.setValueAtTime(82, t); o.frequency.exponentialRampToValueAtTime(41, t + 0.3);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.7, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.45);
    const b = c.createBufferSource(); b.buffer = buf;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.5, t + 0.004); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    b.connect(this.filt('lowpass', 420)).connect(bg).connect(out);
    b.start(t, Math.random()); b.stop(t + 0.2);
    // panel rattle
    const r = c.createBufferSource(); r.buffer = buf;
    const rg = c.createGain();
    rg.gain.setValueAtTime(0.0001, t + 0.01); rg.gain.linearRampToValueAtTime(0.12, t + 0.02); rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    r.connect(this.filt('bandpass', 240, 5)).connect(rg).connect(out);
    r.start(t + 0.01, Math.random()); r.stop(t + 0.2);
    // latch click
    [0.035, 0.07].forEach((d, i) => {
      const k = c.createBufferSource(); k.buffer = buf;
      const kg = c.createGain();
      kg.gain.setValueAtTime(i ? 0.12 : 0.2, t + d); kg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.02);
      k.connect(this.filt('bandpass', 3200, 2)).connect(kg).connect(out);
      k.start(t + d, Math.random()); k.stop(t + d + 0.03);
    });
  }

  private ring(start: number, end: number) {
    const c = this.ctx!;
    const bus = c.createGain(); bus.gain.value = 1;
    bus.connect(this.filt('highpass', 420)).connect(this.filt('lowpass', 3600)).connect(this.master!);
    bus.gain.setValueAtTime(1, end);
    bus.gain.linearRampToValueAtTime(0, end + 0.008);
    const notes: [number, number][] = [[0, 659.25], [0.17, 587.33], [0.34, 523.25], [0.51, 493.88], [0.85, 659.25], [1.02, 415.3]];
    for (let k = 0; start + k * 1.7 < end; k++) {
      notes.forEach((nt) => {
        const t = start + k * 1.7 + nt[0];
        if (t >= end) return;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.11, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        g.connect(bus);
        const a = c.createOscillator(); a.type = 'sine'; a.frequency.value = nt[1];
        const b = c.createOscillator(); b.type = 'triangle'; b.frequency.value = nt[1] * 2;
        const bg = c.createGain(); bg.gain.value = 0.22;
        a.connect(g); b.connect(bg).connect(g);
        a.start(t); b.start(t); a.stop(t + 0.6); b.stop(t + 0.6);
      });
    }
  }

  private buzz(buf: AudioBuffer, bus: AudioNode, s: number, e: number) {
    const c = this.ctx!;
    const env = (g: GainNode, peak: number) => {
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(peak, s + 0.02);
      g.gain.setValueAtTime(peak, Math.max(s + 0.02, e - 0.03));
      g.gain.linearRampToValueAtTime(0, e);
    };
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 168;
    const og = c.createGain(); env(og, 0.07);
    const lfo = c.createOscillator(); lfo.frequency.value = 23;
    const lg = c.createGain(); lg.gain.value = 0.025;
    lfo.connect(lg).connect(og.gain);
    o.connect(this.filt('lowpass', 700, 1)).connect(og).connect(bus);
    const w = c.createBufferSource(); w.buffer = buf; w.loop = true;
    const wg = c.createGain(); env(wg, 0.35);
    w.connect(this.filt('bandpass', 230, 4)).connect(wg).connect(bus);
    const r = c.createBufferSource(); r.buffer = buf; r.loop = true;
    const rg = c.createGain(); env(rg, 0.05);
    r.connect(this.filt('bandpass', 1100, 6)).connect(rg).connect(bus);
    [o, lfo, w, r].forEach((n) => { n.start(s); n.stop(e + 0.03); });
  }
}
