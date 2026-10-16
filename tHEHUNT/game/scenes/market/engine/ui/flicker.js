import gsap from 'gsap';

/**
 * flickerIn — the "light flickers back on" reveal used when leaving the
 * Black Market. Works on any element (opacity) or any numeric setter, so the
 * real folders page can call it on its own lamp/scene: flickerIn(v => lamp.intensity = v * 20)
 * Resolves when the light is steady.
 */
export function flickerIn(target, { reduced = false } = {}) {
  const set = typeof target === 'function' ? target : (v) => { target.style.opacity = String(v); };
  const o = { v: 0 };
  set(0);
  const steps = reduced
    ? [[1, 0.6]]
    : [[0.0, 0.25], [0.6, 0.05], [0.05, 0.08], [0.0, 0.18], [0.85, 0.05], [0.3, 0.07], [0.95, 0.06], [0.7, 0.1], [1.0, 0.4]];
  const tl = gsap.timeline();
  for (const [v, d] of steps) tl.to(o, { v, duration: d, ease: 'none', onUpdate: () => set(o.v) });
  return tl.then();
}
