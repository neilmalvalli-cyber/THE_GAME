import * as THREE from 'three';
import gsap from 'gsap';
import { HALF_DEPTH } from './MerchandiseDesk.js';

/**
 * DealerAnimationController
 * -------------------------
 * Authored, deterministic GSAP timelines over the dealer's pose parameters
 * (see DealerCharacter) and the physical objects the dealer touches.
 *
 * Rules that keep motion believable:
 *  - every action starts from the CURRENT pose (no snapping),
 *  - objects in contact with a hand are driven by the same tween value as
 *    the hand (no sliding hands, no lag),
 *  - released objects keep their momentum and decelerate (friction ease),
 *  - long holds of complete stillness are part of the performance.
 */

const REST_CURL = [0.3, 0.3, 0.36, 0.42, 0.5];


export class DealerAnimationController {
  constructor({ dealer, desk, audio }) {
    this.dealer = dealer;
    this.desk = desk;
    this.audio = audio;
    this.pose = dealer.pose;
    this.idleEnabled = true;
    this.idleTl = null;
    this._idleTimer = null;
    this._idleAllowed = false;
    this.timeScale = 1;
    this._lastIdle = '';
  }

  get top() { return this.desk.top; }

  /** Dealer-space point from a world point. */
  local(world) { return this.dealer.toDealer(world, new THREE.Vector3()); }

  rest(side) { return this.dealer.restHand(side); }

  // ────────────────────────────────────────────── shared building blocks

  /** Tween a hand to a dealer-space wrist position with optional hand shape. */
  handTo(tl, side, pos, { dur = 0.9, ease = 'power2.inOut', pitch, yaw, roll, curl, at } = {}) {
    const H = this.pose[side];
    tl.to(H.pos, { x: pos.x, y: pos.y, z: pos.z, duration: dur, ease }, at);
    const shape = {};
    if (pitch !== undefined) shape.pitch = pitch;
    if (yaw !== undefined) shape.yaw = yaw;
    if (roll !== undefined) shape.roll = roll;
    // '<' = same start time as the position tween just added
    if (Object.keys(shape).length) tl.to(H, { ...shape, duration: dur, ease }, '<');
    if (curl) tl.to(H.curl, { ...Object.fromEntries(curl.map((c, i) => [i, c])), duration: dur * 0.8, ease: 'sine.inOut' }, '<');
    return tl;
  }

  /** Bring both hands and the body back to the neutral seated pose. */
  settle(tl, { dur = 1.1, at, lean = 0.02, headPitch = 0.14 } = {}) {
    const P = this.pose;
    tl.to(P, { lean, headPitch, headYaw: 0, headRoll: 0, shoulderRise: 0, breath: 1, duration: dur, ease: 'sine.inOut' }, at);
    for (const s of ['R', 'L']) {
      const r = this.rest(s);
      tl.to(P[s].pos, { x: r.x, y: r.y, z: r.z, duration: dur, ease: 'power2.inOut' }, '<');
      tl.to(P[s], { pitch: 0, yaw: 0, roll: 0, contact: 0, duration: dur, ease: 'power2.inOut' }, '<');
      tl.to(P[s].curl, { ...Object.fromEntries(REST_CURL.map((c, i) => [i, c])), duration: dur, ease: 'sine.inOut' }, '<');
    }
    return tl;
  }

  // ────────────────────────────────────────────── intro

  /** Pose before the lamp comes on: head bowed, hands resting back in the dark. */
  setPreIntro() {
    const P = this.pose;
    this.dealer.resetPose();
    P.headPitch = 0.55; P.lean = 0.06; P.breath = 0.6;
    for (const s of ['R', 'L']) {
      const r = this.rest(s);
      P[s].pos.set(r.x * 1.05, r.y, r.z - 0.06);
    }
  }

  /**
   * The camera arrives on him: complete stillness → the head slowly rises →
   * both hands slide forward and part a little over the spread merchandise
   * (a silent "look") → they settle back. Never touches the items.
   */
  intro() {
    const P = this.pose;
    const tl = gsap.timeline({ defaults: { overwrite: 'auto' } });
    tl.timeScale(this.timeScale);
    tl.to({}, { duration: 0.8 }); // stillness

    tl.to(P, { headPitch: 0.12, lean: 0.03, breath: 1, duration: 1.8, ease: 'power2.inOut' });
    tl.call(() => this.audio.play('fabric', { position: this._pos('R'), gain: 0.45, dur: 0.9 }), null, '<0.2');

    // the presenting gesture: hands forward, palms down, fingers relaxed and parted
    const fwd = (side) => {
      const r = this.rest(side), sx = side === 'R' ? -1 : 1;
      return new THREE.Vector3(r.x + sx * 0.05, r.y + 0.012, r.z + 0.07);
    };
    this.handTo(tl, 'R', fwd('R'), { dur: 1.3, ease: 'sine.inOut', pitch: 0.06, curl: [0.25, 0.14, 0.18, 0.22, 0.28], at: '-=0.5' });
    this.handTo(tl, 'L', fwd('L'), { dur: 1.3, ease: 'sine.inOut', pitch: 0.06, curl: [0.25, 0.14, 0.18, 0.22, 0.28], at: '<0.12' });
    tl.to([P.R, P.L], { spread: 1.6, duration: 1.0, ease: 'sine.inOut' }, '<0.2');
    tl.to(P, { lean: 0.07, duration: 1.2, ease: 'sine.inOut' }, '<');
    tl.call(() => this.audio.play('woodContact', { position: this._pos('L'), gain: 0.12 }));
    tl.to({}, { duration: 0.7 }); // he lets you look
    tl.to([P.R, P.L], { spread: 1, duration: 0.9, ease: 'sine.inOut' });
    this.settle(tl, { dur: 1.3, lean: 0.03, headPitch: 0.12, at: '<' });
    return tl;
  }

  // ────────────────────────────────────────────── the two-tap ritual

  /**
   * Signature two knocks. `onTap(i)` fires on the exact frame the fingertip
   * reaches the wood (contact = 1), and the knock sound is scheduled there.
   */
  twoTap({ onTap, withStillness = true } = {}) {
    const P = this.pose, R = P.R;
    const tl = gsap.timeline();
    tl.timeScale(this.timeScale);
    if (withStillness) {
      tl.to(P, { breath: 0.15, duration: 0.25 });
      tl.to({}, { duration: 0.5 });
    }
    // hand forward, index rises, other fingers fold
    const spot = new THREE.Vector3(-0.2, this.top + 0.062, this.rest('R').z + 0.05);
    this.handTo(tl, 'R', spot, { dur: 0.75, ease: 'power2.inOut', pitch: 0.42, yaw: 0.08, curl: [0.75, 0.0, 0.92, 0.96, 1.0] });
    tl.to({}, { duration: 0.18 });

    const knock = (i, down, up) => {
      // tiny wind-up, then a deliberate drop onto the wood
      tl.to(R.pos, { y: spot.y + 0.012, duration: 0.16, ease: 'sine.out' });
      tl.to(R, { pitch: 0.36, duration: 0.16, ease: 'sine.out' }, '<');
      tl.to(R, { contact: 1, duration: down, ease: 'power2.in' });
      tl.to(R, { pitch: 0.47, duration: down, ease: 'power2.in' }, '<');
      tl.call(() => {
        this.audio.play('knock', { variant: i === 1 ? 'deep' : 'sharp', position: this._tipPos(), gain: 1, wet: 0.35 });
        onTap?.(i);
      });
    };
    knock(1, 0.12, 0.2);
    tl.to(R, { contact: 0, duration: 0.2, ease: 'power2.out' });
    tl.to(R.pos, { y: spot.y, duration: 0.2, ease: 'power2.out' }, '<');
    tl.to({}, { duration: 0.42 });  // the pause between the knocks
    knock(2, 0.1, 0.18);
    tl.to({}, { duration: 0.65 });  // the hand stays on the wood
    tl.to(R, { contact: 0, duration: 0.35, ease: 'sine.inOut' });
    tl.to(R.curl, { 1: 0.3, duration: 0.35, ease: 'sine.inOut' }, '<');
    tl.to(P, { breath: 1, duration: 0.6 }, '<');
    return tl;
  }

  // ────────────────────────────────────────────── payment

  /** Left hand reaches the pouch, closes around it and drags it into shadow. */
  acceptPayment(pouch) {
    const P = this.pose, L = P.L;
    const tl = gsap.timeline();
    tl.timeScale(this.timeScale);
    const p = this.local(pouch.position);
    const reach = new THREE.Vector3(p.x - 0.004, this.top + 0.095, p.z - 0.085);
    tl.to(P, { lean: 0.13, duration: 1.1, ease: 'power2.inOut' });
    this.handTo(tl, 'L', reach, { dur: 1.15, ease: 'power2.inOut', pitch: 0.55, yaw: -0.05, curl: [0.1, 0.12, 0.12, 0.15, 0.18], at: '<' });
    tl.call(() => this.audio.play('fabric', { position: this._pos('L'), gain: 0.45, dur: 0.8 }), null, '<');
    // fingers close around the leather
    // settle onto the leather (the dome surface stops the fingers on its skin)
    tl.to(L.pos, { y: this.top + 0.05, z: reach.z + 0.01, duration: 0.25, ease: 'sine.out' });
    tl.to(L.curl, { 0: 0.62, 1: 0.7, 2: 0.74, 3: 0.78, 4: 0.8, duration: 0.38, ease: 'power2.inOut' }, '<0.05');
    tl.call(() => this.audio.play('coinsShift', { position: [pouch.position.x, this.top, pouch.position.z], gain: 0.7 }));
    tl.to({}, { duration: 0.2 });

    // drag it toward the dealer — pouch and hand driven by the same value
    const drag = { t: 0 };
    const hp0 = new THREE.Vector3(), pp0 = new THREE.Vector3();
    const dest = new THREE.Vector3(0.36, 0, 0.32); // dealer space: straight back in its own lane, to the dark edge
    let pouchStartLocal;
    tl.call(() => {
      hp0.copy(L.pos); pp0.copy(pouch.position);
      pouchStartLocal = this.local(pouch.position);
      this.audio.play('woodSlide', { position: [pouch.position.x, this.top, pouch.position.z], gain: 0.35, dur: 1.0 });
    });
    tl.to(drag, {
      t: 1, duration: 1.05, ease: 'power2.inOut',
      onUpdate: () => {
        const dx = (dest.x - pouchStartLocal.x) * drag.t, dz = (dest.z - pouchStartLocal.z) * drag.t;
        L.pos.set(hp0.x + dx, hp0.y + Math.sin(drag.t * Math.PI) * 0.006, hp0.z + dz);
        pouch.position.set(pp0.x + dx, pp0.y + Math.sin(drag.t * Math.PI) * 0.004, pp0.z + dz);
        pouch.rotation.y = drag.t * 0.4;
      },
    });
    tl.to(P, { lean: 0.03, duration: 1.05, ease: 'power2.inOut' }, '<');
    // release
    tl.to(L.curl, { 0: 0.25, 1: 0.2, 2: 0.25, 3: 0.3, 4: 0.35, duration: 0.35, ease: 'sine.inOut' });
    tl.to(L.pos, { y: '+=0.02', duration: 0.35, ease: 'sine.out' }, '<');
    const r = this.rest('L');
    this.handTo(tl, 'L', r, { dur: 0.8, ease: 'power2.inOut', pitch: 0, yaw: 0 });
    return tl;
  }

  // ────────────────────────────────────────────── delivery

  /**
   * Reach behind the purchased object and push it toward the player; it slides
   * off the bottom of frame on its own momentum.
   */
  deliver(item, { edgeZ = -0.2, side = 'L' } = {}) {
    const P = this.pose, R = P[side];
    const root = item.root;
    const half = HALF_DEPTH[item.id] ?? 0.05;
    const tl = gsap.timeline();
    tl.timeScale(this.timeScale);
    const p = this.local(root.position);
    // wrist far enough back that the fingertips start just behind the item
    const behind = new THREE.Vector3(p.x - 0.01, this.top + 0.042, p.z - half - 0.2);
    tl.to(P, { lean: 0.11, duration: 0.9, ease: 'power2.inOut' });
    this.handTo(tl, side, behind, { dur: 0.95, ease: 'power2.inOut', pitch: 0.36, curl: [0.3, 0.08, 0.1, 0.14, 0.2], at: '<' });
    tl.to(R, { contact: 0.8, duration: 0.25, ease: 'sine.out' });
    tl.to({}, { duration: 0.15 });

    const pusher = { side, object: root, halfDepth: half };
    tl.call(() => {
      this.dealer.pushers.push(pusher);
      this.audio.play(item.id === 'second_chance' ? 'tokenSlide' : item.id === 'hint_drop' ? 'paperSlide' : 'woodSlide',
        { position: root.position.toArray(), gain: 0.8, dur: 1.2 });
    });
    tl.to(R.pos, { z: '+=0.2', duration: 0.85, ease: 'sine.in' });
    tl.addLabel('release');
    tl.call(() => this._dropPusher(pusher));
    // momentum carries it to the player's edge of the desk…
    tl.to(root.position, { z: edgeZ - half * 0.35, duration: 0.6, ease: 'power1.out' }, 'release');
    // …where it tips over and drops into the player's (unseen) hand
    tl.to(root.rotation, { x: 0.9, duration: 0.32, ease: 'power2.in' }, 'release+=0.55');
    tl.to(root.position, { y: `-=0.22`, z: `+=0.07`, duration: 0.32, ease: 'power2.in' }, 'release+=0.55');
    tl.to(R, { contact: 0, duration: 0.4, ease: 'power2.out' }, 'release');
    tl.to(R.pos, { y: '+=0.02', z: '-=0.02', duration: 0.45, ease: 'power2.out' }, 'release');
    tl.to({}, { duration: 0.2 });
    return tl;
  }

  _dropPusher(p) {
    const i = this.dealer.pushers.indexOf(p);
    if (i >= 0) this.dealer.pushers.splice(i, 1);
  }

  /** Slowly lean back into the darkness (end of a transaction / before exit). */
  withdraw({ deep = false } = {}) {
    const tl = gsap.timeline();
    tl.timeScale(this.timeScale);
    this.settle(tl, { dur: deep ? 1.6 : 1.3, lean: deep ? -0.13 : -0.02, headPitch: deep ? 0.06 : 0.12 });
    if (deep) {
      for (const s of ['R', 'L']) {
        const r = this.rest(s);
        tl.to(this.pose[s].pos, { z: r.z - 0.09, y: r.y + 0.004, duration: 1.4, ease: 'sine.inOut' }, '<0.15');
      }
    }
    return tl;
  }

  // ────────────────────────────────────────────── idle behaviour

  setIdleAllowed(allowed) {
    this._idleAllowed = allowed && this.idleEnabled;
    clearTimeout(this._idleTimer);
    if (!this._idleAllowed) { this.interruptIdle(); return; }
    this._scheduleIdle(2.5 + Math.random() * 3);
  }

  /** Release any objects the hands are pushing (used on cancel/reset). */
  releaseAll() { this.dealer.pushers.length = 0; }

  interruptIdle(smooth = true) {
    clearTimeout(this._idleTimer);
    if (this.idleTl) {
      this.idleTl.kill();
      this.idleTl = null;
      if (smooth) {
        const tl = gsap.timeline();
        this.settle(tl, { dur: 0.45, lean: this.pose.lean, headPitch: Math.max(0.1, this.pose.headPitch) });
        // put the ledger back if an adjustment was interrupted
        const L = this.desk.ledger, rest = this.desk.ledgerRest;
        tl.to(L.position, { x: rest.pos.x, z: rest.pos.z, duration: 0.45 }, 0);
        tl.to(L.rotation, { y: rest.rotY, duration: 0.45 }, 0);
      }
    }
  }

  _scheduleIdle(sec) {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._playIdle(), sec * 1000);
  }

  _playIdle() {
    if (!this._idleAllowed || this.idleTl) return;
    // Weighted choice; stillness is the most common "event".
    const table = [
      ['still', 4], ['fingers', 3], ['headTilt', 2], ['shoulders', 2], ['tap', 1.2], ['lookDoor', 1], ['adjust', 1],
    ].filter(([k]) => k !== this._lastIdle || k === 'still');
    let sum = table.reduce((a, [, w]) => a + w, 0), r = Math.random() * sum, pick = 'still';
    for (const [k, w] of table) { if ((r -= w) <= 0) { pick = k; break; } }
    this._lastIdle = pick;
    const tl = this[`_idle_${pick}`]?.() || gsap.timeline().to({}, { duration: 2 });
    this.idleTl = tl;
    tl.eventCallback('onComplete', () => {
      this.idleTl = null;
      if (this._idleAllowed) this._scheduleIdle(pick === 'still' ? 1.5 + Math.random() * 3 : 3 + Math.random() * 6);
    });
  }

  _idle_still() {
    // hold the breath slightly; complete stillness
    return gsap.timeline().to(this.pose, { breath: 0.35, duration: 1.2, ease: 'sine.inOut' }).to({}, { duration: 2 + Math.random() * 2.5 }).to(this.pose, { breath: 1, duration: 1.4 });
  }

  _idle_fingers() {
    const side = Math.random() < 0.6 ? 'R' : 'L';
    const H = this.pose[side];
    const tl = gsap.timeline();
    const c = REST_CURL.map((v) => v + (Math.random() - 0.5) * 0.25);
    tl.to(H.curl, { ...Object.fromEntries(c.map((v, i) => [i, Math.max(0, v)])), duration: 0.6, ease: 'sine.inOut' });
    tl.to(H.pos, { x: H.pos.x + (Math.random() - 0.5) * 0.02, z: H.pos.z + (Math.random() - 0.3) * 0.015, duration: 0.7, ease: 'sine.inOut' }, '<');
    tl.to({}, { duration: 1.2 + Math.random() });
    tl.to(H.curl, { ...Object.fromEntries(REST_CURL.map((v, i) => [i, v])), duration: 0.8, ease: 'sine.inOut' });
    return tl;
  }

  _idle_headTilt() {
    const P = this.pose;
    const roll = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.04);
    return gsap.timeline()
      .to(P, { headRoll: roll, headPitch: P.headPitch + 0.03, duration: 1.4, ease: 'sine.inOut' })
      .to({}, { duration: 1.2 + Math.random() * 1.5 })
      .to(P, { headRoll: 0, headPitch: 0.12, duration: 1.6, ease: 'sine.inOut' });
  }

  _idle_shoulders() {
    const P = this.pose;
    return gsap.timeline()
      .to(P, { shoulderRise: 0.035, lean: P.lean - 0.02, duration: 1.1, ease: 'sine.inOut' })
      .to(P, { shoulderRise: 0, lean: 0.03, duration: 1.5, ease: 'sine.inOut' });
  }

  _idle_tap() {
    // a single quiet, absent-minded finger tap (not the ritual)
    const H = this.pose.R;
    const tl = gsap.timeline();
    tl.to(H.curl, { 2: 0.05, duration: 0.3, ease: 'sine.out' });
    tl.to(H, { pitch: -0.08, duration: 0.25, ease: 'sine.out' }, '<');
    tl.to(H, { pitch: 0.02, duration: 0.12, ease: 'power2.in' });
    tl.call(() => this.audio.play('woodContact', { position: this._pos('R'), gain: 0.18 }));
    tl.to({}, { duration: 0.5 });
    tl.to(H.curl, { 2: REST_CURL[2], duration: 0.5 });
    tl.to(H, { pitch: 0, duration: 0.5 }, '<');
    return tl;
  }

  _idle_lookDoor() {
    const P = this.pose;
    return gsap.timeline()
      .to(P, { headYaw: 0.75, headPitch: 0.02, duration: 2.0, ease: 'sine.inOut' })
      .to(P, { breath: 0.2, duration: 0.6 }, '<1')
      .to({}, { duration: 1.4 + Math.random() })
      .to(P, { headYaw: 0, headPitch: 0.12, breath: 1, duration: 2.2, ease: 'sine.inOut' });
  }

  _idle_adjust() {
    // straighten the ledger with the right hand (it lies on his right)
    const L = this.desk.ledger, rest = this.desk.ledgerRest;
    const tl = gsap.timeline();
    const p = this.local(L.position);
    const reach = new THREE.Vector3(p.x + 0.07, this.top + 0.05, p.z - 0.02);
    tl.to(this.pose, { lean: 0.06, duration: 1.0, ease: 'sine.inOut' });
    this.handTo(tl, 'R', reach, { dur: 1.0, ease: 'power2.inOut', pitch: 0.2, curl: [0.2, 0.15, 0.2, 0.25, 0.3], at: '<' });
    const nudge = { a: 0 };
    const rot0 = L.rotation.y;
    const target = rest.rotY + (Math.random() - 0.5) * 0.06;
    tl.call(() => this.audio.play('paperSlide', { position: [L.position.x, this.top, L.position.z], gain: 0.35, dur: 0.4 }));
    tl.to(nudge, {
      a: 1, duration: 0.45, ease: 'sine.inOut',
      onUpdate: () => { L.rotation.y = rot0 + (target - rot0) * nudge.a; L.position.x = rest.pos.x - 0.004 * nudge.a; },
    });
    tl.to(this.pose.R.pos, { x: reach.x - 0.006, duration: 0.45, ease: 'sine.inOut' }, '<');
    tl.to({}, { duration: 0.3 });
    this.handTo(tl, 'R', this.rest('R'), { dur: 1.0, pitch: 0, curl: REST_CURL });
    tl.to(this.pose, { lean: 0.03, duration: 1.0, ease: 'sine.inOut' }, '<');
    tl.call(() => { L.position.x = rest.pos.x; rest.rotY = L.rotation.y; });
    return tl;
  }

  /** Atmospheric reaction: freeze, glance at the door, return. */
  reactToNoise() {
    this.interruptIdle(false);
    const P = this.pose;
    const tl = gsap.timeline();
    tl.to(P, { breath: 0, duration: 0.3 });
    tl.to({}, { duration: 0.6 });
    tl.to(P, { headYaw: 0.55, headPitch: 0.06, duration: 1.4, ease: 'sine.inOut' });
    tl.to({}, { duration: 1.2 });
    tl.to(P, { headYaw: 0, headPitch: 0.12, breath: 1, duration: 1.8, ease: 'sine.inOut' });
    this.idleTl = tl;
    tl.eventCallback('onComplete', () => { this.idleTl = null; if (this._idleAllowed) this._scheduleIdle(4); });
    return tl;
  }

  _pos(side) { return this.dealer.handWorld(side).toArray(); }
  _tipPos() { return (this.dealer.fingertip('R', 'index') || this.dealer.handWorld('R')).toArray(); }

  dispose() {
    clearTimeout(this._idleTimer);
    this.idleTl?.kill();
  }
}
