import gsap from 'gsap';

/**
 * Rare atmospheric events. Fires only while the market is idle (some events
 * are allowed during hover because they don't move the dealer). Never runs
 * during inspections, purchases, entrance or exit.
 */
export class AmbientEventScheduler {
  constructor({ room, dealerAnim, audio, isAllowed, reducedMotion }) {
    Object.assign(this, { room, dealerAnim, audio, isAllowed, reducedMotion });
    this.enabled = true;
    this._timer = null;
    this._tl = null;
    this.minGap = 12;
    this.maxGap = 26;
  }

  start() {
    this.stop();
    if (!this.enabled) return;
    this._schedule();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  /** Kill any running event and put the lamp back to full. */
  interrupt() {
    if (this._tl) {
      this._tl.kill();
      this._tl = null;
      this.room.setLampLevel(this._lampBase ?? 1);
      this.audio.setLampBuzz(0.35, this._buzzPos());
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.start(); else { this.stop(); this.interrupt(); }
  }

  _schedule() {
    clearTimeout(this._timer);
    const sec = this.minGap + Math.random() * (this.maxGap - this.minGap);
    this._timer = setTimeout(() => this._fire(), sec * 1000);
  }

  _fire() {
    if (!this.enabled) return;
    const mode = this.isAllowed();
    if (!mode) { this._schedule(); return; }
    // dealer-moving events only in full idle; lamp/noise also allowed during hover
    const pool = mode === 'idle'
      ? [['lampFlicker', 3], ['dealerNotices', 2], ['distantNoise', 2], ['objectAdjust', 1.5], ['fingerMovement', 2]]
      : [['lampFlicker', 2], ['distantNoise', 1]];
    let r = Math.random() * pool.reduce((a, [, w]) => a + w, 0), pick = pool[0][0];
    for (const [k, w] of pool) { if ((r -= w) <= 0) { pick = k; break; } }
    this.trigger(pick);
    this._schedule();
  }

  /** Manually trigger an event (dev preview). */
  trigger(name) {
    if (this._tl && this._tl.isActive()) return;
    const fn = this[`_${name}`];
    if (!fn) return;
    const tl = fn.call(this) || null;
    this._tl = tl;
    // .then() instead of eventCallback so we never replace the event's own onComplete
    tl?.then(() => { if (this._tl === tl) this._tl = null; });
  }

  _buzzPos() { return [this.room.lamp.position.x, this.room.lamp.position.y, this.room.lamp.position.z]; }

  _lampFlicker() {
    if (this.reducedMotion) return null;
    const room = this.room, base = room.lampLevel;
    this._lampBase = base;
    const o = { v: base };
    const set = () => { room.setLampLevel(o.v); this.audio.setLampBuzz(0.35 + (base - o.v) * 2.2, this._buzzPos()); };
    // a brief, irregular dip — never a strobe
    return gsap.timeline()
      .to(o, { v: base * 0.55, duration: 0.06, ease: 'none', onUpdate: set })
      .to(o, { v: base * 0.92, duration: 0.09, onUpdate: set })
      .to(o, { v: base * 0.7, duration: 0.05, onUpdate: set })
      .to(o, { v: base, duration: 0.35, ease: 'power2.out', onUpdate: set })
      .call(() => this.audio.setLampBuzz(0.35, this._buzzPos()));
  }

  _dealerNotices() { return this.dealerAnim.reactToNoise(); }

  _distantNoise() {
    this.audio.play('distantMetal', { gain: 0.8 });
    const tl = this.dealerAnim.reactToNoise();
    return tl;
  }

  _objectAdjust() {
    this.dealerAnim.interruptIdle(false);
    const tl = this.dealerAnim._idle_adjust();
    this.dealerAnim.idleTl = tl;
    tl.eventCallback('onComplete', () => { this.dealerAnim.idleTl = null; this.dealerAnim.setIdleAllowed(this.dealerAnim._idleAllowed); });
    return tl;
  }

  _fingerMovement() {
    this.dealerAnim.interruptIdle(false);
    const tl = this.dealerAnim._idle_fingers();
    this.dealerAnim.idleTl = tl;
    tl.eventCallback('onComplete', () => { this.dealerAnim.idleTl = null; this.dealerAnim.setIdleAllowed(this.dealerAnim._idleAllowed); });
    return tl;
  }

  dispose() {
    this.stop();
    this._tl?.kill();
  }
}
