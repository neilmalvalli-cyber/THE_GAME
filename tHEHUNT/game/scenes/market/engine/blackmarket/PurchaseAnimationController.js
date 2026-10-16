import * as THREE from 'three';
import gsap from 'gsap';
import { buildCoinPouch } from './items/itemBuilders.js';
import { S } from './BlackMarketStateManager.js';

/**
 * PurchaseAnimationController — the dealer's ritual.
 *
 *   PURCHASE_STARTING        item moves in front of the dealer; payment placed
 *   DEALER_ACCEPTING_PAYMENT dealer takes the pouch into the shadows
 *   DEALER_TWO_TAP           stillness, KNOCK … KNOCK
 *   ITEM_DELIVERY            dealer slides the item to the player (off frame)
 *   PURCHASE_COMPLETE        dealer withdraws; desk returns to idle
 *
 * The controller only animates. Whether a purchase is allowed is decided by
 * the caller (later: only after the backend confirms the transaction).
 */
export class PurchaseAnimationController {
  constructor({ desk, stage, dealerAnim, director, inspection, audio, room, seq }) {
    Object.assign(this, { desk, stage, dealerAnim, director, inspection, audio, room, seq });
    this.pouch = buildCoinPouch();
    this.pouch.visible = false;
    stage.add(this.pouch);
  }

  get top() { return this.desk.top; }

  /**
   * Runs the whole ritual. `step(state)` is called at each state boundary.
   * Resolves true when complete, false if cancelled.
   */
  async play(item, { step, onTap }) {
    const seq = this.seq;
    step(S.PURCHASE_STARTING);
    if (!(await seq.run(this._offer(item)))) return false;

    step(S.DEALER_ACCEPTING_PAYMENT);
    if (!(await seq.run(this.dealerAnim.acceptPayment(this.pouch)))) return false;
    this._pouchIntoShadow();

    step(S.DEALER_TWO_TAP);
    if (!(await seq.run(this.dealerAnim.twoTap({ onTap })))) return false;

    step(S.ITEM_DELIVERY);
    if (!(await seq.run(this.dealerAnim.deliver(item, { edgeZ: -0.2, side: 'L' })))) return false;
    item.transferred = true;
    item.root.visible = false;

    step(S.PURCHASE_COMPLETE);
    const tl = gsap.timeline();
    tl.add(this.dealerAnim.withdraw(), 0);
    tl.add(this.director.moveAlong(['desk'], { duration: 1.8, ease: 'power2.inOut' }), 0.2);
    if (!(await seq.run(tl))) return false;
    return true;
  }

  /** Item to the dealer's side of the desk + the payment placed by the player. */
  _offer(item) {
    const T = this.top;
    const tl = gsap.timeline();
    const root = item.root;
    const offer = this.desk.offerSpot(item.id);
    const offerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.08, 0));

    if (item.hover > 0) item.setHover(false);
    this.director.setDOF(false);
    this.director.attend(null);
    tl.add(this.director.moveAlong(['purchase'], { duration: 2.0, ease: 'power2.inOut' }), 0);
    tl.to(this.desk.focusLight, { intensity: 0, duration: 0.8 }, 0);
    tl.to(this.room, { lampLevel: 1, duration: 0.8, onUpdate: () => this.room.setLampLevel(this.room.lampLevel) }, 0);

    if (root.parent !== this.stage) item.detachTo(this.stage);
    const sPos = root.position.clone(), sQ = root.quaternion.clone();
    const glass = item.id === 'deep_scan' ? item.model.userData.parts.glass : null;
    tl.call(() => this.audio.play(item.id === 'second_chance' ? 'tokenSlide' : item.id === 'hint_drop' ? 'paperSlide' : 'woodSlide', { position: sPos.toArray(), gain: 0.5, dur: 1.0 }), null, 0.1);
    tl.to(item.present.rotation, { x: 0, y: 0, z: 0, duration: 1.0, ease: 'power2.inOut' }, 0.1);
    if (glass) {
      const r = this.inspection._glassRest;
      tl.to(glass.position, { x: r.pos.x, y: r.pos.y, z: r.pos.z, duration: 1.0, ease: 'power2.inOut' }, 0.1);
      tl.to(glass.rotation, { x: r.rot.x, y: r.rot.y, z: r.rot.z, duration: 1.0, ease: 'power2.inOut' }, 0.1);
    }
    const prog = { t: 0 };
    tl.to(prog, {
      t: 1, duration: 1.4, ease: 'power2.inOut',
      onUpdate: () => {
        root.position.lerpVectors(sPos, offer, prog.t);
        // arc high enough to clear the tray rim and anything lying in between
        root.position.y += Math.sin(prog.t * Math.PI) * 0.075;
        root.quaternion.slerpQuaternions(sQ, offerQ, prog.t);
        item.shadow.material.opacity = item.shadowBase * Math.max(0, (prog.t - 0.7) / 0.3);
      },
    }, 0.15);
    tl.call(() => this.audio.play('woodContact', { position: offer.toArray(), gain: 0.2 }), null, 1.55);

    // payment: rises from below the player's edge, clears the edge of the desk,
    // lands in its own lane (right of the offered item) and is pushed across
    const p0 = new THREE.Vector3(0.38, T - 0.16, -0.06);
    const p1 = new THREE.Vector3(0.36, T, -0.4);
    const p2z = -0.56;
    const path = new THREE.CatmullRomCurve3([
      p0, new THREE.Vector3(0.375, T + 0.05, -0.12), new THREE.Vector3(0.37, T + 0.075, -0.26), new THREE.Vector3(0.365, T + 0.03, -0.36), p1,
    ], false, 'centripetal');
    const pp = { t: 0 };
    tl.call(() => {
      gsap.killTweensOf(this.pouch.position);
      this.pouch.visible = true;
      this.pouch.position.copy(p0);
      this.pouch.rotation.set(0.3, -0.4, 0.2);
      this.pouch.scale.set(1, 1, 1);
      this.audio.play('fabric', { position: p0.toArray(), gain: 0.3, dur: 0.5 });
    }, null, 1.2);
    tl.to(pp, {
      t: 1, duration: 0.8, ease: 'power1.inOut',
      onUpdate: () => {
        const t = pp.t;
        path.getPoint(t, this.pouch.position);
        this.pouch.rotation.set(0.3 * (1 - t), -0.4 + t * 0.3, 0.2 * (1 - t));
      },
    }, 1.2);
    tl.call(() => this.audio.play('coinPouch', { position: p1.toArray(), gain: 0.9 }), null, 2.0);
    tl.to(this.pouch.scale, { y: 0.9, x: 1.04, z: 1.04, duration: 0.12, ease: 'power2.out' }, 1.95);
    tl.to(this.pouch.scale, { y: 1, x: 1, z: 1, duration: 0.35, ease: 'sine.out' }, 2.07);
    tl.call(() => this.audio.play('woodSlide', { position: p1.toArray(), gain: 0.3, dur: 0.5 }), null, 2.35);
    tl.to(this.pouch.position, { z: p2z, duration: 0.5, ease: 'power2.out' }, 2.35);
    tl.to({}, { duration: 0.35 });
    return tl;
  }

  _pouchIntoShadow() {
    const T = this.top;
    const pz = this.pouch.position.z;
    gsap.to(this.pouch.position, { y: T - 0.12, z: pz - 0.07, duration: 0.45, ease: 'power2.in', onComplete: () => { this.pouch.visible = false; } });
    this.audio.play('fabric', { position: this.pouch.position.toArray(), gain: 0.35, dur: 0.5 });
  }

  reset() {
    gsap.killTweensOf(this.pouch.position);
    gsap.killTweensOf(this.pouch.scale);
    this.pouch.visible = false;
  }
}
