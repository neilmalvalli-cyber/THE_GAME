import * as THREE from 'three';

/**
 * DealerGloves — procedural, SKINNED gloved hands and coat sleeves.
 *
 * Every finger, the palm, the thumb, the glove cuff and the sleeve are single
 * continuous surfaces bound to the skeleton with blended weights, so joints
 * bend smoothly like leather over knuckles instead of rigid segments meeting.
 * Geometry details that sell "real glove": knuckle bulges, leather creases on
 * the back of each joint, flattened finger pads, the three stitched "points"
 * on the back of the hand, thenar/hypothenar padding, a cuff tucked inside a
 * folded coat sleeve.
 *
 * Everything is authored in the blockout rig's bind pose (dealer space).
 */

const g = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Build one tube from ring samples.
 * sample = { c: Vector3, S, U, T: Vector3 frame (S×U = T), rx, ryTop, ryBot,
 *            exp?: superellipse exponent, bump?: (theta, nx, ny) => radial multiplier,
 *            v: number, skin: [[boneIndex, weight], ...] }
 */
function buildTube(samples, M, { capEnd = false, capStart = false } = {}) {
  const pos = [], uv = [], si = [], sw = [], idx = [];
  const ringSize = M + 1;
  const pushSkin = (skin) => {
    const s = [...skin].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = s.reduce((a, [, w]) => a + w, 0) || 1;
    for (let k = 0; k < 4; k++) { si.push(s[k] ? s[k][0] : 0); sw.push(s[k] ? s[k][1] / sum : 0); }
  };
  const p = new THREE.Vector3();
  for (const sm of samples) {
    const e = sm.exp || 2;
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const nx = Math.sign(c) * Math.abs(c) ** (2 / e);
      const ny = Math.sign(sn) * Math.abs(sn) ** (2 / e);
      const k = sm.bump ? sm.bump(th, nx, ny) : 1;
      const ry = sn >= 0 ? sm.ryTop : sm.ryBot;
      p.copy(sm.c).addScaledVector(sm.S, nx * sm.rx * k).addScaledVector(sm.U, ny * ry * k);
      pos.push(p.x, p.y, p.z);
      uv.push(j / M, sm.v);
      pushSkin(sm.skin);
    }
  }
  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * ringSize + j, b = a + 1, c2 = a + ringSize, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const fan = (ringIdx, sm, reverse) => {
    const center = pos.length / 3;
    pos.push(sm.c.x, sm.c.y, sm.c.z); uv.push(0.5, sm.v); pushSkin(sm.skin);
    for (let j = 0; j < M; j++) {
      const a = ringIdx * ringSize + j, b = a + 1;
      if (reverse) idx.push(center, b, a); else idx.push(center, a, b);
    }
  };
  if (capEnd) fan(samples.length - 1, samples[samples.length - 1], false);
  if (capStart) fan(0, samples[0], true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure normals face outward (winding depends on frame handedness)
  const n0 = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, Math.floor(ringSize / 4) + ringSize);
  const p0 = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, Math.floor(ringSize / 4) + ringSize);
  if (n0.dot(p0.sub(samples[1].c)) < 0) {
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

function mergeGeometries(geos) {
  const out = { pos: [], nrm: [], uv: [], si: [], sw: [], idx: [] };
  let offset = 0;
  for (const geo of geos) {
    const a = geo.attributes;
    out.pos.push(...a.position.array); out.nrm.push(...a.normal.array); out.uv.push(...a.uv.array);
    out.si.push(...a.skinIndex.array); out.sw.push(...a.skinWeight.array);
    for (const i of geo.index.array) out.idx.push(i + offset);
    offset += a.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  // keep each part's (blended) normals — recomputing would bring the seams back
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.sw, 4));
  geo.setIndex(out.idx);
  return geo;
}

/**
 * Seamless joins between separate tubes (finger → back of hand).
 * Where a finger emerges from the palm, its vertex normals are blended toward
 * the palm surface's normals (nearest point), so lighting flows across the
 * knuckle instead of showing the hard crease where two meshes intersect.
 * weight(i) ∈ [0,1]: 1 = fully take the palm's shading.
 */
function blendNormalsInto(target, source, weight) {
  const tp = target.attributes.position, tn = target.attributes.normal;
  const sp = source.attributes.position.array, sn = source.attributes.normal.array;
  const n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    const w = weight(i);
    if (w <= 0.001) continue;
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
    let best = Infinity, bj = 0;
    for (let j = 0; j < sp.length; j += 3) {
      const dx = sp[j] - x, dy = sp[j + 1] - y, dz = sp[j + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bj = j; }
    }
    n.fromBufferAttribute(tn, i);
    m.set(sn[bj], sn[bj + 1], sn[bj + 2]);
    n.lerp(m, w).normalize();
    tn.setXYZ(i, n.x, n.y, n.z);
  }
  tn.needsUpdate = true;
}

/**
 * Weight helper: given an arc coordinate and a list of joints
 * [{ at, a, b, w0, w1 }], returns [[a, 1-t], [b, t]] for the active joint.
 */
function chainWeights(x, joints) {
  for (let i = joints.length - 1; i >= 0; i--) {
    const J = joints[i];
    if (x >= J.at + J.w0) {
      const t = smooth(J.at + J.w0, J.at + J.w1, x);
      return [[J.a, 1 - t], [J.b, t]];
    }
  }
  return [[joints[0].a, 1]];
}

/**
 * @param o.side 'R' | 'L'
 * @param o.bones  dealer.bones
 * @param o.abs    bind positions (dealer space) by bone name
 * @param o.handQ  hand frame (dealer space)
 * @param o.spec   finger spec { index: { x, len[3], r }, ... }
 * @param o.thumb  { base: Vector3 (hand local), dir: Vector3 (hand local), len[3] }
 */
export function buildSkinnedArm(o) {
  const { side, bones, abs, handQ, spec, thumb, gloveMat, sleeveMat, parent } = o;
  const s = side === 'R' ? -1 : 1;
  const inner = -s; // hand-local x sign of the thumb side
  const F = ['index', 'middle', 'ring', 'pinky'];

  // skeleton for this arm
  const names = ['spine2', `${side}shoulder`, `${side}arm`, `${side}forearm`, `${side}hand`];
  for (const f of ['thumb', ...F]) for (let k = 1; k <= 3; k++) names.push(`${side}${f}${k}`);
  const list = names.map((n) => bones[n]);
  const I = Object.fromEntries(names.map((n, i) => [n, i]));
  parent.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);

  const H = abs[`${side}hand`];
  const toDealer = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(handQ).add(H);
  const hS = new THREE.Vector3(1, 0, 0).applyQuaternion(handQ);
  const hU = new THREE.Vector3(0, 1, 0).applyQuaternion(handQ);
  const hT = new THREE.Vector3(0, 0, 1).applyQuaternion(handQ);
  const dorsal = (ny) => Math.max(0, ny) ** 2;
  const palmar = (ny) => Math.max(0, -ny) ** 2;

  const gloveGeos = [];
  const fingerGeos = [];

  // ── fingers
  const baseZ = 0.097;
  F.forEach((f) => {
    const d = spec[f];
    const fx = -s * d.x;
    const z0 = baseZ, z1 = z0 + d.len[0], z2 = z1 + d.len[1], zt = z2 + d.len[2];
    const r0 = d.r * 1.14;
    const rEnd = r0 * 0.83;
    const k1 = I[`${side}${f}1`], k2 = I[`${side}${f}2`], k3 = I[`${side}${f}3`], hb = I[`${side}hand`];
    const joints = [
      { at: z0, a: hb, b: k1, w0: -0.013, w1: 0.003 },
      { at: z1, a: k1, b: k2, w0: -0.0045, w1: 0.0045 },
      { at: z2, a: k2, b: k3, w0: -0.004, w1: 0.004 },
    ];
    const samples = [];
    const rc = rEnd * 0.95;
    const zc = zt - rc * 0.55;
    const ring = (z, scale = 1) => {
      const t = Math.min(1, Math.max(0, (z - z0) / (zt - z0)));
      const r = lerp(r0, rEnd, t) * scale;
      // flare where the finger grows out of the hand (webbing / knuckle pad)
      const flare = 1 + 0.16 * smooth(z0 + 0.002, z0 - 0.016, z);
      samples.push({
        c: toDealer(fx * (1 - 0.05 * t), -0.002 + (scale < 1 ? -(1 - scale) * 0.002 : 0) - 0.0012 * (flare - 1) / 0.16, z),
        S: hS, U: hU, T: hT, rx: r * 1.05 * flare, ryTop: r * 0.93 * (1 + (flare - 1) * 0.6), ryBot: r * 0.8 * flare, v: z * 6,
        skin: chainWeights(z, joints),
        bump: (th, nx, ny) => {
          let k = 1;
          for (const zj of [z0, z1, z2]) {
            k += dorsal(ny) * 0.08 * g(z - zj, 0.0045);                                 // knuckle
            k += dorsal(ny) * 0.035 * Math.sin((z - zj) * 2600) * g(z - zj, 0.0042);     // leather creases
          }
          k += palmar(ny) * 0.05 * g(z - (z0 + z1) / 2, 0.006);                          // finger pads
          k += palmar(ny) * 0.05 * g(z - (z1 + z2) / 2, 0.005);
          return k;
        },
      });
    };
    for (let z = 0.064; z < zc; z += 0.0022) ring(z);
    for (let a = 0; a <= 7; a++) {
      const phi = (a / 7) * Math.PI / 2;
      ring(zc + Math.sin(phi) * rc, Math.max(0.03, Math.cos(phi)));
    }
    fingerGeos.push({ geo: buildTube(samples, 18, { capEnd: true }), z0 });
  });

  // ── palm / back of hand
  {
    const samples = [];
    const hb = I[`${side}hand`], fb = I[`${side}forearm`];
    for (let z = -0.012; z <= 0.1085; z += 0.0035) {
      let w = lerp(0.056, 0.087, smooth(-0.005, 0.07, z));
      w *= 1 - 0.1 * smooth(0.096, 0.1085, z);
      const ryTop = lerp(0.0155, 0.0118, smooth(0.02, 0.1, z)) * (1 - 0.12 * smooth(0.1, 0.1085, z));
      const ryBot = lerp(0.0175, 0.0135, smooth(0.03, 0.1, z)) * (1 - 0.2 * smooth(0.1, 0.1085, z));
      const wf = 1 - smooth(-0.02, 0.012, z);
      samples.push({
        c: toDealer(0, -0.0025, z), S: hS, U: hU, T: hT, rx: w / 2, ryTop, ryBot, exp: 2.8, v: z * 6,
        skin: [[hb, 1 - wf * 0.5], [fb, wf * 0.5]],
        bump: (th, nx, ny) => {
          const x = nx * (w / 2);
          let k = 1;
          // knuckle row
          if (z > 0.07) for (const f of F) k += dorsal(ny) * 0.22 * g(x - -s * spec[f].x, 0.0075) * g(z - 0.097, 0.0065);
          // the three stitched "points" on the back of the glove
          const win = smooth(0.018, 0.03, z) * (1 - smooth(0.07, 0.085, z));
          for (const sx of [-0.0125, 0, 0.0125]) k += dorsal(ny) * 0.06 * g(x - sx, 0.0011) * win;
          // tendons fanning toward the knuckles (very subtle)
          for (const f of F) k += dorsal(ny) * 0.025 * g(x - -s * spec[f].x * smooth(0.0, 0.09, z), 0.004) * smooth(0.03, 0.08, z);
          // thenar (thumb-side) and hypothenar padding on the palm
          k += palmar(ny) * 0.38 * g(z - 0.032, 0.02) * g(x - inner * 0.022, 0.016);
          k += palmar(ny) * 0.18 * g(z - 0.04, 0.025) * g(x + inner * 0.03, 0.012);
          // palm hollow
          k -= palmar(ny) * 0.12 * g(z - 0.06, 0.018) * g(x, 0.014);
          return k;
        },
      });
    }
    var palmGeo = buildTube(samples, 32, { capEnd: true });
    gloveGeos.push(palmGeo);
  }
  // knuckles: fingers take the palm's shading where they emerge
  for (const { geo, z0 } of fingerGeos) {
    const uvA = geo.attributes.uv;
    blendNormalsInto(geo, palmGeo, (i) => 1 - smooth(z0 - 0.017, z0 + 0.006, uvA.getY(i) / 6));
    gloveGeos.push(geo);
  }

  // ── thumb
  {
    const T = thumb.dir.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const U = up.clone().sub(T.clone().multiplyScalar(T.dot(up))).normalize();
    const S = U.clone().cross(T);
    // to dealer space
    const Td = T.clone().applyQuaternion(handQ), Ud = U.clone().applyQuaternion(handQ), Sd = S.clone().applyQuaternion(handQ);
    const j1 = thumb.len[0], j2 = j1 + thumb.len[1], jt = j2 + thumb.len[2];
    const hb = I[`${side}hand`], t1 = I[`${side}thumb1`], t2 = I[`${side}thumb2`], t3 = I[`${side}thumb3`];
    const joints = [
      { at: 0, a: hb, b: t1, w0: -0.022, w1: 0.008 },
      { at: j1, a: t1, b: t2, w0: -0.005, w1: 0.005 },
      { at: j2, a: t2, b: t3, w0: -0.0045, w1: 0.0045 },
    ];
    const samples = [];
    const r0 = 0.0152, rEnd = 0.0118, rc = rEnd * 0.95, zc = jt - rc * 0.5;
    const ring = (u, scale = 1) => {
      const t = Math.min(1, Math.max(0, u / jt));
      const r = (u < 0 ? lerp(0.017, r0, smooth(-0.03, 0, u)) : lerp(r0, rEnd, t)) * scale;
      const lp = thumb.base.clone().addScaledVector(T, u);
      samples.push({
        c: toDealer(lp.x, lp.y, lp.z), S: Sd, U: Ud, T: Td, rx: r * 1.06, ryTop: r * 0.9, ryBot: r * 0.85, v: u * 6,
        skin: chainWeights(u, joints),
        bump: (th, nx, ny) => {
          let k = 1;
          for (const zj of [j1, j2]) {
            k += dorsal(ny) * 0.07 * g(u - zj, 0.005);
            k += dorsal(ny) * 0.03 * Math.sin((u - zj) * 2400) * g(u - zj, 0.0045);
          }
          return k;
        },
      });
    };
    for (let u = -0.03; u < zc; u += 0.0025) ring(u);
    for (let a = 0; a <= 7; a++) { const phi = (a / 7) * Math.PI / 2; ring(zc + Math.sin(phi) * rc, Math.max(0.03, Math.cos(phi))); }
    const thumbGeo = buildTube(samples, 18, { capEnd: true });
    const uvT = thumbGeo.attributes.uv;
    blendNormalsInto(thumbGeo, palmGeo, (i) => 1 - smooth(-0.03, 0.014, uvT.getY(i) / 6));
    gloveGeos.push(thumbGeo);
  }

  // ── glove cuff (runs back up the wrist, tucked into the sleeve)
  {
    const samples = [];
    const hb = I[`${side}hand`], fb = I[`${side}forearm`];
    for (let z = -0.08; z <= 0.004; z += 0.004) {
      const flare = 1 + 0.12 * smooth(-0.04, -0.08, z);
      const wf = 1 - smooth(-0.035, 0.0, z);
      samples.push({
        c: toDealer(0, -0.002, z), S: hS, U: hU, T: hT, rx: 0.0305 * flare, ryTop: 0.0225 * flare, ryBot: 0.0235 * flare, exp: 2.3, v: z * 6,
        skin: [[fb, wf], [hb, 1 - wf]],
        bump: (th) => 1 + 0.03 * Math.sin(th * 5 + z * 300) * smooth(-0.03, -0.075, z), // soft leather rumple
      });
    }
    gloveGeos.push(buildTube(samples, 24));
  }

  const gloveGeo = mergeGeometries(gloveGeos);
  const glove = new THREE.SkinnedMesh(gloveGeo, gloveMat);
  glove.name = `${side}Glove`;
  glove.castShadow = true; glove.receiveShadow = true;
  glove.frustumCulled = false;
  parent.add(glove);
  glove.updateMatrixWorld(true);
  glove.bind(skeleton);

  // ── coat sleeve: shoulder → elbow → past the wrist, folds at the elbow and cuff
  let sleeve = null;
  {
    const A = abs[`${side}arm`].clone().add(new THREE.Vector3(s * 0.01, 0.01, 0));
    const E = abs[`${side}forearm`].clone();
    const W = abs[`${side}hand`].clone();
    const dirF = W.clone().sub(E).normalize();
    const End = W.clone().addScaledVector(dirF, -0.03);
    const L1 = A.distanceTo(E), L2 = E.distanceTo(End), L = L1 + L2;
    const ab = I[`${side}arm`], fb = I[`${side}forearm`], sb = I[`${side}shoulder`];
    const up = new THREE.Vector3(0, 1, 0);
    const pointAt = (u) => (u <= L1 ? A.clone().lerp(E, u / L1) : E.clone().lerp(End, (u - L1) / L2));
    const samples = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * L;
      // smoothed tangent around the elbow
      const t0 = pointAt(Math.max(0, u - 0.035)), t1 = pointAt(Math.min(L, u + 0.035));
      const T = t1.sub(t0).normalize();
      const U = up.clone().sub(T.clone().multiplyScalar(T.dot(up))).normalize();
      const S = U.clone().cross(T);
      // the sleeve sags/rounds at the elbow: offset the centre slightly outward/down
      const c = pointAt(u).addScaledVector(U, -0.006 * g(u - L1, 0.05));
      let r;
      if (u < L1) r = lerp(0.066, 0.057, u / L1);
      else r = lerp(0.057, 0.05, (u - L1) / L2);
      r *= 1 + 0.06 * g(u - L1, 0.04);              // bunching at the bend
      r *= 1 + 0.05 * smooth(L - 0.06, L, u);        // hem opening
      const wArmFore = smooth(L1 - 0.06, L1 + 0.06, u);
      const wSh = 1 - smooth(0, 0.07, u);
      samples.push({
        c, S, U, T, rx: r, ryTop: r * 0.96, ryBot: r * 0.98, v: u * 3,
        skin: [[sb, wSh * 0.5], [ab, (1 - wArmFore) * (1 - wSh * 0.5)], [fb, wArmFore * (1 - wSh * 0.5)]],
        bump: (th) => {
          let k = 1;
          k += 0.055 * Math.sin(th * 2 + u * 95) * g(u - L1, 0.05);           // elbow folds
          k += 0.03 * Math.sin(th * 3 - u * 150 + 1.3) * g(u - (L - 0.05), 0.045); // forearm bunching above the cuff
          k += 0.018 * Math.sin(th + u * 18);                                   // drape irregularity
          k += 0.03 * g(u - (L - 0.004), 0.004);                                // turned hem
          return k;
        },
      });
    }
    const geo = buildTube(samples, 28);
    sleeve = new THREE.SkinnedMesh(geo, sleeveMat);
    sleeve.name = `${side}Sleeve`;
    sleeve.castShadow = true; sleeve.receiveShadow = true;
    sleeve.frustumCulled = false;
    parent.add(sleeve);
    sleeve.updateMatrixWorld(true);
    sleeve.bind(skeleton);
  }

  return { glove, sleeve, skeleton };
}
