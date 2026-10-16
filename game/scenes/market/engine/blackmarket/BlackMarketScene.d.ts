import type { Engine } from '../core/Engine.js';
import type { CinematicAudioController } from '../core/CinematicAudioController.js';

export type MarketState =
  | 'MARKET_INACTIVE' | 'MARKET_LOADING' | 'MARKET_ENTERING' | 'DOOR_OPENING' | 'ROOM_REVEAL' | 'DEALER_INTRO'
  | 'MARKET_IDLE' | 'DEALER_VIEW' | 'VIEW_CHANGING' | 'ITEM_HOVER' | 'ITEM_SELECTING' | 'ITEM_INSPECTING'
  | 'ITEM_INSPECTED' | 'ITEM_RETURNING' | 'PURCHASE_STARTING' | 'DEALER_ACCEPTING_PAYMENT' | 'DEALER_TWO_TAP'
  | 'ITEM_DELIVERY' | 'PURCHASE_COMPLETE' | 'MARKET_EXITING';

export interface MarketItemHandle {
  id: string; title: string; transferred: boolean; root: { visible: boolean };
  restoreRest(): void; setHover(on: boolean): void;
}

export interface MarketOrigin {
  leave?: (opts?: { instant?: boolean }) => Promise<void>;
  restore?: (opts?: { transition?: string }) => Promise<void>;
}

export class BlackMarketScene {
  constructor(opts: { engine: Engine; audio: CinematicAudioController; origin?: MarketOrigin; debug?: boolean; assetBase?: string });
  ready: Promise<'glb' | 'blockout'>;
  scene: unknown;
  state: { state: MarketState; is(...s: MarketState[]): boolean; can(s: MarketState): boolean; force(s: MarketState): void; interactive: boolean; locked: boolean };
  seq: { speed: number };
  desk: { items: Map<string, MarketItemHandle> };
  inspected: MarketItemHandle | null;
  backAction: 'return' | 'dealer' | 'exit' | null;
  enterBlackMarket(): Promise<boolean>;
  skipEntrance(): Promise<boolean>;
  exitBlackMarket(): Promise<boolean>;
  forceExit(): Promise<boolean>;
  inspectMarketItem(id: string): Promise<boolean>;
  returnToMarketDesk(): Promise<boolean>;
  showDealer(): Promise<boolean>;
  showTable(): Promise<boolean>;
  goBack(): Promise<boolean>;
  playPurchaseAnimation(id: string): Promise<boolean>;
  requestPurchase(id: string, confirm: (id: string) => Promise<boolean> | boolean): Promise<boolean>;
  playDealerTwoTap(opts?: { distant?: boolean }): Promise<boolean>;
  resetBlackMarket(): boolean;
  onBlackMarketEntered(cb: () => void): () => void;
  onBlackMarketExited(cb: () => void): () => void;
  onPurchaseAnimationComplete(cb: (id: string) => void): () => void;
  onStateChange(cb: (next: MarketState, prev: MarketState, meta?: { item?: string }) => void): () => void;
  onDealerTap(cb: (i: number) => void): () => void;
  dispose(): void;
}
