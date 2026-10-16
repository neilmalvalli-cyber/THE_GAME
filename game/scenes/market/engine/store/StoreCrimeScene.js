import * as THREE from 'three';
import { makeRng } from '../core/proceduralTextures.js';
import { STORE } from './storeLayout.js';

/**
 * StoreCrimeScene — what the convenience store looks like after the Admin shuts the
 * market down (THE GAME integration; additive, the open store is never modified).
 *
 *   outside : police tape stretched across the sliding doors between two posts, a
 *             notice on the door glass, a cracked window pane, red/blue light from
 *             cars out on the street, the neon sign off
 *   inside  : most tubes dead and one stuttering, stock knocked onto the floor, a
 *             display rack lying in the aisle, glass on the floor, the receipt roll
 *             unspooled, a dried stain, numbered evidence markers
 *
 * Everything lives in one group that is shown or hidden; nothing in the open store is
 * moved, so reopening restores the clean store exactly.
 */

const R = STORE.room;
const Z1 = R.z1;

export class StoreCrimeScene {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'CrimeScene';
    this.group.visible = false;
    this.tapes = [];
    this.active = false;
    this._build();
  }

  _build() {
    this._buildTape();
    this._buildDoorNotice();
    this._buildCrack();
    this._buildDebris();
    this._buildRack();
    this._buildGlass();
    this._buildReceiptRoll();
    this._buildStain();
    this._buildMarkers();
    this._buildPoliceLights();
  }

  // ── tape across the doors: a ribbon re-shaped every frame (sag + travelling waves)
  _buildTape() {
    const tex = tapeTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, emissive: 0x3a3000, emissiveIntensity: 0.25 });
    const z = Z1 + 0.42;
    // two posts the tape is tied to
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    for (const x of [-1.45, 1.45]) {
      const post = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 12), postMat);
      pole.position.y = 0.85; post.add(pole);
      for (const y of [0.35, 0.75, 1.15, 1.55]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.12, 12), stripeMat);
        band.position.y = y; post.add(band);
      }
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }));
      foot.position.y = 0.03; post.add(foot);
      post.position.set(x, 0, z);
      post.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(post);
    }
    // an X across the doorway and one line straight across
    const runs = [
      { a: [-1.45, 1.55, z], b: [1.45, 0.62, z + 0.02], sag: 0.05, phase: 0 },
      { a: [-1.45, 0.62, z + 0.04], b: [1.45, 1.55, z + 0.05], sag: 0.05, phase: 1.7 },
      { a: [-1.45, 1.12, z + 0.07], b: [1.45, 1.12, z + 0.07], sag: 0.12, phase: 3.1 },
    ];
    for (const r of runs) {
      const t = new Ribbon(new THREE.Vector3(...r.a), new THREE.Vector3(...r.b), { width: 0.075, sag: r.sag, phase: r.phase, segments: 56 });
      t.mesh.material = mat;
      t.setRepeat(0.075 * tex.userData.aspect);
      t.mesh.renderOrder = 6;
      this.tapes.push(t);
      this.group.add(t.mesh);
    }
  }

  _buildDoorNotice() {
    const c = document.createElement('canvas'); c.width = 420; c.height = 560;
    const x = c.getContext('2d');
    x.fillStyle = '#f4efe2'; x.fillRect(0, 0, 420, 560);
    x.fillStyle = '#a3262a'; x.fillRect(0, 0, 420, 70);
    x.fillStyle = '#fff'; x.font = 'bold 34px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('POLICE NOTICE', 210, 48);
    x.fillStyle = '#161412'; x.font = 'bold 58px "Arial Narrow", Arial, sans-serif'; x.fillText('MARKET', 210, 160); x.fillText('CLOSED', 210, 222);
    x.font = 'bold 22px Arial, sans-serif';
    x.fillText('THIS AREA IS UNDER', 210, 300); x.fillText('INVESTIGATION', 210, 330);
    x.fillStyle = '#a3262a'; x.fillText('ALL TRANSACTIONS', 210, 390); x.fillText('SUSPENDED', 210, 420);
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.font = '16px monospace'; x.fillText('CASE REF 06-0427 · DO NOT ENTER', 210, 520);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
    sheet.position.set(-0.42, 1.38, Z1 + 0.012);
    sheet.rotation.z = 0.025;
    this.group.add(sheet);
    // two strips of clear tape holding it up
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xe8e2cc, transparent: true, opacity: 0.55, roughness: 0.3 });
    for (const dx of [-0.13, 0.13]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.03), tapeMat);
      s.position.set(-0.42 + dx, 1.62, Z1 + 0.014); s.rotation.z = dx > 0 ? 0.2 : -0.2;
      this.group.add(s);
    }
  }

  // ── a spider crack in the window pane right of the door (seen from the street)
  _buildCrack() {
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const rng = makeRng(61);
    const cx = S * 0.46, cy = S * 0.42;
    x.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.3;
      let px = cx, py = cy;
      const len = 80 + rng() * 170;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 1; k <= 6; k++) { const aa = a + (rng() - 0.5) * 0.4; px = cx + Math.cos(aa) * len * (k / 6); py = cy + Math.sin(aa) * len * (k / 6); x.lineTo(px, py); }
      x.strokeStyle = `rgba(255,255,255,${0.45 + rng() * 0.4})`; x.lineWidth = 1 + rng() * 1.5; x.stroke();
    }
    for (const r of [18, 38, 64]) {
      x.beginPath();
      for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; const rr = r * (0.85 + rng() * 0.3); k ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1; x.stroke();
    }
    x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(cx, cy, 7, 0, Math.PI * 2); x.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, side: THREE.DoubleSide }));
    crack.position.set(1.75, 1.35, Z1 + 0.006);
    crack.renderOrder = 7;
    this.group.add(crack);
  }

  // ── stock knocked off the shelves into the aisles and across the floor
  _buildDebris() {
    const rng = makeRng(404);
    const palette = [0xd8382f, 0xf2b72f, 0x2f8fd8, 0x3cb371, 0xe86f2c, 0x8e44ad, 0xf4e04d, 0x1abc9c, 0xffffff];
    const boxMat = new THREE.MeshStandardMaterial({ map: labelTex(), roughness: 0.55 });
    const canMat = new THREE.MeshStandardMaterial({ map: labelTex(), metalness: 0.55, roughness: 0.35 });
    const boxes = [], cans = [];
    // the main spill: from the second gondola out across the aisle toward the counter
    const scatter = (n, x0, x1, z0, z1, list, mk) => { for (let i = 0; i < n; i++) list.push(mk(x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0))); };
    const box = (x, z) => {
      const w = 0.08 + rng() * 0.12, h = 0.12 + rng() * 0.18, d = 0.1 + rng() * 0.1;
      const lying = rng() < 0.75;
      return { p: [x, lying ? d / 2 : h / 2, z], s: lying ? [w, d, h] : [w, h, d], r: [lying ? 0 : 0, rng() * Math.PI * 2, lying ? 0 : (rng() - 0.5) * 0.1], c: palette[Math.floor(rng() * palette.length)] };
    };
    const can = (x, z) => ({ p: [x, 0.033, z], r: [Math.PI / 2, rng() * Math.PI * 2, 0], c: palette[Math.floor(rng() * palette.length)] });
    scatter(26, -1.45, -0.55, -0.2, 2.1, boxes, box);
    scatter(10, -2.5, -2.2, 0.1, 2.0, boxes, box);
    scatter(8, -0.6, 0.9, 0.25, 1.4, boxes, box);
    scatter(18, -1.4, 0.6, -0.1, 2.3, cans, can);
    scatter(6, 1.6, 3.0, 0.2, 1.6, cans, can);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const ib = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), boxMat, boxes.length);
    boxes.forEach((b, i) => { q.setFromEuler(new THREE.Euler(...b.r)); m4.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(...b.s)); ib.setMatrixAt(i, m4); ib.setColorAt(i, col.set(b.c)); });
    const ic = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 14), canMat, cans.length);
    cans.forEach((c, i) => { q.setFromEuler(new THREE.Euler(...c.r, 'YXZ')); m4.compose(new THREE.Vector3(...c.p), q, new THREE.Vector3(1, 1, 1)); ic.setMatrixAt(i, m4); ic.setColorAt(i, col.set(c.c)); });
    ib.castShadow = ib.receiveShadow = true; ic.castShadow = ic.receiveShadow = true;
    this.group.add(ib, ic);
  }

  // ── a wire display rack lying across the aisle
  _buildRack() {
    const g = new THREE.Group();
    const wire = new THREE.MeshStandardMaterial({ color: 0xc9cccf, metalness: 0.8, roughness: 0.35 });
    const H = 1.5, W = 0.55;
    for (const x of [-W / 2, W / 2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, H, 8), wire); p.position.set(x, H / 2, 0); g.add(p); }
    for (let i = 0; i < 5; i++) {
      const y = 0.15 + i * 0.32;
      const s = new THREE.Mesh(new THREE.BoxGeometry(W, 0.012, 0.32), wire); s.position.set(0, y, 0.12); g.add(s);
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, W, 6), wire); lip.rotation.z = Math.PI / 2; lip.position.set(0, y + 0.05, 0.28); g.add(lip);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, 0.01), new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.6 }));
    sign.position.set(0, H + 0.08, 0); g.add(sign);
    // fallen forward into the aisle, resting on its top edge
    g.rotation.set(-Math.PI / 2 + 0.06, 0.5, 0);
    g.position.set(-0.95, 0.03, 1.15);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(g);
  }

  // ── broken glass on the floor in front of the counter
  _buildGlass() {
    const rng = makeRng(88);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xe8f2f4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1, side: THREE.DoubleSide, envMapIntensity: 2.2, depthWrite: false });
    const shards = new THREE.Group();
    for (let i = 0; i < 46; i++) {
      const s = 0.015 + rng() * 0.07;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(s * (0.6 + rng()), s * (rng() - 0.3)); shape.lineTo(s * (rng() - 0.2), s * (0.6 + rng())); shape.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.75;
      m.position.set(0.55 + Math.cos(a) * r, 0.002 + rng() * 0.002, 0.25 + Math.sin(a) * r * 0.7);
      m.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.15, 0, rng() * Math.PI * 2);
      shards.add(m);
    }
    this.group.add(shards);
  }

  // ── the receipt roll, pulled out and trailing off the counter onto the floor
  _buildReceiptRoll() {
    const C = STORE.counter;
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      const x = C.x + 0.86 - u * 0.5 + Math.sin(u * 7) * 0.08;
      const y = u < 0.25 ? C.top + 0.01 - u * 0.2 : Math.max(0.003, C.top * (1 - (u - 0.25) / 0.2));
      const z = C.z + 0.1 + u * 1.3;
      pts.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 80, 0.0015, 3, false);
    geo.scale(1, 1, 1);
    const strip = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }));
    // flatten the tube into a ribbon look by layering a thin plane path on the floor part
    this.group.add(strip);
    const floorStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.9), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, side: THREE.DoubleSide }));
    floorStrip.rotation.set(-Math.PI / 2, 0, 0.35);
    floorStrip.position.set(C.x + 0.42, 0.003, C.z + 1.05);
    floorStrip.receiveShadow = true;
    this.group.add(floorStrip);
  }

  // ── a dried stain in front of the counter (dark, matte, not bright red)
  _buildStain() {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const rng = makeRng(17);
    for (let i = 0; i < 9; i++) {
      const r = 20 + rng() * 60, px = S / 2 + (rng() - 0.5) * 90, py = S / 2 + (rng() - 0.5) * 60;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(58,14,10,0.75)'); g.addColorStop(0.7, 'rgba(48,10,8,0.45)'); g.addColorStop(1, 'rgba(40,8,6,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(px, py, r, r * (0.6 + rng() * 0.4), rng() * 3, 0, Math.PI * 2); x.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const stain = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(-0.25, 0.004, 0.35);
    stain.receiveShadow = true;
    this.group.add(stain);
  }

  // ── numbered yellow evidence markers by each find
  _buildMarkers() {
    const spots = [[-0.2, 0.45], [0.55, 0.15], [-0.95, 1.55], [0.45, 1.1], [-1.1, 0.4], [1.75, 2.75]];
    spots.forEach(([x, z], i) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#111'; g.font = 'bold 84px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), 64, 70);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const plain = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
      // an A-frame tent: two faces leaning together
      const m = new THREE.Group();
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.004), [plain, plain, plain, plain, face, face]);
        p.position.set(0, 0.052, s * 0.022); p.rotation.x = s * 0.4;
        p.castShadow = true;
        m.add(p);
      }
      m.position.set(x, 0, z);
      m.rotation.y = (i % 2 ? 0.4 : -0.3);
      this.group.add(m);
    });
  }

  // ── patrol cars out on the street: alternating red / blue light, no shadows
  _buildPoliceLights() {
    this.red = new THREE.PointLight(0xff2a2a, 0, 14, 1.6);
    this.red.position.set(-3.2, 1.3, Z1 + 4.2);
    this.blue = new THREE.PointLight(0x2a5cff, 0, 14, 1.6);
    this.blue.position.set(3.0, 1.3, Z1 + 4.6);
    this.group.add(this.red, this.blue);
  }

  /** Called every frame while the crime scene is shown. */
  update(dt, t) {
    if (!this.active) return;
    for (const tape of this.tapes) tape.update(t);
    // two rotating beacons, out of phase
    const a = Math.max(0, Math.sin(t * 5.2)) ** 2, b = Math.max(0, Math.sin(t * 5.2 + Math.PI)) ** 2;
    this.red.intensity = 22 * a;
    this.blue.intensity = 26 * b;
  }

  setActive(on) {
    this.active = on;
    this.group.visible = on;
    if (!on) { this.red.intensity = 0; this.blue.intensity = 0; }
    else for (const tape of this.tapes) tape.update(0);
  }
}

/** A flat ribbon between two points that hangs and moves like cloth. */
class Ribbon {
  constructor(a, b, { width = 0.075, sag = 0.06, phase = 0, segments = 48 } = {}) {
    this.a = a; this.b = b; this.width = width; this.sag = sag; this.phase = phase; this.n = segments;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((segments + 1) * 2 * 3);
    const uv = new Float32Array((segments + 1) * 2 * 2);
    const idx = [];
    const len = a.distanceTo(b);
    for (let i = 0; i <= segments; i++) {
      uv.set([(i / segments) * len / 0.6, 1, (i / segments) * len / 0.6, 0], i * 4);
      if (i < segments) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo);
    this.mesh.frustumCulled = false;
    this._dir = new THREE.Vector3().subVectors(b, a);
    this._p = new THREE.Vector3();
  }

  /** One texture tile per `tile` metres of tape. */
  setRepeat(tile) {
    const uv = this.mesh.geometry.attributes.uv, len = this.a.distanceTo(this.b);
    for (let i = 0; i <= this.n; i++) { const u = (i / this.n) * len / tile; uv.setXY(i * 2, u, 1); uv.setXY(i * 2 + 1, u, 0); }
    uv.needsUpdate = true;
  }

  update(t) {
    const pos = this.mesh.geometry.attributes.position;
    const { a, n, width, sag, phase } = this;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const env = Math.sin(Math.PI * u); // tied at both ends, free in the middle
      this._p.copy(a).addScaledVector(this._dir, u);
      this._p.y -= sag * 4 * u * (1 - u) + env * 0.012 * Math.sin(u * 11 - t * 2.1 + phase);
      const dz = env * (0.025 * Math.sin(u * 7 - t * 1.6 + phase) + 0.01 * Math.sin(u * 19 + t * 3.1 + phase));
      // the band twists a little as it moves
      const tw = env * 0.35 * Math.sin(u * 5 - t * 1.3 + phase);
      const hy = (width / 2) * Math.cos(tw), hz = (width / 2) * Math.sin(tw);
      pos.setXYZ(i * 2, this._p.x, this._p.y + hy, this._p.z + dz + hz);
      pos.setXYZ(i * 2 + 1, this._p.x, this._p.y - hy, this._p.z + dz - hz);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

function tapeTexture() {
  // one phrase, measured, so the texture tiles seamlessly along the tape
  const phrase = 'POLICE LINE  ·  DO NOT CROSS  ·  ';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = 'bold 34px Arial, sans-serif';
  const w = Math.ceil(probe.measureText(phrase).width);
  const c = document.createElement('canvas'); c.width = w; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f2c230'; x.fillRect(0, 0, w, 64);
  x.fillStyle = '#111'; x.fillRect(0, 0, w, 5); x.fillRect(0, 59, w, 5);
  x.font = 'bold 34px Arial, sans-serif'; x.textBaseline = 'middle';
  x.fillText(phrase, 0, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  t.userData.aspect = w / 64;
  return t;
}

function labelTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, 128, 20);
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(15, 40, 98, 35);
  x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(23, 50, 60, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
