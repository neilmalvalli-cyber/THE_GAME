// The phone from the intro, as a reusable component. Same body, bezel, side buttons,
// punch-hole, glass and rim — the same classes from intro.css — so the evidence phone is
// recognisably the device that rang in the intro.
//
//   variant "intro"     the clean phone, as in the intro
//   variant "evidence"  the same phone after the night it was recovered: a cracked corner,
//                       a scratch, scuffed edges, fingerprints and one dried bloody print.
//
// The intro itself still renders its original, verbatim markup (introMarkup.ts) and is
// not affected by this component.
import { useMemo, type ReactNode } from 'react';
import '../intro/intro.css';
import './phone.css';

export const PHONE_W = 270;
export const PHONE_H = 560;

interface Props {
  variant: 'intro' | 'evidence';
  children?: ReactNode;
  /** Extra class on the outer element (animation hooks). */
  className?: string;
}

export function PhoneModel({ variant, children, className }: Props) {
  return (
    <div className={`phone-model phone-model--${variant}${className ? ` ${className}` : ''}`} style={{ width: PHONE_W, height: PHONE_H }}>
      <div className="tg-edge" />
      <div className="tg-body">
        <div className="tg-sidebtn" style={{ top: 148, height: 64 }} />
        <div className="tg-sidebtn" style={{ top: 104, height: 30, right: 'auto', left: -2 }} />
        <div className="tg-screen tg-ui">
          {children}
          <div className="tg-hole" />
          <div className="tg-glass" />
        </div>
      </div>
      <div className="tg-rim tg-rim-home" />
      {variant === 'evidence' && <PhoneDamage />}
      <div className="pm-glint" aria-hidden="true"><span /></div>
    </div>
  );
}

// ---- damage ----------------------------------------------------------------------------
// Drawn once, deterministic (seeded), in phone coordinates (270×560). Everything is
// pointer-events: none so the keypad underneath stays fully usable.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Radial cracks from an impact point near the top-right corner, with a few cross links. */
function crackPaths(seed: number) {
  const r = rng(seed);
  const ox = 238, oy = 30; // impact, upper-right corner of the glass
  const main: string[] = [];
  const fine: string[] = [];
  const spokes = 9;
  const ends: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i < spokes; i++) {
    // fan into the screen (down and to the left), never across the keypad
    const a = Math.PI * (0.52 + (i / (spokes - 1)) * 0.62) + (r() - 0.5) * 0.14;
    const len = 38 + r() * (i % 3 === 0 ? 120 : 64);
    let x = ox, y = oy, d = `M${ox.toFixed(1)} ${oy.toFixed(1)}`;
    const steps = 4 + Math.floor(r() * 3);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const ang = a + (r() - 0.5) * 0.35;
      x = ox + Math.cos(ang) * len * t;
      y = oy + Math.sin(ang) * len * t * 0.92;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    (len > 70 ? main : fine).push(d);
    ends.push({ x, y, a });
  }
  // short concentric links between neighbouring spokes (the "web")
  for (let ring = 0; ring < 2; ring++) {
    const rad = 14 + ring * 16 + r() * 4;
    for (let i = 0; i < spokes - 1; i++) {
      if (r() < 0.45) continue;
      const a1 = ends[i].a, a2 = ends[i + 1].a;
      const p1 = { x: ox + Math.cos(a1) * rad, y: oy + Math.sin(a1) * rad };
      const p2 = { x: ox + Math.cos(a2) * (rad + (r() - 0.5) * 5), y: oy + Math.sin(a2) * (rad + (r() - 0.5) * 5) };
      fine.push(`M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`);
    }
  }
  return { main, fine, ox, oy };
}

/** Fingerprint ridges: broken concentric loops around a core, slightly sheared. */
function ridgePaths(seed: number, rx: number, ry: number, count: number) {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const kx = (rx / count) * i, ky = (ry / count) * i;
    // each ridge is an ellipse arc broken into 2–4 pieces
    let a = r() * Math.PI * 2;
    const pieces = 2 + Math.floor(r() * 3);
    for (let p = 0; p < pieces; p++) {
      const span = (Math.PI * 2 / pieces) * (0.55 + r() * 0.35);
      const a2 = a + span;
      const x1 = Math.cos(a) * kx, y1 = Math.sin(a) * ky + Math.cos(a) * kx * 0.12;
      const x2 = Math.cos(a2) * kx, y2 = Math.sin(a2) * ky + Math.cos(a2) * kx * 0.12;
      out.push(`M${x1.toFixed(2)} ${y1.toFixed(2)} A${kx.toFixed(2)} ${ky.toFixed(2)} 0 ${span > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`);
      a = a2 + (Math.PI * 2 / pieces) * (0.45 - 0.35 * r());
    }
  }
  return out;
}

function Print({ x, y, rot, rx, ry, seed, className, ridges = 11 }: { x: number; y: number; rot: number; rx: number; ry: number; seed: number; className: string; ridges?: number }) {
  const d = useMemo(() => ridgePaths(seed, rx, ry, ridges).join(' '), [seed, rx, ry, ridges]);
  return (
    <g className={className} transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path d={d} />
    </g>
  );
}

function PhoneDamage() {
  const cracks = useMemo(() => crackPaths(427), []);
  return (
    <svg className="pm-damage" width={PHONE_W} height={PHONE_H} viewBox={`0 0 ${PHONE_W} ${PHONE_H}`} aria-hidden="true">
      <defs>
        <clipPath id="pm-glass"><rect x="9" y="9" width={PHONE_W - 18} height={PHONE_H - 18} rx="33" /></clipPath>
        <radialGradient id="pm-blood-fade" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="pm-blood-mask" maskUnits="userSpaceOnUse" x="-40" y="-40" width="80" height="80">
          <rect x="-40" y="-40" width="80" height="80" fill="url(#pm-blood-fade)" />
          {/* a lifted edge: part of the print never touched the glass */}
          <path d="M4 -30 C 18 -10, 22 8, 30 26 L 40 40 L 40 -40 Z" fill="#000" />
        </mask>
        <filter id="pm-blur-s"><feGaussianBlur stdDeviation=".35" /></filter>
        <filter id="pm-blur-m"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>

      {/* scuffs on the frame: worn paint at the corners and along one edge */}
      <g className="pm-scuffs">
        <path d="M14 520 C 10 530, 13 540, 22 548" />
        <path d="M18 527 C 16 534, 19 540, 25 545" />
        <path d="M262 300 L 262.5 336" />
        <path d="M262 352 L 261.6 364" />
        <path d="M232 553 C 241 551, 248 547, 254 540" />
        <path d="M8 120 L 7.6 136" />
      </g>

      <g clipPath="url(#pm-glass)">
        {/* latent prints: barely there, they catch the light when the glint passes */}
        <Print className="pm-print" x={102} y={330} rot={-24} rx={22} ry={30} seed={7} ridges={13} />
        <Print className="pm-print pm-print--faint" x={186} y={214} rot={18} rx={16} ry={22} seed={19} ridges={10} />
        <Print className="pm-print pm-print--faint" x={70} y={470} rot={-8} rx={18} ry={24} seed={31} ridges={10} />

        {/* one long scratch, diagonally across the middle */}
        <path className="pm-scratch" d="M46 286 C 92 270, 150 252, 214 232" />
        <path className="pm-scratch pm-scratch--hair" d="M52 291 C 96 276, 140 262, 176 250" />

        {/* the crack, upper-right corner: a dark side and a lit side per line */}
        <g className="pm-crack">
          <circle cx={cracks.ox} cy={cracks.oy} r="4.5" className="pm-crack__chip" />
          <g className="pm-crack__shadow" transform="translate(.6 .7)">
            {cracks.main.map((d, i) => <path key={`m${i}`} d={d} />)}
            {cracks.fine.map((d, i) => <path key={`f${i}`} d={d} />)}
          </g>
          <g className="pm-crack__lit pm-crack__lit--main">{cracks.main.map((d, i) => <path key={i} d={d} />)}</g>
          <g className="pm-crack__lit">{cracks.fine.map((d, i) => <path key={i} d={d} />)}</g>
        </g>
      </g>

      {/* dried blood: one print on the lower-left corner, half on the frame, half on the glass */}
      <g className="pm-blood" transform="translate(30 516) rotate(-32)">
        <ellipse className="pm-blood__smear" cx="2" cy="4" rx="17" ry="22" filter="url(#pm-blur-m)" />
        <g mask="url(#pm-blood-mask)">
          <Print className="pm-blood__ridges" x={0} y={0} rot={0} rx={16} ry={21} seed={53} ridges={12} />
        </g>
        <path className="pm-blood__edge" d="M-14 -6 C -16 6, -10 18, 0 22" filter="url(#pm-blur-s)" />
      </g>
    </svg>
  );
}
