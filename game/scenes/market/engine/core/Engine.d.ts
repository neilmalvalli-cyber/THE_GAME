export class Engine {
  constructor(container: HTMLElement, opts?: { pixelRatioCap?: number; minPixelRatio?: number; adaptive?: boolean });
  fpsCap: number;
  pixelRatio: number;
  maxPixelRatio: number;
  stats: { fps: number; ms: number; calls: number; triangles: number; pixelRatio: number };
  setPixelRatio(r: number): void;
  supported: boolean;
  reducedMotion: boolean;
  fade: number;
  renderer: { domElement: HTMLCanvasElement };
  onContextLost?: () => void;
  start(): void;
  stop(): void;
  resize(): void;
  setScene(scene: unknown): void;
  dispose(): void;
  static isWebGLAvailable(): boolean;
}
export function disposeObject(root: unknown): void;
