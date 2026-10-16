import * as THREE from 'three';

/**
 * Procedural PBR texture generation (albedo / roughness / normal) on canvas.
 * No image downloads; everything is generated once at load and cached.
 * Replace any of these with scanned textures (KTX2) later without touching
 * the scene code — each builder returns plain THREE.Texture objects.
 */

const cache = new Map();

// ── noise ────────────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function valueNoise2D(seed, PX, PY = PX) {
  const rng = makeRng(seed);
  const g = new Float32Array(PX * PY);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % PX) + PX) % PX, y0 = ((yi % PY) + PY) % PY;
    const x1 = (x0 + 1) % PX, y1 = (y0 + 1) % PY;
    const a = g[y0 * PX + x0], b = g[y0 * PX + x1], c = g[y1 * PX + x0], d = g[y1 * PX + x1];
    const u = s(xf), v = s(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Tileable fBm over a w×h grid. Returns Float32Array 0..1 */
function fbm(w, h, { seed = 1, scale = 4, octaves = 5, gain = 0.5, stretchX = 1, stretchY = 1 } = {}) {
  const out = new Float32Array(w * h);
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const per = Math.max(1, Math.round(scale * 2 ** o));
    const px = Math.max(1, Math.round(per * stretchX)), py = Math.max(1, Math.round(per * stretchY));
    layers.push({ n: valueNoise2D(seed + o * 101, px, py), px, py, amp: gain ** o });
  }
  let norm = 0; layers.forEach((l) => (norm += l.amp));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const l of layers) {
        // lattice period == sample range, so the texture tiles seamlessly
        const px = (x / w) * l.px, py = (y / h) * l.py;
        v += l.n(px, py) * l.amp;
      }
      out[y * w + x] = v / norm;
    }
  }
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { srgb = false, repeat = [1, 1], anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Height field (0..1) → tangent-space normal map canvas. */
function heightToNormal(hf, w, h, strength = 2) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const at = (x, y) => hf[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1; // +Y up (OpenGL convention)
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fieldToCanvas(w, h, fn) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const [r, g, b] = fn(i);
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

// ── concrete ─────────────────────────────────────────────────────────────
export function concreteTextures({ seed = 7, repeat = [2, 1], wet = 0.6 } = {}) {
  const key = `concrete${seed}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const W = 512, H = 512;
  const base = fbm(W, H, { seed, scale: 3, octaves: 6 });
  const pores = fbm(W, H, { seed: seed + 9, scale: 48, octaves: 2, gain: 0.6 });
  const stain = fbm(W, H, { seed: seed + 3, scale: 2, octaves: 4, stretchY: 0.5 });
  const height = new Float32Array(W * H);
  const rng = makeRng(seed * 3);
  // shutter-board seams from the formwork
  const seams = new Float32Array(W * H);
  for (let k = 1; k < 4; k++) {
    const y0 = Math.round((k / 4) * H + (rng() - 0.5) * 6);
    for (let x = 0; x < W; x++) for (let dy = -1; dy <= 1; dy++) seams[((y0 + dy + H) % H) * W + x] = 1 - Math.abs(dy) * 0.5;
  }
  for (let i = 0; i < W * H; i++) {
    const pit = pores[i] < 0.28 ? (0.28 - pores[i]) * 2.4 : 0;
    height[i] = base[i] * 0.6 - pit * 0.5 - seams[i] * 0.25;
  }
  const map = fieldToCanvas(W, H, (i) => {
    const y = Math.floor(i / W) / H;
    // moisture creeping down from the top, darker near the floor
    const damp = clamp01((stain[i] - 0.45) * 2.4) * wet * (0.5 + 0.5 * (1 - y));
    let v = mix(92, 128, base[i]) - pores[i] * 10 - damp * 38 - seams[i] * 14;
    const tint = damp * 6;
    return [v - tint * 0.2, v - tint * 0.1, v + tint * 0.15];
  });
  const rough = fieldToCanvas(W, H, (i) => {
    const damp = clamp01((stain[i] - 0.45) * 2.4) * wet;
    const r = 235 - damp * 90 - base[i] * 20;
    return [r, r, r];
  });
  const out = {
    map: toTexture(map, { srgb: true, repeat }),
    roughnessMap: toTexture(rough, { repeat }),
    normalMap: toTexture(heightToNormal(height, W, H, 3.2), { repeat }),
  };
  cache.set(key, out);
  return out;
}

// ── aged oak ─────────────────────────────────────────────────────────────
export function woodTextures({ seed = 21, repeat = [1, 1], tone = [62, 38, 22] } = {}) {
  const key = `wood${seed}${repeat}${tone}`;
  if (cache.has(key)) return cache.get(key);
  const W = 1024, H = 512;
  const warp = fbm(W, H, { seed, scale: 2, octaves: 4 });
  const fine = fbm(W, H, { seed: seed + 5, scale: 64, octaves: 2, stretchX: 0.08 });
  const wear = fbm(W, H, { seed: seed + 8, scale: 3, octaves: 5 });
  const height = new Float32Array(W * H);
  const rings = new Float32Array(W * H);
  // planks: three boards with slightly different figure
  const planks = 3;
  for (let y = 0; y < H; y++) {
    const p = Math.floor((y / H) * planks);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W, v = y / H;
      const r = Math.sin((v * 38 + p * 7.3 + warp[i] * 5.5 + Math.sin(u * 6.28 * 2 + p) * 0.6) * Math.PI);
      const ring = Math.pow(Math.abs(r), 0.35);
      rings[i] = ring;
      const gap = Math.abs((v * planks) % 1 - 0) < 0.006 || Math.abs((v * planks) % 1 - 1) < 0.006 ? 1 : 0;
      height[i] = ring * 0.22 + fine[i] * 0.5 - gap * 0.9;
    }
  }
  const map = fieldToCanvas(W, H, (i) => {
    const k = 0.6 + rings[i] * 0.45 + (fine[i] - 0.5) * 0.35;
    const worn = clamp01((wear[i] - 0.52) * 3); // lighter rubbed patches in the middle
    const f = k * (1 + worn * 0.25);
    return [tone[0] * f, tone[1] * f, tone[2] * f];
  });
  const rough = fieldToCanvas(W, H, (i) => {
    const worn = clamp01((wear[i] - 0.52) * 3);
    const r = 150 + fine[i] * 50 - worn * 55 + rings[i] * 20;
    return [r, r, r];
  });
  const out = {
    map: toTexture(map, { srgb: true, repeat }),
    roughnessMap: toTexture(rough, { repeat }),
    normalMap: toTexture(heightToNormal(height, W, H, 2.0), { repeat }),
  };
  cache.set(key, out);
  return out;
}

// ── paper ────────────────────────────────────────────────────────────────
/**
 * Aged paper. `draw(ctx, w, h)` paints content (text, stamps) on top.
 * Returns { map, roughnessMap, normalMap }
 */
export function paperTextures({ seed = 31, w = 512, h = 512, base = [176, 140, 96], creases = 3, draw, edgeWear = 0.6 } = {}) {
  const fib = fbm(w, h, { seed, scale: 24, octaves: 3 });
  const blot = fbm(w, h, { seed: seed + 2, scale: 3, octaves: 4 });
  const height = new Float32Array(w * h);
  const rng = makeRng(seed);
  const lines = [];
  for (let k = 0; k < creases; k++) {
    lines.push({ a: rng() * Math.PI, c: (rng() - 0.5) * 0.6, s: 0.6 + rng() * 0.6 });
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w - 0.5, v = y / h - 0.5;
      let hv = fib[y * w + x] * 0.15;
      for (const L of lines) {
        const dd = Math.abs(u * Math.cos(L.a) + v * Math.sin(L.a) - L.c);
        hv += Math.max(0, 1 - dd * 90) * 0.35 * L.s;
      }
      height[y * w + x] = hv;
    }
  }
  const c = fieldToCanvas(w, h, (i) => {
    const x = (i % w) / w, y = Math.floor(i / w) / h;
    const edge = Math.min(x, 1 - x, y, 1 - y);
    const e = clamp01(1 - edge * 14) * edgeWear;
    const k = 0.92 + fib[i] * 0.12 - clamp01((blot[i] - 0.55) * 2) * 0.18 - e * 0.25;
    return [base[0] * k, base[1] * k, base[2] * k * 0.98];
  });
  if (draw) draw(c.getContext('2d'), w, h);
  const rough = fieldToCanvas(w, h, (i) => {
    const r = 215 + fib[i] * 30;
    return [r, r, r];
  });
  return {
    map: toTexture(c, { srgb: true }),
    roughnessMap: toTexture(rough),
    normalMap: toTexture(heightToNormal(height, w, h, 4), {}),
  };
}

// ── worn metal ───────────────────────────────────────────────────────────
/**
 * Scratched metal with an optional engraved design.
 * `engrave(ctx, size)` draws WHITE where metal is cut away (on black).
 */
export function metalTextures({ seed = 41, size = 512, engrave, baseRough = 0.38, scratchCount = 260 } = {}) {
  const W = size, H = size;
  const n = fbm(W, H, { seed, scale: 6, octaves: 5 });
  const rng = makeRng(seed);
  // scratches
  const sc = canvas(W, H), sx = sc.getContext('2d');
  sx.fillStyle = '#000'; sx.fillRect(0, 0, W, H);
  sx.lineCap = 'round';
  for (let i = 0; i < scratchCount; i++) {
    const x = rng() * W, y = rng() * H, a = rng() * Math.PI, l = 10 + rng() * 80 * (rng() < 0.1 ? 3 : 1);
    sx.strokeStyle = `rgba(255,255,255,${0.15 + rng() * 0.45})`;
    sx.lineWidth = 0.5 + rng() * 1.2;
    sx.beginPath(); sx.moveTo(x, y);
    sx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rng() - 0.5) * 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    sx.stroke();
  }
  const sd = sx.getImageData(0, 0, W, H).data;
  let ed = null;
  if (engrave) {
    const ec = canvas(W, H), ex = ec.getContext('2d');
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    engrave(ex, W);
    // soften engraving edges (chamfered cut)
    const bc = canvas(W, H), bx = bc.getContext('2d');
    bx.filter = 'blur(1.6px)'; bx.drawImage(ec, 0, 0);
    ed = bx.getImageData(0, 0, W, H).data;
  }
  const height = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    height[i] = n[i] * 0.08 - (sd[i * 4] / 255) * 0.12 - (ed ? (ed[i * 4] / 255) * 0.9 : 0);
  }
  const rough = fieldToCanvas(W, H, (i) => {
    const s = sd[i * 4] / 255, e = ed ? ed[i * 4] / 255 : 0;
    // grime collects in engravings (rougher, darker), scratches are bright & polished
    const r = (baseRough + (n[i] - 0.5) * 0.25 - s * 0.12 + e * 0.35) * 255;
    return [r, r, r];
  });
  const ao = fieldToCanvas(W, H, (i) => {
    const e = ed ? ed[i * 4] / 255 : 0;
    const v = 255 * (1 - e * 0.65) * (0.9 + n[i] * 0.1);
    return [v, v, v];
  });
  return {
    roughnessMap: toTexture(rough),
    normalMap: toTexture(heightToNormal(height, W, H, 5)),
    aoMap: toTexture(ao),
    // Albedo darkening mask (grime), applied as `map` multiplied with material color
    map: toTexture(ao, { srgb: true }),
  };
}

// ── leather / fabric ─────────────────────────────────────────────────────
export function leatherTextures({ seed = 51, repeat = [2, 2], tone = [58, 40, 28] } = {}) {
  const key = `leather${seed}${repeat}${tone}`;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 256;
  const g = fbm(W, H, { seed, scale: 32, octaves: 3, gain: 0.55 });
  const big = fbm(W, H, { seed: seed + 1, scale: 3, octaves: 3 });
  const height = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) height[i] = Math.abs(g[i] - 0.5) * 0.6;
  const map = fieldToCanvas(W, H, (i) => {
    const k = 0.8 + big[i] * 0.35 - Math.abs(g[i] - 0.5) * 0.25;
    return [tone[0] * k, tone[1] * k, tone[2] * k];
  });
  const rough = fieldToCanvas(W, H, (i) => { const r = 150 + g[i] * 70 - big[i] * 30; return [r, r, r]; });
  const out = {
    map: toTexture(map, { srgb: true, repeat }),
    roughnessMap: toTexture(rough, { repeat }),
    normalMap: toTexture(heightToNormal(height, W, H, 3), { repeat }),
  };
  cache.set(key, out);
  return out;
}

export function woolTextures({ seed = 61, repeat = [6, 6] } = {}) {
  const key = `wool${seed}${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 256;
  // twill weave
  const n = fbm(W, H, { seed, scale: 16, octaves: 2 });
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tw = Math.sin(((x + y) / 4) * Math.PI) * 0.5 + 0.5;
    height[y * W + x] = tw * 0.25 + n[y * W + x] * 0.25;
  }
  const out = {
    normalMap: toTexture(heightToNormal(height, W, H, 2.5), { repeat }),
    roughnessMap: toTexture(fieldToCanvas(W, H, (i) => { const r = 225 + n[i] * 30; return [r, r, r]; }), { repeat }),
  };
  cache.set(key, out);
  return out;
}

/** Soft radial blob for contact shadows. */
export function blobShadowTexture() {
  if (cache.has('blob')) return cache.get('blob');
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  cache.set('blob', t);
  return t;
}

export { makeRng, fbm };
