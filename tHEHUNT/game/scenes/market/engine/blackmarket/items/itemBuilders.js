import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { paperTextures, metalTextures, leatherTextures, woodTextures, makeRng } from '../../core/proceduralTextures.js';

/**
 * Physical merchandise builders. Every builder returns a THREE.Group whose
 * origin sits on the desk surface (y = 0 is the contact plane), so resting
 * transforms are exact and contact shadows line up.
 */

const shadowAll = (g) => g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

// ── handwriting & typewriter helpers (canvas) ────────────────────────────
function inkQuestionMark(ctx, x, y, size, color = 'rgba(28,20,16,0.9)') {
  // Hand-drawn stroke rather than a font glyph: pressure varies along the path
  const rng = makeRng(Math.floor(x * 7 + y * 13));
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.12); ctx.scale(size / 100, size / 100);
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // hook → belly → short stem, written in one stroke; a second, thinner pass
  // slightly offset reads as ink pooling where the nib slowed down
  const stroke = (w, dx, dy) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(-24 + dx, -28 + dy);
    ctx.bezierCurveTo(-26 + dx, -62 + dy, 30 + dx, -66 + dy, 27 + dx, -32 + dy);
    ctx.bezierCurveTo(25 + dx, -12 + dy, 2 + dx, -10 + dy, 1 + dx, 10 + dy);
    ctx.lineTo(1.5 + dx, 18 + dy);
    ctx.stroke();
  };
  stroke(9, 0, 0);
  ctx.globalAlpha = 0.5;
  stroke(5, (rng() - 0.5) * 1.5, 1);
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.fillStyle = color; ctx.ellipse(2, 36, 6, 5.5, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function typewrite(ctx, text, x, y, size, rng) {
  ctx.font = `${size}px "Courier New", Courier, monospace`;
  let cx = x;
  for (const ch of text) {
    const a = 0.55 + rng() * 0.4; // uneven ribbon ink
    ctx.fillStyle = `rgba(22,18,16,${a})`;
    ctx.fillText(ch, cx + (rng() - 0.5) * 0.6, y + (rng() - 0.5) * 0.8);
    cx += size * 0.6;
  }
}

// ── ITEM 01 — HINT DROP: sealed envelope ─────────────────────────────────
export function buildEnvelope() {
  const g = new THREE.Group(); g.name = 'item_envelope';
  const W = 0.165, H = 0.112, T = 0.0045;
  const tex = paperTextures({
    seed: 101, w: 512, h: 352, base: [150, 112, 72], creases: 2, edgeWear: 0.9,
    draw: (ctx, w, h) => {
      // flap edges (back side): shaded V
      ctx.strokeStyle = 'rgba(60,40,20,0.35)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(6, 8); ctx.lineTo(w / 2, h * 0.58); ctx.lineTo(w - 6, 8); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,210,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, 11); ctx.lineTo(w / 2, h * 0.58 + 3); ctx.lineTo(w - 8, 11); ctx.stroke();
      // side seams
      ctx.strokeStyle = 'rgba(60,40,20,0.22)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(6, h - 6); ctx.lineTo(w * 0.36, h * 0.52); ctx.moveTo(w - 6, h - 6); ctx.lineTo(w * 0.64, h * 0.52); ctx.stroke();
      inkQuestionMark(ctx, w * 0.82, h * 0.8, 70);
      // faint thumb smudge
      const gr = ctx.createRadialGradient(w * 0.15, h * 0.7, 2, w * 0.15, h * 0.7, 40);
      gr.addColorStop(0, 'rgba(40,25,15,0.18)'); gr.addColorStop(1, 'rgba(40,25,15,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    },
  });
  // pillowed body: subdivided rounded box, middle pushed up (contents inside)
  const geo = new RoundedBoxGeometry(W, T, H, 6, 0.0018);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (W / 2), z = p.getZ(i) / (H / 2), y = p.getY(i);
    if (y > 0) p.setY(i, y + Math.max(0, (1 - x * x) * (1 - z * z)) * 0.0028);
  }
  geo.computeVertexNormals();
  // top-face UVs (planar)
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / W + 0.5, 0.5 - p.getZ(i) / H);
  const paper = new THREE.MeshStandardMaterial({ ...tex, roughness: 1, color: 0xffffff, normalScale: new THREE.Vector2(0.6, 0.6) });
  const body = new THREE.Mesh(geo, paper);
  body.position.y = T / 2;
  g.add(body);

  // wax seal: irregular disc with stamped emblem
  const sealGeo = new THREE.CylinderGeometry(0.0165, 0.0175, 0.0042, 48, 2);
  const sp = sealGeo.attributes.position;
  const rng = makeRng(5);
  const bumps = Array.from({ length: 9 }, () => rng());
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i), r = Math.hypot(x, z);
    if (r > 0.012) {
      const a = Math.atan2(z, x);
      let k = 1;
      bumps.forEach((b, j) => (k += Math.sin(a * (j + 2) + b * 6.28) * 0.025 / (j + 1)));
      sp.setX(i, x * k); sp.setZ(i, z * k);
      if (sp.getY(i) > 0) sp.setY(i, sp.getY(i) - (r - 0.012) * 0.25);
    }
  }
  sealGeo.computeVertexNormals();
  const emb = metalTextures({
    seed: 6, size: 256, baseRough: 0.3, scratchCount: 0,
    engrave: (ctx, s) => {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.03;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = s * 0.012;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(-s * 0.02, s * 0.02); inkQuestionMark(ctx, s / 2, s / 2, s * 0.45, '#fff'); ctx.restore();
    },
  });
  const wax = new THREE.MeshPhysicalMaterial({
    color: 0x7a0f0e, roughness: 0.42, roughnessMap: emb.roughnessMap, normalMap: emb.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4), clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.3, sheenColor: new THREE.Color(0x3a0505),
  });
  const seal = new THREE.Mesh(sealGeo, wax);
  seal.position.set(0, T + 0.0028 + 0.0021, H * 0.08);
  seal.rotation.y = 0.4;
  g.add(seal);
  shadowAll(g);
  g.userData.parts = { body, seal };
  return g;
}

// ── ITEM 02 — DEEP SCAN: magnifying glass on a classified document ───────
export function buildMagnifierSet() {
  const g = new THREE.Group(); g.name = 'item_magnifier';
  const rng = makeRng(2024);
  const DW = 0.2, DH = 0.265;
  const doc = paperTextures({
    seed: 202, w: 512, h: 680, base: [196, 182, 152], creases: 2, edgeWear: 0.5,
    draw: (ctx, w, h) => {
      ctx.save();
      ctx.translate(w * 0.62, h * 0.1); ctx.rotate(-0.08);
      ctx.strokeStyle = 'rgba(130,20,18,0.75)'; ctx.lineWidth = 4;
      ctx.strokeRect(-110, -26, 220, 52);
      ctx.font = 'bold 34px "Courier New", monospace'; ctx.fillStyle = 'rgba(130,20,18,0.7)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CLASSIFIED', 0, 2);
      ctx.restore();
      typewrite(ctx, 'FILE NO. 77-B / SUBJECT: [WITHHELD]', 36, 140, 17, rng);
      typewrite(ctx, 'DISTRIBUTION: EYES ONLY', 36, 166, 17, rng);
      let y = 214;
      for (let l = 0; l < 17; l++) {
        const words = ['observed', 'at', 'the', 'location', 'between', '0200', 'and', 'meeting', 'contact', 'confirmed', 'ledger', 'transfer', 'witness', 'did', 'not', 'route', 'second', 'name'];
        let line = '', x = 36;
        while (line.length < 38) line += words[Math.floor(rng() * words.length)] + ' ';
        if (rng() < 0.3) {
          typewrite(ctx, line.slice(0, 14), x, y, 15, rng);
          ctx.fillStyle = 'rgba(12,10,10,0.92)';
          ctx.fillRect(x + 14 * 9 + 6, y - 13, 120 + rng() * 140, 16);
        } else typewrite(ctx, line, x, y, 15, rng);
        y += 25;
      }
      ctx.font = 'italic 22px Georgia, serif'; ctx.fillStyle = 'rgba(25,30,60,0.75)';
      ctx.fillText('— not for the detective', 220, h - 50);
    },
  });
  const paperMat = new THREE.MeshStandardMaterial({ ...doc, roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5) });
  const docGeo = new THREE.PlaneGeometry(DW, DH, 12, 16);
  // slight curl at one corner so it doesn't look like a decal
  const dp = docGeo.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i) / DW + 0.5, y = dp.getY(i) / DH + 0.5;
    dp.setZ(i, Math.pow(Math.max(0, x + y - 1.55), 2) * 0.05 + 0.0006);
  }
  docGeo.computeVertexNormals();
  const docMesh = new THREE.Mesh(docGeo, paperMat);
  docMesh.rotation.x = -Math.PI / 2;
  docMesh.receiveShadow = true;
  g.add(docMesh);

  // magnifying glass
  const glass = new THREE.Group(); glass.name = 'magnifier';
  const R = 0.043;
  // biconvex lens profile
  const prof = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(t * R, 0.0045 * Math.cos(t * Math.PI / 2))); }
  for (let i = 16; i >= 0; i--) { const t = i / 16; prof.push(new THREE.Vector2(t * R, -0.0045 * Math.cos(t * Math.PI / 2))); }
  const lensGeo = new THREE.LatheGeometry(prof, 64);
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xf4f2ea, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.012, ior: 1.52,
    specularIntensity: 1, envMapIntensity: 1.2, attenuationColor: new THREE.Color(0xe8f0e0), attenuationDistance: 0.2,
  });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  glass.add(lens);
  const rimTex = metalTextures({ seed: 9, size: 256, baseRough: 0.32, scratchCount: 140 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6b5634, metalness: 1, roughness: 1, roughnessMap: rimTex.roughnessMap, normalMap: rimTex.normalMap });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.0025, 0.0042, 14, 72), rimMat);
  rim.rotation.x = Math.PI / 2;
  glass.add(rim);
  // ferrule + handle (lathe)
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0065, 0.022, 20), rimMat);
  ferrule.rotation.z = Math.PI / 2; ferrule.position.x = R + 0.016;
  glass.add(ferrule);
  const hp = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    hp.push(new THREE.Vector2(0.0062 + Math.sin(t * Math.PI) * 0.0028 - t * 0.0008 + (t > 0.95 ? -(t - 0.95) * 0.08 : 0), t * 0.105));
  }
  const handleWood = woodTextures({ seed: 12, tone: [36, 20, 12] });
  const handle = new THREE.Mesh(new THREE.LatheGeometry(hp, 24), new THREE.MeshStandardMaterial({ ...handleWood, roughness: 0.6, color: 0xbbaaa0 }));
  handle.rotation.z = -Math.PI / 2; handle.position.x = R + 0.026;
  glass.add(handle);
  glass.traverse((o) => { if (o.isMesh && o !== lens) { o.castShadow = true; } });
  lens.castShadow = false;
  // resting: lying on the document, handle supported by the paper, lens just above it
  glass.position.set(-0.012, 0.0072, 0.02);
  glass.rotation.set(0, 0.55, 0.035);
  g.add(glass);
  g.userData.parts = { doc: docMesh, glass, lens };
  return g;
}

// ── ITEM 03 — SECOND CHANCE: worn metal token ───────────────────────────
export function buildToken() {
  const g = new THREE.Group(); g.name = 'item_token';
  const R = 0.0265, T = 0.0042;
  const tex = metalTextures({
    seed: 303, size: 512, baseRough: 0.34, scratchCount: 320,
    engrave: (ctx, s) => {
      const c = s / 2;
      ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
      ctx.lineWidth = s * 0.018;
      ctx.beginPath(); ctx.arc(c, c, s * 0.44, 0, Math.PI * 2); ctx.stroke();
      // dotted inner ring
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; ctx.beginPath(); ctx.arc(c + Math.cos(a) * s * 0.39, c + Math.sin(a) * s * 0.39, s * 0.007, 0, 6.28); ctx.fill(); }
      // circular arrow (≈300°) with arrowhead
      ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';
      const a0 = -Math.PI * 0.35, a1 = a0 + Math.PI * 1.62, rr = s * 0.24;
      ctx.beginPath(); ctx.arc(c, c, rr, a0, a1); ctx.stroke();
      const hx = c + Math.cos(a1) * rr, hy = c + Math.sin(a1) * rr;
      const ta = a1 + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ta) * s * 0.07, hy + Math.sin(ta) * s * 0.07);
      ctx.lineTo(hx + Math.cos(a1) * s * 0.065, hy + Math.sin(a1) * s * 0.065);
      ctx.lineTo(hx - Math.cos(a1) * s * 0.065, hy - Math.sin(a1) * s * 0.065);
      ctx.closePath(); ctx.fill();
    },
  });
  const face = new THREE.MeshStandardMaterial({
    color: 0xa0784c, metalness: 1, roughness: 1, roughnessMap: tex.roughnessMap, normalMap: tex.normalMap,
    aoMap: tex.aoMap, map: tex.map, normalScale: new THREE.Vector2(1.2, 1.2),
  });
  const backTex = metalTextures({ seed: 304, size: 256, baseRough: 0.4, scratchCount: 200 });
  const back = new THREE.MeshStandardMaterial({ color: 0x8e6a42, metalness: 1, roughness: 1, roughnessMap: backTex.roughnessMap, normalMap: backTex.normalMap });
  const edge = new THREE.MeshStandardMaterial({ color: 0x86643f, metalness: 1, roughness: 0.48 });
  const geo = new THREE.CylinderGeometry(R, R, T, 96, 1);
  // reeded edge
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r > R * 0.99) { const a = Math.atan2(z, x); const k = 1 + Math.sin(a * 96) * 0.004; p.setX(i, x * k); p.setZ(i, z * k); }
  }
  geo.computeVertexNormals();
  const coin = new THREE.Mesh(geo, [edge, face, back]);
  coin.position.y = T / 2;
  g.add(coin);
  // raised rim bead on the face
  const bead = new THREE.Mesh(new THREE.TorusGeometry(R - 0.0012, 0.0008, 6, 96), edge);
  bead.rotation.x = Math.PI / 2; bead.position.y = T + 0.0002;
  g.add(bead);
  shadowAll(g);
  g.userData.parts = { coin };
  return g;
}

// ── ITEM 04 — BLACKOUT SHIELD: dark metal insignia ──────────────────────
export function buildShield() {
  const g = new THREE.Group(); g.name = 'item_shield';
  const w = 0.07, h = 0.088;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2);
  s.lineTo(w / 2, h / 2);
  s.lineTo(w / 2, 0.006);
  s.bezierCurveTo(w / 2, -h * 0.25, w * 0.2, -h * 0.42, 0, -h / 2);
  s.bezierCurveTo(-w * 0.2, -h * 0.42, -w / 2, -h * 0.25, -w / 2, 0.006);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: 3, curveSegments: 32 });
  // planar UVs normalised to the shield's bounds
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2 + 0.002) / (w + 0.004), (p.getY(i) + h / 2 + 0.002) / (h + 0.004));
  const tex = metalTextures({
    seed: 404, size: 512, baseRough: 0.3, scratchCount: 360,
    engrave: (ctx, S) => {
      const sx = (x) => ((x + w / 2 + 0.002) / (w + 0.004)) * S;
      const sy = (y) => (1 - (y + h / 2 + 0.002) / (h + 0.004)) * S;
      const k = 0.78; // inset outline
      ctx.strokeStyle = '#fff'; ctx.lineWidth = S * 0.018;
      ctx.beginPath();
      ctx.moveTo(sx(-w / 2 * k), sy(h / 2 * k)); ctx.lineTo(sx(w / 2 * k), sy(h / 2 * k)); ctx.lineTo(sx(w / 2 * k), sy(0.004));
      ctx.bezierCurveTo(sx(w / 2 * k), sy(-h * 0.25 * k), sx(w * 0.2 * k), sy(-h * 0.42 * k), sx(0), sy(-h / 2 * k));
      ctx.bezierCurveTo(sx(-w * 0.2 * k), sy(-h * 0.42 * k), sx(-w / 2 * k), sy(-h * 0.25 * k), sx(-w / 2 * k), sy(0.004));
      ctx.closePath(); ctx.stroke();
      // single vertical cut + a horizontal bar (minimal, not heraldic)
      ctx.lineWidth = S * 0.026;
      ctx.beginPath(); ctx.moveTo(sx(0), sy(h * 0.3)); ctx.lineTo(sx(0), sy(-h * 0.3)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx(-w * 0.24), sy(h * 0.12)); ctx.lineTo(sx(w * 0.24), sy(h * 0.12)); ctx.stroke();
    },
  });
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6a7078, metalness: 1, roughness: 0.85, roughnessMap: tex.roughnessMap, normalMap: tex.normalMap,
    aoMap: tex.aoMap, map: tex.map, normalScale: new THREE.Vector2(1.3, 1.3),
  });
  const mesh = new THREE.Mesh(geo, mat);
  // lay it flat, face up, on the desk
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.0016;
  g.add(mesh);
  shadowAll(g);
  g.userData.parts = { mesh };
  return g;
}

// ── payment: leather coin pouch ──────────────────────────────────────────
export function buildCoinPouch() {
  const g = new THREE.Group(); g.name = 'coin_pouch';
  const prof = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    let r;
    if (t < 0.7) r = Math.sin((t / 0.7) * Math.PI * 0.95) * 0.042 + 0.004;
    else r = 0.012 + Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.01 + (t - 0.7) * 0.04;
    prof.push(new THREE.Vector2(Math.max(0.001, r), t * 0.085));
  }
  const geo = new THREE.LatheGeometry(prof, 40);
  // slump: the bag sags and folds under its own weight
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const fold = 1 + Math.sin(a * 5 + y * 40) * 0.05 * Math.min(1, y / 0.05);
    const sag = y < 0.05 ? 1 + (0.05 - y) * 2.2 : 1;
    p.setX(i, x * fold * sag); p.setZ(i, z * fold * sag * 0.86); p.setY(i, y * 0.78);
  }
  geo.computeVertexNormals();
  const lt = leatherTextures({ seed: 71, repeat: [2, 1], tone: [62, 40, 24] });
  const mat = new THREE.MeshStandardMaterial({ ...lt, roughness: 1, color: 0xffffff });
  const bag = new THREE.Mesh(geo, mat);
  g.add(bag);
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 });
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.0135, 0.0022, 8, 32), cordMat);
  cord.rotation.x = Math.PI / 2; cord.position.y = 0.054;
  g.add(cord);
  const tie = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.013, 0.054, 0), new THREE.Vector3(0.03, 0.045, 0.01), new THREE.Vector3(0.045, 0.02, 0.006), new THREE.Vector3(0.05, 0.002, -0.01),
  ]), 20, 0.0018, 6), cordMat);
  g.add(tie);
  shadowAll(g);
  return g;
}

// ── dealer's own props (not merchandise) ────────────────────────────────
export function buildLedger() {
  const g = new THREE.Group(); g.name = 'ledger';
  const lt = leatherTextures({ seed: 81, repeat: [1, 1], tone: [30, 22, 18] });
  const cover = new THREE.MeshStandardMaterial({ ...lt, roughness: 1 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 1 });
  const book = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.022, 0.21, 2, 0.004), [cover, cover, cover, cover, cover, cover]);
  book.position.y = 0.011;
  g.add(book);
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.143, 0.016, 0.2), pages);
  block.position.set(0.004, 0.011, 0);
  g.add(block);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.152, 0.0235, 0.006), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.6 }));
  band.position.set(0, 0.011, 0.06); g.add(band);
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x2c2a20, roughness: 0.5 }));
  pencil.rotation.z = Math.PI / 2; pencil.rotation.y = 0.3; pencil.position.set(0.02, 0.0035, 0.135);
  g.add(pencil);
  shadowAll(g);
  return g;
}

export function buildLooseSheet(seed = 900, w = 0.19, h = 0.25, text = true) {
  const rng = makeRng(seed);
  const t = paperTextures({
    seed, w: 384, h: 512, base: [170, 158, 128], creases: 1,
    draw: text ? (ctx, W) => { for (let i = 0; i < 14; i++) typewrite(ctx, '. . . . . . . . . . . . . . .'.slice(0, 10 + Math.floor(rng() * 20)), 30, 60 + i * 28, 13, rng); } : undefined,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ ...t, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0004;
  m.receiveShadow = true;
  return m;
}

// ── extra merchandise: revolver & knife (lie on their side on the desk) ──

/** Helper: extrude a 2D side profile (x = length, y = height) and lay it flat. */
function extrudeFlat(shape, depth, mat, { bevel = 0.0012, curve = 24 } = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curve,
  });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, mat);
  return m;
}

export function buildRevolver() {
  const g = new THREE.Group(); g.name = 'item_revolver';
  const side = new THREE.Group(); // modelled in profile (XY), then laid on its side
  // Extrude UVs are in metres: repeat the maps so grain/scratches are at real scale
  const blued = metalTextures({ seed: 505, size: 512, baseRough: 0.5, scratchCount: 300 });
  for (const t of [blued.roughnessMap, blued.normalMap]) t.repeat.set(9, 9);
  const steel = new THREE.MeshStandardMaterial({
    color: 0x1d2024, metalness: 1, roughness: 1, roughnessMap: blued.roughnessMap, normalMap: blued.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  const bright = new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 1, roughness: 0.42 });
  const wood = woodTextures({ seed: 77, tone: [52, 26, 13], repeat: [14, 14] });
  const grip = new THREE.MeshStandardMaterial({ ...wood, roughness: 0.62, color: 0x86685a, normalScale: new THREE.Vector2(1.2, 1.2) });

  // frame
  const f = new THREE.Shape();
  f.moveTo(-0.045, 0.02); f.lineTo(0.03, 0.02); f.lineTo(0.034, 0.05); f.lineTo(-0.03, 0.056);
  f.lineTo(-0.05, 0.05); f.lineTo(-0.058, 0.035); f.lineTo(-0.05, 0.02); f.closePath();
  const frame = extrudeFlat(f, 0.016, steel); side.add(frame);
  // barrel + ejector rod housing
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0075, 0.105, 24), steel);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(0.085, 0.046, 0); side.add(barrel);
  const rib = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.004, 0.006), steel);
  rib.position.set(0.085, 0.054, 0); side.add(rib);
  const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.07, 16), steel);
  lug.rotation.z = Math.PI / 2; lug.position.set(0.07, 0.034, 0); side.add(lug);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.003), steel);
  sight.position.set(0.133, 0.055, 0); side.add(sight);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.002, 16), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
  muzzle.rotation.z = Math.PI / 2; muzzle.position.set(0.1385, 0.046, 0); side.add(muzzle);
  // cylinder (drum) with flutes
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.0185, 0.0185, 0.036, 36), steel);
  const dp = drum.geometry.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i), z = dp.getZ(i), r = Math.hypot(x, z);
    if (r > 0.017 && Math.abs(dp.getY(i)) < 0.012) {
      const a = Math.atan2(z, x);
      const flute = Math.max(0, Math.cos(a * 6)) ** 6 * 0.0028;
      dp.setX(i, x * (1 - flute / r)); dp.setZ(i, z * (1 - flute / r));
    }
  }
  drum.geometry.computeVertexNormals();
  drum.rotation.z = Math.PI / 2; drum.position.set(0.012, 0.038, 0); side.add(drum);
  // hammer
  const hm = new THREE.Shape();
  hm.moveTo(0, 0); hm.lineTo(0.006, 0); hm.lineTo(0.002, 0.016); hm.lineTo(-0.008, 0.02); hm.lineTo(-0.006, 0.013); hm.closePath();
  const hammer = extrudeFlat(hm, 0.006, steel, { bevel: 0.0006 }); hammer.position.set(-0.047, 0.05, 0); side.add(hammer);
  // trigger guard + trigger
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0022, 8, 28, Math.PI), steel);
  guard.rotation.z = Math.PI; guard.position.set(-0.012, 0.02, 0); side.add(guard);
  const tr = new THREE.Shape();
  tr.moveTo(0, 0); tr.quadraticCurveTo(0.004, -0.012, -0.002, -0.016); tr.lineTo(-0.004, -0.015); tr.quadraticCurveTo(0.0, -0.008, -0.003, 0); tr.closePath();
  const trigger = extrudeFlat(tr, 0.004, bright, { bevel: 0.0004 }); trigger.position.set(-0.01, 0.022, 0); side.add(trigger);
  // grip (birds-head curve)
  const gp = new THREE.Shape();
  gp.moveTo(-0.04, 0.024); gp.lineTo(-0.058, 0.036);
  gp.bezierCurveTo(-0.072, 0.02, -0.086, -0.03, -0.08, -0.056);
  gp.quadraticCurveTo(-0.068, -0.068, -0.05, -0.058);
  gp.bezierCurveTo(-0.05, -0.03, -0.038, -0.005, -0.03, 0.016);
  gp.closePath();
  const gripMesh = extrudeFlat(gp, 0.024, grip, { bevel: 0.003 }); side.add(gripMesh);
  // grip screw
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 16), bright);
  screw.rotation.x = Math.PI / 2; screw.position.set(-0.062, -0.018, 0); side.add(screw);

  // lay it on its side: profile plane (XY) → desk plane (XZ); thickness rests on the wood
  side.rotation.x = -Math.PI / 2;
  side.position.set(-0.025, 0.0155, 0.004);
  g.add(side);
  shadowAll(g);
  g.userData.parts = { side };
  return g;
}

export function buildKnife() {
  const g = new THREE.Group(); g.name = 'item_knife';
  const side = new THREE.Group();
  const steelTex = metalTextures({ seed: 606, size: 512, baseRough: 0.24, scratchCount: 160 });
  for (const t of [steelTex.roughnessMap, steelTex.normalMap]) t.repeat.set(8, 8);
  const blade = new THREE.MeshStandardMaterial({
    color: 0xb9bcc0, metalness: 1, roughness: 1, roughnessMap: steelTex.roughnessMap, normalMap: steelTex.normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6b3c, metalness: 1, roughness: 0.38 });
  const wood = woodTextures({ seed: 88, tone: [40, 22, 12], repeat: [14, 14] });
  const handleMat = new THREE.MeshStandardMaterial({ ...wood, roughness: 0.5, color: 0xb09080 });

  // blade: clip point, slight belly; thin with a hollow grind toward the edge
  const b = new THREE.Shape();
  b.moveTo(0, 0.0); b.lineTo(0, 0.026);
  b.lineTo(0.075, 0.026);
  b.quadraticCurveTo(0.098, 0.024, 0.118, 0.012); // clip
  b.lineTo(0.124, 0.006);
  b.quadraticCurveTo(0.1, -0.004, 0.06, -0.002);   // belly / edge
  b.lineTo(0.006, 0.0); b.closePath();
  const bgeo = new THREE.ExtrudeGeometry(b, { depth: 0.0032, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 24 });
  bgeo.translate(0, 0, -0.0016);
  // grind: thin the lower half toward the edge
  const bp = bgeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i), z = bp.getZ(i);
    const k = Math.min(1, Math.max(0.12, (y + 0.002) / 0.016));
    bp.setZ(i, z * k);
  }
  bgeo.computeVertexNormals();
  const bladeMesh = new THREE.Mesh(bgeo, blade); side.add(bladeMesh);
  // fuller line (subtle groove) as a darker inset strip
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0025, 0.0002), new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 1, roughness: 0.4 }));
  fuller.position.set(0.04, 0.019, 0.0021); side.add(fuller);
  // guard (bolster)
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.014), brass);
  guard.position.set(-0.004, 0.013, 0); side.add(guard);
  // handle: slightly swelled, rounded
  const h = new THREE.Shape();
  h.moveTo(-0.008, 0.0); h.lineTo(-0.008, 0.026);
  h.bezierCurveTo(-0.04, 0.03, -0.075, 0.03, -0.095, 0.024);
  h.quadraticCurveTo(-0.104, 0.013, -0.096, 0.002);
  h.bezierCurveTo(-0.07, -0.004, -0.035, -0.003, -0.008, 0.0);
  const handle = extrudeFlat(h, 0.016, handleMat, { bevel: 0.003 }); side.add(handle);
  for (const x of [-0.03, -0.075]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0225, 12), brass);
    pin.rotation.x = Math.PI / 2; pin.position.set(x, 0.013, 0); side.add(pin);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.0175), brass);
  cap.position.set(-0.099, 0.013, 0); side.add(cap);

  side.rotation.x = -Math.PI / 2;
  side.position.set(-0.01, 0.0115, 0.014); // centre the profile (height maps to -Z when laid flat)
  g.add(side);
  shadowAll(g);
  g.userData.parts = { side, blade: bladeMesh };
  return g;
}

// ── THE GAME additions ──────────────────────────────────────────────────────
// Origin on the desk surface (y = 0), like every builder above.

/** MASTER KEY — an antique gold key with three set gems (legendary). */
export function buildMasterKey() {
  const g = new THREE.Group(); g.name = 'item_master_key';
  const tex = metalTextures({ seed: 811, size: 256, baseRough: 0.32, scratchCount: 220 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89a3c, metalness: 1, roughness: 0.38, roughnessMap: tex.roughnessMap, normalMap: tex.normalMap });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5a4218, metalness: 1, roughness: 0.55 });
  const R = 0.0055; // shaft radius
  const lay = new THREE.Group(); // modelled along +X, then laid flat
  // bow: an ornate ring with an inner ring
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0062, 14, 48), gold);
  bow.position.x = -0.07; lay.add(bow);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0026, 10, 36), dark);
  inner.position.x = -0.07; lay.add(inner);
  // collar + shaft
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.7, R * 1.7, 0.012, 20), gold);
  collar.rotation.z = Math.PI / 2; collar.position.x = -0.032; lay.add(collar);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.12, 20), gold);
  shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.032; lay.add(shaft);
  // bit (teeth)
  for (const [x, h] of [[0.07, 0.022], [0.082, 0.016], [0.088, 0.026]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.008, h, 0.006), gold);
    t.position.set(x, -h / 2 - R * 0.6, 0); lay.add(t);
  }
  // three gems on the bow (blue, red, green), softly self-lit so they read in the dark room
  const gem = (c, x, y) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.0062, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 }));
    m.position.set(x, y, 0.0045); m.scale.z = 0.6; lay.add(m); return m;
  };
  gem(0x3aa8ff, -0.07, 0.03); gem(0xd23a3a, -0.1, 0); gem(0x2fc06a, -0.07, -0.03);
  lay.rotation.x = -Math.PI / 2; // flat on the desk
  lay.position.y = 0.0062;
  g.add(lay);
  shadowAll(g);
  return g;
}

/** OVERCLOCK — a small circuit board with a glowing core. */
export function buildOverclockChip() {
  const g = new THREE.Group(); g.name = 'item_overclock';
  const W = 0.1, D = 0.07, T = 0.003;
  const c = document.createElement('canvas'); c.width = 256; c.height = 180;
  const x = c.getContext('2d');
  x.fillStyle = '#0f3b2a'; x.fillRect(0, 0, 256, 180);
  x.strokeStyle = '#d9b24a'; x.lineWidth = 2;
  const rng = makeRng(77);
  for (let i = 0; i < 26; i++) { const y = 10 + rng() * 160; x.beginPath(); x.moveTo(0, y); x.lineTo(60 + rng() * 40, y); x.lineTo(90 + rng() * 30, 90 + (rng() - 0.5) * 40); x.stroke(); }
  for (let i = 0; i < 26; i++) { const y = 10 + rng() * 160; x.beginPath(); x.moveTo(256, y); x.lineTo(196 - rng() * 40, y); x.lineTo(166 - rng() * 30, 90 + (rng() - 0.5) * 40); x.stroke(); }
  x.fillStyle = '#f2f2f2'; x.font = 'bold 13px monospace'; x.fillText('OC-2X', 12, 172);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new RoundedBoxGeometry(W, T, D, 2, 0.002), new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.2 }));
  board.position.y = T / 2; g.add(board);
  const chip = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.006, 0.03, 2, 0.0015), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.4 }));
  chip.position.y = T + 0.003; g.add(chip);
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24), new THREE.MeshStandardMaterial({ color: 0x55e0ff, emissive: 0x2ab8ff, emissiveIntensity: 1.4 }));
  core.rotation.x = -Math.PI / 2; core.position.y = T + 0.0062; g.add(core);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.0015, 0.004), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 1, roughness: 0.3 }));
    pin.position.set(-0.0125 + i * 0.005, T + 0.001, s * 0.017); g.add(pin);
  }
  shadowAll(g);
  return g;
}

/** BLACKOUT BUNDLE — a wax-paper parcel tied with twine, a tag tucked under the knot. */
export function buildBundleParcel() {
  const g = new THREE.Group(); g.name = 'item_bundle';
  const W = 0.12, H = 0.045, D = 0.08;
  const wrap = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.006), new THREE.MeshStandardMaterial({ color: 0x3a3532, roughness: 0.65 }));
  wrap.position.y = H / 2; g.add(wrap);
  const twine = new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.9 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, H + 0.002, 0.004), twine); a.position.y = H / 2; g.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.004, H + 0.002, D + 0.002), twine); b.position.y = H / 2; g.add(b);
  const knot = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.002, 8, 16), twine); knot.rotation.x = Math.PI / 2; knot.position.y = H + 0.002; g.add(knot);
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#e9e0c8'; x.fillRect(0, 0, 128, 64); x.fillStyle = '#7a1c16'; x.font = 'bold 20px monospace'; x.fillText('G + F', 30, 40);
  const tm = new THREE.CanvasTexture(c); tm.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.02), new THREE.MeshStandardMaterial({ map: tm, roughness: 0.8, side: THREE.DoubleSide }));
  tag.rotation.set(-Math.PI / 2, 0, 0.4); tag.position.set(0.02, H + 0.0035, 0.012); g.add(tag);
  shadowAll(g);
  return g;
}
