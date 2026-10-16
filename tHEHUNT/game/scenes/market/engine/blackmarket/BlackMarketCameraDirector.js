import * as THREE from 'three';
import gsap from 'gsap';

/**
 * BlackMarketCameraDirector
 * -------------------------
 * The ONLY object allowed to move the camera while in the Black Market.
 * Authored moves are CatmullRom paths (position + look target) driven by one
 * eased progress value, so a move is a single tween that can be killed and
 * replaced without two controllers fighting. Two small additive layers sit on
 * top: a hover "attention" nudge and a near-imperceptible handheld drift.
 */

export const SHOTS = {
  // just outside the metal door, looking through it toward the dealer
  doorway: { pos: [3.05, 1.6, 1.3], look: [0.0, 1.0, -1.1] },
  // through the doorway (waypoint), then close on the seated dealer
  inside: { pos: [1.6, 1.52, 0.85], look: [0.0, 1.0, -1.15] },
  dealerClose: { pos: [0.12, 1.3, 0.22], look: [0.0, 1.04, -1.25] },
  // the "back" view: the dealer sitting behind his desk, the table below him
  dealerView: { pos: [0.32, 1.45, 1.05], look: [0.0, 0.95, -1.05] },
  // looking down over the spread merchandise
  desk: { pos: [0.0, 1.82, 0.16], look: [0.0, 0.76, -0.52] },
  purchase: { pos: [0.1, 1.2, 0.24], look: [0.08, 0.84, -0.74] },
};

const v = (a) => new THREE.Vector3(...a);

export class BlackMarketCameraDirector {
  constructor({ camera, engine, shots = SHOTS }) {
    this.shots = shots;
    this.camera = camera;
    this.engine = engine;
    this.base = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.nudge = new THREE.Vector3();
    this.nudgeTarget = new THREE.Vector3();
    this.lookNudge = new THREE.Vector3();
    this.lookNudgeTarget = new THREE.Vector3();
    this.handheld = !engine.reducedMotion;
    this.tl = null;
    this.focusDistance = 1.6;
    this.dof = { enabled: false, aperture: 0.0016 };
  }

  get reduced() { return this.engine.reducedMotion; }

  set(shot) {
    const s = typeof shot === 'string' ? this.shots[shot] : shot;
    this.kill();
    this.nudge.set(0, 0, 0); this.nudgeTarget.set(0, 0, 0); this.lookNudge.set(0, 0, 0); this.lookNudgeTarget.set(0, 0, 0);
    this.base.pos.copy(s.pos instanceof THREE.Vector3 ? s.pos : v(s.pos));
    this.base.look.copy(s.look instanceof THREE.Vector3 ? s.look : v(s.look));
    this._apply();
  }

  kill() {
    this.tl?.kill();
    this.tl = null;
  }

  /**
   * Move along a sequence of shots, starting from wherever the camera is now.
   * Returns the GSAP tween (add it to a parent timeline or await it).
   */
  moveAlong(shots, { duration = 2.5, ease = 'power2.inOut' } = {}) {
    // Bake the additive layers (hover lean) into the base first, so the move
    // starts exactly where the camera is on screen. Releasing the lean while
    // also starting a move was what made the camera tilt back, then forward.
    this._bakeLayers();
    const pts = shots.map((s) => (typeof s === 'string' ? this.shots[s] : s));
    const posPts = [this.base.pos.clone(), ...pts.map((p) => (p.pos instanceof THREE.Vector3 ? p.pos.clone() : v(p.pos)))];
    const lookPts = [this.base.look.clone(), ...pts.map((p) => (p.look instanceof THREE.Vector3 ? p.look.clone() : v(p.look)))];
    const pc = new THREE.CatmullRomCurve3(posPts, false, 'centripetal');
    const lc = new THREE.CatmullRomCurve3(lookPts, false, 'centripetal');
    const prog = { t: 0 };

    if (this.reduced) {
      // Reduced motion: no travel. Fade, cut, fade.
      const tl = gsap.timeline();
      tl.to(this.engine, { fade: Math.max(this.engine.fade, 0.85), duration: 0.25 });
      tl.call(() => { this.base.pos.copy(posPts.at(-1)); this.base.look.copy(lookPts.at(-1)); });
      tl.to(this.engine, { fade: 0, duration: 0.3 });
      return tl;
    }

    return gsap.to(prog, {
      t: 1, duration, ease,
      onUpdate: () => {
        pc.getPoint(prog.t, this.base.pos);
        lc.getPoint(prog.t, this.base.look);
      },
    });
  }

  /** Small attention shift toward a point (hover). Pass null to release. */
  attend(point, strength = 1) {
    if (!point) { this.nudgeTarget.set(0, 0, 0); this.lookNudgeTarget.set(0, 0, 0); return; }
    const d = point.clone().sub(this.base.look);
    // a gentle lean of attention, not a pan
    this.lookNudgeTarget.copy(d).multiplyScalar(0.08 * strength);
    this.nudgeTarget.copy(d).multiplyScalar(0.015 * strength).setY(0);
  }

  _bakeLayers() {
    this.base.pos.add(this.nudge);
    this.base.look.add(this.lookNudge);
    this.nudge.set(0, 0, 0); this.nudgeTarget.set(0, 0, 0);
    this.lookNudge.set(0, 0, 0); this.lookNudgeTarget.set(0, 0, 0);
  }

  /** Depth of field that fades in/out (aperture tween) instead of switching. */
  setDOF(enabled, aperture = 0.0016, duration = 0.8) {
    gsap.killTweensOf(this.dof);
    if (this.reduced) { this.dof.enabled = false; return; }
    if (enabled) {
      if (!this.dof.enabled) { this.dof.enabled = true; this.dof.aperture = 0; }
      gsap.to(this.dof, { aperture, duration, ease: 'sine.inOut' });
    } else if (this.dof.enabled) {
      gsap.to(this.dof, { aperture: 0, duration, ease: 'sine.inOut', onComplete: () => { this.dof.enabled = false; } });
    }
  }

  update(dt, t) {
    // critically-damped approach for the additive layers
    const k = 1 - Math.exp(-dt * 3.2); // slow, critically damped — no visible snap between targets
    this.nudge.lerp(this.nudgeTarget, k);
    this.lookNudge.lerp(this.lookNudgeTarget, k);
    this._apply(t);
  }

  _apply(t = 0) {
    const c = this.camera;
    c.position.copy(this.base.pos).add(this.nudge);
    const look = (this._look ||= new THREE.Vector3()).copy(this.base.look).add(this.lookNudge);
    if (this.handheld) {
      // breathing camera operator: sub-centimetre, sub-degree, very slow
      c.position.x += Math.sin(t * 0.31) * 0.0012 + Math.sin(t * 0.83) * 0.0005;
      c.position.y += Math.sin(t * 0.47 + 1.1) * 0.0010;
      look.x += Math.sin(t * 0.27 + 2.0) * 0.0015;
      look.y += Math.sin(t * 0.39) * 0.0012;
    }
    c.lookAt(look);
    this.focusDistance = c.position.distanceTo(look);
    this.engine.setDepthOfField(this.dof.enabled, this.focusDistance, this.dof.aperture);
  }
}
