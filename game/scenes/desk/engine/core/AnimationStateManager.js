import { STATES as S } from '../config.js';

// Only these transitions are legal. Anything else is rejected (and logged in dev),
// which is what makes rapid clicking harmless.
const TRANSITIONS = {
  [S.INTRO_TRANSITION]: [S.FOLDERS_DROPPING],
  [S.FOLDERS_DROPPING]: [S.DESK_IDLE],
  [S.DESK_IDLE]: [S.FOLDER_HOVER, S.FOLDER_SELECTING, S.FOLDERS_DROPPING],
  [S.FOLDER_HOVER]: [S.DESK_IDLE, S.FOLDER_HOVER, S.FOLDER_SELECTING, S.FOLDERS_DROPPING],
  [S.FOLDER_SELECTING]: [S.FOLDER_OPENING],
  [S.FOLDER_OPENING]: [S.FOLDER_OPEN],
  [S.FOLDER_OPEN]: [S.FOLDER_CLOSING],
  [S.FOLDER_CLOSING]: [S.FOLDER_RETURNING],
  [S.FOLDER_RETURNING]: [S.DESK_IDLE],
};

export class AnimationStateManager {
  constructor(initial = S.INTRO_TRANSITION) {
    this.state = initial;
    this.context = {};
    this._listeners = new Set();
  }

  can(next) {
    return (TRANSITIONS[this.state] || []).includes(next);
  }

  is(...states) {
    return states.includes(this.state);
  }

  /** Attempt a legal transition. Returns false (and does nothing) if illegal. */
  transition(next, context = {}) {
    if (!this.can(next)) {
      if (process.env.NODE_ENV !== 'production') console.debug(`[state] rejected ${this.state} → ${next}`);
      return false;
    }
    this._set(next, context);
    return true;
  }

  /** Hard reset path (resetDesk / replay intro). Bypasses the table on purpose. */
  force(next, context = {}) {
    this._set(next, context);
  }

  _set(next, context) {
    const prev = this.state;
    this.state = next;
    this.context = { ...context };
    for (const fn of this._listeners) fn(next, prev, this.context);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
