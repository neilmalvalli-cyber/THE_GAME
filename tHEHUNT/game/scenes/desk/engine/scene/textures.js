import * as THREE from 'three';

// All textures are generated procedurally on <canvas> at load time:
// zero external assets, zero licensing questions, and every folder/photo
// gets its own seeded variation. Swap for scanned PBR sets later if wanted.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[perm[X] + Y]], b = vals[perm[perm[X + 1] + Y]];
    const c = vals[perm[perm[X] + Y + 1]], d = vals[perm[perm[X + 1] + Y + 1]];
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = null, aniso = 8, mirror = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.needsUpdate = true;
  return t;
}

export const FONTS = {
  type: '"Special Elite", "Courier New", monospace',
  stencil: '"Stardos Stencil", "Special Elite", Impact, sans-serif',
  marker: '"Permanent Marker", "Comic Sans MS", cursive',
};

export async function loadFonts(timeout = 2500) {
  if (!document.fonts) return;
  const want = ['40px "Special Elite"', '700 80px "Stardos Stencil"', '40px "Permanent Marker"'];
  await Promise.race([
    Promise.all(want.map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, timeout)),
  ]);
}

// ---------------------------------------------------------------------------
// WALNUT TABLE  (albedo, roughness, bump)
// ---------------------------------------------------------------------------
export function makeWalnut(seed = 7) {
  // A furniture top, not a floor: two wide book-matched boards per tile with
  // flat-sawn "cathedral" figure (elongated elliptical rings), a barely visible
  // glue line, no plank gaps or butt joints. The varnish comes from the material.
  const W = 2048, H = 1024, BOARDS = 2, bh = H / BOARDS;
  const n1 = makeNoise(seed), n2 = makeNoise(seed + 1), n3 = makeNoise(seed + 2);
  const r = rng(seed + 3);
  const tone = Array.from({ length: BOARDS }, () => 0.93 + r() * 0.12);
  // cathedral centre per board (where the arches peak) and ring stretch
  const arch = Array.from({ length: BOARDS }, () => ({ x0: W * (0.25 + r() * 0.5), cy: bh * (0.35 + r() * 0.3), k: 0.085 + r() * 0.03 }));

  const cA = canvas(W, H), cR = canvas(W, H), cB = canvas(W, H);
  const xA = cA.getContext('2d'), xR = cR.getContext('2d'), xB = cB.getContext('2d');
  const iA = xA.createImageData(W, H), iR = xR.createImageData(W, H), iB = xB.createImageData(W, H);
  const A = iA.data, R = iR.data, B = iB.data;

  const dark = [34, 20, 12], mid = [70, 43, 26], light = [112, 72, 44];

  for (let y = 0; y < H; y++) {
    const b = Math.floor(y / bh), yb = y - b * bh;
    const seamD = Math.min(yb, bh - 1 - yb);
    const a = arch[b];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const warp = n2(x * 0.0011 + b * 5, yb * 0.006) * 90 + n2(x * 0.004, yb * 0.02 + b) * 16;
      const dx = (x - a.x0) * a.k, dy = yb - a.cy + warp;
      const rr = Math.sqrt(dx * dx + dy * dy);
      let ring = 0.5 + 0.5 * Math.sin(rr * 0.42 + n1(x * 0.002, yb * 0.01) * 6);
      ring = Math.pow(ring, 3.0) * (0.35 + 0.65 * n3(x * 0.0018 + 7, yb * 0.03)); // thin, irregular latewood lines
      const streak = n1(x * 0.0015 + b * 9, yb * 0.05) * 0.7 + n1(x * 0.004, yb * 0.12) * 0.3;
      const fiber = n3(x * 0.03, yb * 1.1 + b * 40) * 0.6 + n3(x * 0.09, yb * 2.5) * 0.4;
      let v = 0.5 - 0.3 * ring + 0.3 * (streak - 0.5) + 0.22 * (fiber - 0.5);
      v *= 0.9 + 0.22 * n2(x * 0.0006 + 50, yb * 0.003 + b * 2.7); // broad colour variation
      v = Math.min(1, Math.max(0, v));
      const pore = (((x >> 2) * 73856093) ^ (y * 19349663)) >>> 0;
      const isPore = (pore % 1000) < 4;
      let col;
      if (v < 0.5) { const k = v / 0.5; col = [dark[0] + (mid[0] - dark[0]) * k, dark[1] + (mid[1] - dark[1]) * k, dark[2] + (mid[2] - dark[2]) * k]; }
      else { const k = (v - 0.5) / 0.5; col = [mid[0] + (light[0] - mid[0]) * k, mid[1] + (light[1] - mid[1]) * k, mid[2] + (light[2] - mid[2]) * k]; }
      let m = tone[b];
      if (isPore) m *= 0.75;
      if (seamD < 1) m *= 0.78; // glue line, not a gap
      A[i] = col[0] * m; A[i + 1] = col[1] * m; A[i + 2] = col[2] * m; A[i + 3] = 255;

      // varnished: mostly smooth, slightly rougher in the open-pored dark lines
      const rough = 125 + ring * 45 + fiber * 25 + (isPore ? 35 : 0);
      R[i] = R[i + 1] = R[i + 2] = rough; R[i + 3] = 255;

      const bump = 150 - ring * 60 - (isPore ? 50 : 0);
      B[i] = B[i + 1] = B[i + 2] = bump; B[i + 3] = 255;
    }
  }
  xA.putImageData(iA, 0, 0); xR.putImageData(iR, 0, 0); xB.putImageData(iB, 0, 0);

  // scratches & wear (drawn on all three maps)
  for (let s = 0; s < 140; s++) {
    const x0 = r() * W, y0 = r() * H, len = 15 + r() * (r() < 0.15 ? 200 : 70);
    const ang = (r() - 0.5) * Math.PI * (r() < 0.6 ? 0.35 : 2);
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const cx = (x0 + x1) / 2 + (r() - 0.5) * 20, cy = (y0 + y1) / 2 + (r() - 0.5) * 20;
    const a = 0.03 + r() * 0.08, lw = 0.4 + r() * 0.8;
    const draw = (ctx, style, w) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke(); };
    draw(xA, `rgba(190,150,112,${a})`, lw);
    draw(xR, `rgba(255,255,255,${a * 2.2})`, lw + 0.5);
    draw(xB, `rgba(0,0,0,${a * 2.5})`, lw);
  }
  // dents & rubbed patches
  for (let s = 0; s < 40; s++) {
    const x0 = r() * W, y0 = r() * H, rad = 6 + r() * 40;
    const g = xA.createRadialGradient(x0, y0, 0, x0, y0, rad);
    const lighter = r() < 0.5;
    g.addColorStop(0, lighter ? 'rgba(150,105,70,0.10)' : 'rgba(10,5,2,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    xA.fillStyle = g; xA.fillRect(x0 - rad, y0 - rad, rad * 2, rad * 2);
  }
  // a faint old ring mark where a mug once stood
  xA.strokeStyle = 'rgba(20,10,5,0.18)'; xA.lineWidth = 3;
  xA.beginPath(); xA.arc(W * 0.83, H * 0.22, 42, 0.2, Math.PI * 1.85); xA.stroke();

  return {
    map: tex(cA, { repeat: [1.5, 1.5], aniso: 16, mirror: true }),
    roughnessMap: tex(cR, { srgb: false, repeat: [1.5, 1.5], aniso: 16, mirror: true }),
    bumpMap: tex(cB, { srgb: false, repeat: [1.5, 1.5], aniso: 16, mirror: true }),
  };
}

// ---------------------------------------------------------------------------
// PAPER helpers
// ---------------------------------------------------------------------------
function paperBase(ctx, w, h, seed, base, { mottle = 14, fibers = 1600, stains = 6, edge = 0.28, edgeColor = '110,72,34' } = {}) {
  const r = rng(seed), n = makeNoise(seed + 9);
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const m = (n(x / 90, y / 90) - 0.5) * mottle + (n(x / 18, y / 18) - 0.5) * mottle * 0.35;
      const g = (Math.random() - 0.5) * 9;
      d[i] = base[0] + m + g; d[i + 1] = base[1] + m * 0.95 + g; d[i + 2] = base[2] + m * 0.8 + g; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // fibres
  for (let i = 0; i < fibers; i++) {
    const x = r() * w, y = r() * h, l = 3 + r() * 11, a = r() * Math.PI;
    ctx.strokeStyle = r() < 0.5 ? `rgba(255,248,225,${0.05 + r() * 0.1})` : `rgba(90,60,25,${0.04 + r() * 0.08})`;
    ctx.lineWidth = 0.6 + r() * 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  // discoloration
  for (let i = 0; i < stains; i++) {
    const x = r() * w, y = r() * h, rad = 60 + r() * w * 0.45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${edgeColor},${0.04 + r() * 0.08})`);
    g.addColorStop(1, `rgba(${edgeColor},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  // edge ageing
  const e = Math.min(w, h) * 0.08;
  const sides = [[0, 0, e, 0], [w, 0, w - e, 0], [0, 0, 0, e], [0, h, 0, h - e]];
  for (const [x0, y0, x1, y1] of sides) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${edgeColor},${edge})`);
    g.addColorStop(1, `rgba(${edgeColor},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  // nicks along the edges
  for (let i = 0; i < 26; i++) {
    const side = Math.floor(r() * 4), t = r();
    const x = side === 0 ? 0 : side === 1 ? w : t * w, y = side === 2 ? 0 : side === 3 ? h : t * h;
    ctx.fillStyle = `rgba(${edgeColor},${0.15 + r() * 0.2})`;
    ctx.beginPath(); ctx.ellipse(x, y, 3 + r() * 9, 2 + r() * 5, r() * 3, 0, Math.PI * 2); ctx.fill();
  }
  return r;
}

function crease(ctx, r, w, h, count = 3) {
  for (let i = 0; i < count; i++) {
    const vertical = r() < 0.5;
    const p = (0.2 + r() * 0.6) * (vertical ? w : h);
    const a = r() * 0.08 + 0.04;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(255,245,220,${a})`;
    ctx.beginPath();
    if (vertical) { ctx.moveTo(p, 0); ctx.lineTo(p + (r() - 0.5) * 30, h); } else { ctx.moveTo(0, p); ctx.lineTo(w, p + (r() - 0.5) * 30); }
    ctx.stroke();
    ctx.strokeStyle = `rgba(80,50,20,${a})`;
    ctx.beginPath();
    if (vertical) { ctx.moveTo(p + 1.5, 0); ctx.lineTo(p + 1.5 + (r() - 0.5) * 30, h); } else { ctx.moveTo(0, p + 1.5); ctx.lineTo(w, p + 1.5 + (r() - 0.5) * 30); }
    ctx.stroke();
  }
}

/** Rubber-stamp: draws text on a scratch canvas, erodes it, multiplies it on. */
function stamp(ctx, text, x, y, { font, size, color = '128,30,24', rot = -0.04, seed = 1, box = true, alpha = 0.85, blend = 'multiply' }) {
  const r = rng(seed);
  ctx.save();
  ctx.font = `${size}px ${font}`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  const pad = size * 0.32;
  const sw = Math.ceil(tw + pad * 2), sh = Math.ceil(size * 1.45 + pad);
  const sc = canvas(sw, sh), s = sc.getContext('2d');
  s.fillStyle = `rgba(${color},${alpha})`;
  s.strokeStyle = `rgba(${color},${alpha})`;
  s.font = `${size}px ${font}`;
  s.textBaseline = 'middle';
  s.fillText(text, pad, sh / 2 + size * 0.04);
  if (box) { s.lineWidth = size * 0.07; s.strokeRect(s.lineWidth, s.lineWidth, sw - s.lineWidth * 2, sh - s.lineWidth * 2); }
  // erode: uneven ink
  s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < sw * sh * 0.004; i++) {
    s.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
    s.beginPath(); s.arc(r() * sw, r() * sh, 0.5 + r() * 2.2, 0, Math.PI * 2); s.fill();
  }
  const grad = s.createLinearGradient(0, 0, sw, sh);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(r(), `rgba(0,0,0,${0.25 + r() * 0.25})`); grad.addColorStop(1, 'rgba(0,0,0,0.05)');
  s.fillStyle = grad; s.fillRect(0, 0, sw, sh);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(sc, -sw / 2, -sh / 2);
  ctx.restore();
}

const MANILA = [206, 172, 112];

// ---------------------------------------------------------------------------
// FOLDER COVER (outside) – carries the case number stamp
// ---------------------------------------------------------------------------
export function makeCoverOuter(caseNo, seed, title = '') {
  const w = 760, h = 1046; // matches coverW : D
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = paperBase(ctx, w, h, seed, MANILA.map((v, i) => v - 6 + (seed % 3) * 2 - i), { mottle: 18, stains: 7, edge: 0.34 });
  crease(ctx, r, w, h, 2);
  // printed form box (top right) – empty ruled lines, physical detail only
  ctx.strokeStyle = 'rgba(70,45,22,0.55)'; ctx.lineWidth = 2;
  const bx = w * 0.53, by = h * 0.07, bw = w * 0.38, bhh = h * 0.13;
  ctx.strokeRect(bx, by, bw, bhh);
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(bx + 10, by + (bhh / 4) * i); ctx.lineTo(bx + bw - 10, by + (bhh / 4) * i); ctx.stroke(); }
  // typed number in the box
  ctx.fillStyle = 'rgba(30,26,22,0.85)';
  ctx.font = `34px ${FONTS.type}`;
  ctx.fillText(`No. ${String(caseNo).padStart(2, '0')}`, bx + 16, by + bhh / 4 - 9);
  if (title) { // case title typed across the ruled lines
    ctx.font = `25px ${FONTS.type}`;
    const words = title.toUpperCase().split(' ');
    let line = '', row = 0;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > bw - 28 && line) { ctx.fillText(line, bx + 14, by + (bhh / 4) * (row + 2) - 7); line = word; row++; } else line = next;
    }
    if (line && row < 2) ctx.fillText(line, bx + 14, by + (bhh / 4) * (row + 2) - 7);
  }
  // big stamp
  stamp(ctx, `CASE ${String(caseNo).padStart(2, '0')}`, w * 0.44, h * 0.42, {
    font: FONTS.stencil, size: 118, seed: seed + 3, rot: -0.05 + r() * 0.05, color: '122,28,22',
  });
  // pencil underline / handling marks
  ctx.strokeStyle = 'rgba(60,50,45,0.18)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.14, h * 0.53); ctx.quadraticCurveTo(w * 0.45, h * 0.545, w * 0.73, h * 0.528); ctx.stroke();
  // thumb smudges near the free edge
  for (let i = 0; i < 3; i++) {
    const x = w * (0.82 + r() * 0.12), y = h * (0.35 + r() * 0.35), rad = 30 + r() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(70,45,25,0.10)'); g.addColorStop(1, 'rgba(70,45,25,0)');
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  if (caseNo === 3) { // coffee ring on one file
    ctx.strokeStyle = 'rgba(105,60,25,0.22)'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(w * 0.7, h * 0.78, 78, 0, Math.PI * 1.7); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(105,60,25,0.3)';
    ctx.beginPath(); ctx.arc(w * 0.7, h * 0.78, 82, 0.4, Math.PI * 1.2); ctx.stroke();
  }
  return tex(c);
}

// ---------------------------------------------------------------------------
// FOLDER COVER (inside) – lighter manila + evidence label sticker.
// Drawn rotated 180° because the box's -Y face is seen flipped once open.
// ---------------------------------------------------------------------------
export function makeCoverInner(caseNo, seed) {
  const w = 760, h = 1046;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = paperBase(ctx, w, h, seed + 100, [216, 186, 130], { mottle: 10, stains: 4, edge: 0.2 });
  crease(ctx, r, w, h, 1);
  ctx.save();
  ctx.translate(w, h); ctx.rotate(Math.PI);
  // evidence label: bottom-right of the left page when open (next to the fold)
  const lw = 250, lh = 150, lx = w - lw - 46, ly = h - lh - 60;
  ctx.save();
  ctx.translate(lx + lw / 2, ly + lh / 2); ctx.rotate(0.03);
  ctx.shadowColor = 'rgba(40,25,10,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#efe8d6'; ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#7c1f19'; ctx.fillRect(-lw / 2, -lh / 2, lw, 36);
  ctx.fillStyle = '#efe8d6'; ctx.font = `26px ${FONTS.type}`; ctx.textBaseline = 'middle';
  ctx.fillText('EVIDENCE', -lw / 2 + 14, -lh / 2 + 19);
  ctx.strokeStyle = 'rgba(60,40,30,0.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) { const yy = -lh / 2 + 66 + i * 28; ctx.beginPath(); ctx.moveTo(-lw / 2 + 14, yy); ctx.lineTo(lw / 2 - 14, yy); ctx.stroke(); }
  ctx.fillStyle = 'rgba(30,26,22,0.85)'; ctx.font = `24px ${FONTS.type}`;
  ctx.fillText(`CASE ${String(caseNo).padStart(2, '0')}`, -lw / 2 + 16, -lh / 2 + 56);
  ctx.restore();
  ctx.restore();
  return tex(c);
}

/** Inside face of the back panel (seen under/around the documents). */
export function makeBackInner(seed = 55) {
  const w = 760, h = 1000;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = paperBase(ctx, w, h, seed, [214, 183, 126], { mottle: 10, stains: 4, edge: 0.22 });
  crease(ctx, r, w, h, 1);
  return tex(c);
}

/** Outside of the back panel / edges. */
export function makeBackOuter(seed = 77) {
  const w = 512, h = 680;
  const c = canvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, seed, [196, 160, 102], { mottle: 16, stains: 5, edge: 0.3 });
  return tex(c);
}

/** Small label stuck on the tab. Text runs along the tab (bottom → top). */
export function makeTabLabel(caseNo, seed) {
  const w = 96, h = 300;
  const c = canvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, seed + 300, [236, 230, 212], { mottle: 6, fibers: 120, stains: 2, edge: 0.15, edgeColor: '120,100,70' });
  ctx.fillStyle = '#7c1f19'; ctx.fillRect(0, h - 26, w, 26);
  ctx.save();
  ctx.translate(w / 2 + 2, (h - 26) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(25,22,20,0.9)';
  ctx.font = `46px ${FONTS.type}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`CASE ${String(caseNo).padStart(2, '0')}`, 0, 0);
  ctx.restore();
  return tex(c);
}

// ---------------------------------------------------------------------------
// DOCUMENT PAGES – abstract typed blocks (no readable content by design)
// ---------------------------------------------------------------------------
export function makeDocument(seed) {
  const w = 800, h = 1030;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = paperBase(ctx, w, h, seed + 500, [228, 218, 194], { mottle: 9, fibers: 900, stains: 5, edge: 0.18, edgeColor: '140,105,60' });
  // foxing
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(140,90,40,${0.05 + r() * 0.12})`;
    ctx.beginPath(); ctx.arc(r() * w, r() * h, 1 + r() * 4, 0, Math.PI * 2); ctx.fill();
  }
  const ink = (a) => `rgba(40,36,34,${a})`;
  // letterhead rule
  ctx.fillStyle = ink(0.8); ctx.fillRect(70, 86, w - 140, 5);
  ctx.fillRect(70, 96, w - 140, 1.5);
  // title block (abstract)
  for (let k = 0; k < 2; k++) ctx.fillRect(70, 120 + k * 26, 180 + r() * 160, 13);
  // typed lines: word-sized blocks
  let y = 210;
  while (y < h - 110) {
    if (r() < 0.12) { y += 26; continue; } // paragraph gap
    let x = 70;
    const end = r() < 0.15 ? 70 + r() * (w - 240) : w - 70 - r() * 50;
    while (x < end) {
      const ww = 14 + r() * 58;
      if (x + ww > end) break;
      const redacted = r() < 0.035;
      ctx.fillStyle = redacted ? 'rgba(18,16,15,0.92)' : ink(0.35 + r() * 0.3);
      ctx.fillRect(x, y + (redacted ? -3 : 0), ww, redacted ? 16 : 9);
      x += ww + 9;
    }
    y += 24;
  }
  // signature scribble
  ctx.strokeStyle = 'rgba(30,40,80,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w - 300, h - 70);
  for (let i = 0; i < 9; i++) ctx.quadraticCurveTo(w - 290 + i * 22, h - 100 + r() * 50, w - 280 + i * 24, h - 72 + r() * 10);
  ctx.stroke();
  return tex(c);
}

/** THE GAME: a solved case — dark-green SOLVED stamp and the earned code fragment, on the cover. */
export function stampSolved(ctx, w, h, seed = 1, fragment = '') {
  stamp(ctx, 'SOLVED', w * 0.5, h * 0.66, { font: FONTS.stencil, size: 132, seed: 7100 + seed, rot: -0.11 + (seed % 3) * 0.02, color: '28,84,52', alpha: 0.9 });
  if (fragment) {
    // typed on a gummed label, then stamped over with the digits
    const lx = w * 0.18, ly = h * 0.76, lw = w * 0.64, lh = h * 0.1;
    ctx.save();
    ctx.translate(lx + lw / 2, ly + lh / 2); ctx.rotate(0.015 - (seed % 2) * 0.03);
    ctx.fillStyle = 'rgba(240,232,210,0.93)'; ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
    ctx.strokeStyle = 'rgba(70,45,22,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(-lw / 2 + 6, -lh / 2 + 6, lw - 12, lh - 12);
    ctx.fillStyle = 'rgba(30,26,22,0.88)'; ctx.font = `30px ${FONTS.type}`; ctx.textBaseline = 'middle';
    ctx.fillText('FRAGMENT:', -lw / 2 + 24, 2);
    ctx.restore();
    stamp(ctx, fragment.split('').join(' '), lx + lw * 0.72, ly + lh / 2, { font: FONTS.stencil, size: 74, seed: 7300 + seed, rot: -0.03, color: '122,28,22', box: false, alpha: 0.95 });
  }
}

/** Red VERIFIED rubber stamp across a solved Polaroid. */
export function stampVerified(ctx, w, h, seed = 1) {
  // ink sits on top of the glossy print (multiply would vanish into the dark photo)
  stamp(ctx, 'VERIFIED', w * 0.5, w * 0.42, { font: FONTS.stencil, size: 74, seed: 4400 + seed, rot: -0.2 + seed * 0.04, color: '196,38,30', alpha: 0.92, blend: 'source-over' });
}

// ---------------------------------------------------------------------------
// POLAROIDS – generic, moody, blurred photographic placeholders
// ---------------------------------------------------------------------------
export function makePolaroid(index, seed, sceneType = index) {
  const w = 512, h = 616;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const r = paperBase(ctx, w, h, seed + 700, [236, 230, 212], { mottle: 7, fibers: 220, stains: 3, edge: 0.16, edgeColor: '150,125,80' });
  const ix = 34, iy = 34, iw = w - 68, ih = w - 68;

  const sc = canvas(iw, ih), s = sc.getContext('2d');
  const scene = sceneType % 4;
  const sky = s.createLinearGradient(0, 0, 0, ih);
  if (scene === 0) { // night street: buildings + lit window
    sky.addColorStop(0, '#1d2226'); sky.addColorStop(0.6, '#2c2c2a'); sky.addColorStop(1, '#141210');
    s.fillStyle = sky; s.fillRect(0, 0, iw, ih);
    s.filter = 'blur(3px)';
    s.fillStyle = '#0c0d0e'; s.fillRect(0, ih * 0.18, iw * 0.42, ih); s.fillRect(iw * 0.62, ih * 0.08, iw * 0.38, ih);
    s.fillStyle = 'rgba(255,190,110,0.85)'; s.fillRect(iw * 0.72, ih * 0.3, iw * 0.08, ih * 0.1);
    const g = s.createRadialGradient(iw * 0.52, ih * 0.62, 4, iw * 0.52, ih * 0.62, ih * 0.35);
    g.addColorStop(0, 'rgba(255,200,140,0.55)'); g.addColorStop(1, 'rgba(255,200,140,0)');
    s.fillStyle = g; s.fillRect(0, 0, iw, ih);
    s.fillStyle = 'rgba(255,220,170,0.25)'; s.fillRect(iw * 0.3, ih * 0.86, iw * 0.45, 4);
  } else if (scene === 1) { // parked car under a streetlight
    sky.addColorStop(0, '#0f1214'); sky.addColorStop(1, '#25231f');
    s.fillStyle = sky; s.fillRect(0, 0, iw, ih);
    s.filter = 'blur(2.5px)';
    const cone = s.createLinearGradient(iw * 0.45, 0, iw * 0.45, ih);
    cone.addColorStop(0, 'rgba(255,214,150,0.55)'); cone.addColorStop(1, 'rgba(255,214,150,0.05)');
    s.fillStyle = cone; s.beginPath(); s.moveTo(iw * 0.42, 0); s.lineTo(iw * 0.5, 0); s.lineTo(iw * 0.86, ih); s.lineTo(iw * 0.08, ih); s.fill();
    s.fillStyle = '#0a0a0a';
    s.beginPath(); s.roundRect(iw * 0.18, ih * 0.62, iw * 0.62, ih * 0.16, 18); s.fill();
    s.beginPath(); s.roundRect(iw * 0.3, ih * 0.52, iw * 0.34, ih * 0.14, 20); s.fill();
    s.fillStyle = 'rgba(200,190,170,0.3)'; s.fillRect(iw * 0.34, ih * 0.55, iw * 0.12, ih * 0.06);
  } else if (scene === 2) { // treeline in fog
    sky.addColorStop(0, '#8d8a80'); sky.addColorStop(0.55, '#5f5d56'); sky.addColorStop(1, '#2a2925');
    s.fillStyle = sky; s.fillRect(0, 0, iw, ih);
    s.filter = 'blur(2px)';
    for (let i = 0; i < 26; i++) {
      const x = r() * iw, tw = 3 + r() * 10, depth = r();
      s.fillStyle = `rgba(20,20,18,${0.35 + depth * 0.6})`;
      s.fillRect(x, ih * (0.1 + r() * 0.2), tw, ih);
    }
    const fog = s.createLinearGradient(0, ih * 0.5, 0, ih);
    fog.addColorStop(0, 'rgba(160,158,150,0)'); fog.addColorStop(1, 'rgba(160,158,150,0.45)');
    s.fillStyle = fog; s.fillRect(0, 0, iw, ih);
  } else { // doorway with light slit
    sky.addColorStop(0, '#2a2622'); sky.addColorStop(1, '#141210');
    s.fillStyle = sky; s.fillRect(0, 0, iw, ih);
    s.filter = 'blur(2px)';
    s.fillStyle = '#0b0a09'; s.fillRect(iw * 0.3, ih * 0.15, iw * 0.4, ih * 0.85);
    const slit = s.createLinearGradient(iw * 0.66, 0, iw * 0.72, 0);
    slit.addColorStop(0, 'rgba(255,215,160,0)'); slit.addColorStop(0.5, 'rgba(255,215,160,0.9)'); slit.addColorStop(1, 'rgba(255,215,160,0)');
    s.fillStyle = slit; s.fillRect(iw * 0.64, ih * 0.15, iw * 0.1, ih * 0.85);
    const spill = s.createRadialGradient(iw * 0.69, ih * 0.98, 2, iw * 0.69, ih * 0.98, ih * 0.3);
    spill.addColorStop(0, 'rgba(255,215,160,0.4)'); spill.addColorStop(1, 'rgba(255,215,160,0)');
    s.fillStyle = spill; s.fillRect(0, 0, iw, ih);
  }
  s.filter = 'none';
  // film response: grain, faded blacks, warm cast, vignette
  const im = s.getImageData(0, 0, iw, ih), d = im.data;
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const i = (y * iw + x) * 4;
    const g = (Math.random() - 0.5) * 34;
    const dx = x / iw - 0.5, dy = y / ih - 0.5, vig = 1 - (dx * dx + dy * dy) * 1.25;
    d[i] = (d[i] * 0.86 + 22 + g) * vig + 6;
    d[i + 1] = (d[i + 1] * 0.84 + 18 + g) * vig + 3;
    d[i + 2] = (d[i + 2] * 0.76 + 14 + g) * vig;
  }
  s.putImageData(im, 0, 0);
  ctx.drawImage(sc, ix, iy);
  // slight sheen / chemical edge on the print
  ctx.strokeStyle = 'rgba(60,50,40,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(ix, iy, iw, ih);
  // handwritten number
  ctx.save();
  ctx.translate(w * 0.5, iy + ih + (h - iy - ih) * 0.52);
  ctx.rotate((r() - 0.5) * 0.08);
  ctx.fillStyle = 'rgba(25,25,30,0.88)';
  ctx.font = `50px ${FONTS.marker}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`LEVEL ${String(index + 1).padStart(2, '0')}`, 0, 0);
  ctx.restore();
  return tex(c);
}

export function makePolaroidBack(seed = 909) {
  const w = 256, h = 308;
  const c = canvas(w, h), ctx = c.getContext('2d');
  paperBase(ctx, w, h, seed, [62, 60, 58], { mottle: 6, fibers: 80, stains: 2, edge: 0.1, edgeColor: '30,30,30' });
  return tex(c);
}

// ---------------------------------------------------------------------------
// Shared utility maps
// ---------------------------------------------------------------------------
export function makePaperBump(seed = 3) {
  const w = 512, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
  const n = makeNoise(seed);
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = 128 + (n(x / 6, y / 6) - 0.5) * 70 + (n(x / 1.6, y / 1.6) - 0.5) * 50 + (Math.random() - 0.5) * 30;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: [3, 3] });
}

/** Soft rounded-rect contact shadow. */
export function makeBlobShadow() {
  // shadowBlur works in every browser (ctx.filter does not in Safari)
  const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetX = 2000;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.roundRect(52 - 2000, 52, s - 104, s - 104, 18); ctx.fill();
  return tex(c, { srgb: false });
}

export function makeDustSprite() {
  const s = 64, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return tex(c, { srgb: false });
}
