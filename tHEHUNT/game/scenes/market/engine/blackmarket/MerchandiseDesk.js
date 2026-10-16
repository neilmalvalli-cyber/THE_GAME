import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { woodTextures } from '../core/proceduralTextures.js';
import { MarketItem } from './MarketItem.js';
import { LAYOUT } from './layout.js';
import {
  buildEnvelope, buildMagnifierSet, buildToken, buildShield, buildLedger, buildLooseSheet, buildRevolver, buildKnife, buildMasterKey, buildOverclockChip, buildBundleParcel,
} from './items/itemBuilders.js';

/** Item catalogue (ids are the public contract used by inspect/purchase). */
export const MARKET_ITEMS = Object.freeze({
  hint_drop: { title: 'POWERFUL HINT' },
  deep_scan: { title: 'FREEZE' },
  second_chance: { title: 'SKIP TOKEN' },
  blackout_shield: { title: 'FIREWALL' },
  knife: { title: 'GLITCH ATTACK' },
  master_key: { title: 'MASTER KEY' },
  overclock: { title: 'OVERCLOCK' },
  bundle: { title: 'BLACKOUT BUNDLE' },
});

/** Half the footprint depth (along Z) of each item lying flat at its offer pose. */
export const HALF_DEPTH = {
  hint_drop: 0.058, second_chance: 0.028, blackout_shield: 0.046, deep_scan: 0.134, revolver: 0.066, knife: 0.022, master_key: 0.04, overclock: 0.035, bundle: 0.04,
};

/**
 * A box-shaped support surface for the dealer's hands, in an object's local
 * frame. heightAt() returns the world Y of the top inside the footprint.
 */
class BoxSurface {
  constructor(object, hx, hz, top, { rim = 0, rimTop = top, active = () => true } = {}) {
    Object.assign(this, { object, hx, hz, top, rim, rimTop, active });
    this._inv = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._on = true;
  }
  prepare() {
    const o = this.object;
    this._on = o.visible && this.active();
    if (!this._on) return;
    o.updateWorldMatrix(true, false);
    // only flat-lying objects act as a support (not while tilted in inspection)
    this._up.set(0, 1, 0).transformDirection(o.matrixWorld);
    this._on = this._up.y > 0.97;
    this._inv.copy(o.matrixWorld).invert();
    this._baseY = this._v.setFromMatrixPosition(o.matrixWorld).y;
  }
  heightAt(x, z) {
    if (!this._on) return -Infinity;
    const p = this._v.set(x, this._baseY, z).applyMatrix4(this._inv);
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    // a little margin so fingers lift before they would touch the edge
    const m = 0.006;
    if (ax > this.hx + m || az > this.hz + m) return -Infinity;
    const onRim = this.rim > 0 && (ax > this.hx - this.rim - m || az > this.hz - this.rim - m);
    return this._baseY + (onRim ? this.rimTop : this.top);
  }
}

/** Dome-shaped support (the leather pouch). */
class DomeSurface {
  constructor(object, radius, height) { Object.assign(this, { object, radius, height }); this._p = new THREE.Vector3(); }
  prepare() { this._on = this.object.visible; if (this._on) this.object.getWorldPosition(this._p); }
  heightAt(x, z) {
    if (!this._on) return -Infinity;
    const d = Math.hypot(x - this._p.x, z - this._p.z) / (this.radius + 0.008);
    if (d >= 1) return -Infinity;
    return this._p.y + this.height * Math.sqrt(1 - d * d);
  }
}

export class MerchandiseDesk {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'MerchandiseDesk';
    this.items = new Map();
    this._buildDesk();
    this._buildItems();
    this._buildProps();

    // A narrow, shadowless "attention" light. Hover and inspection raise it on
    // the focused object — physically brightening it instead of faking glow.
    this._buildSurfaces();

    this.focusLight = new THREE.SpotLight(0xffe2c4, 0, 3, 0.16, 1, 2);
    this.focusLight.position.set(0.15, 1.55, 0.55);
    this.group.add(this.focusLight, this.focusLight.target);
  }

  get top() { return LAYOUT.desk.top; }

  _buildDesk() {
    const D = LAYOUT.desk;
    const wood = woodTextures({ seed: 21, repeat: [1, 1], tone: [66, 40, 23] });
    const topMat = new THREE.MeshStandardMaterial({ ...wood, roughness: 1, color: 0xffffff, normalScale: new THREE.Vector2(0.7, 0.7) });
    const bodyWood = woodTextures({ seed: 22, repeat: [1, 2], tone: [52, 32, 19] });
    const bodyMat = new THREE.MeshStandardMaterial({ ...bodyWood, roughness: 1 });
    const desk = new THREE.Group();
    desk.position.set(D.x, 0, D.z);

    const top = new THREE.Mesh(new RoundedBoxGeometry(D.w, 0.05, D.d, 3, 0.012), topMat);
    top.position.y = D.top - 0.025;
    top.receiveShadow = true; top.castShadow = true;
    desk.add(top);
    this.topMesh = top;

    const legH = D.top - 0.05;
    const legGeo = new THREE.BoxGeometry(0.06, legH, 0.06);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = new THREE.Mesh(legGeo, bodyMat);
      l.position.set(sx * (D.w / 2 - 0.06), legH / 2, sz * (D.d / 2 - 0.06));
      desk.add(l);
    }
    // apron
    for (const sz of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(D.w - 0.1, 0.09, 0.022), bodyMat);
      a.position.set(0, D.top - 0.095, sz * (D.d / 2 - 0.05)); desk.add(a);
    }
    // modesty panel on the player's side (hides the dealer's legs)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(D.w - 0.14, legH - 0.12, 0.018), bodyMat);
    panel.position.set(0, 0.12 + (legH - 0.12) / 2, D.d / 2 - 0.07);
    desk.add(panel);
    // drawer pedestal on the dealer's right
    const ped = new THREE.Mesh(new RoundedBoxGeometry(0.38, legH - 0.04, D.d - 0.16, 2, 0.006), bodyMat);
    ped.position.set(D.w / 2 - 0.26, (legH - 0.04) / 2, 0);
    desk.add(ped);
    for (let i = 0; i < 3; i++) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshStandardMaterial({ color: 0x5a4632, metalness: 1, roughness: 0.4 }));
      knob.position.set(D.w / 2 - 0.26, 0.15 + i * 0.2, -D.d / 2 + 0.07);
      desk.add(knob);
    }
    desk.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(desk);
  }

  /**
   * The merchandise lies spread across the wood — no tray, no grid. Positions
   * leave two clear lanes on the dealer's left (x ≈ 0.1–0.45): one for the
   * payment pouch and one for delivering a purchase, so nothing ever crosses.
   */
  _buildItems() {
    const top = LAYOUT.desk.top, D = LAYOUT.desk;
    const add = (it, x, z, ry, y = 0) => { it.setRest(this.group, [D.x + x, top + y, z], ry); this.items.set(it.id, it); };

    // THE GAME catalogue: the models stand for the power-ups named here (data/market.ts)
    add(new MarketItem({ id: 'deep_scan', title: 'FREEZE', model: buildMagnifierSet(), hit: [0.24, 0.04, 0.28], shadow: [0.26, 0.31], hover: { lift: 0.003, tiltX: -0.025 } }), -0.55, -0.47, 0.22);
    this.items.get('deep_scan').shadowBase = 0.35;
    add(new MarketItem({ id: 'hint_drop', title: 'POWERFUL HINT', model: buildEnvelope(), hit: [0.18, 0.03, 0.13], shadow: [0.2, 0.15], hover: { lift: 0.005, tiltX: -0.06 } }), -0.3, -0.38, 0.2);
    add(new MarketItem({ id: 'master_key', title: 'MASTER KEY', model: buildMasterKey(), hit: [0.2, 0.03, 0.08], shadow: [0.21, 0.09], hover: { lift: 0.005, tiltX: -0.05 } }), -0.04, -0.52, -0.3);
    add(new MarketItem({ id: 'overclock', title: 'OVERCLOCK', model: buildOverclockChip(), hit: [0.11, 0.02, 0.08], shadow: [0.12, 0.09], hover: { lift: 0.004, tiltX: -0.06 } }), 0.26, -0.36, 0.25);
    add(new MarketItem({ id: 'bundle', title: 'BLACKOUT BUNDLE', model: buildBundleParcel(), hit: [0.13, 0.05, 0.09], shadow: [0.14, 0.1], hover: { lift: 0.005, tiltX: -0.05 } }), 0.3, -0.72, -0.15);
    add(new MarketItem({ id: 'second_chance', title: 'SKIP TOKEN', model: buildToken(), hit: [0.075, 0.03, 0.075], shadow: [0.075, 0.075], hover: { lift: 0.004, tiltX: -0.12 } }), -0.13, -0.29, 0.6);
    add(new MarketItem({ id: 'knife', title: 'GLITCH ATTACK', model: buildKnife(), hit: [0.24, 0.035, 0.06], shadow: [0.25, 0.07], hover: { lift: 0.004, tiltX: -0.06 } }), 0.53, -0.34, 0.7);
    add(new MarketItem({ id: 'blackout_shield', title: 'FIREWALL', model: buildShield(), hit: [0.1, 0.03, 0.11], shadow: [0.11, 0.13], hover: { lift: 0.005, tiltX: -0.1 } }), 0.58, -0.6, -0.38, 0.0005);
  }

  _buildProps() {
    const top = LAYOUT.desk.top, D = LAYOUT.desk;
    this.ledger = buildLedger();
    this.ledger.position.set(D.x - 0.42, top, D.z - 0.26);
    this.ledger.rotation.y = -0.12;
    this.ledgerRest = { pos: this.ledger.position.clone(), rotY: this.ledger.rotation.y };
    this.group.add(this.ledger);

    const s1 = buildLooseSheet(901, 0.19, 0.25, true);
    s1.position.set(D.x + 0.58, top + 0.0003, -0.59); s1.rotation.z = 0.2;
    const s2 = buildLooseSheet(902, 0.17, 0.22, false);
    s2.position.set(D.x + 0.6, top + 0.0002, D.z - 0.24); s2.rotation.z = 0.5;
    this.group.add(s1, s2);
  }

  _buildSurfaces() {
    const items = this.items;
    const it = (id, hx, hz, h) => {
      const m = items.get(id);
      return new BoxSurface(m.root, hx, hz, h, { active: () => !m.transferred });
    };
    this.surfaces = [
      new BoxSurface(this.ledger, 0.076, 0.106, 0.023),
      it('hint_drop', 0.083, 0.057, 0.0095),
      it('second_chance', 0.027, 0.027, 0.005),
      it('blackout_shield', 0.036, 0.045, 0.01),
      it('deep_scan', 0.1, 0.133, 0.016),
      it('master_key', 0.1, 0.04, 0.014),
      it('overclock', 0.05, 0.035, 0.01),
      it('bundle', 0.06, 0.04, 0.045),
      it('knife', 0.115, 0.022, 0.024),
    ];
  }

  /** Register an extra support (e.g. the payment pouch). */
  addDome(object, radius, height) {
    const d = new DomeSurface(object, radius, height);
    this.surfaces.push(d);
    return d;
  }

  /**
   * Where a purchased item is laid in front of the dealer: in the free lane
   * on the dealer's left, just ahead of his resting fingertips,
   * so the delivery slide toward the player crosses nothing.
   */
  offerSpot(itemId) {
    const half = HALF_DEPTH[itemId] ?? 0.05;
    return new THREE.Vector3(LAYOUT.desk.x + 0.17, LAYOUT.desk.top, -0.69 + half + 0.012);
  }

  /** Every pickable proxy, for the raycaster. */
  get hitTargets() {
    return [...this.items.values()].filter((i) => !i.transferred).map((i) => i.hit);
  }

  aimFocusLight(point) {
    this.focusLight.target.position.copy(point);
    this.focusLight.target.updateMatrixWorld();
  }

  resetLayout() {
    this.ledger.position.copy(this.ledgerRest.pos);
    this.ledger.rotation.set(0, this.ledgerRest.rotY, 0);
    for (const it of this.items.values()) { it.transferred = false; it.restoreRest(); }
  }
}
