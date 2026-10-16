// Mock team identity — the single place to change the prototype team.
export const MOCK_TEAM = {
  id: 'TEAM-001',
  name: 'TEAM ALPHA',
  /** Coins a new team starts with (STARTING_COINS in data/market.ts). */
  startingBalance: 100,
} as const;

export const CURRENCY = 'coins';
