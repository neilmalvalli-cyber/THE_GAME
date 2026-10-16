import * as THREE from 'three';
import { gsap } from 'gsap';
import { FOLDER, SELECT } from '../config.js';

const DEG = Math.PI / 180;

/**
 * Owns the camera. Poses are {pos: Vector3, target: Vector3}.
 * A base pose is tweened; idle drift and impact shake are layered on top,
 * so they can never accumulate into the base.
 */
export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.base = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
    this.drift = 1;           // 0..1 multiplier for idle drift
    this.reducedMotion = false;
    this.shake = { amp: 0 };
    // footprint of the files on the desk (set from the layout); defaults = the original five
    this.extent = { halfW: 8.3, halfD: 4.6, cx: 0, cz: 0.3 };
    this._tween = null;
    this._lookTmp = new THREE.Vector3();
  }

  // ---- framing helpers (aspect aware) -------------------------------------

  _fitDistance(halfW, halfD, elevation) {
    const t = Math.tan((this.camera.fov * DEG) / 2);
    const projD = halfD * Math.sin(elevation);
    const dV = projD / t;
    const dH = halfW / (t * this.camera.aspect);
    return Math.max(dV, dH);
  }

  _pose(target, elevationDeg, azimuthDeg, dist) {
    const e = elevationDeg * DEG, a = azimuthDeg * DEG;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    return { pos: target.clone().addScaledVector(dir, dist), target: target.clone() };
  }

  setDeskExtent(extent) { this.extent = { ...this.extent, ...extent }; }

  /** Full desk, ~70° down, framed so every file + hover room fits (aspect aware). */
  deskPose() {
    const { halfW, halfD, cx, cz, rows = 1 } = this.extent;
    // two rows are seen a little more from above so the back row stays readable,
    // and the aim sits slightly forward so the file index at the bottom clears the front row
    const elev = rows > 1 ? 73 : 70;
    const target = new THREE.Vector3(cx, 0, cz + (rows > 1 ? 0.25 : 0));
    const d = this._fitDistance(halfW, halfD, elev * DEG) * 1.04;
    return this._pose(target, elev, 0, d);
  }

  /** Low, dark, from the side where the intro's phone sat. */
  introPose() {
    const p = this.deskPose();
    return this._pose(new THREE.Vector3(-0.6, 0.15, -0.4), 24, -18, p.pos.distanceTo(p.target) * 0.62);
  }

  /** Close on the opened spread. */
  openPose() {
    const target = new THREE.Vector3(0, SELECT.y + 0.05, SELECT.z + 0.02);
    // Push in until the open file almost fills the frame (a thin margin of desk).
    const halfW = (FOLDER.W + FOLDER.coverW + FOLDER.tabH) / 2 + 0.05;
    const elev = 78;
    const d = this._fitDistance(halfW, FOLDER.D / 2 + 0.06, elev * DEG);
    return this._pose(target, elev, 0, d);
  }

  /** Slightly pulled back from the open pose (start of closing). */
  pullbackPose() {
    const p = this.openPose();
    const dir = p.pos.clone().sub(p.target).normalize();
    return { pos: p.pos.clone().addScaledVector(dir, 1.3), target: p.target.clone() };
  }

  // ---- motion ---------------------------------------------------------------

  set(pose) {
    this.kill();
    const b = this.base;
    b.px = pose.pos.x; b.py = pose.pos.y; b.pz = pose.pos.z;
    b.tx = pose.target.x; b.ty = pose.target.y; b.tz = pose.target.z;
  }

  /** Returns a tween (add it to a timeline, or let it run). */
  to(pose, duration, ease = 'power2.inOut') {
    return gsap.to(this.base, {
      px: pose.pos.x, py: pose.pos.y, pz: pose.pos.z,
      tx: pose.target.x, ty: pose.target.y, tz: pose.target.z,
      duration: this.reducedMotion ? Math.min(duration, 0.5) : duration,
      ease,
      overwrite: 'auto',
    });
  }

  impulse(amount = 0.02) {
    if (this.reducedMotion) return;
    this.shake.amp = Math.min(0.06, this.shake.amp + amount);
    this.shake.t = 0; // restart the oscillation: every slam begins with the same downward thud
  }

  kill() { gsap.killTweensOf(this.base); }

  update(time, dt) {
    const b = this.base, cam = this.camera;
    let dx = 0, dy = 0, dz = 0;
    if (!this.reducedMotion && this.drift > 0) {
      // extremely subtle breathing; incommensurate periods so it never loops visibly
      dx = Math.sin(time * 0.21) * 0.028 + Math.sin(time * 0.53) * 0.008;
      dy = Math.sin(time * 0.17 + 1.3) * 0.02;
      dz = Math.cos(time * 0.13 + 0.4) * 0.024;
      dx *= this.drift; dy *= this.drift; dz *= this.drift;
    }
    let sx = 0, sy = 0;
    if (this.shake.amp > 0.0002) {
      // a damped oscillation, continuous from frame to frame (per-frame random offsets read as stutter):
      // the table drops under the camera first, then rings out with a slight sideways sway
      const st = (this.shake.t = (this.shake.t || 0) + dt);
      const a = this.shake.amp * 0.55;
      sy = -a * Math.cos(st * Math.PI * 2 * 10);
      sx = a * 0.45 * Math.sin(st * Math.PI * 2 * 13 + 0.6);
      this.shake.amp *= Math.pow(0.004, dt); // ~0.13 s half-life: lands crisp, settles smoothly
    } else this.shake.amp = 0;
    cam.position.set(b.px + dx + sx, b.py + dy + sy, b.pz + dz);
    this._lookTmp.set(b.tx + dx * 0.35, b.ty, b.tz + dz * 0.35);
    cam.lookAt(this._lookTmp);
  }

  /** Distance from camera to a world point (for focus pulls). */
  distanceTo(v) { return this.camera.position.distanceTo(v); }
}
