// Synthesised foley (Web Audio). No sample files, so no licensing to track.
// Every call takes a `variant` so each folder sounds slightly different.
// Swap any method for a recorded sample later without touching the sequences.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CinematicAudioController {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.9;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      // a touch of room: short filtered feedback delay
      const pre = c.createGain(); pre.gain.value = 1;
      const room = c.createDelay(0.2); room.delayTime.value = 0.031;
      const fb = c.createGain(); fb.gain.value = 0.22;
      const roomLp = c.createBiquadFilter(); roomLp.type = 'lowpass'; roomLp.frequency.value = 2200;
      const wet = c.createGain(); wet.gain.value = 0.18;
      pre.connect(comp);
      pre.connect(room); room.connect(roomLp); roomLp.connect(fb); fb.connect(room); roomLp.connect(wet); wet.connect(comp);
      comp.connect(this.master); this.master.connect(c.destination);
      this.bus = pre;
      // shared noise buffers
      this.white = this._noise('white');
      this.brown = this._noise('brown');
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  _noise(kind) {
    const c = this.ctx, len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  _src(buf, t) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.start(t, Math.random() * 1.5);
    return s;
  }

  _env(node, t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g); g.connect(this.bus);
    return g;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  _t(delay = 0) { return this.ctx.currentTime + Math.max(0, delay); }

  /** Air movement as a folder is thrown in. */
  whoosh(variant = 0, delay = 0, dur = 0.38) {
    if (!this.ready) return;
    const r = rng(variant * 31 + 7), t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 350, 0.9);
    bp.frequency.setValueAtTime(300 + r() * 100, t);
    bp.frequency.exponentialRampToValueAtTime(1100 + r() * 400, t + dur);
    s.connect(bp);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + r() * 0.02, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    bp.connect(g); g.connect(this.bus);
    s.stop(t + dur + 0.1);
  }

  /** Heavy paper folder hitting wood + documents shifting inside. */
  impact(variant = 0, delay = 0, strength = 1) {
    if (!this.ready) return;
    const r = rng(variant * 97 + 3), t = this._t(delay), c = this.ctx;
    // 1. body thump (the table answering)
    const o = c.createOscillator(); o.type = 'sine';
    const f0 = 92 + r() * 26;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.14);
    this._env(o, t, 0.55 * strength, 0.003, 0.2);
    o.start(t); o.stop(t + 0.3);
    // 2. low noise body
    const n1 = this._src(this.brown, t);
    const lp = this._filter('lowpass', 700 + r() * 300);
    n1.connect(lp); this._env(lp, t, 0.6 * strength, 0.002, 0.11 + r() * 0.04);
    n1.stop(t + 0.3);
    // 3. paper slap (the cardstock face)
    const n2 = this._src(this.white, t);
    const bp = this._filter('bandpass', 1700 + r() * 900, 0.8);
    n2.connect(bp); this._env(bp, t + 0.002, 0.42 * strength, 0.002, 0.05 + r() * 0.03);
    n2.stop(t + 0.2);
    // 4. documents inside shuffling: several micro crackles
    const k = 4 + Math.floor(r() * 4);
    for (let i = 0; i < k; i++) {
      const ti = t + 0.012 + r() * 0.17;
      const ni = this._src(this.white, ti);
      const hp = this._filter('bandpass', 2800 + r() * 3000, 1.2);
      ni.connect(hp); this._env(hp, ti, 0.05 + r() * 0.09, 0.002, 0.012 + r() * 0.025);
      ni.stop(ti + 0.08);
    }
  }

  /** Paper dragging over wood, decelerating with friction. */
  slide(variant = 0, delay = 0, dur = 0.5, strength = 1) {
    if (!this.ready) return;
    const r = rng(variant * 53 + 11), t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 1300 + r() * 500, 0.55);
    bp.frequency.setValueAtTime(1500 + r() * 400, t);
    bp.frequency.exponentialRampToValueAtTime(700 + r() * 200, t + dur);
    const hp = this._filter('highpass', 280);
    s.connect(hp); hp.connect(bp);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11 * strength, t + 0.015);
    // grainy friction: tiny random steps decaying linearly (constant friction)
    const steps = Math.floor(dur / 0.018);
    for (let i = 1; i < steps; i++) {
      const p = i / steps;
      g.gain.setValueAtTime(Math.max(0.0001, 0.11 * strength * (1 - p) * (0.6 + r() * 0.6)), t + i * 0.018);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
    bp.connect(g); g.connect(this.bus);
    s.stop(t + dur + 0.1);
  }

  /** Small soft tick when something comes to rest. */
  settle(variant = 0, delay = 0, strength = 1) {
    if (!this.ready) return;
    const r = rng(variant * 13 + 5), t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 800 + r() * 500, 1.1);
    s.connect(bp); this._env(bp, t, 0.06 * strength, 0.002, 0.03 + r() * 0.02);
    s.stop(t + 0.1);
    const s2 = this._src(this.brown, t);
    const lp = this._filter('lowpass', 300);
    s2.connect(lp); this._env(lp, t, 0.12 * strength, 0.003, 0.05);
    s2.stop(t + 0.12);
  }

  /** Gentle lift / pickup brush. */
  lift(variant = 0, delay = 0, strength = 1) {
    if (!this.ready) return;
    const r = rng(variant * 7 + 19), t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 2400 + r() * 800, 0.9);
    s.connect(bp); this._env(bp, t, 0.035 * strength, 0.04, 0.16);
    s.stop(t + 0.3);
  }

  /** Card stock flexing as the cover swings. */
  coverSwing(delay = 0, dur = 0.8, strength = 1) {
    if (!this.ready) return;
    const t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 600, 0.8);
    bp.frequency.setValueAtTime(550, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + dur);
    s.connect(bp);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045 * strength, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.connect(g); g.connect(this.bus);
    s.stop(t + dur + 0.1);
    // creak of the fold
    for (let i = 0; i < 3; i++) {
      const ti = t + 0.05 + i * dur * 0.22;
      const n = this._src(this.white, ti);
      const f = this._filter('bandpass', 3200 + i * 500, 2);
      n.connect(f); this._env(f, ti, 0.02, 0.003, 0.02);
      n.stop(ti + 0.05);
    }
  }

  /** Cover landing flat. */
  coverLand(delay = 0, strength = 1) {
    if (!this.ready) return;
    const t = this._t(delay);
    const s = this._src(this.brown, t);
    const lp = this._filter('lowpass', 520);
    s.connect(lp); this._env(lp, t, 0.32 * strength, 0.002, 0.09);
    s.stop(t + 0.2);
    const s2 = this._src(this.white, t);
    const bp = this._filter('bandpass', 1500, 0.8);
    s2.connect(bp); this._env(bp, t, 0.14 * strength, 0.002, 0.05);
    s2.stop(t + 0.15);
  }

  /** Loose photographs shifting. */
  photoShift(variant = 0, delay = 0) {
    if (!this.ready) return;
    const r = rng(variant * 17 + 1), t = this._t(delay);
    const s = this._src(this.white, t);
    const bp = this._filter('bandpass', 3500 + r() * 1500, 1.4);
    s.connect(bp); this._env(bp, t, 0.03 + r() * 0.02, 0.004, 0.05 + r() * 0.04);
    s.stop(t + 0.15);
  }

  dispose() {
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
