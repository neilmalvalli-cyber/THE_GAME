// Animation / scene state. Not persisted, never mixed with game data.
// Only state-machine transitions land here (a handful per second at most);
// per-frame values stay inside the scene engines.
import { create } from 'zustand';
import type { DeskState } from '../scenes/desk/engine/DetectiveDeskScene.js';
import type { MarketState } from '../scenes/market/engine/blackmarket/BlackMarketScene.js';

export type IntroPhase = 'idle' | 'gate' | 'playing' | 'completed';
export type DeskPhase = 'unloaded' | 'loading' | 'ready' | 'revealing' | 'revealed' | 'error';

export interface SceneState {
  introPhase: IntroPhase;
  /** Set when the intro hands over: the desk reveals with the light flicker. */
  pendingFlicker: boolean;
  deskPhase: DeskPhase;
  deskError: string | null;
  deskState: DeskState | null;
  deskOpenId: number | null;
  /** A Polaroid pick-up is playing (navigation follows it). */
  photoSelecting: boolean;
  marketLoaded: boolean;
  marketState: MarketState;
  /** Hovered / inspected item in the market. */
  marketItem: string | null;
  /** The convenience store (Normal Market) — same state names as the Black Market. */
  shopLoaded: boolean;
  shopState: MarketState;
  /** Normal Market catalogue id of the hovered / inspected product. */
  shopItem: string | null;
  set(patch: Partial<SceneState>): void;
}

export const useSceneStore = create<SceneState>()((set) => ({
  introPhase: 'idle',
  pendingFlicker: false,
  deskPhase: 'unloaded',
  deskError: null,
  deskState: null,
  deskOpenId: null,
  photoSelecting: false,
  marketLoaded: false,
  marketState: 'MARKET_INACTIVE',
  marketItem: null,
  shopLoaded: false,
  shopState: 'MARKET_INACTIVE',
  shopItem: null,
  set: (patch) => set(patch),
}));

const DESK_BUSY: ReadonlySet<string> = new Set(['INTRO_TRANSITION', 'FOLDERS_DROPPING', 'FOLDER_SELECTING', 'FOLDER_OPENING', 'FOLDER_CLOSING', 'FOLDER_RETURNING']);
const MARKET_CALM: ReadonlySet<string> = new Set(['MARKET_INACTIVE', 'MARKET_IDLE', 'ITEM_HOVER', 'DEALER_VIEW', 'ITEM_INSPECTED']);

/** True while an important cinematic owns the screen (notifications wait). */
export function isCinematicBusy(s: SceneState): boolean {
  if (s.introPhase === 'playing') return true;
  if (s.deskPhase === 'revealing') return true;
  if (s.deskPhase === 'revealed' && s.deskState && DESK_BUSY.has(s.deskState)) return true;
  if (s.photoSelecting) return true;
  if (!MARKET_CALM.has(s.marketState)) return true;
  if (!MARKET_CALM.has(s.shopState)) return true;
  return false;
}

export function isMarketPurchasing(s: MarketState): boolean {
  return s === 'PURCHASE_STARTING' || s === 'DEALER_ACCEPTING_PAYMENT' || s === 'DEALER_TWO_TAP' || s === 'ITEM_DELIVERY' || s === 'PURCHASE_COMPLETE';
}
