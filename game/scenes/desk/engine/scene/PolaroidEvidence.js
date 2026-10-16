import * as THREE from 'three';
import { gsap } from 'gsap';
import { rng, stampVerified } from './textures.js';

// Four loose instant photos lying on the right-hand page of an open file.
// Positions are folder-local (back panel spans x ∈ [-1.15, 1.15], z ∈ [-1.5, 1.5]).
const PHOTO = { w: 0.86, d: 1.035, t: 0.006 };
const LAYOUT = [
  { x: -0.5, z: -0.66, ry: 0.07 },
  { x: 0.52, z: -0.7, ry: -0.05 },
  { x: -0.47, z: 0.62, ry: -0.09 },
  { x: 0.53, z: 0.66, ry: 0.04 },
];

export class PolaroidEvidence {
  /**
   * @param {object} opts
   * @param {THREE.Texture[]} opts.fronts  4 front textures (image + number)
   * @param {THREE.Material} opts.backMat  shared back material
   * @param {THREE.Material} opts.edgeMat  shared edge material
   * @param {number} opts.baseY            local y the photos rest on
   * @param {number} opts.seed
   */
  constructor({ fronts, backMat, edgeMat, bumpMap, baseY, seed, shadowTex }) {
    this.group = new THREE.Group();
    this.group.name = 'PolaroidEvidence';
    this.items = [];
    const geo = new THREE.BoxGeometry(PHOTO.w, PHOTO.t, PHOTO.d);
    const r = rng(seed);
    // stacking order varies per file so overlaps look natural
    const order = [0, 1, 2, 3].sort(() => r() - 0.5);
    LAYOUT.forEach((L, i) => {
      const front = new THREE.MeshStandardMaterial({ map: fronts[i], roughness: 0.42, metalness: 0, bumpMap, bumpScale: 0.25 });
      const mesh = new THREE.Mesh(geo, [edgeMat, edgeMat, front, backMat, edgeMat, edgeMat]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const jitter = { x: (r() - 0.5) * 0.06, z: (r() - 0.5) * 0.06, ry: (r() - 0.5) * 0.05 };
      const base = { x: L.x + jitter.x, z: L.z + jitter.z, ry: L.ry + jitter.ry, y: baseY + PHOTO.t / 2 + order.indexOf(i) * 0.0032 };
      // how each photo settles when the cover lands (subtle, physically small)
      const shift = { x: (r() - 0.5) * 0.07, z: 0.015 + r() * 0.04, ry: (r() - 0.5) * 0.06 };
      const offset = { x: -shift.x, z: -shift.z, ry: -shift.ry }; // starts displaced, settles to 0
      mesh.userData.photoIndex = i;
      const lift = { y: 0, z: 0, rx: 0, s: 1 }; // hover lift (animated by the scene)
      // soft contact shadow on the papers, only visible while the photo is lifted
      let shadow = null;
      if (shadowTex) {
        const sg = new THREE.PlaneGeometry(PHOTO.w * 1.3, PHOTO.d * 1.26);
        sg.rotateX(-Math.PI / 2);
        shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, map: shadowTex, transparent: true, opacity: 0, depthWrite: false }));
        shadow.renderOrder = 1;
        this.group.add(shadow);
      }
      this.items.push({ mesh, base, offset, shift, front, lift, shadow, paperY: baseY });
      this.group.add(mesh);
    });
    this.apply();
  }

  apply() {
    for (const it of this.items) {
      it.mesh.position.set(it.base.x + it.offset.x, it.base.y + it.lift.y, it.base.z + it.offset.z + it.lift.z);
      it.mesh.rotation.set(it.lift.rx, it.base.ry + it.offset.ry, 0, 'YXZ');
      it.mesh.scale.setScalar(it.lift.s);
      if (it.shadow) {
        const h = it.lift.y;
        it.shadow.position.set(it.base.x + it.offset.x + h * 0.45, it.paperY + 0.0012 + h * 0.02, it.base.z + it.offset.z + it.lift.z + h * 0.3);
        it.shadow.rotation.y = it.base.ry + it.offset.ry;
        it.shadow.material.opacity = Math.min(1, h / 0.2) * 0.62;
        const ss = 1 + h * 0.6; it.shadow.scale.set(ss, 1, ss);
        it.shadow.visible = h > 0.002;
      }
    }
  }

  /** Put photos back in their "packed" (pre-settle) state. Called while hidden. */
  pack() {
    for (const it of this.items) {
      gsap.killTweensOf(it.offset); gsap.killTweensOf(it.lift);
      it.offset.x = -it.shift.x; it.offset.z = -it.shift.z; it.offset.ry = -it.shift.ry;
      it.lift.y = it.lift.z = it.lift.rx = 0; it.lift.s = 1;
    }
    this.apply();
  }

  get meshes() { return this.items.map((it) => it.mesh); }

  /** Hover: lift a photo off the papers, tilted slightly toward the viewer. */
  hover(index, on, reduced = false) {
    const it = this.items[index];
    if (!it) return;
    gsap.to(it.lift, on
      ? { y: 0.22, z: 0.07, rx: 0.13, s: 1.045, duration: reduced ? 0.1 : 0.3, ease: reduced ? 'power1.out' : 'back.out(1.5)', overwrite: true, onUpdate: () => this.apply() }
      : { y: 0, z: 0, rx: 0, s: 1, duration: reduced ? 0.1 : 0.26, ease: 'power2.inOut', overwrite: true, onUpdate: () => this.apply() });
  }

  /** Selection: the photo is picked up and brought toward the viewer. */
  pick(index, reduced = false) {
    const it = this.items[index];
    if (!it) return Promise.resolve();
    return new Promise((resolve) => {
      gsap.to(it.lift, {
        y: 0.55, z: 0.32, rx: 0.42, s: 1.12, duration: reduced ? 0.12 : 0.34, ease: 'power2.out', overwrite: true,
        onUpdate: () => this.apply(), onComplete: resolve,
      });
    });
  }

  /** Status marks drawn onto the print (keeps an untouched copy to redraw from). */
  setStatus(index, { completed = false } = {}) {
    const it = this.items[index];
    const map = it?.front.map;
    if (!map) return;
    if (!map.userData.base) {
      const base = document.createElement('canvas');
      base.width = map.image.width; base.height = map.image.height;
      base.getContext('2d').drawImage(map.image, 0, 0);
      map.userData.base = base;
    }
    if (map.userData.completed === completed) return;
    map.userData.completed = completed;
    const ctx = map.image.getContext('2d');
    ctx.drawImage(map.userData.base, 0, 0);
    if (completed) stampVerified(ctx, map.image.width, map.image.height, index);
    map.needsUpdate = true;
  }

  /** Drop every lifted photo back down. */
  unhoverAll(reduced = false) { this.items.forEach((it, i) => { if (it.lift.y > 0 || gsap.isTweening(it.lift)) this.hover(i, false, reduced); }); }

  /** Tweens for the settle; add to a timeline at the cover's landing. */
  settleTimeline(audio, folderId, reduced = false) {
    const tl = gsap.timeline({ onUpdate: () => this.apply() });
    this.items.forEach((it, i) => {
      const at = i * 0.05 + (i % 2) * 0.02;
      tl.to(it.offset, { x: 0, z: 0, ry: 0, duration: reduced ? 0.2 : 0.55 + i * 0.05, ease: 'power3.out' }, at);
      if (audio) tl.call(() => audio.photoShift(folderId * 10 + i), null, at);
    });
    return tl;
  }

  dispose() {
    this.items.forEach((it) => { it.front.dispose?.(); if (it.shadow) { it.shadow.geometry.dispose(); it.shadow.material.dispose(); } });
    this.items[0]?.mesh.geometry.dispose();
  }
}
