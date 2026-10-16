/**
 * World layout of the Black Market, in meters. Y is up.
 * The dealer sits behind the desk facing +Z; the player stands on the +Z side.
 * The entrance door is in the right-hand wall (+X), reached by a corridor.
 *
 *        back wall (z0)
 *   ┌───────────────────────┐
 *   │  shelves      shelves │
 *   │        [dealer]       │
 *   │       ┌───────┐       │
 *   │       │ desk  │  lamp │      corridor ──────────► (x1)
 *   │       └───────┘       ╞═door══════════════════
 *   │        (player)       │
 *   └───────────────────────┘
 *        front wall (z1)
 */
export const LAYOUT = Object.freeze({
  room: { x0: -2.6, x1: 2.6, z0: -2.8, z1: 2.2, h: 2.7 },
  door: { x: 2.6, z: 1.25, w: 0.95, h: 2.05 },
  corridor: { x0: 2.6, x1: 8.4, w: 1.5, h: 2.4 },
  desk: { x: 0, z: -0.6, top: 0.76, w: 1.7, d: 0.8 },
  lamp: { x: 0, y: 2.05, z: -0.4, angle: 0.56, penumbra: 0.55, intensity: 30, bounce: 0.5, aimX: 0, aimZ: 0.06 },
  dealer: { x: 0, z: -1.3, seatHeight: 0.47 },
});
