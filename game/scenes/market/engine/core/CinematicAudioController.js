/**
 * CinematicAudioController
 * ------------------------
 * Web Audio engine shared by every environment.
 *
 * All sounds are synthesized at runtime (physical-ish models: filtered noise
 * for friction, inharmonic partials for metal, damped resonators for wood).
 * This keeps the project asset-free and lets every sound vary slightly each
 * time, which avoids the "same sample again" loop feel. Any sound can be
 * replaced with a recorded file later via `registerSample(name, url)` — the
 * call sites do not change.
 *
 * Browser autoplay: nothing is created until `unlock()` is called from a user
 * gesture.
 */

const rand = (a, b) => a + Math.random() * (b - a);

export class CinematicAudioController {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.samples = new Map();
    this._loops = {};
  }

  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Must be called from a click/keypress handler. Safe to call repeatedly. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // Concrete-room reverb (generated impulse response)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.9, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    this._noise = this._noiseBuffer(3, 'white');
    this._brown = this._noiseBuffer(6, 'brown');
    if (ctx.state === 'suspended') await ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.now, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.now, 0.05);
  }

  /** Keep the Web Audio listener glued to the camera for spatial sounds. */
  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const p = { x: e[12], y: e[13], z: e[14] };
    const f = { x: -e[8], y: -e[9], z: -e[10] };
    const u = { x: e[4], y: e[5], z: e[6] };
    const t = this.now;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  async registerSample(name, url) {
    if (!this.ctx) return;
    const buf = await fetch(url).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b));
    this.samples.set(name, buf);
  }

  // ───────────────────────────────────────────────────────── public sound API

  /**
   * play(name, { position:[x,y,z], gain, pitch, at, wet })
   * `at` = seconds from now (use for sample-accurate sync with a timeline).
   */
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.now + (opts.at || 0);
    const out = this._out(opts);
    if (this.samples.has(name)) return this._playSample(name, out, t, opts);
    const fn = this[`_s_${name}`];
    if (fn) fn.call(this, out, t, opts);
    else console.warn('[audio] unknown sound', name);
  }

  /** The Black Market motif — two deliberate knocks on wood. */
  playTwoTap({ gap = 0.62, position, gain = 1, distant = false } = {}) {
    const o = { position, gain: distant ? gain * 0.18 : gain, wet: distant ? 2.5 : 0.35 };
    this.play('knock', { ...o, variant: 'deep' });
    this.play('knock', { ...o, variant: 'sharp', at: gap });
  }

  /** Underground room bed: air, ventilation hum, distant structure rumble. */
  startAmbience(fade = 2.5) {
    if (!this.ctx || this._loops.amb) return;
    const ctx = this.ctx, t = this.now;
    const g = ctx.createGain(); g.gain.value = 0;
    g.connect(this.dry);
    const g2 = ctx.createGain(); g2.gain.value = 0.25; g.connect(g2).connect(this.reverbSend);

    const rumble = this._loopNoise(this._brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    rumble.connect(lp).connect(rg).connect(g);

    const air = this._loopNoise(this._noise);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
    const ag = ctx.createGain(); ag.gain.value = 0.012;
    air.connect(bp).connect(ag).connect(g);

    // Ventilation: detuned low hum with slow beating
    const hum = [];
    for (const [f, a] of [[47.6, 0.05], [95.3, 0.03], [143.1, 0.012], [190.4, 0.006]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = a;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rand(0.05, 0.13);
      const lg = ctx.createGain(); lg.gain.value = a * 0.4;
      lfo.connect(lg).connect(og.gain);
      o.connect(og).connect(g); o.start(t); lfo.start(t);
      hum.push(o, lfo);
    }
    g.gain.setTargetAtTime(0.5, t, fade / 3);
    this._loops.amb = { g, nodes: [rumble, air, ...hum] };
  }

  stopAmbience(fade = 1.5) {
    const a = this._loops.amb;
    if (!a) return;
    delete this._loops.amb;
    a.g.gain.cancelScheduledValues(this.now);
    a.g.gain.setTargetAtTime(0, this.now, fade / 4);
    setTimeout(() => a.nodes.forEach((n) => { try { n.stop(); } catch {} }), fade * 1000 + 200);
  }

  /** Electrical lamp buzz; level 0..1 follows the lamp's intensity. */
  setLampBuzz(level, position) {
    if (!this.ctx) return;
    if (!this._loops.buzz) {
      if (level <= 0) return;
      const ctx = this.ctx, t = this.now;
      const out = this._out({ position, wet: 0.15 });
      const g = ctx.createGain(); g.gain.value = 0; g.connect(out);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 200.4;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 1.4;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      o.connect(bp); o2.connect(g2).connect(bp); bp.connect(hp).connect(g);
      o.start(t); o2.start(t);
      this._loops.buzz = { g, nodes: [o, o2] };
    }
    const b = this._loops.buzz;
    b.g.gain.setTargetAtTime(Math.max(0, level) * 0.035, this.now, 0.015);
  }

  stopLampBuzz() {
    const b = this._loops.buzz;
    if (!b) return;
    delete this._loops.buzz;
    b.g.gain.setTargetAtTime(0, this.now, 0.05);
    setTimeout(() => b.nodes.forEach((n) => { try { n.stop(); } catch {} }), 500);
  }

  stopAll(fade = 0.6) {
    this.stopAmbience(fade);
    this.stopStoreAmbience(fade);
    this.stopLampBuzz();
  }

  dispose() {
    this.stopAll(0.05);
    this.ctx?.close();
    this.ctx = null;
  }

  // ───────────────────────────────────────────────────────── synthesis

  _s_knock(out, t, { variant = 'deep', gain = 1 }) {
    const ctx = this.ctx;
    const deep = variant === 'deep';
    const f0 = (deep ? 168 : 224) * rand(0.98, 1.02);
    const g = ctx.createGain(); g.gain.value = gain * 0.9; g.connect(out);
    // 1) fingertip/knuckle transient
    this._burst(g, t, { dur: 0.006, type: 'bandpass', freq: deep ? 1900 : 3100, q: 1.1, gain: deep ? 0.55 : 0.75 });
    // 2) board body: two damped modes of a thick oak top
    this._partial(g, t, f0, deep ? 0.11 : 0.075, 0.55);
    this._partial(g, t, f0 * 2.71, deep ? 0.05 : 0.04, 0.22);
    this._partial(g, t, f0 * 4.9, 0.02, deep ? 0.06 : 0.12);
    // 3) cavity ring under the desk top
    this._burst(g, t, { dur: deep ? 0.12 : 0.08, type: 'bandpass', freq: deep ? 480 : 690, q: 7, gain: 0.5, decay: true });
  }

  _s_doorCreak(out, t, { dur = 2.4, gain = 1 }) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(out);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    // Hinge friction: pitch wanders with the door's angular velocity
    const N = 64, curve = new Float32Array(N);
    let f = rand(140, 180);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      f += rand(-18, 22) + Math.sin(x * Math.PI) * 6;
      curve[i] = Math.min(520, Math.max(90, f));
    }
    o.frequency.setValueCurveAtTime(curve, t, dur);
    // Stick-slip grain
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = rand(26, 34);
    const amg = ctx.createGain(); amg.gain.value = 0.45;
    const vca = ctx.createGain(); vca.gain.value = 0.55;
    am.connect(amg).connect(vca.gain);
    const sum = ctx.createGain();
    for (const [fr, q, a] of [[780, 9, 1], [1530, 10, 0.7], [2650, 12, 0.35]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr * rand(0.95, 1.05); bp.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = a;
      o.connect(bp).connect(bg).connect(sum);
    }
    sum.connect(vca).connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * gain, t + 0.25);
    g.gain.setValueAtTime(0.16 * gain, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0.09 * gain, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
    // Low groan of the heavy slab moving
    this._burst(out, t, { dur, type: 'lowpass', freq: 220, q: 1, gain: 0.25 * gain, swell: true });
  }

  _s_doorSlam(out, t, { gain = 1 }) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain; g.connect(out);
    // Thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(68, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(og).connect(g); o.start(t); o.stop(t + 0.75);
    this._burst(g, t, { dur: 0.16, type: 'lowpass', freq: 900, q: 0.7, gain: 0.9, decay: true });
    // Steel door panel modes (inharmonic)
    for (const [f, d, a] of [[137, 1.6, 0.16], [291, 1.2, 0.1], [463, 0.9, 0.07], [811, 0.7, 0.05], [1290, 0.5, 0.035], [2033, 0.35, 0.02]]) {
      this._partial(g, t, f * rand(0.98, 1.02), d, a);
    }
    // Latch
    this._burst(g, t + 0.11, { dur: 0.012, type: 'bandpass', freq: 2600, q: 3, gain: 0.35 });
    this._partial(g, t + 0.11, 1870, 0.12, 0.05);
  }

  _s_lampOn(out, t, { gain = 1 }) {
    this._burst(out, t, { dur: 0.008, type: 'highpass', freq: 3000, q: 0.7, gain: 0.25 * gain });
    this._partial(out, t, 2480, 0.09, 0.02 * gain);
  }

  _s_paperSlide(out, t, { dur = 0.6, gain = 1 }) {
    this._burst(out, t, { dur, type: 'bandpass', freq: 2600, q: 0.7, gain: 0.22 * gain, swell: true, rough: true });
  }

  _s_fabric(out, t, { dur = 0.7, gain = 1 }) {
    this._burst(out, t, { dur, type: 'bandpass', freq: 650, q: 0.6, gain: 0.18 * gain, swell: true, rough: true });
  }

  _s_woodSlide(out, t, { dur = 0.9, gain = 1 }) {
    this._burst(out, t, { dur, type: 'bandpass', freq: 260, q: 1.6, gain: 0.5 * gain, swell: true, rough: true });
    this._burst(out, t, { dur, type: 'bandpass', freq: 1400, q: 1.2, gain: 0.05 * gain, swell: true, rough: true });
  }

  _s_woodContact(out, t, { gain = 1 }) {
    this._burst(out, t, { dur: 0.004, type: 'bandpass', freq: 1500, q: 1, gain: 0.25 * gain });
    this._partial(out, t, rand(190, 230), 0.06, 0.18 * gain);
  }

  _s_tokenClink(out, t, { gain = 1, pitch = 1 }) {
    this._burst(out, t, { dur: 0.003, type: 'highpass', freq: 4000, q: 0.7, gain: 0.2 * gain });
    for (const [f, d, a] of [[2350, 0.32, 0.06], [3720, 0.22, 0.045], [5130, 0.14, 0.03], [6980, 0.08, 0.02]]) {
      this._partial(out, t, f * pitch * rand(0.99, 1.01), d, a * gain);
    }
  }

  _s_tokenSlide(out, t, { dur = 0.4, gain = 1 }) {
    this._burst(out, t, { dur, type: 'bandpass', freq: 4200, q: 2.5, gain: 0.06 * gain, swell: true, rough: true });
    this._burst(out, t, { dur, type: 'bandpass', freq: 320, q: 2, gain: 0.12 * gain, swell: true, rough: true });
  }

  _s_coinPouch(out, t, { gain = 1 }) {
    // leather thud + muffled coins shifting inside
    this._burst(out, t, { dur: 0.09, type: 'lowpass', freq: 380, q: 0.8, gain: 0.7 * gain, decay: true });
    this._partial(out, t, 92, 0.12, 0.25 * gain);
    for (let i = 0; i < 7; i++) {
      const dt = rand(0.004, 0.16);
      const p = rand(0.7, 1.15);
      for (const [f, d, a] of [[2900, 0.08, 0.025], [4400, 0.05, 0.015]]) this._partial(out, t + dt, f * p, d, a * gain * rand(0.4, 1));
    }
  }

  _s_coinsShift(out, t, { gain = 1 }) {
    for (let i = 0; i < 5; i++) {
      const dt = rand(0, 0.25), p = rand(0.75, 1.1);
      this._partial(out, t + dt, 3100 * p, 0.06, 0.018 * gain);
    }
    this._s_fabric(out, t, { dur: 0.35, gain: 0.6 * gain });
  }

  _s_distantMetal(out, t, { gain = 1 }) {
    // far-away pipe/door clank: only reverb, muffled
    const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.reverbSend);
    g.gain.setValueAtTime(0.5 * gain, t);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(g);
    for (const [f, d, a] of [[183, 1.4, 0.12], [377, 1.0, 0.07], [612, 0.7, 0.04]]) this._partial(lp, t, f * rand(0.95, 1.05), d, a);
    this._burst(lp, t, { dur: 0.05, type: 'lowpass', freq: 500, q: 1, gain: 0.6, decay: true });
    this._partial(lp, t + 0.38, 241, 0.6, 0.04);
  }

  _s_footstep(out, t, { gain = 1 }) {
    this._burst(out, t, { dur: 0.05, type: 'lowpass', freq: 520, q: 0.9, gain: 0.35 * gain, decay: true });
    this._burst(out, t + 0.012, { dur: 0.02, type: 'bandpass', freq: 2100, q: 1.2, gain: 0.05 * gain, decay: true });
  }

  _s_folderSlam(out, t, { gain = 1 }) {
    this._burst(out, t, { dur: 0.05, type: 'lowpass', freq: 1400, q: 0.7, gain: 0.8 * gain, decay: true });
    this._partial(out, t, 120, 0.12, 0.35 * gain);
    this._burst(out, t + 0.01, { dur: 0.15, type: 'bandpass', freq: 3200, q: 0.8, gain: 0.08 * gain, decay: true });
  }

  // ───────────────────────────────────────────────────────── convenience store

  /** Two-tone entry chime of an automatic door (ding… dong). */
  _s_chime(out, t, { gain = 1 }) {
    for (const [f, at] of [[1318.5, 0], [1046.5, 0.42]]) {
      for (const [m, d, a] of [[1, 1.4, 0.12], [2.76, 0.6, 0.03], [5.4, 0.25, 0.012]]) this._partial(out, t + at, f * m, d, a * gain);
    }
  }

  /** Automatic sliding door: motor whine + rubber seal swish. */
  _s_doorSlide(out, t, { dur = 1.4, gain = 1 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(115, t + dur * 0.4); o.frequency.linearRampToValueAtTime(80, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * gain, t + 0.15); g.gain.setValueAtTime(0.05 * gain, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
    this._burst(out, t, { dur, type: 'bandpass', freq: 1800, q: 0.6, gain: 0.07 * gain, swell: true });
    this._burst(out, t + dur - 0.08, { dur: 0.05, type: 'lowpass', freq: 600, q: 0.8, gain: 0.2 * gain, decay: true }); // end stop
  }

  /** Barcode scanner beep. */
  _s_beep(out, t, { gain = 1, pitch = 1, dur = 0.09 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1760 * pitch;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * gain, t + 0.004);
    g.gain.setValueAtTime(0.06 * gain, t + dur - 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
  }

  /** Cash drawer: bell + roller + latch thunk. */
  _s_register(out, t, { gain = 1 }) {
    for (const [f, d, a] of [[2093, 0.9, 0.05], [2637, 0.7, 0.035], [4186, 0.4, 0.015]]) this._partial(out, t + 0.12, f, d, a * gain);
    this._burst(out, t, { dur: 0.16, type: 'bandpass', freq: 900, q: 1.2, gain: 0.25 * gain, swell: true, rough: true });
    this._burst(out, t + 0.17, { dur: 0.06, type: 'lowpass', freq: 500, q: 0.8, gain: 0.45 * gain, decay: true });
  }

  /** Coins dropping into the tray. */
  _s_coins(out, t, { gain = 1 }) {
    for (let i = 0; i < 6; i++) {
      const dt = i * 0.05 + Math.random() * 0.03, p = 0.85 + Math.random() * 0.3;
      for (const [f, d, a] of [[3300, 0.12, 0.03], [5100, 0.07, 0.016], [7600, 0.04, 0.008]]) this._partial(out, t + dt, f * p, d, a * gain);
    }
  }

  /** Thermal receipt printer chatter. */
  _s_printer(out, t, { dur = 1.1, gain = 1 }) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.connect(out);
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 38;
    const amg = ctx.createGain(); amg.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5;
    am.connect(amg).connect(vca.gain);
    const src = ctx.createBufferSource(); src.buffer = this._noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 1.4;
    src.connect(bp).connect(vca).connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * gain, t + 0.03); g.gain.setValueAtTime(0.12 * gain, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
    src.start(t); am.start(t); src.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
    this._burst(out, t + dur, { dur: 0.02, type: 'highpass', freq: 2500, q: 0.7, gain: 0.15 * gain }); // cutter
  }

  /** Paper bag opening / rustling. */
  _s_bag(out, t, { dur = 0.5, gain = 1 }) {
    this._burst(out, t, { dur, type: 'bandpass', freq: 2100, q: 0.5, gain: 0.25 * gain, swell: true, rough: true });
    this._burst(out, t, { dur: dur * 0.6, type: 'bandpass', freq: 600, q: 0.8, gain: 0.12 * gain, swell: true, rough: true });
  }

  /** Can set down on a counter. */
  _s_can(out, t, { gain = 1 }) {
    this._burst(out, t, { dur: 0.004, type: 'highpass', freq: 3000, q: 0.7, gain: 0.2 * gain });
    for (const [f, d, a] of [[880, 0.12, 0.05], [1720, 0.08, 0.03], [3100, 0.05, 0.015]]) this._partial(out, t, f, d, a * gain);
  }

  /** Store bed: fridge compressors + fluorescent hum (replaces the cellar ambience). */
  startStoreAmbience(fade = 2) {
    if (!this.ctx || this._loops.store) return;
    const ctx = this.ctx, t = this.now;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.dry);
    const nodes = [];
    for (const [f, a] of [[59.8, 0.05], [120, 0.035], [180.2, 0.012], [240, 0.008]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(g); o.start(t); nodes.push(o);
    }
    const n = this._loopNoise(this._brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const ng = ctx.createGain(); ng.gain.value = 0.35; n.connect(lp).connect(ng).connect(g); nodes.push(n);
    // fluorescent ballast whine
    const w = ctx.createOscillator(); w.frequency.value = 7900;
    const wg = ctx.createGain(); wg.gain.value = 0.0025; w.connect(wg).connect(g); w.start(t); nodes.push(w);
    g.gain.setTargetAtTime(0.45, t, fade / 3);
    this._loops.store = { g, nodes };
  }

  stopStoreAmbience(fade = 1) {
    const a = this._loops.store;
    if (!a) return;
    delete this._loops.store;
    a.g.gain.cancelScheduledValues(this.now);
    a.g.gain.setTargetAtTime(0, this.now, fade / 4);
    setTimeout(() => a.nodes.forEach((n) => { try { n.stop(); } catch {} }), fade * 1000 + 200);
  }

  // ───────────────────────────────────────────────────────── building blocks

  _out({ position, wet = 0.3, gain = 1 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 1;
    let head = g;
    if (position) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 0.8; p.rolloffFactor = 1;
      if (p.positionX) { p.positionX.value = position[0]; p.positionY.value = position[1]; p.positionZ.value = position[2]; }
      else p.setPosition(...position);
      g.connect(p); head = p;
    }
    head.connect(this.dry);
    if (wet > 0) {
      const s = ctx.createGain(); s.gain.value = wet * 0.35; head.connect(s).connect(this.reverbSend);
    }
    // auto-disconnect after a while so the graph never grows
    setTimeout(() => { try { g.disconnect(); head.disconnect(); } catch {} }, 8000);
    return g;
  }

  _partial(dest, t, freq, decay, amp) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(amp, 0.0002), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + decay + 0.02);
  }

  _burst(dest, t, { dur, type, freq, q, gain, decay = false, swell = false, rough = false }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this._noise;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    if (swell) {
      // rise–sustain–fall, with irregular micro-variation for friction textures
      const N = 48, c = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        let v = Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 0.8;
        if (rough) v *= 0.65 + Math.random() * 0.35;
        c[i] = Math.max(0, v) * gain;
      }
      c[N - 1] = 0;
      g.gain.setValueCurveAtTime(c, t, dur);
    } else if (decay) {
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.0008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.01);
    }
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  _loopNoise(buf) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start();
    return s;
  }

  _playSample(name, out, t, { gain = 1, pitch = 1 }) {
    const s = this.ctx.createBufferSource(); s.buffer = this.samples.get(name);
    s.playbackRate.value = pitch;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(out); s.start(t);
  }

  _noiseBuffer(seconds, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    // crossfade ends so loops are seamless
    const xf = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[n - xf + i] * (1 - a); }
    return b;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        // early reflections off close concrete walls, then a darker diffuse tail
        const er = i < ctx.sampleRate * 0.04 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 1.5 : 0;
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - x * 0.45);
        d[i] = (lp + er) * Math.pow(1 - x, decay);
      }
    }
    return b;
  }
}
