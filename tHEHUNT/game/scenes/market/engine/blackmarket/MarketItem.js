import * as THREE from 'three';
import gsap from 'gsap';
import { blobShadowTexture } from '../core/proceduralTextures.js';

/**
 * MarketItem
 * ----------
 *   root  ← moved by inspection / purchase timelines (world-space choreography)
 *   └ body ← moved ONLY by hover (tiny lift + tilt, always relative to zero)
 *     └ model
 *   └ contact shadow (stays on the desk plane)
 *   └ hit proxy (invisible, generous pick volume)
 *
 * Rest transform is captured once and restored by *assignment* (never by
 * accumulating deltas), so repeated hover/inspect/return cycles cannot drift.
 */
export class MarketItem {
  constructor({ id, title, model, hit = [0.12, 0.04, 0.12], hover = {}, shadow = [0.16, 0.12] }) {
    this.id = id;
    this.title = title;
    this.model = model;
    this.root = new THREE.Group();
    this.root.name = `MarketItem:${id}`;
    // present: item-specific presentation motion during inspection (spin, tilt)
    this.present = new THREE.Group();
    this.body = new THREE.Group();
    this.body.add(model);
    this.present.add(this.body);
    this.root.add(this.present);

    this.hoverCfg = { lift: 0.006, tiltX: -0.05, tiltZ: 0.0, ...hover };
    this.hover = 0;
    this._hoverTween = null;
    this.transferred = false;

    // contact shadow (blob) — complements the shadow map with soft occlusion
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(shadow[0], shadow[1]),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.0007;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
    this.shadowBase = 0.55;

    this.hit = new THREE.Mesh(new THREE.BoxGeometry(...hit), new THREE.MeshBasicMaterial());
    this.hit.position.y = hit[1] / 2;
    this.hit.visible = false;
    this.hit.userData.marketItem = this;
    this.root.add(this.hit);
  }

  /** Place at rest and remember it. Call once after layout. */
  setRest(parent, position, rotationY = 0) {
    parent.add(this.root);
    this.restParent = parent;
    this.restPos = new THREE.Vector3(...position);
    this.restQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
    this.restoreRest();
  }

  restoreRest() {
    if (this.root.parent !== this.restParent) this.restParent.add(this.root);
    this.root.position.copy(this.restPos);
    this.root.quaternion.copy(this.restQuat);
    this.root.scale.set(1, 1, 1);
    this.present.position.set(0, 0, 0);
    this.present.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.hover = 0;
    this.shadow.material.opacity = this.shadowBase;
    this.shadow.scale.set(1, 1, 1);
    this.root.visible = !this.transferred;
    this.model.userData.reset?.();
  }

  /** Reparent to `space` keeping the world transform (for world-space moves). */
  detachTo(space) {
    space.attach(this.root);
  }

  /** Rest transform expressed in `space` coordinates (for return tweens). */
  restIn(space) {
    this.restParent.updateMatrixWorld(true);
    const m = new THREE.Matrix4().compose(this.restPos, this.restQuat, new THREE.Vector3(1, 1, 1));
    m.premultiply(this.restParent.matrixWorld);
    space.updateMatrixWorld(true);
    m.premultiply(new THREE.Matrix4().copy(space.matrixWorld).invert());
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(pos, quat, s);
    return { pos, quat };
  }

  setHover(on) {
    this._hoverTween?.kill();
    this._hoverTween = gsap.to(this, {
      hover: on ? 1 : 0,
      duration: on ? 0.3 : 0.26,
      ease: on ? 'power2.out' : 'power2.inOut',
      onUpdate: () => this._applyHover(),
    });
  }

  /** Immediately cancel hover (used when a cinematic takes over). */
  clearHover() {
    this._hoverTween?.kill();
    this.hover = 0;
    this._applyHover();
  }

  _applyHover() {
    const h = this.hover, c = this.hoverCfg;
    this.body.position.y = c.lift * h;
    this.body.rotation.x = c.tiltX * h;
    this.body.rotation.z = c.tiltZ * h;
    // the shadow softens and spreads as the object lifts
    this.shadow.material.opacity = this.shadowBase * (1 - 0.35 * h);
    const s = 1 + 0.12 * h;
    this.shadow.scale.set(s, s, 1);
  }

  /** World position of the item's visual centre (for camera focus / lights). */
  getFocusPoint(target = new THREE.Vector3()) {
    return this.hit.getWorldPosition(target);
  }
}
