import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { woolTextures, leatherTextures } from '../core/proceduralTextures.js';
import { DEALER_CONFIG } from './dealerConfig.js';
import { buildSkinnedArm } from './DealerGloves.js';
import { LAYOUT } from './layout.js';

/**
 * DealerCharacter
 * ---------------
 * Rig-agnostic seated character driven by a small set of pose parameters:
 *
 *   pose.lean, pose.headPitch, pose.headYaw, pose.headRoll, pose.shoulderRise
 *   pose.R / pose.L = { pos (dealer-space wrist target), pitch, yaw, roll,
 *                       curl[5], spread, contact, ik }
 *
 * Every frame: base pose (seated clip or rest) → spine/head layers →
 * analytic two-bone IK per arm → hand orientation → finger curls →
 * desk-contact constraint (no finger ever passes through the wood).
 *
 * The same code drives the bundled BLOCKOUT rig and any GLB with a standard
 * humanoid skeleton, so animation work done now carries over to the final
 * character unchanged.
 */

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const SPLAY = { index: 0.075, middle: 0.0, ring: -0.06, pinky: -0.15 };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class DealerCharacter {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Dealer';
    this.group.position.set(LAYOUT.dealer.x, 0, LAYOUT.dealer.z);
    this.bones = {};
    this.rest = new Map();
    this.isBlockout = true;
    this.mixer = null;
    this.deskY = LAYOUT.desk.top;
    this.cfg = DEALER_CONFIG;
    this.pose = this._defaultPose();
    /**
     * Collision surfaces the hands rest ON (never pass through):
     * objects with heightAt(x, z) → world Y of their top (or -Infinity), and
     * optional prepare() called once per frame. The desk plane is implicit.
     */
    this.surfaces = [];
    /** Active push contacts: { side, object, halfDepth } — the object is kept
     *  in front of the fingertips along +Z (the hand physically pushes it). */
    this.pushers = [];
  }

  /** Try the GLB; fall back to the blockout rig. Resolves to 'glb' | 'blockout'. */
  async load(baseUrl = '') {
    const url = baseUrl + this.cfg.url;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const type = head.headers.get('content-type') || '';
      if (!head.ok || type.includes('text/html')) throw new Error('no model');
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(url);
      this._setupGLB(gltf);
      this.isBlockout = false;
      return 'glb';
    } catch (e) {
      this._buildBlockout();
      this.isBlockout = true;
      return 'blockout';
    }
  }

  _defaultPose() {
    return {
      lean: 0, headPitch: 0.42, headYaw: 0, headRoll: 0, shoulderRise: 0,
      breath: 1, // breathing amplitude multiplier (0 = held breath)
      R: this._handPose('R'), L: this._handPose('L'),
    };
  }

  /** Rest wrist targets in dealer space (hands resting on the desk edge, half in shadow). */
  restHand(side) {
    const s = side === 'R' ? -1 : 1;
    return new THREE.Vector3(s * 0.17, this.deskY + 0.034, 0.44);
  }

  _handPose(side) {
    return {
      pos: this.restHand(side), pitch: 0, yaw: 0, roll: 0,
      curl: [0.3, 0.3, 0.36, 0.42, 0.5], spread: 1, contact: 0, ik: 1,
    };
  }

  // ─────────────────────────────────────────────────────────────── blockout
  _buildBlockout() {
    const coatTex = woolTextures({ seed: 61, repeat: [5, 5] });
    const coat = new THREE.MeshPhysicalMaterial({
      color: 0x0f1012, roughness: 0.9, ...coatTex, normalScale: new THREE.Vector2(0.5, 0.5),
      sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x30333a),
    });
    // black lambskin: fine grain, soft sheen, slightly waxy highlights
    const glovesTex = leatherTextures({ seed: 93, repeat: [6, 6], tone: [30, 27, 26] });
    const glove = new THREE.MeshPhysicalMaterial({
      color: 0x8c8682, map: glovesTex.map, normalMap: glovesTex.normalMap, roughnessMap: glovesTex.roughnessMap,
      roughness: 0.78, normalScale: new THREE.Vector2(0.35, 0.35),
      clearcoat: 0.4, clearcoatRoughness: 0.38, sheen: 0.25, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x3a3430),
      specularIntensity: 0.6,
    });
    const sleeveMat = coat.clone();
    sleeveMat.side = THREE.DoubleSide;
    const felt = new THREE.MeshPhysicalMaterial({ color: 0x111113, roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color(0x26262c) });
    const skin = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 0.7 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x0b0a0a, roughness: 0.35, metalness: 0.1 });
    this.blockoutMaterials = { coat, glove, felt };

    const abs = {}; // absolute bind positions in dealer space
    const B = (name, parent, pos, rotQuat) => {
      const b = new THREE.Bone(); b.name = name;
      abs[name] = new THREE.Vector3(...pos);
      const pAbs = parent ? abs[parent.name] : new THREE.Vector3();
      const pWorldQ = parent ? parent.userData.absQ : new THREE.Quaternion();
      // local position = inverse(parent abs rotation) * (abs - parentAbs)
      b.position.copy(abs[name]).sub(pAbs).applyQuaternion(pWorldQ.clone().invert());
      const absQ = rotQuat ? rotQuat.clone() : pWorldQ.clone();
      b.quaternion.copy(pWorldQ.clone().invert().multiply(absQ));
      b.userData.absQ = absQ;
      (parent || this.group).add(b);
      this.bones[name] = b;
      return b;
    };

    const hips = B('hips', null, [0, 0.53, 0.0]);
    const spine = B('spine', hips, [0, 0.6, 0.01]);
    const spine1 = B('spine1', spine, [0, 0.73, 0.04]);
    const spine2 = B('spine2', spine1, [0, 0.87, 0.08]);
    const neck = B('neck', spine2, [0, 1.06, 0.12]);
    const head = B('head', neck, [0, 1.13, 0.145]);

    const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    for (const side of ['R', 'L']) {
      const s = side === 'R' ? -1 : 1;
      const sh = B(`${side}shoulder`, spine2, [s * 0.04, 1.02, 0.1]);
      const arm = B(`${side}arm`, sh, [s * 0.19, 1.0, 0.1]);
      const fore = B(`${side}forearm`, arm, [s * 0.25, 0.79, 0.29]);
      // hand frame: local +Z along the fingers, palm facing -Y
      const handQ = yawQ(-s * 0.3);
      const hand = B(`${side}hand`, fore, [s * 0.17, 0.79, 0.55], handQ);
      // fingers in hand space
      const hx = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(handQ).add(abs[`${side}hand`]);
      const spec = {
        index: { x: 0.03, len: [0.043, 0.026, 0.02], r: 0.0098 },
        middle: { x: 0.01, len: [0.047, 0.029, 0.021], r: 0.0102 },
        ring: { x: -0.011, len: [0.044, 0.027, 0.02], r: 0.0096 },
        pinky: { x: -0.031, len: [0.034, 0.021, 0.018], r: 0.0086 },
      };
      for (const [f, d] of Object.entries(spec)) {
        // index sits on the thumb side (toward the body centre): hand-local x = -s * d.x
        const fx = -s * d.x;
        let parent = hand, z = 0.097;
        for (let k = 1; k <= 3; k++) {
          parent = B(`${side}${f}${k}`, parent, hx(fx, -0.002, z).toArray(), handQ);
          z += d.len[k - 1];
        }
        const tip = B(`${side}${f}4`, parent, hx(fx, -0.002, z).toArray(), handQ);
        tip.userData.isTip = true;
      }
      // thumb: angled out from the inner side of the palm
      this._armSpec = this._armSpec || {};
      const tDir = new THREE.Vector3(-s * 0.62, -0.32, 0.72).normalize();
      // inner side of the hand: toward the body centre → +X for R, -X for L (hand-local x mirrored by -s)
      const thumbLocalQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tDir);
      const thumbQ = handQ.clone().multiply(thumbLocalQ);
      // curl axis = thumbDir × palmNormal, expressed in the thumb's own frame
      this.blockThumbAxis = this.blockThumbAxis || {};
      this.blockThumbAxis[side] = tDir.clone().cross(new THREE.Vector3(0, -1, 0)).normalize().applyQuaternion(thumbLocalQ.clone().invert());
      let tp = hand, tz = 0;
      const tLen = [0.036, 0.03, 0.025];
      const tBase = new THREE.Vector3(-s * 0.038, -0.008, 0.028);
      for (let k = 1; k <= 4; k++) {
        const local = tBase.clone().add(tDir.clone().multiplyScalar(tz));
        const b = B(`${side}thumb${k}`, tp, hx(local.x, local.y, local.z).toArray(), thumbQ);
        if (k === 4) b.userData.isTip = true;
        tp = b; tz += tLen[k - 1] || 0;
      }
      this._armSpec[side] = { handQ, spec, thumb: { base: tBase.clone(), dir: tDir.clone(), len: tLen } };
      // legs
      const up = B(`${side}upLeg`, hips, [s * 0.1, 0.52, 0.0]);
      const leg = B(`${side}leg`, up, [s * 0.12, 0.5, 0.44]);
      const foot = B(`${side}foot`, leg, [s * 0.13, 0.085, 0.48]);
      B(`${side}toe`, foot, [s * 0.13, 0.02, 0.62]);
    }

    // ── meshes
    const seg = (boneName, toAbs, r0, r1, mat, extra = {}) => {
      const bone = this.bones[boneName];
      const from = abs[boneName], to = toAbs instanceof THREE.Vector3 ? toAbs : abs[toAbs];
      const dir = _v1.copy(to).sub(from);
      const len = dir.length(); dir.normalize();
      const geo = taperedCapsule(r0, r1, len, extra.squash);
      const m = new THREE.Mesh(geo, mat);
      const invQ = bone.userData.absQ.clone().invert();
      const localDir = dir.clone().applyQuaternion(invQ);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
      if (extra.roll) m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), extra.roll));
      if (extra.offset) m.position.copy(new THREE.Vector3(...extra.offset).applyQuaternion(invQ));
      m.castShadow = true; m.receiveShadow = true;
      bone.add(m);
      return m;
    };
    const ellip = (boneName, center, radii, mat) => {
      const bone = this.bones[boneName];
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
      m.scale.set(...radii);
      m.position.copy(new THREE.Vector3(...center).sub(abs[boneName]).applyQuaternion(bone.userData.absQ.clone().invert()));
      m.castShadow = true; m.receiveShadow = true;
      bone.add(m);
      return m;
    };

    // torso (overcoat)
    ellip('hips', [0, 0.57, 0.06], [0.205, 0.095, 0.17], coat);
    ellip('spine', [0, 0.68, 0.025], [0.19, 0.12, 0.13], coat);
    ellip('spine1', [0, 0.8, 0.055], [0.205, 0.13, 0.135], coat);
    ellip('spine2', [0, 0.93, 0.085], [0.215, 0.14, 0.14], coat);
    {
      // shoulder line: horizontal capsule across the yoke of the coat
      const yoke = new THREE.Mesh(taperedCapsule(0.066, 0.066, 0.36), coat);
      yoke.rotation.z = Math.PI / 2;
      yoke.position.copy(new THREE.Vector3(0.18, 0.995, 0.1).sub(abs.spine2));
      yoke.scale.set(1, 1, 0.85);
      yoke.castShadow = true;
      spine2.add(yoke);
    }
    // raised coat collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.112, 0.13, 32, 1, true, -Math.PI * 0.85, Math.PI * 1.7), coat);
    collar.material = coat.clone(); collar.material.side = THREE.DoubleSide;
    collar.position.copy(new THREE.Vector3(0, 1.075, 0.11).sub(abs.spine2));
    collar.rotation.x = 0.22; collar.rotation.y = Math.PI;
    collar.castShadow = true;
    spine2.add(collar);
    seg('neck', 'head', 0.05, 0.048, skin);
    // head + hat (the brim is the main reason the face never catches the lamp)
    ellip('head', [0, 1.215, 0.16], [0.086, 0.108, 0.098], skin);
    const hat = new THREE.Group();
    hat.position.copy(new THREE.Vector3(0, 1.29, 0.155).sub(abs.head));
    hat.rotation.x = 0.16;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.18, 0.008, 48), felt);
    const bp = brim.geometry.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), z = bp.getZ(i), r = Math.hypot(x, z); bp.setY(i, bp.getY(i) + Math.max(0, r - 0.11) * (z > 0 ? -0.28 : 0.35)); }
    brim.geometry.computeVertexNormals();
    const crownPts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; crownPts.push(new THREE.Vector2(0.105 - t * t * 0.03 - (t > 0.9 ? (t - 0.9) * 0.6 : 0), t * 0.11)); }
    crownPts.push(new THREE.Vector2(0.0, 0.1));
    const crown = new THREE.Mesh(new THREE.LatheGeometry(crownPts, 40), felt);
    crown.scale.set(1, 1, 1.12);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.107, 0.022, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.5 }));
    band.position.y = 0.014; band.scale.set(1, 1, 1.12);
    hat.add(brim, crown, band);
    hat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    head.add(hat);

    for (const side of ['R', 'L']) {
      const s = side === 'R' ? -1 : 1;
      seg(`${side}upLeg`, `${side}leg`, 0.085, 0.07, coat);
      seg(`${side}leg`, `${side}foot`, 0.055, 0.045, trousers);
      seg(`${side}foot`, `${side}toe`, 0.04, 0.036, shoe, { squash: 0.55 });
    }

    // continuous skinned gloves + sleeves (bound in the bind pose)
    this.group.updateMatrixWorld(true);
    for (const side of ['R', 'L']) {
      const a = this._armSpec[side];
      buildSkinnedArm({ side, bones: this.bones, abs, handQ: a.handQ, spec: a.spec, thumb: a.thumb, gloveMat: glove, sleeveMat, parent: this.group });
    }

    this.group.updateMatrixWorld(true);
    this._captureRest();
    this._buildChains();
  }

  // ─────────────────────────────────────────────────────────────── GLB
  _setupGLB(gltf) {
    const model = gltf.scene;
    // unit detection (cm exports are 100× too large)
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    const unit = h > 10 ? 0.01 : 1;
    model.scale.setScalar(unit * this.cfg.scale);
    model.rotation.y = this.cfg.rotationY;
    model.position.set(...this.cfg.offset);
    model.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.group.add(model);
    this.model = model;

    const found = {};
    model.traverse((o) => {
      if (!o.isBone) return;
      const key = canonicalBoneName(o.name);
      if (key && !found[key]) found[key] = o;
    });
    this.bones = found;

    const clip = gltf.animations.find((a) => a.name.toLowerCase().includes(this.cfg.seatedClip));
    if (clip) {
      this.mixer = new THREE.AnimationMixer(model);
      // strip arm tracks: arms are fully procedural (IK) so the clip only drives body/legs
      const armRe = /(arm|hand|thumb|index|middle|ring|pinky|finger)/i;
      clip.tracks = clip.tracks.filter((t) => !armRe.test(t.name.split('.')[0]));
      this.mixer.clipAction(clip).play();
    }
    this.group.updateMatrixWorld(true);
    this._captureRest();
    this._buildChains();
    const missing = ['Rarm', 'Rforearm', 'Rhand', 'Larm', 'Lforearm', 'Lhand', 'head'].filter((k) => !this.bones[k]);
    if (missing.length) console.warn('[Dealer] GLB is missing bones:', missing);
  }

  _captureRest() {
    for (const [k, b] of Object.entries(this.bones)) this.rest.set(k, b.quaternion.clone());
    // rest hand orientation (world) relative to dealer, for hand orientation layer
    this.restHandQ = {};
    this.restForeDir = {};
    const dq = this.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const s of ['R', 'L']) {
      const hand = this.bones[`${s}hand`], fore = this.bones[`${s}forearm`];
      if (!hand || !fore) continue;
      this.restHandQ[s] = dq.clone().multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
      const a = fore.getWorldPosition(new THREE.Vector3()), b = hand.getWorldPosition(new THREE.Vector3());
      this.restForeDir[s] = this.group.worldToLocal(b.clone()).sub(this.group.worldToLocal(a.clone())).setY(0).normalize();
    }
  }

  _buildChains() {
    this.chains = {};
    for (const s of ['R', 'L']) {
      const fingers = {};
      for (const f of FINGERS) {
        const arr = [1, 2, 3].map((k) => this.bones[`${s}${f}${k}`]).filter(Boolean);
        fingers[f] = { bones: arr, tip: this.bones[`${s}${f}4`] || null };
      }
      this.chains[s] = { fingers };
    }
  }

  // ─────────────────────────────────────────────────────────────── per frame
  update(dt, t) {
    const P = this.pose;
    const b = this.bones;
    if (!b.hips && !b.spine) return;

    // Always restart from the rest pose so procedural layers never accumulate;
    // a seated clip (if any) then overwrites the bones it animates.
    for (const [k, q] of this.rest) this.bones[k].quaternion.copy(q);
    if (this.mixer) this.mixer.update(dt);
    this.group.updateMatrixWorld(true);

    if (!this.mixer && !this.isBlockout) this._applyProceduralSeat();

    // breathing: slow, slightly irregular
    const br = (Math.sin(t * 1.45) * 0.7 + Math.sin(t * 0.61 + 1.3) * 0.3) * P.breath;
    const X = _v4.set(1, 0, 0);
    this._rotDealer(b.spine, X, P.lean * 0.3 + br * 0.004);
    this._rotDealer(b.spine1, X, P.lean * 0.35 + br * 0.008);
    this._rotDealer(b.spine2, X, P.lean * 0.35 + br * 0.012);
    for (const s of ['R', 'L']) {
      if (b[`${s}shoulder`]) this._rotDealer(b[`${s}shoulder`], _v3.set(0, 0, 1), (s === 'R' ? -1 : 1) * (P.shoulderRise + br * 0.01));
    }
    this._rotDealer(b.neck, _v3.set(0, 1, 0), P.headYaw * 0.4);
    this._rotDealer(b.neck, X, P.headPitch * 0.45);
    this._rotDealer(b.head, _v3.set(0, 1, 0), P.headYaw * 0.6);
    this._rotDealer(b.head, X, P.headPitch * 0.55);
    this._rotDealer(b.head, _v3.set(0, 0, 1), P.headRoll);

    for (const srf of this.surfaces) srf.prepare?.();
    for (const s of ['R', 'L']) this._solveArm(s, P[s]);
    this._applyPushers();
  }

  /** Support height under a world (x, z): the desk or whatever lies on it. */
  surfaceAt(x, z) {
    let h = this.deskY;
    for (const srf of this.surfaces) { const v = srf.heightAt(x, z); if (v > h) h = v; }
    return h;
  }

  _applyPushers() {
    for (const p of this.pushers) {
      let front = -Infinity;
      for (const f of ['index', 'middle', 'ring']) {
        const tip = this.fingertip(p.side, f, _v1);
        if (tip) front = Math.max(front, tip.z + 0.009);
      }
      const minZ = front + p.halfDepth;
      if (p.object.position.z < minZ) p.object.position.z = minZ;
    }
  }

  _applyProceduralSeat() {
    const c = this.cfg.proceduralSeat, b = this.bones;
    for (const s of ['R', 'L']) {
      for (const [k, e] of [['upLeg', c.upLeg], ['leg', c.leg], ['foot', c.foot]]) {
        const bone = b[`${s}${k}`];
        if (bone) this._rotDealer(bone, _v3.set(1, 0, 0), e[0]);
      }
    }
  }

  /** Rotate a bone about an axis expressed in dealer space. */
  _rotDealer(bone, axisDealer, angle) {
    if (!bone || !angle) return;
    const gq = this.group.getWorldQuaternion(_q3);
    const axis = _v1.copy(axisDealer).applyQuaternion(gq).normalize();
    _q1.setFromAxisAngle(axis, angle);
    applyWorldRotation(bone, _q1);
  }

  _solveArm(s, H) {
    const b = this.bones;
    const sh = b[`${s}shoulder`], up = b[`${s}arm`], lo = b[`${s}forearm`], hand = b[`${s}hand`];
    if (!up || !lo || !hand) return;
    const target = this.group.localToWorld(_v2.copy(H.pos));

    // protraction: shoulders roll forward for long reaches
    if (sh) {
      const A = up.getWorldPosition(_v1);
      const reach = A.distanceTo(target);
      const pro = THREE.MathUtils.clamp((reach - 0.4) / 0.2, 0, 1);
      this._rotDealer(sh, _v3.set(0, 1, 0), (s === 'R' ? 1 : -1) * pro * 0.22);
      this._rotDealer(sh, _v3.set(1, 0, 0), pro * 0.08);
    }

    const pole = this.group.localToWorld(
      up.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(this.group.matrixWorld).invert()).add(_v3.set(...this.cfg.pole[s])),
    );

    const solveOnce = (tgt) => {
      twoBoneIK(up, lo, hand, tgt, pole);
      this._orientHand(s, H);
      this._curlFingers(s, H);
    };
    solveOnce(target);

    // Contact constraint: lift the wrist until no finger, knuckle or palm is
    // below the surface under it (desk, ledger, tray rim, pouch, items…).
    // With H.contact = 1 we also pull DOWN until the lowest point touches
    // (used for taps so the knock lands exactly on contact).
    for (let it = 0; it < 2; it++) {
      const c = this._clearance(s);
      let dy = 0;
      if (c < 0.0004) dy = 0.0004 - c;
      else if (H.contact > 0 && it === 0) dy = (0.0004 - c) * H.contact;
      if (Math.abs(dy) < 1e-4) break;
      target.y += dy;
      solveOnce(target);
    }
  }

  /** Smallest gap between the hand and the surface beneath each sample point. */
  _clearance(s) {
    const r = this.isBlockout ? 0.0105 : 0.009;
    let min = Infinity;
    const test = (p, rad) => { const g = p.y - rad - this.surfaceAt(p.x, p.z); if (g < min) min = g; };
    for (const f of FINGERS) {
      const p = this.fingertip(s, f, _v1);
      if (p) test(p, r * 0.8);
      for (const b of this.chains[s].fingers[f].bones) test(b.getWorldPosition(_v1), r);
    }
    test(this.bones[`${s}hand`].getWorldPosition(_v1), this.isBlockout ? 0.024 : 0.025);
    return min;
  }

  _orientHand(s, H) {
    const hand = this.bones[`${s}hand`], fore = this.bones[`${s}forearm`];
    if (!this.restHandQ[s]) return;
    // follow the forearm's heading so the wrist doesn't twist unnaturally
    const a = this.group.worldToLocal(fore.getWorldPosition(_v1));
    const b2 = this.group.worldToLocal(hand.getWorldPosition(_v3));
    const dir = b2.sub(a).setY(0).normalize();
    const yawFollow = _q2.setFromUnitVectors(this.restForeDir[s], dir);
    const sgn = s === 'R' ? 1 : -1;
    const extra = new THREE.Quaternion().setFromEuler(new THREE.Euler(H.pitch, H.yaw * sgn, H.roll * sgn, 'YXZ'));
    const local = yawFollow.multiply(extra).multiply(this.restHandQ[s]);
    const world = this.group.getWorldQuaternion(new THREE.Quaternion()).multiply(local);
    setWorldQuaternion(hand, world);
  }

  _curlFingers(s, H) {
    const cfg = this.cfg.fingerCurl;
    const blk = this.isBlockout;
    FINGERS.forEach((f, fi) => {
      const ch = this.chains[s].fingers[f];
      const curl = H.curl[fi];
      ch.bones.forEach((bone, k) => {
        const rest = this.rest.get(`${s}${f}${k + 1}`) || bone.quaternion;
        let axis, sign, max;
        if (blk) {
          axis = f === 'thumb' ? _v1.copy(this.blockThumbAxis[s]) : _v1.set(1, 0, 0);
          sign = 1;
          max = f === 'thumb' ? [0.5, 0.7, 0.7][k] : [1.15, 1.45, 1.05][k];
        } else {
          axis = f === 'thumb' ? _v1.set(...cfg.thumbAxis) : _v1.set(...cfg.axis);
          sign = f === 'thumb' ? cfg.thumbSign[s] : cfg.sign[s];
          max = cfg.maxAngles[k];
        }
        _q1.setFromAxisAngle(axis, curl * max * sign);
        bone.quaternion.copy(rest);
        if (blk && k === 0 && f !== 'thumb') {
          // natural splay: index leans toward the thumb, ring/pinky fan outward.
          // Splay shrinks as the fist closes, like a real hand.
          const spread = SPLAY[f] * (s === 'R' ? 1 : -1) * (H.spread ?? 1) * (1 - curl * 0.6);
          bone.quaternion.multiply(_q2.setFromAxisAngle(_v3.set(0, 1, 0), spread));
        }
        bone.quaternion.multiply(_q1);
      });
    });
    this.bones[`${s}hand`].updateMatrixWorld(true);
  }

  /** Lowest world-space Y among fingertips and the heel of the palm. */
  _lowestPoint(s) {
    // bone joints sit at the centre of the finger: subtract the finger radius
    const r = this.isBlockout ? 0.0105 : 0.009;
    let min = Infinity;
    for (const f of FINGERS) {
      const p = this.fingertip(s, f, _v1);
      if (p) min = Math.min(min, p.y - r * 0.8);
      for (const b of this.chains[s].fingers[f].bones) min = Math.min(min, b.getWorldPosition(_v1).y - r);
    }
    // heel of the palm
    min = Math.min(min, this.bones[`${s}hand`].getWorldPosition(_v1).y - (this.isBlockout ? 0.024 : 0.025));
    return min;
  }

  fingertip(s, f, out = new THREE.Vector3()) {
    const ch = this.chains[s]?.fingers[f];
    if (!ch || !ch.bones.length) return null;
    if (ch.tip) return ch.tip.getWorldPosition(out);
    const last = ch.bones[ch.bones.length - 1], prev = ch.bones[ch.bones.length - 2] || this.bones[`${s}hand`];
    const a = prev.getWorldPosition(new THREE.Vector3()), bb = last.getWorldPosition(out);
    return bb.add(bb.clone().sub(a).multiplyScalar(0.85));
  }

  /** World position of a hand's palm centre (for spatial audio / contacts). */
  handWorld(s, out = new THREE.Vector3()) {
    return this.bones[`${s}hand`]?.getWorldPosition(out) ?? out.set(0, 1, -1);
  }

  /** Dealer-space point from a world point. */
  toDealer(world, out = new THREE.Vector3()) {
    return this.group.worldToLocal(out.copy(world));
  }

  /** Restore the default pose in place (objects keep their identity). */
  resetPose() {
    const f = this._defaultPose();
    for (const k of ['lean', 'headPitch', 'headYaw', 'headRoll', 'shoulderRise', 'breath']) this.pose[k] = f[k];
    for (const s of ['R', 'L']) {
      const h = this.pose[s], d = f[s];
      h.pos.copy(d.pos);
      h.pitch = d.pitch; h.yaw = d.yaw; h.roll = d.roll; h.contact = 0; h.ik = 1; h.spread = 1;
      d.curl.forEach((c, i) => (h.curl[i] = c));
    }
  }
}

// ───────────────────────────────────────────────────────────────── helpers

function applyWorldRotation(bone, qWorld) {
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const newWorld = qWorld.clone().multiply(worldQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateMatrixWorld(true);
}

function setWorldQuaternion(bone, qWorld) {
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK, rest-orientation agnostic: rotates the upper bone so
 * the elbow lands on the law-of-cosines circle (biased toward `pole`), then
 * rotates the lower bone so the wrist reaches the target.
 */
function twoBoneIK(upper, lower, end, target, pole) {
  const A = upper.getWorldPosition(new THREE.Vector3());
  const Bp = lower.getWorldPosition(new THREE.Vector3());
  const C = end.getWorldPosition(new THREE.Vector3());
  const a = A.distanceTo(Bp), b = Bp.distanceTo(C);
  const toT = target.clone().sub(A);
  const c = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const dir = toT.normalize();
  const p = pole.clone().sub(A);
  const n = p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const cosA = THREE.MathUtils.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = A.clone().addScaledVector(dir, cosA * a).addScaledVector(n, sinA * a);

  const q1 = new THREE.Quaternion().setFromUnitVectors(Bp.clone().sub(A).normalize(), elbow.clone().sub(A).normalize());
  applyWorldRotation(upper, q1);

  const B2 = lower.getWorldPosition(new THREE.Vector3());
  const C2 = end.getWorldPosition(new THREE.Vector3());
  const wrist = A.clone().addScaledVector(dir, c);
  const q2 = new THREE.Quaternion().setFromUnitVectors(C2.sub(B2).normalize(), wrist.sub(B2).normalize());
  applyWorldRotation(lower, q2);
}

function taperedCapsule(r0, r1, len, squash) {
  const pts = [];
  const N = 8;
  for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (i / N) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }
  for (let i = 0; i <= N; i++) { const a = (i / N) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * r1, len + Math.sin(a) * r1)); }
  const g = new THREE.LatheGeometry(pts, 20);
  if (squash) g.scale(1, 1, squash);
  return g;
}

function roundedPalm() {
  // palm block in hand space: wrist at origin, fingers toward +Z, palm down (-Y)
  const g = new THREE.SphereGeometry(1, 28, 18);
  g.scale(0.046, 0.017, 0.056);
  g.translate(0, -0.002, 0.052);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), y = p.getY(i);
    // flatter underside, knuckle ridge toward the fingers
    if (y < -0.004) p.setY(i, -0.004 + (y + 0.004) * 0.55);
    if (z > 0.085 && y > 0) p.setY(i, y + 0.003);
  }
  g.computeVertexNormals();
  return g;
}

/** Map arbitrary humanoid bone names to canonical keys. */
export function canonicalBoneName(raw) {
  let n = raw.toLowerCase().replace(/mixamorig\d*[:_]?|cc_base_|def-|org-|bip0?1[_ ]?|armature[|_]?|^j_|_jnt$/g, '');
  let side = '';
  if (/left|(^|[_. ])l([_. ]|$)|\.l$|_l$/.test(n)) side = 'L';
  else if (/right|(^|[_. ])r([_. ]|$)|\.r$|_r$/.test(n)) side = 'R';
  n = n.replace(/left|right|(^|[_. ])[lr](?=[_. ]|$)|\.[lr]$|_[lr]$/g, '').replace(/[_. ]/g, '');
  const num = (n.match(/(\d)/) || [])[1];
  const finger = (n.match(/thumb|index|middle|mid|ring|pinky|little/) || [])[0];
  if (finger && side) {
    const f = { mid: 'middle', little: 'pinky' }[finger] || finger;
    const k = num ? Math.min(4, Math.max(1, +num)) : 1;
    return `${side}${f}${k}`;
  }
  if (side) {
    if (/forearm|lowerarm|elbow/.test(n)) return `${side}forearm`;
    if (/upperarm|^arm$|arm\d?$/.test(n) && !/fore|lower/.test(n)) return `${side}arm`;
    if (/hand$|wrist/.test(n)) return `${side}hand`;
    if (/shoulder|clavicle/.test(n)) return `${side}shoulder`;
    if (/upleg|thigh|upperleg/.test(n)) return `${side}upLeg`;
    if (/^leg$|calf|lowerleg|shin|knee/.test(n)) return `${side}leg`;
    if (/foot|ankle/.test(n)) return `${side}foot`;
    return null;
  }
  if (/hips|pelvis/.test(n)) return 'hips';
  if (/spine2|spine02|upperchest|chest/.test(n)) return 'spine2';
  if (/spine1|spine01/.test(n)) return 'spine1';
  if (/^spine$|spine0?$/.test(n)) return 'spine';
  if (/neck/.test(n)) return 'neck';
  if (/^head$|head$/.test(n) && !/top|end/.test(n)) return 'head';
  return null;
}
