// THE GAME — Detective Desk: shared dimensions, layout and timing.
// Units: 1 unit = 10 cm. The table top is the plane y = 0.

export const FOLDER = {
  W: 2.3,          // back panel: hinge (x = -W/2) to free edge
  D: 3.0,          // length along the hinge (z)
  T: 0.012,        // board thickness
  coverW: 2.18,    // front cover is slightly shorter so the back tab shows
  gusset: 0.052,   // closed height of the fold (room for the documents)
  tabW: 0.82,      // tab length along z
  tabH: 0.24,      // how far the tab sticks out past the back panel
};

export const TABLE = { W: 34, D: 22, thickness: 0.7 };

// Deterministic resting transforms. Folders are thrown by authored trajectories
// that always finish exactly here, so hit-testing and returns never drift.
// tabZ: where the tab is cut along the edge (third-cut folders).
export const LAYOUT = [
  { id: 1, x: -5.55, z: -0.42, yaw:  0.17, tabZ: -0.95 },
  { id: 2, x: -2.78, z:  0.50, yaw: -0.09, tabZ:  0.00 },
  { id: 3, x:  0.02, z: -0.34, yaw:  0.06, tabZ:  0.95 },
  { id: 4, x:  2.82, z:  0.44, yaw: -0.15, tabZ: -0.95 },
  { id: 5, x:  5.62, z: -0.38, yaw:  0.21, tabZ:  0.00 },
];

// Per-folder throw: direction it comes from (xz, normalised in code),
// slide length after contact, spin in the air, yaw added by the slide,
// leading-edge tilt at contact (rx, rz) and cover corner curl.
export const THROWS = [
  { from: [-0.78, 0.62], slide: 0.62, airSpin: -0.55, slideYaw: 0.16, lead: [ 0.07, -0.10], curl: 0.035, curlCorner: 1 },
  { from: [ 0.22, 0.97], slide: 0.48, airSpin:  0.42, slideYaw: -0.11, lead: [-0.09,  0.05], curl: 0.022, curlCorner: -1 },
  { from: [-0.30, 0.95], slide: 0.70, airSpin:  0.30, slideYaw: 0.09, lead: [-0.10, -0.04], curl: 0.03, curlCorner: 1 },
  { from: [ 0.62, 0.78], slide: 0.55, airSpin: -0.38, slideYaw: -0.14, lead: [-0.06,  0.09], curl: 0.026, curlCorner: -1 },
  { from: [ 0.86, 0.50], slide: 0.66, airSpin:  0.62, slideYaw: 0.18, lead: [ 0.05,  0.11], curl: 0.04, curlCorner: 1 },
];

// ---------------------------------------------------------------------------
// Data-driven desk: everything below is derived from the number of cases, so
// adding a case means adding a data entry, not touching animation code.
// Five cases reproduce the original single-row arrangement exactly.
// ---------------------------------------------------------------------------

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Resting transforms for `count` files. Up to five sit in one loose row; more are
 * split into a back row and a front row, staggered, each file with its own small
 * angle and offset — files dropped on a desk, not a grid.
 */
export function buildLayout(count) {
  if (count === LAYOUT.length) return LAYOUT.map((l) => ({ ...l }));
  const r = seeded(4242 + count);
  const rows = count <= 5 ? 1 : 2;
  const perRow = Math.ceil(count / rows);
  const yaws = [0.13, -0.09, 0.16, -0.14, 0.07, -0.17, 0.11, -0.06];
  const tabs = [-0.95, 0, 0.95];
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = rows === 1 ? 0 : Math.floor(i / perRow);
    const inRow = rows === 1 ? count : (row === 0 ? perRow : count - perRow);
    const k = rows === 1 ? i : i - row * perRow;
    const spacing = rows === 1 ? 2.8 : 3.4;
    const rowShift = rows === 1 ? 0 : row === 0 ? -0.28 : 0.42;   // the front row sits a little to the right
    const rowZ = rows === 1 ? 0 : row === 0 ? -1.95 : 1.78;        // back row / front row
    out.push({
      id: i + 1,
      x: (k - (inRow - 1) / 2) * spacing + rowShift + (r() - 0.5) * 0.26,
      z: rowZ + (r() - 0.5) * 0.3 + (k % 2 ? 0.1 : -0.06),
      yaw: yaws[i % yaws.length] + (r() - 0.5) * 0.04,
      tabZ: tabs[i % tabs.length],
    });
  }
  return out;
}

/** Throw parameters per file: the authored five, then seeded variations in the same ranges. */
export function buildThrows(count) {
  const r = seeded(9001);
  return Array.from({ length: count }, (_, i) => {
    const base = THROWS[i] ?? {
      from: [(r() - 0.5) * 1.6, 0.6 + r() * 0.4], slide: 0.5 + r() * 0.2, airSpin: (r() - 0.5) * 1.2,
      slideYaw: (r() - 0.5) * 0.3, lead: [(r() - 0.5) * 0.18, (r() - 0.5) * 0.2], curl: 0.022 + r() * 0.018, curlCorner: i % 2 ? -1 : 1,
    };
    // a short, settled slide after contact (a few centimetres), not a skid
    return { ...base, slide: base.slide * 0.5 };
  });
}

/** Contact times after the table is revealed: one file every ~0.32 s. */
export function impactTimes(count) {
  return Array.from({ length: count }, (_, i) => 0.4 + i * 0.32);
}

/** Footprint of a layout (for camera framing): half extents + centre. */
export function layoutExtent(layout) {
  const reach = Math.hypot(FOLDER.W / 2 + FOLDER.tabH, FOLDER.D / 2);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const l of layout) { x0 = Math.min(x0, l.x); x1 = Math.max(x1, l.x); z0 = Math.min(z0, l.z); z1 = Math.max(z1, l.z); }
  const rows = z1 - z0 > FOLDER.D ? 2 : 1;
  // depth margin covers the hover lift (files rise toward the camera) and the top bar
  return { halfW: (x1 - x0) / 2 + reach + 0.5, halfD: (z1 - z0) / 2 + FOLDER.D / 2 + 1.15, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rows };
}

export const TIMING = {
  introFade: 1.7,
  introCamera: 2.9,
  impacts: [0.4, 0.75, 1.1, 1.45, 1.8], // seconds after the table is fully revealed
  flight: 0.46,
  hoverIn: 0.34,
  hoverOut: 0.3,
};

// Hover offsets (added to the rest pose).
export const HOVER = { lift: 0.36, forward: 0.24, tilt: 0.08 };

// Where the selected folder is held while open (world space).
// The opened spread spans local x ∈ [-W/2 - coverW, W/2 + tabH]; shift so it is centred.
export const SELECT = {
  y: 0.9,
  tiltX: 0.09,
  get x() { return -((-FOLDER.W / 2 - FOLDER.coverW) + (FOLDER.W / 2 + FOLDER.tabH)) / 2; },
  z: 0.25,
};

export const STATES = Object.freeze({
  INTRO_TRANSITION: 'INTRO_TRANSITION',
  FOLDERS_DROPPING: 'FOLDERS_DROPPING',
  DESK_IDLE: 'DESK_IDLE',
  FOLDER_HOVER: 'FOLDER_HOVER',
  FOLDER_SELECTING: 'FOLDER_SELECTING',
  FOLDER_OPENING: 'FOLDER_OPENING',
  FOLDER_OPEN: 'FOLDER_OPEN',
  FOLDER_CLOSING: 'FOLDER_CLOSING',
  FOLDER_RETURNING: 'FOLDER_RETURNING',
});
