import type { Engine } from '../core/Engine.js';
import type { CinematicAudioController } from '../core/CinematicAudioController.js';
import type { MarketState, MarketItemHandle, MarketOrigin } from '../blackmarket/BlackMarketScene.js';

export class StoreScene {
  constructor(opts: { engine: Engine; audio: CinematicAudioController; origin?: MarketOrigin; debug?: boolean });
  ready: Promise<'store'>;
  scene: unknown;
  kind: 'store';
  closed: boolean;
  isSoldOut: ((sceneItemId: string) => boolean) | null;
  state: { state: MarketState; is(...s: MarketState[]): boolean; can(s: MarketState): boolean; force(s: MarketState): void; interactive: boolean; locked: boolean };
  seq: { speed: number };
  desk: { items: Map<string, MarketItemHandle> };
  inspected: MarketItemHandle | null;
  backAction: 'return' | 'dealer' | 'exit' | null;
  enterStore(): Promise<boolean>;
  skipEntrance(): Promise<boolean>;
  exitStore(): Promise<boolean>;
  forceExit(): Promise<boolean>;
  setClosed(closed: boolean): Promise<boolean>;
  inspectMarketItem(id: string): Promise<boolean>;
  returnToMarketDesk(): Promise<boolean>;
  showDealer(): Promise<boolean>;
  showTable(): Promise<boolean>;
  goBack(): Promise<boolean>;
  playPurchaseAnimation(id: string): Promise<boolean>;
  requestPurchase(id: string, confirm: (id: string) => Promise<boolean> | boolean): Promise<boolean>;
  resetStore(): boolean;
  onStoreEntered(cb: () => void): () => void;
  onStoreExited(cb: () => void): () => void;
  onPurchaseAnimationComplete(cb: (id: string) => void): () => void;
  onStateChange(cb: (next: MarketState, prev: MarketState, meta?: { item?: string }) => void): () => void;
  dispose(): void;
}
