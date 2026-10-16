/**
 * Convenience store layout (meters, Y up). The player enters from the street
 * (+Z) through automatic sliding doors and walks to the counter.
 *
 *            back wall / staff shelving (z0)
 *   ┌──────────────────────────────────────┐
 *   │            [ register ]               │ F
 *   │  aisle  aisle   ════ COUNTER ════     │ R
 *   │  ║   ║  ║   ║                        │ I
 *   │  ║   ║  ║   ║                        │ D
 *   │  ║   ║  ║   ║                        │ G
 *   │                                       │ E
 *   └──────────╡ sliding doors ╞────────────┘ S
 *                   street (z1 →)
 */
export const STORE = Object.freeze({
  room: { x0: -4.0, x1: 4.0, z0: -1.95, z1: 3.0, h: 2.9 },
  door: { x: 0, w: 1.7, h: 2.2 },
  counter: { x: 0, z: -0.6, top: 0.95, w: 1.9, d: 0.7 },
  // fluorescent fixtures (ceiling grid)
  fixtures: { xs: [-2.5, 0, 2.5], zs: [-0.75, 1.0, 2.45] },
});
