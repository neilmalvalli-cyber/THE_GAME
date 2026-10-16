/**
 * BlackMarketStateManager
 * -----------------------
 * A strict finite-state machine. Every animation in the Black Market asks this
 * object for permission before it starts. Invalid transitions are rejected
 * (and logged in dev), which is what makes rapid clicking harmless: a second
 * click simply fails the `can()` check instead of starting a competing timeline.
 */

export const S = Object.freeze({
  MARKET_INACTIVE: 'MARKET_INACTIVE', // not in the market (player is at the desk)
  MARKET_LOADING: 'MARKET_LOADING',
  MARKET_ENTERING: 'MARKET_ENTERING',
  DOOR_OPENING: 'DOOR_OPENING',
  ROOM_REVEAL: 'ROOM_REVEAL',
  DEALER_INTRO: 'DEALER_INTRO',
  MARKET_IDLE: 'MARKET_IDLE',         // looking at the table (items pickable)
  DEALER_VIEW: 'DEALER_VIEW',         // pulled back: the dealer sitting behind his desk
  VIEW_CHANGING: 'VIEW_CHANGING',     // camera moving between the two views
  ITEM_HOVER: 'ITEM_HOVER',
  ITEM_SELECTING: 'ITEM_SELECTING',
  ITEM_INSPECTING: 'ITEM_INSPECTING',
  ITEM_INSPECTED: 'ITEM_INSPECTED',
  ITEM_RETURNING: 'ITEM_RETURNING',
  PURCHASE_STARTING: 'PURCHASE_STARTING',
  DEALER_ACCEPTING_PAYMENT: 'DEALER_ACCEPTING_PAYMENT',
  DEALER_TWO_TAP: 'DEALER_TWO_TAP',
  ITEM_DELIVERY: 'ITEM_DELIVERY',
  PURCHASE_COMPLETE: 'PURCHASE_COMPLETE',
  MARKET_EXITING: 'MARKET_EXITING',
});

const T = {
  [S.MARKET_INACTIVE]: [S.MARKET_LOADING],
  [S.MARKET_LOADING]: [S.MARKET_ENTERING, S.MARKET_INACTIVE],
  [S.MARKET_ENTERING]: [S.DOOR_OPENING],
  [S.DOOR_OPENING]: [S.ROOM_REVEAL],
  [S.ROOM_REVEAL]: [S.DEALER_INTRO],
  [S.DEALER_INTRO]: [S.MARKET_IDLE],
  [S.MARKET_IDLE]: [S.ITEM_HOVER, S.ITEM_SELECTING, S.PURCHASE_STARTING, S.DEALER_TWO_TAP, S.VIEW_CHANGING, S.MARKET_EXITING],
  [S.ITEM_HOVER]: [S.MARKET_IDLE, S.ITEM_HOVER, S.ITEM_SELECTING, S.PURCHASE_STARTING, S.VIEW_CHANGING, S.MARKET_EXITING],
  [S.VIEW_CHANGING]: [S.DEALER_VIEW, S.MARKET_IDLE],
  [S.DEALER_VIEW]: [S.VIEW_CHANGING, S.MARKET_EXITING],
  [S.ITEM_SELECTING]: [S.ITEM_INSPECTING],
  [S.ITEM_INSPECTING]: [S.ITEM_INSPECTED],
  [S.ITEM_INSPECTED]: [S.ITEM_RETURNING, S.PURCHASE_STARTING, S.MARKET_EXITING],
  [S.ITEM_RETURNING]: [S.MARKET_IDLE],
  [S.PURCHASE_STARTING]: [S.DEALER_ACCEPTING_PAYMENT],
  [S.DEALER_ACCEPTING_PAYMENT]: [S.DEALER_TWO_TAP],
  [S.DEALER_TWO_TAP]: [S.ITEM_DELIVERY, S.MARKET_IDLE],
  [S.ITEM_DELIVERY]: [S.PURCHASE_COMPLETE],
  [S.PURCHASE_COMPLETE]: [S.MARKET_IDLE],
  [S.MARKET_EXITING]: [S.MARKET_INACTIVE],
};

/** States in which the room accepts pointer input on merchandise. */
export const INTERACTIVE = new Set([S.MARKET_IDLE, S.ITEM_HOVER]);
/** States in which nothing else may start (a cinematic owns the scene). */
export const LOCKED = new Set([
  S.MARKET_LOADING, S.MARKET_ENTERING, S.DOOR_OPENING, S.ROOM_REVEAL, S.DEALER_INTRO,
  S.ITEM_SELECTING, S.ITEM_INSPECTING, S.ITEM_RETURNING, S.VIEW_CHANGING,
  S.PURCHASE_STARTING, S.DEALER_ACCEPTING_PAYMENT, S.DEALER_TWO_TAP, S.ITEM_DELIVERY,
  S.PURCHASE_COMPLETE, S.MARKET_EXITING,
]);

export class BlackMarketStateManager {
  constructor({ debug = false } = {}) {
    this.state = S.MARKET_INACTIVE;
    this.debug = debug;
    this.listeners = new Set();
    this.history = [];
  }

  can(next) {
    return (T[this.state] || []).includes(next);
  }

  /** Attempt a transition. Returns true on success, false if it was rejected. */
  to(next, meta) {
    if (!this.can(next)) {
      if (this.debug) console.warn(`[BlackMarket] rejected ${this.state} → ${next}`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    this.history.push({ from: prev, to: next, t: performance.now() });
    if (this.history.length > 64) this.history.shift();
    for (const fn of this.listeners) fn(next, prev, meta);
    return true;
  }

  /** Dev-only hard reset (used by resetBlackMarket / skip entrance). */
  force(next) {
    const prev = this.state;
    this.state = next;
    for (const fn of this.listeners) fn(next, prev, { forced: true });
  }

  is(...states) {
    return states.includes(this.state);
  }

  get interactive() {
    return INTERACTIVE.has(this.state);
  }

  get locked() {
    return LOCKED.has(this.state);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.listeners.clear();
  }
}
