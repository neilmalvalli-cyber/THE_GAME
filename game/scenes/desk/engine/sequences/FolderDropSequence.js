import { gsap } from 'gsap';
import { FOLDER, THROWS, TIMING } from '../config.js';

/**
 * The signature slam. Physically *inspired*, fully authored:
 *  flight   – horizontal momentum + gravity (power2.in on y), spin in the air,
 *             cover lifted a hair by air pressure
 *  contact  – leading corner touches first (pre-tilt), trailing edge slaps down
 *  flex     – cover flutters (only upward, never through the documents)
 *  slide    – constant kinetic friction = quadratic ease-out (power1.out)
 *  settle   – ends exactly on the stored rest transform (deterministic)
 *
 * Returns a gsap timeline; t = 0 is "table fully revealed".
 */
export function buildDropTimeline({ folders, throws = THROWS, impacts = TIMING.impacts, audio, cameraDirector, reduced = false, onLaunch = () => {}, onLand = () => {} }) {
  // Flights begin before their impact time. Folder 01 lands 0.4 s after the reveal
  // but flies for ~0.46 s, so its launch would sit at a negative time, where gsap
  // never fires it (the folder then just popped in at the end). Shift everything
  // by a lead-in; the caller starts this timeline `lead` seconds before the reveal.
  const flightOf = (i) => TIMING.flight + (i % 3) * 0.02;
  const LEAD = reduced ? 0 : Math.max(0, ...folders.map((_, i) => flightOf(i) - (impacts[i] ?? 0.4 + i * 0.35))) + 0.02;
  const tl = gsap.timeline({ data: { lead: LEAD } });
  // every file waits off-stage until its own throw begins
  tl.call(() => { for (const f of folders) f.phase = 'WAITING'; }, null, 0);

  folders.forEach((f, i) => {
    const cfg = throws[i % throws.length];
    const rest = f.rest;
    const impactAt = LEAD + (impacts[i] ?? 0.4 + i * 0.35);

    if (reduced) {
      const at = 0.15 + i * 0.12;
      tl.call(() => {
        f.resetToRest();
        f.pose.y = 0.45;
        f.group.visible = true;
        f.phase = 'ENTERING';
        onLaunch(f.id);
      }, null, at);
      tl.to(f.pose, { y: 0, duration: 0.22, ease: 'power2.in' }, at);
      tl.call(() => { audio.settle(f.id, 0, 1.6); onLand(f.id); Object.assign(f.pose, f.rest); f.phase = 'IDLE'; }, null, at + 0.22);
      return;
    }

    let [fx, fz] = cfg.from;
    const len = Math.hypot(fx, fz); fx /= len; fz /= len;
    // contact point: before the slide (travel direction is -from)
    const P = { x: rest.x + fx * cfg.slide, z: rest.z + fz * cfg.slide };
    const yawImpact = rest.ry - cfg.slideYaw;
    const [lrx, lrz] = cfg.lead;
    // origin height so the lowest corner just touches the wood when tilted
    const contactY = Math.abs((FOLDER.D / 2) * Math.sin(lrx)) + Math.abs((FOLDER.W / 2 + 0.08) * Math.sin(lrz));
    const throwDist = 4.4;
    const start = {
      x: P.x + fx * throwDist, y: 5.4 + (i % 2) * 0.5, z: P.z + fz * throwDist,
      rx: lrx * 3.2, ry: yawImpact - cfg.airSpin, rz: lrz * 3.2,
    };
    const flight = flightOf(i);
    const t0 = impactAt - flight;
    const slideDur = 0.4 + cfg.slide * 0.32;
    const c = f.cover;

    tl.call(() => {
      f.resetToRest();
      Object.assign(f.pose, start);
      f.group.visible = true;
      f.update(true);
      f.phase = 'ENTERING';
      onLaunch(f.id);
    }, null, t0);

    // flight
    tl.to(f.pose, { x: P.x, z: P.z, duration: flight, ease: 'sine.out' }, t0);
    tl.to(f.pose, { y: contactY, duration: flight, ease: 'power2.in' }, t0);
    tl.to(f.pose, { ry: yawImpact, duration: flight, ease: 'power1.out' }, t0);
    tl.to(f.pose, { rx: lrx, rz: lrz, duration: flight, ease: 'power1.inOut' }, t0);
    tl.to(c, { theta: 0.045 + (i % 2) * 0.02, duration: flight * 0.7, ease: 'power1.out' }, t0);
    tl.call(() => audio.whoosh(f.id, 0, flight * 0.8), null, t0 + flight * 0.1);

    // contact: corner first, trailing edge slaps flat
    const slap = 0.075;
    tl.to(f.pose, { y: 0, rx: 0, rz: 0, duration: slap, ease: 'power2.in' }, impactAt);
    tl.to(c, { theta: 0, duration: slap * 0.8, ease: 'power2.in' }, impactAt);
    tl.call(() => { f.phase = 'LANDING'; }, null, impactAt);
    // The weight of the landing is carried by the sound, the cover's flex and the contact
    // shadow, not by the camera: an impulse per file shook the whole view while earlier files
    // were already lying still, so the first file appeared to jitter five more times.
    tl.call(() => {
      audio.impact(f.id, 0, 0.9 + (i % 3) * 0.07);
      onLand(f.id);
    }, null, impactAt + slap * 0.7);

    // the cover flexes once (the air under it), then settles — no second flap
    tl.to(c, {
      keyframes: [
        { ripple: 0.09 + (i % 2) * 0.025, duration: 0.07, ease: 'power2.out' },
        { ripple: 0, duration: 0.34, ease: 'power3.out' },
      ],
    }, impactAt + slap);

    // slide with friction, picking up a little rotation from the impact
    const s0 = impactAt + slap * 0.6;
    tl.call(() => { f.phase = 'SETTLING'; }, null, s0);
    tl.to(f.pose, { x: rest.x, z: rest.z, duration: slideDur, ease: 'power1.out' }, s0);
    tl.to(f.pose, { ry: rest.ry, duration: slideDur * 1.05, ease: 'power2.out' }, s0);
    tl.call(() => audio.slide(f.id, 0, slideDur * 0.9, 0.8 + cfg.slide * 0.4), null, s0 + 0.01);
    tl.call(() => audio.settle(f.id, 0, 0.8), null, s0 + slideDur * 0.95);
    // lock exactly to rest (guards against any float residue)
    // lock exactly to rest; the eases above already end there, so this is imperceptible
    tl.call(() => { Object.assign(f.pose, f.rest); f.cover.ripple = 0; f.cover.theta = 0; f.phase = 'IDLE'; }, null, s0 + slideDur * 1.06);
  });

  return tl;
}
