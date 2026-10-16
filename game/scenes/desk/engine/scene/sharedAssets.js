import * as THREE from 'three';
import {
  makePaperBump, makeBackInner, makeBackOuter, makeDocument, makePolaroidBack, makeBlobShadow,
  makeCoverOuter, makeCoverInner, makeTabLabel, makePolaroid,
} from './textures.js';

/** A gem paper clip as a tube, long axis along x. */
export function makeClipGeometry() {
  const L = 0.3, r1 = 0.044, r2 = 0.033, r3 = 0.021, seg = 14;
  const pts = [];
  const arc = (cx, cy, r, a0, a1) => {
    for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * (i / seg); pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
  };
  const left = -L / 2 + r1, right = L / 2 - r2;
  pts.push(new THREE.Vector2(L * 0.18, -r1));
  arc(left, 0, r1, -Math.PI / 2, -Math.PI * 1.5);                  // outer left loop
  arc(right, r1 - r2, r2, Math.PI / 2, -Math.PI / 2);              // right loop
  const y3 = r1 - 2 * r2;
  const left3 = -L / 2 + r1 + 0.035 + r3;
  arc(left3, y3 + r3, r3, -Math.PI / 2, -Math.PI * 1.5);           // inner left loop
  pts.push(new THREE.Vector2(L * 0.24, y3 + 2 * r3));
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0, p.y)), false, 'centripetal', 0.2);
  const geo = new THREE.TubeGeometry(curve, 160, 0.0052, 6, false);
  geo.userData.shared = true;
  return geo;
}

/** Everything shared between folders + per-folder texture sets. */
export function createAssets(renderer, count = 5, cases = null) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const paperBump = makePaperBump();
  const paper = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0, bumpMap: paperBump, bumpScale: 0.9, ...extra });

  const shared = {
    paperBump,
    edgeMat: new THREE.MeshStandardMaterial({ color: 0xb48c55, roughness: 0.92 }),
    backInnerMat: paper(makeBackInner()),
    backOuterMat: paper(makeBackOuter()),
    tabMat: new THREE.MeshStandardMaterial({ color: 0xcca76a, roughness: 0.88, bumpMap: paperBump, bumpScale: 0.9 }),
    docMats: [11, 22, 33].map((s) => paper(makeDocument(s), { roughness: 0.92, bumpScale: 0.5 })),
    sheetMat: new THREE.MeshStandardMaterial({ color: 0xe0d4b8, roughness: 0.92, bumpMap: paperBump, bumpScale: 0.5 }),
    sheetEdgeMat: new THREE.MeshStandardMaterial({ color: 0xd6c8aa, roughness: 0.95 }),
    polaroidBackMat: new THREE.MeshStandardMaterial({ map: makePolaroidBack(), roughness: 0.6 }),
    polaroidEdgeMat: new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.6 }),
    clipGeo: makeClipGeometry(),
    clipMat: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.27, envMapIntensity: 2.2 }),
    blobTex: makeBlobShadow(),
  };

  const perFolder = [];
  for (let id = 1; id <= count; id++) {
    const seed = id * 1009;
    const set = {
      coverOuter: makeCoverOuter(id, seed, cases?.[id - 1]?.title ?? ''),
      coverInner: makeCoverInner(id, seed),
      tabLabel: makeTabLabel(id, seed),
      polaroids: Array.from({ length: Math.max(4, cases?.[id - 1]?.levels?.length ?? 4) }, (_, i) => makePolaroid(i, seed + i * 31, i + id)),
    };
    [set.coverOuter, set.coverInner, ...set.polaroids].forEach((t) => { t.anisotropy = aniso; });
    perFolder.push(set);
  }

  const dispose = () => {
    Object.values(shared).forEach((v) => {
      if (Array.isArray(v)) v.forEach((m) => { m.map?.dispose(); m.dispose?.(); });
      else if (v?.isMaterial) { v.map?.dispose(); v.dispose(); }
      else v?.dispose?.();
    });
    perFolder.forEach((s) => { s.coverOuter.dispose(); s.coverInner.dispose(); s.tabLabel.dispose(); s.polaroids.forEach((t) => t.dispose()); });
  };

  return { shared, perFolder, dispose };
}
