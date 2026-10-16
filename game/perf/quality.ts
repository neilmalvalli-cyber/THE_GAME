// Graphics quality: LOW / MEDIUM / HIGH, chosen automatically or by the player.
//
// AUTO starts from a conservative guess (GPU string, memory, cores, screen) and then
// listens to the scenes: if the desk cannot hold ~30 fps even after its own resolution
// step-down, AUTO drops a tier. A manual choice is never overridden.
// Every tier keeps every interaction; only cost changes.
import { create } from 'zustand';

export type Quality = 'low' | 'medium' | 'high';
export type QualityChoice = Quality | 'auto';

export interface QualityProfile {
  /** Max device pixel ratio for 3D canvases. */
  pixelRatio: number;
  /** MSAA samples on the desk's post-processing target. */
  msaa: number;
  /** Desk shadow map size (one lamp). */
  shadowMap: number;
  /** Depth-of-field pass (renders the scene depth again). */
  dof: boolean;
  /** Dust motes in the lamp beam. */
  dust: boolean;
  /** Frame cap for 3D scenes (0 = display rate). */
  fpsCap: number;
  /** Market scenes: shadow-map size as a fraction of each light's authored size. */
  sceneShadowScale: number;
  /** Market scenes: re-render dynamic shadow maps every Nth frame. */
  shadowEvery: number;
  /** Market scenes: point lights (6 shadow renders each) may cast shadows. */
  pointShadows: boolean;
  /** Market scenes: depth of field while inspecting an item. */
  sceneDof: boolean;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, msaa: 0, shadowMap: 1024, dof: false, dust: false, fpsCap: 30, sceneShadowScale: 0.25, shadowEvery: 3, pointShadows: false, sceneDof: false },
  medium: { pixelRatio: 1.25, msaa: 2, shadowMap: 1024, dof: true, dust: true, fpsCap: 0, sceneShadowScale: 0.5, shadowEvery: 2, pointShadows: true, sceneDof: false },
  high: { pixelRatio: 2, msaa: 4, shadowMap: 2048, dof: true, dust: true, fpsCap: 0, sceneShadowScale: 0.5, shadowEvery: 1, pointShadows: true, sceneDof: true },
};

const KEY = 'the-game:quality';

function readChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high' || v === 'auto') return v;
  } catch { /* storage blocked */ }
  return 'auto';
}

/** A first guess before anything has been measured. Conservative on purpose. */
export function guessQuality(): Quality {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL: the scenes show their own fallback */ }
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem <= 4 || cores <= 2) return 'low';
  const integrated = /intel|uhd|hd graphics|iris|mali|adreno|powervr|apple gpu/.test(g) && !/arc/.test(g);
  const bigScreen = window.screen.width * (window.devicePixelRatio || 1) > 2600;
  if (integrated) return bigScreen ? 'low' : 'medium';
  return /nvidia|geforce|rtx|radeon|amd/.test(g) ? 'high' : 'medium';
}

interface QualityState {
  choice: QualityChoice;
  /** The tier in effect (resolved from AUTO). */
  quality: Quality;
  setChoice(c: QualityChoice): void;
  /** Called by scenes when AUTO should step down (sustained low frame rate). */
  reportSlow(): void;
}

let lastStepDown = 0;
const initialChoice = typeof window !== 'undefined' ? readChoice() : 'auto';

export const useQuality = create<QualityState>()((set, get) => ({
  choice: initialChoice,
  quality: initialChoice === 'auto' ? (typeof window !== 'undefined' ? guessQuality() : 'medium') : initialChoice,
  setChoice(c) {
    try { localStorage.setItem(KEY, c); } catch { /* ignore */ }
    set({ choice: c, quality: c === 'auto' ? guessQuality() : c });
  },
  reportSlow() {
    const { choice, quality } = get();
    if (choice !== 'auto' || quality === 'low') return;
    // one step at a time, never two within 20 s (no rapid switching); AUTO never steps back up
    const now = Date.now();
    if (now - lastStepDown < 20_000) return;
    lastStepDown = now;
    set({ quality: quality === 'high' ? 'medium' : 'low' });
  },
}));

export const profile = (): QualityProfile => PROFILES[useQuality.getState().quality];

/** Subscribe to changes of the tier in effect. */
export function onQuality(cb: (q: Quality, p: QualityProfile) => void): () => void {
  return useQuality.subscribe((s, prev) => { if (s.quality !== prev.quality) cb(s.quality, PROFILES[s.quality]); });
}
