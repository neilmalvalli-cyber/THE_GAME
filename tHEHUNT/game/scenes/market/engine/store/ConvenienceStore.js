import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { concreteTextures, makeRng, fbm } from '../core/proceduralTextures.js';
import { STORE } from './storeLayout.js';

/**
 * ConvenienceStore — a late-night corner store, built procedurally.
 *
 * Lighting rig (kept small for 60 fps):
 *   key      : shadow-casting spot over the counter (crisp item shadows)
 *   hemi     : cool ceiling bounce / floor bounce
 *   fills    : three shadowless points (aisles, fridges, entrance)
 *   fridge   : cold glow from the drinks coolers
 *   spill    : store light falling out onto the wet street
 * plus emissive fluorescent tubes whose brightness follows `lampLevel`.
 */
export class ConvenienceStore {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'ConvenienceStore';
    this.lampLevel = 1;
    this.tubes = [];      // { mat, base, flicker }
    this.lights = [];     // { light, base }
    this.doorOpen = 0;
    this._build();
  }

  _build() {
    const R = STORE.room, g = this.group;
    const W = R.x1 - R.x0, D = R.z1 - R.z0, H = R.h;
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;

    // ── surfaces
    const floorMat = new THREE.MeshStandardMaterial({ ...vinylTiles(), roughness: 1, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true;
    const fuv = floor.geometry.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * W / 1.2, fuv.getY(i) * D / 1.2);
    g.add(floor);

    const wallTex = paintedWall();
    const wallMat = new THREE.MeshStandardMaterial({ ...wallTex, roughness: 1 });
    const ceilMat = new THREE.MeshStandardMaterial({ ...ceilingTiles(), roughness: 1 });
    const plane = (w, h, mat, pos, rotY = 0, rotX = 0, uvScale) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(...pos); m.rotation.set(rotX, rotY, 0); m.receiveShadow = true;
      if (uvScale) {
        const uv = m.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / uvScale, uv.getY(i));
      }
      g.add(m); return m;
    };
    const ceil = plane(W, D, ceilMat, [cx, H, cz], 0, Math.PI / 2);
    const cuv = ceil.geometry.attributes.uv;
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * W / 1.2, cuv.getY(i) * D / 1.2);
    plane(W, H, wallMat, [cx, H / 2, R.z0], 0, 0, 2.5);
    plane(D, H, wallMat, [R.x0, H / 2, cz], Math.PI / 2, 0, 2.5);
    plane(D, H, wallMat, [R.x1, H / 2, cz], -Math.PI / 2, 0, 2.5);

    this._buildFront();
    this._buildFixtures();
    this._buildGondolas();
    this._buildFridges();
    this._buildBackWall();
    this._buildDetails();
    this._buildLights();
    this._buildOutside();
  }

  // ── storefront: window wall, automatic sliding doors, neon sign
  _buildFront() {
    const R = STORE.room, Dr = STORE.door, g = this.group;
    const z = R.z1;
    const alu = new THREE.MeshStandardMaterial({ color: 0xa9adb1, metalness: 1, roughness: 0.35 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xdfe8ea, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.12,
      envMapIntensity: 1.4, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false,
    });
    this.glassMat = glass;
    // knee wall + header beam
    const knee = new THREE.Mesh(new THREE.BoxGeometry(R.x1 - R.x0, 0.45, 0.12), new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.6 }));
    knee.position.set(0, 0.225, z); g.add(knee);
    const header = new THREE.Mesh(new THREE.BoxGeometry(R.x1 - R.x0, R.h - 2.35, 0.14), new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.9 }));
    header.position.set(0, 2.35 + (R.h - 2.35) / 2, z); g.add(header);
    // window panes (left and right of the door)
    for (const side of [-1, 1]) {
      const x0 = side * (Dr.w / 2 + 0.06), x1 = side * (R.x1 - 0.02);
      const w = Math.abs(x1 - x0), xc = (x0 + x1) / 2;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.9), glass);
      pane.position.set(xc, 0.45 + 0.95, z); pane.renderOrder = 5; g.add(pane);
      for (const fx of [x0, x1, xc]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.08), alu);
        m.position.set(fx, 1.4, z); g.add(m);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.08), alu); rail.position.set(xc, 2.35, z); g.add(rail);
    }
    // sliding door leaves
    this.doorLeaves = [];
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group();
      const lw = Dr.w / 2;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.06, Dr.h - 0.06), glass);
      pane.position.set(0, Dr.h / 2, 0); pane.renderOrder = 5; leaf.add(pane);
      for (const [w, h, x, y] of [[lw, 0.06, 0, Dr.h - 0.03], [lw, 0.1, 0, 0.05], [0.05, Dr.h, -lw / 2 + 0.025, Dr.h / 2], [0.05, Dr.h, lw / 2 - 0.025, Dr.h / 2]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), alu); f.position.set(x, y, 0); f.castShadow = true; leaf.add(f);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.03), alu);
      handle.position.set(-side * (lw / 2 - 0.08), 1.05, 0.03); leaf.add(handle);
      leaf.position.set(side * lw / 2, 0, z - 0.02);
      leaf.userData.closedX = side * lw / 2;
      leaf.userData.side = side;
      g.add(leaf);
      this.doorLeaves.push(leaf);
    }
    const doorHead = new THREE.Mesh(new THREE.BoxGeometry(Dr.w + 0.3, 0.14, 0.22), alu);
    doorHead.position.set(0, Dr.h + 0.07, z - 0.05); g.add(doorHead);
    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    sensor.position.set(0, Dr.h + 0.0, z + 0.08); g.add(sensor);
    this.sensorLed = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a1a, emissiveIntensity: 2 }));
    this.sensorLed.position.set(0.05, Dr.h - 0.02, z + 0.11); g.add(this.sensorLed);

    // neon "OPEN 24 HOURS" sign in the left window (reads from the street)
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 160);
    x.font = 'bold 74px "Arial Rounded MT Bold", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#ff3b2f'; x.shadowBlur = 18; x.fillStyle = '#ff6a5a';
    x.fillText('OPEN', 256, 58);
    x.font = 'bold 38px Arial, sans-serif'; x.shadowColor = '#3fd0ff'; x.fillStyle = '#9be8ff';
    x.fillText('24 HOURS', 256, 122);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.neonMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), this.neonMat);
    neon.position.set(-2.1, 1.85, z - 0.08);
    neon.rotation.y = Math.PI; // faces the street
    neon.scale.x = -1;         // …and reads correctly from there
    g.add(neon);
  }

  setDoorOpen(v) {
    this.doorOpen = v;
    const Dr = STORE.door;
    for (const leaf of this.doorLeaves) leaf.position.x = leaf.userData.closedX + leaf.userData.side * v * (Dr.w / 2 + 0.02);
  }

  // ── fluorescent troffers
  _buildFixtures() {
    const F = STORE.fixtures, H = STORE.room.h;
    const housing = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.6, metalness: 0.1 });
    const tubeGeo = new THREE.CylinderGeometry(0.014, 0.014, 1.18, 12);
    const diffuserGeo = new THREE.BoxGeometry(1.25, 0.012, 0.3);
    for (const x of F.xs) for (const z of F.zs) {
      const fx = new THREE.Group(); fx.position.set(x, H - 0.03, z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.36), housing);
      fx.add(box);
      // tubes: emissive; each fixture has its own flicker personality
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe8f4ff, emissiveIntensity: 3.2 });
      for (const dz of [-0.075, 0.075]) {
        const tube = new THREE.Mesh(tubeGeo, mat);
        tube.rotation.z = Math.PI / 2; tube.position.set(0, -0.045, dz); fx.add(tube);
      }
      const diff = new THREE.Mesh(diffuserGeo, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf2f8ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.5 }));
      diff.position.y = -0.065; fx.add(diff);
      this.tubes.push({ mat, diff: diff.material, base: 3.2, flicker: 1, id: this.tubes.length });
      this.group.add(fx);
    }
  }

  // ── two double-sided gondola shelves, stocked with packaged goods
  _buildGondolas() {
    const rng = makeRng(77);
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dadb, metalness: 0.6, roughness: 0.45 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xe6e7e8, metalness: 0.4, roughness: 0.5 });
    const label = productLabels();
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.55 });
    const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 14);
    const canMat = new THREE.MeshStandardMaterial({ map: label, metalness: 0.55, roughness: 0.35 });
    const boxes = [], cans = [];
    const palette = [0xd8382f, 0xf2b72f, 0x2f8fd8, 0x3cb371, 0xe86f2c, 0x8e44ad, 0xf4e04d, 0x1abc9c, 0xffffff, 0x2c3e50];
    const unit = (x, z, len) => {
      const u = new THREE.Group(); u.position.set(x, 0, z);
      const H = 1.45, Dd = 0.9;
      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, len), metal); spine.position.y = H / 2; u.add(spine);
      const base = new THREE.Mesh(new THREE.BoxGeometry(Dd, 0.12, len), metal); base.position.y = 0.06; u.add(base);
      for (const y of [0.12, 0.47, 0.82, 1.17]) {
        for (const s of [-1, 1]) {
          const sh = new THREE.Mesh(new THREE.BoxGeometry(Dd / 2 - 0.04, 0.02, len), shelfMat);
          sh.position.set(s * Dd / 4, y + 0.01, 0); sh.receiveShadow = true; u.add(sh);
          // price-strip edge
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.035, len), new THREE.MeshStandardMaterial({ color: 0xf5d547, roughness: 0.6 }));
          strip.position.set(s * (Dd / 2 - 0.02), y + 0.005, 0); u.add(strip);
          // stock
          let pz = -len / 2 + 0.04;
          while (pz < len / 2 - 0.06) {
            const isCan = rng() < 0.25;
            if (isCan) {
              const n = 3 + Math.floor(rng() * 4);
              for (let i = 0; i < n && pz < len / 2 - 0.05; i++) {
                cans.push({ p: [x + s * (Dd / 2 - 0.07), y + 0.08, z + pz + 0.035], c: palette[Math.floor(rng() * palette.length)] });
                pz += 0.072;
              }
            } else {
              const w = 0.08 + rng() * 0.12, h = 0.12 + rng() * 0.18, dpt = 0.12 + rng() * 0.12;
              const c = palette[Math.floor(rng() * palette.length)];
              const facing = 1 + Math.floor(rng() * 3);
              for (let i = 0; i < facing && pz < len / 2 - 0.05; i++) {
                boxes.push({ p: [x + s * (Dd / 2 - 0.03 - dpt / 2), y + 0.02 + h / 2, z + pz + w / 2], s: [dpt, h, w], c, ry: (rng() - 0.5) * 0.06 });
                pz += w + 0.008;
              }
            }
            pz += 0.01 + rng() * 0.03;
          }
        }
      }
      // end cap topper
      const cap = new THREE.Mesh(new RoundedBoxGeometry(Dd, 0.2, 0.04, 2, 0.01), new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.6 }));
      cap.position.set(0, H + 0.1, len / 2); u.add(cap);
      u.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
      this.group.add(u);
    };
    unit(-2.95, 0.75, 2.6);
    unit(-1.75, 0.75, 2.6);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const ib = new THREE.InstancedMesh(boxGeo, boxMat, boxes.length);
    boxes.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, b.ry, 0));
      m4.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(...b.s));
      ib.setMatrixAt(i, m4); ib.setColorAt(i, col.set(b.c));
    });
    ib.receiveShadow = true;
    const ic = new THREE.InstancedMesh(canGeo, canMat, cans.length);
    cans.forEach((c, i) => {
      m4.compose(new THREE.Vector3(...c.p), q.identity(), new THREE.Vector3(1, 1, 1));
      ic.setMatrixAt(i, m4); ic.setColorAt(i, col.set(c.c));
    });
    this.group.add(ib, ic);
  }

  // ── drinks coolers along the right wall
  _buildFridges() {
    const R = STORE.room;
    const x = R.x1 - 0.42;
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: 0.7, roughness: 0.4 });
    const label = productLabels();
    const bottleGeo = new THREE.CylinderGeometry(0.03, 0.033, 0.24, 12);
    const bottleMat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.25, metalness: 0.1 });
    const rng = makeRng(12);
    const palette = [0xd8382f, 0x2f8fd8, 0x3cb371, 0xf2b72f, 0xffffff, 0x8e44ad, 0xe86f2c];
    const bottles = [];
    const doors = 4, dw = 0.78, z0 = -0.75;
    for (let i = 0; i < doors; i++) {
      const zc = z0 + i * dw + dw / 2;
      // interior glow panel (cold LED backlight)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.04, 1.9), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xdff2ff, emissiveIntensity: 1.1 }));
      back.position.set(R.x1 - 0.02, 1.05, zc); back.rotation.y = -Math.PI / 2; this.group.add(back);
      this.tubes.push({ mat: back.material, base: 1.1, flicker: 1, id: this.tubes.length, fridge: true });
      for (let s = 0; s < 5; s++) {
        const y = 0.2 + s * 0.38;
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, dw - 0.06), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.7 }));
        shelf.position.set(R.x1 - 0.3, y, zc); this.group.add(shelf);
        const c = palette[Math.floor(rng() * palette.length)];
        for (let k = 0; k < 9; k++) {
          for (let r = 0; r < 2; r++) bottles.push({ p: [R.x1 - 0.18 - r * 0.09, y + 0.126, zc - dw / 2 + 0.06 + k * 0.08], c: rng() < 0.8 ? c : palette[Math.floor(rng() * palette.length)] });
        }
      }
      // door: glass + frame + handle
      const dg = new THREE.Group(); dg.position.set(x, 1.05, zc);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.06, 1.95), this.glassMat.clone());
      pane.material.opacity = 0.18; pane.rotation.y = -Math.PI / 2; pane.renderOrder = 5; dg.add(pane);
      for (const [h, w, y, zz] of [[0.05, dw, 1.0, 0], [0.05, dw, -1.0, 0], [2.05, 0.05, 0, -dw / 2 + 0.025], [2.05, 0.05, 0, dw / 2 - 0.025]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, w), frame); f.position.set(0, y, zz); dg.add(f);
      }
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0xbfc3c7, metalness: 1, roughness: 0.25 }));
      handle.position.set(-0.05, 0.0, dw / 2 - 0.1); dg.add(handle);
      this.group.add(dg);
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, doors * dw + 0.1), frame);
    cab.position.set(R.x1 - 0.42, 2.25, z0 + doors * dw / 2); this.group.add(cab);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(doors * dw, 0.22), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7fd8ff, emissiveIntensity: 1.2, map: coldDrinksSign() }));
    sign.position.set(R.x1 - 0.86, 2.25, z0 + doors * dw / 2); sign.rotation.y = -Math.PI / 2; this.group.add(sign);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const ib = new THREE.InstancedMesh(bottleGeo, bottleMat, bottles.length);
    bottles.forEach((b, i) => { m4.makeTranslation(...b.p); ib.setMatrixAt(i, m4); ib.setColorAt(i, col.set(b.c)); });
    this.group.add(ib);
  }

  // ── staff wall behind the counter
  _buildBackWall() {
    const R = STORE.room;
    const rng = makeRng(31);
    const label = productLabels();
    const mat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.5 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const items = [];
    const palette = [0xd8382f, 0xf2b72f, 0x2f8fd8, 0x3cb371, 0xffffff, 0x2c3e50, 0xe86f2c];
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 0.32), new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.3 }));
    cab.position.set(0, 1.55, R.z0 + 0.16); this.group.add(cab);
    for (let row = 0; row < 5; row++) {
      let x = -1.5;
      const y = 0.85 + row * 0.3;
      while (x < 1.45) {
        const w = 0.05 + rng() * 0.06, h = 0.1 + rng() * 0.12;
        items.push({ p: [x + w / 2, y + h / 2, R.z0 + 0.3], s: [w, h, 0.08], c: palette[Math.floor(rng() * palette.length)] });
        x += w + 0.005;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const ib = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((b, i) => { m4.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(...b.s)); ib.setMatrixAt(i, m4); ib.setColorAt(i, col.set(b.c)); });
    this.group.add(ib);
    // shelf lip lights (thin emissive strips)
    for (let row = 0; row < 5; row++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.01, 0.01), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.5 }));
      strip.position.set(0, 0.84 + row * 0.3, R.z0 + 0.36); this.group.add(strip);
      this.tubes.push({ mat: strip.material, base: 1.5, flicker: 1, id: this.tubes.length, fridge: true });
    }
  }

  _buildDetails() {
    const R = STORE.room;
    // security dome mirror in the corner
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 }));
    dome.rotation.x = Math.PI; dome.position.set(R.x0 + 0.5, R.h - 0.01, R.z0 + 0.5); this.group.add(dome);
    // wall clock behind the counter
    const clock = new THREE.Group(); clock.position.set(1.95, 2.4, R.z0 + 0.02);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 40), new THREE.MeshStandardMaterial({ map: clockFace(), roughness: 0.4 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 8, 40), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }));
    clock.add(face, rim);
    const hand = (len, w, a) => { const h = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.004), new THREE.MeshStandardMaterial({ color: 0x111111 })); h.geometry.translate(0, len / 2, 0); h.rotation.z = -a; h.position.z = 0.006; clock.add(h); return h; };
    hand(0.09, 0.012, (3 / 12) * Math.PI * 2 + 0.2);   // 3:07 a.m.
    hand(0.13, 0.008, (7 / 60) * Math.PI * 2);
    this.group.add(clock);
    // rubber entry mat
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), new THREE.MeshStandardMaterial({ color: 0x1b1d1e, roughness: 1 }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(0, 0.003, R.z1 - 0.6); mat.receiveShadow = true; this.group.add(mat);
  }

  _buildLights() {
    const S = STORE;
    const add = (light, base) => { this.lights.push({ light, base }); this.group.add(light); return light; };
    this.hemi = add(new THREE.HemisphereLight(0xeaf2ff, 0x5a5a55, 0.9), 0.9);
    const key = new THREE.SpotLight(0xf2f8ff, 30, 6, 0.8, 0.9, 2);
    key.position.set(S.counter.x, S.room.h - 0.08, S.counter.z + 0.25);
    key.target.position.set(S.counter.x, S.counter.top, S.counter.z);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.8; key.shadow.camera.far = 3.2;
    key.shadow.bias = -0.00005; key.shadow.normalBias = 0.004; key.shadow.radius = 3; key.shadow.blurSamples = 16;
    this.group.add(key.target);
    add(key, 30);
    for (const [p, i, c] of [[[-2.3, 2.6, 0.9], 9, 0xeef6ff], [[2.6, 2.4, 0.8], 7, 0xd8f0ff], [[0, 2.6, 2.2], 9, 0xeef6ff]]) {
      const pl = new THREE.PointLight(c, i, 7, 2); pl.position.set(...p); add(pl, i);
    }
    this.spill = add(new THREE.SpotLight(0xe8f4ff, 25, 12, 0.7, 0.9, 1.6), 25);
    this.spill.position.set(0, 2.6, S.room.z1 - 0.5);
    this.spill.target.position.set(0, 0, S.room.z1 + 5);
    this.group.add(this.spill.target);
  }

  _buildOutside() {
    const R = STORE.room;
    const tex = concreteTextures({ seed: 23, repeat: [6, 6], wet: 1 });
    const street = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), new THREE.MeshStandardMaterial({ color: 0x2a2b2d, ...tex, roughness: 0.55, metalness: 0.1 }));
    street.rotation.x = -Math.PI / 2; street.position.set(0, -0.01, R.z1 + 8); street.receiveShadow = true;
    this.group.add(street);
    // painted parking line
    for (const x of [-2.6, 2.6]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 4), new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 0.8 }));
      line.rotation.x = -Math.PI / 2; line.position.set(x, 0, R.z1 + 3.5); this.group.add(line);
    }
    // facade around the shopfront (so the store is a lit box in the night)
    const facade = new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.9 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.2), facade); top.position.set(0, R.h + 0.6, R.z1 + 0.08); this.group.add(top);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1, R.h + 1.2), facade); w.position.set(s * (R.x1 + 0.5), (R.h + 1.2) / 2, R.z1 + 0.08); this.group.add(w); }
  }

  /** 0..1 master brightness (inspection dims it slightly; exit kills it). */
  setLampLevel(v) {
    this.lampLevel = v;
    for (const t of this.tubes) {
      const k = v * t.flicker;
      t.mat.emissiveIntensity = t.base * k;
      if (t.diff) t.diff.emissiveIntensity = 0.8 * k;
    }
    for (const { light, base } of this.lights) light.intensity = base * v;
  }

  update(dt, t) {
    if (this._crime) return; // THE GAME: the crime scene drives the tubes itself
    // the one fixture near the door hums slightly unstable (barely)
    const near = this.tubes[this.tubes.length > 8 ? 8 : 0];
    if (near && !this._exiting) near.flicker = 0.97 + Math.sin(t * 31) * 0.015 + (Math.random() < 0.0008 ? -0.35 : 0);
    if (!this._exiting) this.setLampLevel(this.lampLevel);
  }
}

// ───────────────────────────────────────────── procedural textures

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (repeat) t.repeat.set(...repeat);
  return t;
}

/** Off-white / grey vinyl checker tiles with scuffs; 1 UV unit = 4 tiles. */
function vinylTiles() {
  const S = 512, n = 4, c = canvas(S, S), x = c.getContext('2d');
  const r = canvas(S, S), rx = r.getContext('2d');
  const noise = fbm(128, 128, { seed: 4, scale: 4, octaves: 4 });
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const light = (i + j) % 2 === 0;
    x.fillStyle = light ? '#d9d7cf' : '#8c8e8b';
    x.fillRect(i * S / n, j * S / n, S / n, S / n);
  }
  // grout
  x.strokeStyle = 'rgba(60,60,55,0.5)'; x.lineWidth = 2;
  for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * S / n, 0); x.lineTo(i * S / n, S); x.stroke(); x.beginPath(); x.moveTo(0, i * S / n); x.lineTo(S, i * S / n); x.stroke(); }
  // scuffs & dirt
  const rng = makeRng(9);
  for (let k = 0; k < 140; k++) {
    x.strokeStyle = `rgba(30,30,30,${0.04 + rng() * 0.08})`; x.lineWidth = 1 + rng() * 3;
    const px = rng() * S, py = rng() * S, a = rng() * Math.PI;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 30 * rng(), py + Math.sin(a) * 30 * rng()); x.stroke();
  }
  // roughness: polished vinyl (low) with dull scuffed patches
  const img = rx.createImageData(S, S);
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const v = noise[((yy >> 2) % 128) * 128 + ((xx >> 2) % 128)];
    const rough = 70 + v * 90;
    const i = (yy * S + xx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = rough; img.data[i + 3] = 255;
  }
  rx.putImageData(img, 0, 0);
  return { map: tex(c), roughnessMap: tex(r, { srgb: false }) };
}

function paintedWall() {
  const c = canvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#e7e5de'; x.fillRect(0, 0, 512, 512);
  // teal brand stripe + darker kick band (canvas v=0 is the top → stripe at ~1.1 m)
  x.fillStyle = '#2f6f6a'; x.fillRect(0, 512 - 512 * (1.15 / 2.9), 512, 512 * (0.08 / 2.9));
  x.fillStyle = '#b9b6ad'; x.fillRect(0, 512 - 512 * (0.12 / 2.9), 512, 512 * (0.12 / 2.9));
  const rng = makeRng(3);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(0,0,0,${rng() * 0.03})`; x.fillRect(rng() * 512, rng() * 512, 2 + rng() * 10, 2 + rng() * 10); }
  return { map: tex(c) };
}

function ceilingTiles() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#e9e8e3'; x.fillRect(0, 0, 256, 256);
  const rng = makeRng(5);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(90,90,85,${rng() * 0.25})`; x.fillRect(rng() * 256, rng() * 256, 1.5, 1.5); }
  x.strokeStyle = '#b8b8b2'; x.lineWidth = 3;
  for (const p of [0, 128, 256]) { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 256); x.stroke(); x.beginPath(); x.moveTo(0, p); x.lineTo(256, p); x.stroke(); }
  return { map: tex(c) };
}

/** Generic packaging print (no text, no brands): bands, blocks, a white panel. Tinted per instance. */
function productLabels() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, 256, 40);
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(30, 80, 196, 70);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(46, 100, 120, 12); x.fillRect(46, 122, 80, 8);
  x.fillStyle = 'rgba(0,0,0,0.18)'; x.beginPath(); x.arc(190, 200, 34, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(0, 228, 256, 10);
  return tex(c);
}

function coldDrinksSign() {
  const c = canvas(1024, 64), x = c.getContext('2d');
  x.fillStyle = '#04121a'; x.fillRect(0, 0, 1024, 64);
  x.fillStyle = '#ffffff'; x.font = 'bold 40px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('COLD DRINKS', 512, 34);
  return tex(c);
}

function clockFace() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#f4f2ea'; x.beginPath(); x.arc(128, 128, 126, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#222';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.fillRect(128 + Math.sin(a) * 104 - 3, 128 - Math.cos(a) * 104 - 10, 6, 20); }
  return tex(c);
}
