// ONE item catalogue for both markets. The Normal Market (the store) and the Black Market
// sell the same power-ups; they differ in price, availability and atmosphere.
//
// PLACEHOLDERS: the final power-up list, prices and limits are not decided yet. Edit
// CATALOG only — everything else (pages, scenes, wallet) reads these views.
export type MarketKind = 'normal' | 'black';

export type EffectType =
  | 'skip-level' | 'block-sabotage' | 'glitch-rival' | 'freeze-rival' | 'powerful-hint'
  | 'double-minigame-coins' | 'bundle' | 'skip-case';

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  /** Rules shown on the item card. */
  rules?: string[];
  rarity?: 'common' | 'rare' | 'legendary';
  normalPrice: number;
  /** Omit to use the configured Black Market discount. */
  blackPrice?: number;
  availability: { normal: boolean; black: boolean };
  /** Units a team may buy, per market. */
  limit: { normal: number; black: number };
  effect: EffectType;
  /** For bundles: the item ids the team receives. */
  contains?: string[];
  /** The 3D model that represents it in each scene. */
  asset: { normal?: string; black?: string };
}

/** Black Market discount on the normal price (0.25 = 25 % off), rounded down. Used when no blackPrice is set. */
export const BLACK_MARKET_DISCOUNT = 0.25;

/** Coins a new team starts with. */
export const STARTING_COINS = 100;

export const CATALOG: CatalogItem[] = [
  { id: 'skip_token', name: 'Skip Token', normalPrice: 60, availability: { normal: true, black: true }, limit: { normal: 2, black: 2 }, effect: 'skip-level',
    asset: { normal: 'second_chance', black: 'second_chance' },
    description: 'Skip one level in a case. No normal solve points for the skipped level, but you can keep progressing.' },
  { id: 'firewall', name: 'Firewall', normalPrice: 30, blackPrice: 22, availability: { normal: true, black: true }, limit: { normal: 3, black: 3 }, effect: 'block-sabotage',
    asset: { normal: 'blackout_shield', black: 'blackout_shield' },
    description: 'Blocks one incoming sabotage effect. The shield is used up when it blocks an attack.' },
  { id: 'glitch_attack', name: 'Glitch Attack', normalPrice: 45, availability: { normal: true, black: true }, limit: { normal: 2, black: 2 }, effect: 'glitch-rival',
    asset: { normal: 'glitch_pack', black: 'knife' },
    description: 'Disrupts a rival team’s interface for 60 seconds with a visual glitch. It never stops them solving or submitting.' },
  { id: 'freeze', name: 'Freeze', normalPrice: 60, blackPrice: 45, availability: { normal: true, black: true }, limit: { normal: 2, black: 2 }, effect: 'freeze-rival',
    asset: { normal: 'deep_scan', black: 'deep_scan' },
    description: 'Pauses a rival team’s competitive progress timer for 60 seconds. Their dashboard stays usable and their clues stay open.' },
  { id: 'powerful_hint', name: 'Powerful Hint', normalPrice: 40, blackPrice: 30, availability: { normal: true, black: true }, limit: { normal: 3, black: 3 }, effect: 'powerful-hint',
    asset: { normal: 'hint_drop', black: 'hint_drop' },
    description: 'Reveals a substantial clue about your current level — the cipher type, the part of an image that matters, the likely method. Never the answer itself.' },
  { id: 'overclock', name: 'Overclock', normalPrice: 35, availability: { normal: true, black: true }, limit: { normal: 2, black: 2 }, effect: 'double-minigame-coins',
    asset: { normal: 'overclock_pack', black: 'overclock' },
    description: 'Doubles the coin reward from your next eligible mini-game if you complete it. Does not double case-completion rewards.' },
  { id: 'blackout_bundle', name: 'Blackout Bundle', normalPrice: 75, blackPrice: 55, availability: { normal: false, black: true }, limit: { normal: 0, black: 1 }, effect: 'bundle',
    contains: ['glitch_attack', 'firewall'], asset: { black: 'bundle' },
    description: 'One Glitch Attack plus one Firewall.' },
  { id: 'master_key', name: 'Master Key', normalPrice: 450, blackPrice: 450, rarity: 'legendary', availability: { normal: false, black: true }, limit: { normal: 0, black: 1 }, effect: 'skip-case',
    asset: { black: 'master_key' },
    description: 'Instantly skips an entire case file and unlocks its hidden number fragment, bypassing every remaining level in that case.',
    rules: ['The case is marked as completed.', 'Its number fragment is revealed immediately.', 'No normal challenge-completion points are awarded for skipped levels.', 'Cannot be used on an already completed case.', 'Maximum one use per team.', 'Obtainable through exceptionally difficult surprise challenges or rare Black Market appearances.'] },
];

export function priceIn(item: CatalogItem, market: MarketKind): number {
  if (market === 'normal') return item.normalPrice;
  return item.blackPrice ?? Math.floor(item.normalPrice * (1 - BLACK_MARKET_DISCOUNT));
}

// ---- per-market views (what pages, scenes and the wallet use) ------------------------
export interface MarketItemDef {
  /** Purchase key: the catalogue id in the Black Market, `store_<id>` in the store. */
  id: string;
  /** The catalogue / scene id. */
  sceneId: string;
  name: string;
  price: number;
  /** The normal price (shown struck through in the Black Market). */
  listPrice: number;
  stock: number;
  description: string;
  ledgerLabel: string;
  /** The catalogue id (power-up kind) — what the team owns after buying. */
  catalogId: string;
  rarity?: CatalogItem['rarity'];
  rules?: string[];
}

/** Purchase key for an item in a market (keeps per-market stock apart). */
export const purchaseKey = (id: string, market: MarketKind) => (market === 'normal' ? `store_${id}` : id);

function view(item: CatalogItem, market: MarketKind): MarketItemDef {
  return {
    id: purchaseKey(item.id, market),
    sceneId: item.asset[market] ?? item.id,
    catalogId: item.id,
    rarity: item.rarity,
    rules: item.rules,
    name: item.name,
    price: priceIn(item, market),
    listPrice: item.normalPrice,
    stock: item.limit[market],
    description: item.description,
    ledgerLabel: `${item.name} purchased${market === 'normal' ? ' (Market)' : ' (Black Market)'}`,
  };
}

export const NORMAL_MARKET_ITEMS: MarketItemDef[] = CATALOG.filter((i) => i.availability.normal && i.asset.normal).map((i) => view(i, 'normal'));
export const BLACK_MARKET_ITEMS: MarketItemDef[] = CATALOG.filter((i) => i.availability.black && i.asset.black).map((i) => view(i, 'black'));
/** @deprecated use BLACK_MARKET_ITEMS */
export const MARKET_ITEMS = BLACK_MARKET_ITEMS;

export function catalogFor(market: MarketKind): MarketItemDef[] {
  return market === 'normal' ? NORMAL_MARKET_ITEMS : BLACK_MARKET_ITEMS;
}

/** Look up by purchase key (or catalogue id) in one market, or in both. */
export const getCatalogItem = (id: string) => CATALOG.find((i) => i.id === id);

export function getMarketItem(id: string, market?: MarketKind): MarketItemDef | undefined {
  const lists = market ? [catalogFor(market)] : [BLACK_MARKET_ITEMS, NORMAL_MARKET_ITEMS];
  for (const l of lists) { const it = l.find((i) => i.id === id || (market && i.sceneId === id)); if (it) return it; }
  return undefined;
}
