import * as THREE from 'three';
import { FOLDER } from '../config.js';
import { PolaroidEvidence } from './PolaroidEvidence.js';
import { rng } from './textures.js';

const { W, D, T, coverW: WC, gusset, tabW, tabH } = FOLDER;
const TC = T * 0.9;                    // cover thickness
export const HINGE_CLOSED = T + gusset;
export const HINGE_OPEN = T + TC * 0.6;

/**
 * One physical case file.
 *
 *   group (pose: x,y,z / rx,ry,rz, order YXZ, origin = centre of footprint on the table)
 *    ├─ back panel (+ tab + tab label)
 *    ├─ spine (the fold / gusset)
 *    ├─ contents: paper stack, PolaroidEvidence, paper clips
 *    └─ cover   (CPU-deformed: hinge rotation + bend + corner curl)
 *
 * All animation goes through `pose` and `cover`; `update()` applies them.
 */
export class CaseFolder {
  constructor({ id, layout, throwCfg, shared, textures }) {
    this.id = id;
    this.rest = Object.freeze({ x: layout.x, y: 0, z: layout.z, rx: 0, ry: layout.yaw, rz: 0 });
    this.pose = { ...this.rest };
    // Who owns this file's transform right now. Exactly one system writes `pose` per phase:
    //   WAITING · ENTERING · LANDING · SETTLING  → the drop timeline
    //   IDLE · HOVERED                           → the hover controller (only from IDLE)
    //   SELECTING · OPENING · OPEN · CLOSING     → the open / close timelines
    this.phase = 'IDLE';
    this.cover = { theta: 0, flex: 0, ripple: 0, hingeY: HINGE_CLOSED, curl: throwCfg.curl };
    this.curlCorner = throwCfg.curlCorner;
    this._lastCover = '';
    const r = rng(id * 101);

    this.group = new THREE.Group();
    this.group.name = `CaseFolder-${id}`;
    this.group.rotation.order = 'YXZ';

    // ---- materials ----------------------------------------------------------
    const paper = (map, extra = {}) => new THREE.MeshStandardMaterial({
      map, roughness: 0.88, metalness: 0, bumpMap: shared.paperBump, bumpScale: 0.9, ...extra,
    });
    this.materials = {
      coverOuter: paper(textures.coverOuter),
      coverInner: paper(textures.coverInner),
      edge: shared.edgeMat,
    };

    // ---- back panel ---------------------------------------------------------
    const backGeo = new THREE.BoxGeometry(W, T, D, 14, 1, 16);
    backGeo.translate(0, T / 2, 0);
    {
      // very slight waviness + one dog-eared corner on the free side
      const p = backGeo.attributes.position;
      const cz = this.curlCorner * D / 2;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const dist = Math.hypot(W / 2 - x, cz - z);
        const f = Math.max(0, 1 - dist / 0.55);
        p.setY(i, p.getY(i) + 0.0025 * Math.sin(x * 2.1 + z * 1.3 + id) + throwCfg.curl * 0.55 * f * f);
      }
      backGeo.computeVertexNormals();
    }
    this.back = new THREE.Mesh(backGeo, [shared.edgeMat, shared.edgeMat, shared.backInnerMat, shared.backOuterMat, shared.edgeMat, shared.edgeMat]);
    this.back.castShadow = true; this.back.receiveShadow = true;
    this.group.add(this.back);

    // ---- tab (rounded trapezoid on the free edge) ----------------------------
    const tabShape = new THREE.Shape();
    const h2 = tabW / 2, slope = 0.09, rr = 0.035;
    tabShape.moveTo(-0.03, -h2 - slope);
    tabShape.lineTo(tabH - rr, -h2 + rr * 0.4);
    tabShape.quadraticCurveTo(tabH, -h2 + rr * 0.4, tabH, -h2 + rr * 1.4);
    tabShape.lineTo(tabH, h2 - rr * 1.4);
    tabShape.quadraticCurveTo(tabH, h2 - rr * 0.4, tabH - rr, h2 - rr * 0.4);
    tabShape.lineTo(-0.03, h2 + slope);
    tabShape.closePath();
    const tabGeo = new THREE.ExtrudeGeometry(tabShape, { depth: T, bevelEnabled: false, curveSegments: 6 });
    tabGeo.rotateX(Math.PI / 2);     // shape y → world z ; extrusion → -y
    tabGeo.translate(0, T, 0);
    this.tab = new THREE.Mesh(tabGeo, shared.tabMat);
    this.tab.position.set(W / 2, 0, layout.tabZ);
    this.tab.castShadow = true; this.tab.receiveShadow = true;
    this.group.add(this.tab);

    const labelGeo = new THREE.PlaneGeometry(tabH - 0.075, tabW * 0.7);
    labelGeo.rotateX(-Math.PI / 2);
    this.tabLabelMat = new THREE.MeshStandardMaterial({
      map: textures.tabLabel, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.tabLabel = new THREE.Mesh(labelGeo, this.tabLabelMat);
    this.tabLabel.position.set(W / 2 + (tabH - 0.03) / 2 + 0.005, T + 0.0006, layout.tabZ);
    this.tabLabel.receiveShadow = true;
    this.group.add(this.tabLabel);

    // ---- spine / gusset ------------------------------------------------------
    this.spine = new THREE.Mesh(new THREE.BoxGeometry(TC * 1.3, 1, D), shared.backOuterMat);
    this.spine.castShadow = true;
    this.group.add(this.spine);

    // ---- contents -----------------------------------------------------------
    this.contents = new THREE.Group();
    this.contents.name = 'Contents';
    this.group.add(this.contents);
    const sheetT = 0.0025, SHEETS = 6;
    const sheetGeo = new THREE.BoxGeometry(2.1, sheetT, 2.72);
    for (let i = 0; i < SHEETS; i++) {
      const top = i === SHEETS - 1, second = i === SHEETS - 2;
      const face = top ? shared.docMats[(id + 1) % shared.docMats.length]
        : second ? shared.docMats[id % shared.docMats.length] : shared.sheetMat;
      const m = new THREE.Mesh(sheetGeo, [shared.sheetEdgeMat, shared.sheetEdgeMat, face, shared.sheetMat, shared.sheetEdgeMat, shared.sheetEdgeMat]);
      m.position.set((r() - 0.5) * 0.07 + 0.02, T + sheetT * (i + 0.5), (r() - 0.5) * 0.06);
      m.rotation.y = (r() - 0.5) * (second ? 0.09 : 0.035);
      m.receiveShadow = true; m.castShadow = i === SHEETS - 1;
      this.contents.add(m);
    }
    const papersTop = T + sheetT * SHEETS;

    this.polaroids = new PolaroidEvidence({
      fronts: textures.polaroids, backMat: shared.polaroidBackMat, edgeMat: shared.polaroidEdgeMat,
      bumpMap: shared.paperBump, baseY: papersTop, seed: id * 7, shadowTex: shared.blobTex,
    });
    this.contents.add(this.polaroids.group);

    const clipY = papersTop + 0.0056; // resting on the paper (clear of the photos so they can lift)
    const clipSpots = [
      { x: -0.98, z: -0.02, ry: 0.0 + (r() - 0.5) * 0.15 },              // binding the papers on the left edge
      { x: 0.6, z: -1.43, ry: Math.PI / 2 + (r() - 0.5) * 0.12 },         // on the papers' top edge
      { x: 0.86, z: 1.38, ry: Math.PI / 2 + 0.18 + (r() - 0.5) * 0.1 },  // loose near the corner
    ];
    for (const c of clipSpots) {
      const clip = new THREE.Mesh(shared.clipGeo, shared.clipMat);
      clip.position.set(c.x, clipY, c.z);
      clip.rotation.y = c.ry;
      clip.castShadow = true;
      this.contents.add(clip);
    }

    // ---- cover --------------------------------------------------------------
    const coverGeo = new THREE.BoxGeometry(WC, TC, D, 36, 1, 18);
    coverGeo.translate(WC / 2, TC / 2, 0); // x ∈ [0, WC] from the hinge; y ∈ [0, TC]
    this.coverBase = Float32Array.from(coverGeo.attributes.position.array);
    this.coverMesh = new THREE.Mesh(coverGeo, [shared.edgeMat, shared.edgeMat, this.materials.coverOuter, this.materials.coverInner, shared.edgeMat, shared.edgeMat]);
    this.coverMesh.castShadow = true; this.coverMesh.receiveShadow = true;
    this.coverMesh.position.x = -W / 2;
    this.group.add(this.coverMesh);

    // ---- contact shadow (lives in the scene, follows the folder) -------------
    this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: shared.blobTex, transparent: true, depthWrite: false, opacity: 0.6 });
    const blobGeo = new THREE.PlaneGeometry(W * 1.32 + tabH, D * 1.22);
    blobGeo.rotateX(-Math.PI / 2);
    this.blob = new THREE.Mesh(blobGeo, this.blobMat);
    this.blob.renderOrder = -1;

    // picking
    this.pickables = [this.back, this.coverMesh, this.tab, this.tabLabel];
    for (const m of this.pickables) m.userData.folderId = id;

    this.group.traverse((o) => { if (o.isMesh) o.userData.folderId = id; });
    this.update(true);
  }

  // -------------------------------------------------------------------------
  setPose(p) { Object.assign(this.pose, p); }
  resetToRest() {
    Object.assign(this.pose, this.rest);
    Object.assign(this.cover, { theta: 0, flex: 0, ripple: 0, hingeY: HINGE_CLOSED });
    this.polaroids.pack();
    this.update(true);
  }

  isAtRest(eps = 1e-6) {
    const p = this.pose, r = this.rest;
    return ['x', 'y', 'z', 'rx', 'ry', 'rz'].every((k) => Math.abs(p[k] - r[k]) < eps) && Math.abs(this.cover.theta) < eps;
  }

  update(force = false) {
    const p = this.pose;
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.set(p.rx, p.ry, p.rz, 'YXZ');

    // contact shadow: shifts away from the lamp & softens as the file lifts
    const h = Math.max(0, p.y);
    this.blob.position.set(p.x + h * 0.32 + 0.06, 0.0025, p.z + h * 0.2 + 0.04);
    this.blob.rotation.y = p.ry;
    const s = 1 + h * 0.42;
    this.blob.scale.set(s, 1, s);
    this.blobMat.opacity = 0.78 * Math.exp(-h * 1.4);
    this.blob.visible = this.group.visible && this.blobMat.opacity > 0.01;

    const c = this.cover;
    const key = `${c.theta.toFixed(5)}|${c.flex.toFixed(4)}|${c.ripple.toFixed(4)}|${c.hingeY.toFixed(5)}`;
    if (force || key !== this._lastCover) {
      this._lastCover = key;
      this._deformCover();
    }
  }

  /** Bend the cover around the fold. Constant-curvature arc from the hinge. */
  _deformCover() {
    const { theta, flex, ripple, hingeY, curl } = this.cover;
    // paper lags behind the hinge while swinging (flex), plus a settling ripple
    const B = flex * 0.6 * Math.sin(Math.min(Math.PI, Math.max(0, theta)));
    const k = (-B + ripple) / WC;
    const pos = this.coverMesh.geometry.attributes.position;
    const a = pos.array, base = this.coverBase;
    const cz = this.curlCorner * D / 2;
    const s0 = Math.sin(theta), c0 = Math.cos(theta);
    for (let i = 0; i < a.length; i += 3) {
      const s = base[i], t = base[i + 1], z = base[i + 2];
      const th = theta + k * s;
      let px, py;
      if (Math.abs(k) < 1e-5) { px = s * c0; py = s * s0; } else { px = (Math.sin(th) - s0) / k; py = (c0 - Math.cos(th)) / k; }
      const dist = Math.hypot(WC - s, cz - z);
      const f = Math.max(0, 1 - dist / 0.7);
      const off = t + curl * f * f;
      a[i] = px - Math.sin(th) * off;
      a[i + 1] = py + Math.cos(th) * off;
      a[i + 2] = z;
    }
    pos.needsUpdate = true;
    this.coverMesh.geometry.computeVertexNormals();
    this.coverMesh.geometry.computeBoundingSphere();
    this.coverMesh.position.y = hingeY;
    // spine spans from the table to the fold
    const sh = hingeY + TC;
    this.spine.scale.y = sh;
    this.spine.position.set(-W / 2 - TC * 0.6, sh / 2, 0);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    this.blob.geometry.dispose();
    this.blobMat.dispose();
    this.materials.coverOuter.dispose(); this.materials.coverInner.dispose();
    this.tabLabelMat.dispose();
    this.polaroids.items.forEach((it) => { it.front.map?.dispose(); it.front.dispose(); });
  }
}
