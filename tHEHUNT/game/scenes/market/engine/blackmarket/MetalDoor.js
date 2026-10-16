import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { metalTextures } from '../core/proceduralTextures.js';
import { LAYOUT } from './layout.js';

/**
 * MetalDoor — heavy riveted steel door in a steel frame.
 * `open` (0..1) is the only animated property; the scene reads it to drive
 * the light spill. Hinge is on the -Z jamb; the door swings into the room.
 */
export class MetalDoor {
  constructor() {
    const D = LAYOUT.door;
    this.group = new THREE.Group();
    this.group.name = 'MetalDoor';
    this.open = 0;
    this.maxAngle = THREE.MathUtils.degToRad(104);

    const tex = metalTextures({ seed: 404, size: 512, baseRough: 0.62, scratchCount: 420 });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x55595a, metalness: 0.78, roughness: 1,
      roughnessMap: tex.roughnessMap, normalMap: tex.normalMap, map: tex.map,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    const darkSteel = steel.clone(); darkSteel.color.set(0x35383a);
    const brass = new THREE.MeshStandardMaterial({ color: 0x6d5a3a, metalness: 1, roughness: 0.42 });

    // frame
    const fw = 0.07, fd = 0.16;
    const frame = new THREE.Group();
    frame.position.set(D.x, 0, D.z);
    const jambGeo = new THREE.BoxGeometry(fd, D.h + fw, fw);
    for (const s of [-1, 1]) {
      const j = new THREE.Mesh(jambGeo, darkSteel);
      j.position.set(0, (D.h + fw) / 2, s * (D.w / 2 + fw / 2));
      frame.add(j);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(fd, fw, D.w + fw * 2), darkSteel);
    head.position.set(0, D.h + fw / 2, 0);
    frame.add(head);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(fd + 0.04, 0.012, D.w), darkSteel);
    sill.position.y = 0.006; frame.add(sill);
    frame.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    this.group.add(frame);

    // Leaf pivot on the +Z jamb (front of the room): the open slab folds back
    // toward the front wall, leaving the view from the doorway to the dealer
    // clear. The leaf is modelled once and mirrored (scale.z = -1).
    const pivot = new THREE.Group();
    pivot.position.set(D.x, 0, D.z + D.w / 2 - 0.005);
    pivot.scale.z = -1;
    this.pivot = pivot;
    this.group.add(pivot);

    const LW = D.w - 0.012, LH = D.h - 0.012, LT = 0.055;
    const leaf = new THREE.Mesh(new RoundedBoxGeometry(LT, LH, LW, 2, 0.006), steel);
    leaf.position.set(0, LH / 2 + 0.006, LW / 2);
    leaf.castShadow = leaf.receiveShadow = true;
    pivot.add(leaf);

    // reinforcing plates, rivets, kick plate — both faces
    const rivetGeo = new THREE.SphereGeometry(0.0085, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    for (const side of [1, -1]) {
      const fx = side * (LT / 2 + 0.002);
      for (const y of [0.42, 1.05, 1.72]) {
        const bar = new THREE.Mesh(new RoundedBoxGeometry(0.008, 0.11, LW - 0.08, 1, 0.003), darkSteel);
        bar.position.set(fx + side * 0.002, y, LW / 2);
        bar.castShadow = true; pivot.add(bar);
        for (let k = 0; k < 9; k++) {
          const r = new THREE.Mesh(rivetGeo, darkSteel);
          r.rotation.z = -side * Math.PI / 2;
          r.position.set(fx + side * 0.006, y + (k % 2 ? 0.035 : -0.035), 0.07 + (k / 8) * (LW - 0.14));
          pivot.add(r);
        }
      }
      // perimeter rivets
      for (let k = 0; k < 16; k++) {
        for (const z of [0.03, LW - 0.03]) {
          const r = new THREE.Mesh(rivetGeo, darkSteel);
          r.rotation.z = -side * Math.PI / 2;
          r.position.set(fx, 0.08 + (k / 15) * (LH - 0.16), z);
          pivot.add(r);
        }
      }
      const kick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.22, LW - 0.06), brass);
      kick.material = darkSteel;
      kick.position.set(fx + side * 0.001, 0.14, LW / 2);
      pivot.add(kick);

      // lever handle
      const hz = LW - 0.09;
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20), darkSteel);
      rose.rotation.z = Math.PI / 2; rose.position.set(fx + side * 0.006, 1.02, hz); pivot.add(rose);
      const lever = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.024, 0.14, 2, 0.008), darkSteel);
      lever.position.set(fx + side * 0.04, 1.02, hz - 0.055);
      lever.castShadow = true; pivot.add(lever);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.04, 10), darkSteel);
      neck.rotation.z = Math.PI / 2; neck.position.set(fx + side * 0.022, 1.02, hz); pivot.add(neck);
    }
    // corridor-side observation slot (closed hatch)
    const slot = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.06, 0.24, 2, 0.004), darkSteel);
    slot.position.set(LT / 2 + 0.008, 1.55, LW / 2);
    slot.castShadow = true;
    pivot.add(slot);
    // hinges
    for (const y of [0.25, 1.0, 1.8]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 12), darkSteel);
      h.position.set(-LT / 2 - 0.01, y, 0.0);
      pivot.add(h);
    }
    pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  setOpen(v) {
    this.open = v;
    // mirrored pivot: positive rotation swings the slab into the room
    this.pivot.rotation.y = v * this.maxAngle;
  }

  /** Approximate world position of the hinge (for spatial audio). */
  get audioPosition() {
    const D = LAYOUT.door;
    return [D.x, 1.0, D.z];
  }
}
