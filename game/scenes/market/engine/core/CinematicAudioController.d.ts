export class CinematicAudioController {
  ctx: AudioContext | null;
  muted: boolean;
  unlock(): Promise<void>;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  playTwoTap(opts?: { distant?: boolean; gain?: number }): void;
  stopAll(fade?: number): void;
  dispose(): void;
}
