// Type surface of the existing desk engine (JS). Only what the frontend uses.
export type DeskState =
  | 'INTRO_TRANSITION' | 'FOLDERS_DROPPING' | 'DESK_IDLE' | 'FOLDER_HOVER' | 'FOLDER_SELECTING'
  | 'FOLDER_OPENING' | 'FOLDER_OPEN' | 'FOLDER_CLOSING' | 'FOLDER_RETURNING';

export interface CaseReport {
  caseLabel: string; caseTitle: string; levelLabel: string; title: string;
  difficulty: string; reward: string; status: string; description: string; hint?: string; completed?: boolean;
}

export function webglAvailable(): boolean;

export class DetectiveDeskScene {
  constructor(container: HTMLElement, opts?: {
    reducedMotion?: boolean; onProgress?: (p: string) => void; backButton?: boolean; cases?: { title: string }[]; quality?: import('../../../perf/quality').QualityProfile | null;
  });
  reducedMotion: boolean;
  paused: boolean;
  tempo: number;
  openId: number | null;
  renderer: { domElement: HTMLCanvasElement };
  post: { fade: { value: number } };
  audio: { ctx: AudioContext | null; setMuted(m: boolean): void };
  stats: { fps: number; pixelRatio: number; ms: number; calls: number; triangles: number; shadowRenders: number };
  onSlow?: () => void;
  setQuality(q: import('../../../perf/quality').QualityProfile, opts?: { resize?: boolean }): void;
  init(): Promise<this>;
  unlockAudio(): Promise<void>;
  playIntro(opts?: { lightIn?: 'fade' | 'flicker' }): unknown;
  playFolderEntrance(): boolean;
  openFolder(id: number): boolean;
  closeFolder(): boolean;
  resetDesk(): void;
  restoreDesk(opts?: { fade?: number }): void;
  pause(): void;
  resume(): void;
  setSelectedPhoto(folderId: number, index: number | null): void;
  playPhotoSelect(folderId: number, index: number): Promise<boolean>;
  setCaseReport(folderId: number, report: CaseReport | null): void;
  setPhotoStatus(folderId: number, index: number, status: { completed?: boolean }): void;
  setCaseSolved(folderId: number, fragment: string | null): void;
  onFolderOpened(cb: (id: number) => void): () => void;
  onStateChange(cb: (next: DeskState, prev: DeskState, ctx: { folderId?: number }) => void): () => void;
  onPolaroidHover(cb: (folderId: number | null, index: number | null) => void): () => void;
  onPolaroidSelect(cb: (folderId: number, index: number, pointerType?: string) => void): () => void;
  onFolderDrop(cb: (kind: 'launch' | 'land', folderId: number) => void): () => void;
  getState(): DeskState;
  setReducedMotion(v: boolean): void;
  setMuted(m: boolean): void;
  measureDrift(): number;
  dispose(): void;
}
