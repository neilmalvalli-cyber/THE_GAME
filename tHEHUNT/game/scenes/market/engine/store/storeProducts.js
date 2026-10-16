import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildEnvelope, buildShield, buildMagnifierSet, buildToken, buildOverclockChip } from '../blackmarket/items/itemBuilders.js';
import { metalTextures } from '../core/proceduralTextures.js';

/**
 * Retail packaging for the four power-ups (same item ids as the Black Market,
 * so the backend/wallet logic is shared). Every product's origin is on the
 * counter surface, lying (or standing) exactly as it rests.
 */

const shadowAll = (g) => g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

function barcode(x, X, Y, w, h, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  x.fillStyle = '#fff'; x.fillRect(X - 6, Y - 6, w + 12, h + 22);
  x.fillStyle = '#111';
  let px = X;
  while (px < X + w) { const bw = 1 + Math.floor(r() * 3); if (r() > 0.45) x.fillRect(px, Y, bw, h); px += bw + 1; }
  x.font = '10px monospace'; x.textAlign = 'center'; x.fillText('0 41234 56789 ' + seed, X + w / 2, Y + h + 11);
}

/** Printed backing card (portrait). Colors: [bg, accent, ink] */
function cardArt(title, sub, [bg, accent, ink], seed, icon) {
  const W = 360, H = 540, c = canvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // hang tab hole
  x.fillStyle = 'rgba(0,0,0,0.85)'; x.beginPath(); x.ellipse(W / 2, 30, 26, 9, 0, 0, Math.PI * 2); x.fill();
  // burst badge
  x.save(); x.translate(W - 70, 92); x.fillStyle = accent;
  x.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 44 : 54; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill();
  x.fillStyle = ink; x.font = 'bold 15px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('POWER', 0, -3); x.fillText('UP!', 0, 15);
  x.restore();
  // title
  x.fillStyle = '#fff'; x.font = 'bold 44px "Arial Black", Arial, sans-serif'; x.textAlign = 'left';
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 6;
  const words = title.split(' ');
  words.forEach((w, i) => x.fillText(w, 26, 92 + i * 46));
  x.shadowBlur = 0;
  x.fillStyle = accent; x.fillRect(26, 92 + words.length * 46 - 30, 120, 6);
  // window area for the blister (lighter panel)
  x.fillStyle = 'rgba(255,255,255,0.18)';
  x.beginPath(); x.roundRect(40, 200, W - 80, 220, 18); x.fill();
  if (icon) icon(x, W / 2, 310);
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.font = '15px Arial, sans-serif'; x.fillText(sub, 26, 452);
  barcode(x, W - 150, 470, 120, 34, seed);
  return tex(c);
}

/** Card + clear blister bubble with the object inside. */
function blisterCard({ title, sub, colors, seed, inner, innerScale = 1, innerY = 0.012, bubble = [0.09, 0.022, 0.11] }) {
  const g = new THREE.Group();
  const CW = 0.12, CH = 0.18, T = 0.0025;
  const art = cardArt(title, sub, colors, seed);
  const print = new THREE.MeshStandardMaterial({ map: art, roughness: 0.42 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.8 });
  const card = new THREE.Mesh(new RoundedBoxGeometry(CW, T, CH, 2, 0.0012), [backMat, backMat, print, backMat, backMat, backMat]);
  // planar top UVs
  const p = card.geometry.attributes.position, uv = card.geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + 0.5, 0.5 - p.getZ(i) / CH);
  card.geometry.clearGroups();
  card.material = print;
  card.position.y = T / 2;
  g.add(card);
  // object inside the bubble
  inner.scale.setScalar(innerScale);
  inner.position.set(0, T + innerY * 0.2, 0.015);
  g.add(inner);
  // clear PET bubble
  const bub = new THREE.Mesh(new RoundedBoxGeometry(bubble[0], bubble[1], bubble[2], 4, 0.008), new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.05,
    envMapIntensity: 1.6, depthWrite: false,
  }));
  bub.position.set(0, T + bubble[1] / 2, 0.015);
  bub.renderOrder = 6;
  g.add(bub);
  // bubble flange (pressed edge)
  const fl = new THREE.Mesh(new RoundedBoxGeometry(bubble[0] + 0.012, 0.0008, bubble[2] + 0.012, 2, 0.0004), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, roughness: 0.1 }));
  fl.position.set(0, T + 0.0004, 0.015);
  g.add(fl);
  shadowAll(g);
  bub.castShadow = false;
  return g;
}

export function buildHintDropPack() {
  const env = buildEnvelope();
  return blisterCard({
    title: 'POWERFUL HINT', sub: 'A strong clue. Never the answer.', seed: 11,
    colors: [['#2b6fd6', '#123a7a'], '#ffd23f', '#1a1a1a'], inner: env, innerScale: 0.48, bubble: [0.092, 0.02, 0.066],
  });
}

export function buildShieldPack() {
  const sh = buildShield();
  return blisterCard({
    title: 'FIREWALL', sub: 'Blocks one incoming sabotage.', seed: 44,
    colors: [['#2d2f36', '#0d0e12'], '#e8473b', '#ffffff'], inner: sh, innerScale: 0.95, bubble: [0.082, 0.02, 0.098],
  });
}

/** SECOND CHANCE — an energy-drink can (stands upright). */
export function buildSecondChanceCan() {
  const g = new THREE.Group();
  const R = 0.033, H = 0.122;
  // label wrap
  const W = 1024, Hc = 380, c = canvas(W, Hc), x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, Hc);
  grad.addColorStop(0, '#e8352b'); grad.addColorStop(1, '#8e1410');
  x.fillStyle = grad; x.fillRect(0, 0, W, Hc);
  x.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 14; i++) { x.beginPath(); x.moveTo(i * 90, 0); x.lineTo(i * 90 + 60, 0); x.lineTo(i * 90 - 40, Hc); x.lineTo(i * 90 - 100, Hc); x.fill(); }
  for (const cx of [256, 768]) {
    x.save(); x.translate(cx, Hc / 2);
    // circular-arrow emblem (matches the token)
    x.strokeStyle = '#fff'; x.lineWidth = 16; x.lineCap = 'round';
    x.beginPath(); x.arc(0, -46, 46, -Math.PI * 0.35, Math.PI * 1.25); x.stroke();
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(36, -86); x.lineTo(64, -60); x.lineTo(28, -54); x.fill();
    x.font = 'bold 70px "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.fillText('SKIP', 0, 70);
    x.font = 'bold 46px Arial, sans-serif'; x.fillText('TOKEN', 0, 122);
    x.font = '22px Arial, sans-serif'; x.fillStyle = '#ffd23f'; x.fillText('POWER-UP · 250 ml', 0, 160);
    x.restore();
  }
  const label = tex(c);
  label.wrapS = THREE.RepeatWrapping;
  const metal = metalTextures({ seed: 71, size: 256, baseRough: 0.25, scratchCount: 60 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * 0.82, 48, 1, true), new THREE.MeshStandardMaterial({ map: label, metalness: 0.65, roughness: 0.28 }));
  body.position.y = H * 0.5; g.add(body);
  const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.25, roughnessMap: metal.roughnessMap });
  // tapered shoulders and base (lathe)
  const top = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; top.push(new THREE.Vector2(R - t * t * 0.007, H * 0.91 + t * H * 0.075)); }
  top.push(new THREE.Vector2(R - 0.0075, H * 0.99), new THREE.Vector2(R - 0.006, H), new THREE.Vector2(R - 0.0085, H), new THREE.Vector2(R - 0.0095, H * 0.985));
  const shoulder = new THREE.Mesh(new THREE.LatheGeometry(top, 48), alu); g.add(shoulder);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(R - 0.0095, 48), alu); lid.rotation.x = -Math.PI / 2; lid.position.y = H * 0.985; g.add(lid);
  const tab = new THREE.Mesh(new RoundedBoxGeometry(0.013, 0.0012, 0.024, 2, 0.0006), alu); tab.position.set(0, H * 0.99, 0.004); g.add(tab);
  const bot = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; bot.push(new THREE.Vector2(R - 0.006 + t * 0.006, t * H * 0.09)); }
  const base = new THREE.Mesh(new THREE.LatheGeometry(bot, 48), alu); g.add(base);
  const bottomCap = new THREE.Mesh(new THREE.CircleGeometry(R - 0.006, 32), alu); bottomCap.rotation.x = Math.PI / 2; bottomCap.position.y = 0.0005; g.add(bottomCap);
  // the token itself rides on the lid like a promo coin (ties it to the Black Market item)
  const token = buildToken(); token.scale.setScalar(0.42); token.position.set(-0.01, H * 0.99, -0.006); token.rotation.y = 0.5;
  g.add(token);
  shadowAll(g);
  g.userData.parts = { body };
  return g;
}

/** DEEP SCAN — magnifying glass in a window box (lies flat). */
export function buildDeepScanBox() {
  const g = new THREE.Group();
  const BW = 0.13, BH = 0.042, BD = 0.21;
  // top print with a transparent window
  const W = 390, H = 630, c = canvas(W, H), x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1d8f6e'); grad.addColorStop(1, '#0b4a39');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff'; x.font = 'bold 50px "Arial Black", Arial, sans-serif'; x.fillText('FREEZE', 24, 70); x.fillText('60 SEC', 24, 122);
  x.fillStyle = '#ffd23f'; x.fillRect(24, 136, 110, 6);
  x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '16px Arial, sans-serif'; x.fillText('Pauses a rival team’s progress timer.', 24, 570);
  barcode(x, W - 150, 586, 120, 26, 22);
  // window (cut out)
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.roundRect(46, 175, W - 92, 360, 24); x.fill();
  x.globalCompositeOperation = 'source-over';
  x.strokeStyle = '#ffd23f'; x.lineWidth = 5; x.beginPath(); x.roundRect(46, 175, W - 92, 360, 24); x.stroke();
  const topTex = tex(c);
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.45, alphaTest: 0.5, side: THREE.DoubleSide });
  const side = new THREE.MeshStandardMaterial({ color: 0x14684f, roughness: 0.5 });
  // box shell (no top) + insert
  const shell = new THREE.Group();
  const wallT = 0.0015;
  for (const [w, h, d, px, py, pz] of [
    [BW, wallT, BD, 0, wallT / 2, 0],
    [BW, BH, wallT, 0, BH / 2, BD / 2], [BW, BH, wallT, 0, BH / 2, -BD / 2],
    [wallT, BH, BD, BW / 2, BH / 2, 0], [wallT, BH, BD, -BW / 2, BH / 2, 0],
  ]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), side); m.position.set(px, py, pz); shell.add(m); }
  const insert = new THREE.Mesh(new THREE.PlaneGeometry(BW - 0.004, BD - 0.004), new THREE.MeshStandardMaterial({ color: 0x0c1814, roughness: 1 }));
  insert.rotation.x = -Math.PI / 2; insert.position.y = 0.012; shell.add(insert);
  g.add(shell);
  const topFace = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), topMat);
  topFace.rotation.x = -Math.PI / 2; topFace.position.y = BH; g.add(topFace);
  // window film
  const film = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.78, BD * 0.58), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.14, clearcoat: 1, depthWrite: false }));
  film.rotation.x = -Math.PI / 2; film.position.set(0, BH - 0.0015, -BD * 0.006); film.renderOrder = 6; g.add(film);
  // the magnifier, nested in the insert
  const set = buildMagnifierSet();
  const glass = set.userData.parts.glass;
  set.remove(glass);
  glass.position.set(0.0, 0.016, 0.058); // lens toward the front, handle toward the back — fits inside the box
  glass.rotation.set(0, Math.PI / 2 + 0.05, 0);
  glass.scale.setScalar(0.9);
  g.add(glass);
  shadowAll(g);
  topFace.castShadow = true;
  g.userData.parts = { glass };
  g.userData.noGlassAnim = true; // the glass stays in its box
  return g;
}

// ── THE GAME additions: the two power-ups the original store did not stock ──────

/** GLITCH ATTACK — a small black USB-style dongle in a blister. */
export function buildGlitchPack() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.012, 0.022, 2, 0.004), new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.35, metalness: 0.3 }));
  body.position.y = 0.006; g.add(body);
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.006, 0.014), new THREE.MeshStandardMaterial({ color: 0xc9cacc, metalness: 1, roughness: 0.3 }));
  plug.position.set(0.038, 0.006, 0); g.add(plug);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.002, 0.006), new THREE.MeshStandardMaterial({ color: 0xff2bd6, emissive: 0xff2bd6, emissiveIntensity: 1.5 }));
  led.position.set(-0.018, 0.0125, 0); g.add(led);
  return blisterCard({
    title: 'GLITCH ATTACK', sub: 'Scrambles a rival screen for 60 s.', seed: 61,
    colors: [['#4b1d6b', '#170a24'], '#ff2bd6', '#ffffff'], inner: g, innerScale: 1.0, bubble: [0.082, 0.02, 0.07],
  });
}

/** OVERCLOCK — the circuit board, retail-packed. */
export function buildOverclockPack() {
  return blisterCard({
    title: 'OVERCLOCK', sub: 'Doubles your next mini-game coins.', seed: 72,
    colors: [['#0f5a43', '#062419'], '#55e0ff', '#ffffff'], inner: buildOverclockChip(), innerScale: 0.72, bubble: [0.086, 0.02, 0.07],
  });
}
