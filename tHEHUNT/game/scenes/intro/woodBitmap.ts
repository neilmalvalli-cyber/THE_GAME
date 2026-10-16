// The intro's walnut table is three 2000×1700 SVG layers built from five-octave
// feTurbulence filters, inside a tilted, drifting, zooming "camera". Every change of
// scale makes the browser recompute that noise on the CPU, which held the intro near
// 15 fps on ordinary PCs. Here the same SVG is rendered once, ahead of time, into a
// bitmap; the intro then shows identical pixels as plain images the GPU can move freely.
import { INTRO_MARKUP } from './introMarkup';

const W = 2000, H = 1700;
let promise: Promise<string | null> | null = null;

function woodSvg(scale: number): string | null {
  const start = INTRO_MARKUP.indexOf('<svg class="tg-layer" width="2000" height="1700"');
  if (start < 0) return null;
  const end = INTRO_MARKUP.indexOf('</svg>', start) + '</svg>'.length;
  return INTRO_MARKUP.slice(start, end).replace(
    '<svg class="tg-layer" width="2000" height="1700"',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(W * scale)}" height="${Math.round(H * scale)}"`,
  );
}

/** Resolves to an object URL of the rendered table (or null if the browser can't). */
export function prepareIntroWood(): Promise<string | null> {
  if (promise) return promise;
  promise = (async () => {
    // render at the size the intro is displayed (it is scaled to the viewport), capped
    const fit = Math.max(window.innerWidth / 1280, window.innerHeight / 720);
    const scale = Math.min(1.5, Math.max(1, fit * Math.min(window.devicePixelRatio || 1, 1.5)));
    const svg = woodSvg(scale);
    if (!svg) return null;
    const src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.round(W * scale); c.height = Math.round(H * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.94));
      if (blob) document.documentElement.dataset.introWood = 'ready'; // observable (debugging / tests)
      return blob ? URL.createObjectURL(blob) : null;
    } finally {
      URL.revokeObjectURL(src);
    }
  })().catch(() => null);
  return promise;
}

/** Replace the three live SVG table layers inside a mounted intro with the bitmap. */
export function swapInWood(root: HTMLElement, url: string) {
  const layers = root.querySelectorAll<SVGSVGElement>('svg.tg-layer');
  if (layers.length !== 3) return;
  layers.forEach((svg) => {
    const img = document.createElement('img');
    img.className = svg.getAttribute('class') ?? 'tg-layer';
    img.alt = '';
    img.decoding = 'sync';
    img.src = url;
    svg.replaceWith(img);
  });
}
