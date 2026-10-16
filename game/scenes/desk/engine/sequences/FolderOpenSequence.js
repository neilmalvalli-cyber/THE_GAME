import { gsap } from 'gsap';
import { SELECT } from '../config.js';
import { HINGE_CLOSED, HINGE_OPEN } from '../scene/CaseFolder.js';

/**
 * Select → open. Phases are labelled so the scene can flip state exactly
 * when each begins:  'selecting' (0) · 'opening' · 'open'.
 */
export function buildOpenTimeline({ folder: f, env, cameraDirector: cam, audio, post, reduced, on }) {
  const tl = gsap.timeline();
  const c = f.cover;
  const sel = { x: SELECT.x, y: SELECT.y, z: SELECT.z, rx: SELECT.tiltX };

  // ---------------- SELECTING: pull the file toward you ----------------------
  tl.addLabel('selecting', 0);
  tl.call(() => { audio.lift(f.id, 0, 1.3); audio.slide(f.id + 20, 0.05, 0.5, 0.35); }, null, 0);
  tl.to(f.pose, { x: sel.x, z: sel.z, duration: 1.0, ease: 'power2.inOut' }, 0);
  tl.to(f.pose, { y: sel.y + 0.32, duration: 0.55, ease: 'power2.out' }, 0);
  tl.to(f.pose, { y: sel.y, duration: 0.5, ease: 'power2.inOut' }, 0.55);
  tl.to(f.pose, { ry: 0, rz: 0, rx: sel.rx, duration: 0.95, ease: 'power2.inOut' }, 0.04);
  tl.add(cam.to(cam.openPose(), 1.6, 'power2.inOut'), 0.08);
  tl.to(env.lampTarget.position, { x: -0.6, z: sel.z, duration: 1.5, ease: 'power2.inOut' }, 0);
  tl.to(env.levels, { ambient: 0.5, duration: 1.3, ease: 'power1.inOut' }, 0.15);
  tl.to(env.reading, { level: 1, duration: 1.5, ease: 'power1.inOut' }, 0.25);
  tl.to(post.dof, { aperture: post.dofOpen, duration: 1.4, ease: 'power1.inOut' }, 0.2);
  tl.to(cam, { drift: 0.35, duration: 1.2 }, 0);

  // ---------------- OPENING: the cover swings over the fold -----------------
  const O = 1.05;
  tl.addLabel('opening', O);
  tl.call(() => on.opening?.(), null, O);
  tl.call(() => audio.coverSwing(0, 1.05, 1), null, O);
  // lift against the stiffness of the fold to vertical...
  tl.to(c, { theta: Math.PI / 2, duration: 0.72, ease: 'sine.inOut' }, O);
  tl.to(c, { flex: 1, duration: 0.6, ease: 'power1.out' }, O);
  // ...then gravity takes it down
  tl.to(c, { theta: Math.PI, duration: 0.42, ease: 'power2.in' }, O + 0.72);
  tl.to(c, { flex: 0.4, duration: 0.42, ease: 'none' }, O + 0.72);
  // the fold flattens once the cover is past vertical
  tl.to(c, { hingeY: HINGE_OPEN, duration: 0.5, ease: 'power2.inOut' }, O + 0.62);

  const L = O + 1.14; // cover lands
  tl.set(c, { flex: 0 }, L);
  tl.call(() => audio.coverLand(0, 0.9), null, L);
  if (!reduced) {
    tl.to(c, {
      keyframes: [
        { ripple: -0.17, duration: 0.08, ease: 'power2.out' },
        { ripple: 0.07, duration: 0.15, ease: 'sine.inOut' },
        { ripple: -0.025, duration: 0.14, ease: 'sine.inOut' },
        { ripple: 0, duration: 0.2, ease: 'sine.out' },
      ],
    }, L);
    // the hand holding the file absorbs the landing
    tl.to(f.pose, { keyframes: [{ y: sel.y - 0.018, duration: 0.07, ease: 'power2.out' }, { y: sel.y, duration: 0.3, ease: 'sine.out' }] }, L);
  }
  // loose photos shift as the folder settles
  tl.add(f.polaroids.settleTimeline(audio, f.id, reduced), L - 0.04);

  tl.addLabel('open', L + 0.62);
  tl.call(() => on.open?.(), null, 'open');
  if (reduced) tl.timeScale(2.2);
  return tl;
}

/**
 * Close → return. Labels: 'closing' (0) · 'returning'.
 * Not a mirrored open: the hand lifts the cover (decelerating), it falls shut,
 * then the file is put back down with a short arc.
 */
export function buildCloseTimeline({ folder: f, env, cameraDirector: cam, audio, post, reduced, on }) {
  const tl = gsap.timeline();
  const c = f.cover, r = f.rest;

  tl.addLabel('closing', 0);
  tl.add(cam.to(cam.pullbackPose(), 0.7, 'power2.out'), 0);
  tl.call(() => audio.coverSwing(0.1, 0.8, 0.8), null, 0);
  tl.to(c, { hingeY: HINGE_CLOSED, duration: 0.45, ease: 'power2.inOut' }, 0.12);
  tl.to(c, { theta: Math.PI / 2, duration: 0.5, ease: 'sine.inOut' }, 0.12);
  tl.to(c, { flex: -0.9, duration: 0.4, ease: 'power1.out' }, 0.12);
  tl.to(c, { theta: 0, duration: 0.36, ease: 'power2.in' }, 0.62);
  tl.to(c, { flex: -0.3, duration: 0.36, ease: 'none' }, 0.62);
  const L = 0.98;
  tl.set(c, { flex: 0 }, L);
  tl.call(() => { audio.coverLand(0, 0.75); f.polaroids.pack(); }, null, L);
  if (!reduced) {
    tl.to(c, {
      keyframes: [
        { ripple: 0.1, duration: 0.07, ease: 'power2.out' },
        { ripple: 0, duration: 0.11, ease: 'power2.in' },
        { ripple: 0.025, duration: 0.08 },
        { ripple: 0, duration: 0.12 },
      ],
    }, L);
  }

  const R = L + 0.12;
  tl.addLabel('returning', R);
  tl.call(() => on.returning?.(), null, R);
  tl.to(f.pose, { x: r.x, z: r.z, duration: 1.05, ease: 'power2.inOut' }, R);
  tl.to(f.pose, { y: SELECT.y + 0.18, duration: 0.35, ease: 'power1.out' }, R);
  tl.to(f.pose, { y: r.y, duration: 0.72, ease: 'power2.inOut' }, R + 0.35);
  tl.to(f.pose, { rx: r.rx, ry: r.ry, rz: r.rz, duration: 1.0, ease: 'power2.inOut' }, R + 0.05);
  tl.add(cam.to(cam.deskPose(), 1.35, 'power2.inOut'), R - 0.05);
  tl.to(env.lampTarget.position, { x: 0.6, z: 0.5, duration: 1.3, ease: 'power2.inOut' }, R);
  tl.to(env.levels, { ambient: 1, duration: 1.1 }, R);
  tl.to(env.reading, { level: 0, duration: 1.0 }, R);
  tl.to(post.dof, { aperture: post.dofDesk, duration: 1.2 }, R);
  tl.to(cam, { drift: 1, duration: 1.2 }, R + 0.4);
  tl.call(() => audio.settle(f.id, 0, 1.1), null, R + 1.05);
  tl.call(() => { Object.assign(f.pose, f.rest); on.done?.(); }, null, R + 1.12);
  if (reduced) tl.timeScale(2.2);
  return tl;
}
