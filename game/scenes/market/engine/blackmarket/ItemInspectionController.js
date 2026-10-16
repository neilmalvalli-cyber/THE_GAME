import * as THREE from 'three';
import gsap from 'gsap';

/**
 * ItemInspectionController
 * ------------------------
 * Selection → presentation → hold → return, per item.
 * The item's root travels in world space (desk "stage" group); item-specific
 * flourishes (spin, tilt, lifting the magnifier off the page) live on the
 * item's `present` group / its own parts. Return tweens target the exact
 * rest transform and finish with an assignment, so cycles never drift.
 */

const top = (desk) => desk.top;

/** Authored inspection choreography per item. */
function presets(desk) {
  const T = top(desk);
  return {
    hint_drop: {
      stage: { pos: [-0.02, T + 0.07, -0.25], rot: [0.62, 0.2, 0.0] },
      present: (tl, item) => {
        tl.to(item.present.rotation, { y: -0.12, duration: 1.4, ease: 'sine.inOut' }, '<0.2');
      },
      sound: 'paperSlide',
    },
    deep_scan: {
      stage: { pos: [-0.03, T + 0.075, -0.26], rot: [0.38, 0.05, 0.0] },
      present: (tl, item) => {
        const glass = item.model.userData.parts.glass;
        tl.to(glass.position, { y: 0.055, x: 0.0, z: 0.03, duration: 1.0, ease: 'power2.inOut' }, '<0.25');
        tl.to(glass.rotation, { x: 0.32, z: -0.12, y: 0.4, duration: 1.0, ease: 'power2.inOut' }, '<');
      },
      sound: 'paperSlide',
    },
    second_chance: {
      stage: { pos: [0.0, T + 0.07, -0.25], rot: [0.95, 0.0, 0.0] },
      present: (tl, item) => {
        // a slow spin around its own axis that settles with the arrow upright
        tl.fromTo(item.present.rotation, { y: 0 }, { y: Math.PI * 2 - 0.6, duration: 1.6, ease: 'power2.out' }, '<');
      },
      sound: 'tokenSlide',
      settleSound: 'tokenClink',
    },
    master_key: {
      // lifted toward the lamp; a slow turn lets the gems catch the light
      stage: { pos: [0.0, T + 0.075, -0.25], rot: [0.75, 0.2, 0.0] },
      present: (tl, item) => {
        tl.to(item.present.rotation, { y: -0.3, duration: 1.8, ease: 'sine.inOut' }, '<0.2');
        tl.to(item.present.rotation, { z: 0.08, duration: 1.2, ease: 'sine.inOut' }, '<0.3');
      },
      sound: 'tokenSlide',
      settleSound: 'tokenClink',
    },
    overclock: {
      stage: { pos: [0.0, T + 0.07, -0.25], rot: [0.85, -0.1, 0.0] },
      present: (tl, item) => { tl.to(item.present.rotation, { y: 0.2, duration: 1.4, ease: 'sine.inOut' }, '<0.2'); },
      sound: 'paperSlide',
      settleSound: 'tokenClink',
    },
    bundle: {
      stage: { pos: [0.0, T + 0.065, -0.26], rot: [0.55, 0.15, 0.0] },
      present: (tl, item) => { tl.to(item.present.rotation, { y: -0.25, duration: 1.5, ease: 'sine.inOut' }, '<0.2'); },
      sound: 'paperSlide',
      settleSound: 'woodContact',
    },
    revolver: {
      // picked up and turned toward the light so the cylinder and grip read
      stage: { pos: [0.0, T + 0.075, -0.25], rot: [0.55, 0.15, 0.0] },
      present: (tl, item) => {
        tl.to(item.present.rotation, { y: -0.35, duration: 1.6, ease: 'sine.inOut' }, '<0.2');
        tl.to(item.present.rotation, { z: 0.06, duration: 1.2, ease: 'sine.inOut' }, '<0.3');
      },
      sound: 'tokenSlide',
      settleSound: 'woodContact',
    },
    knife: {
      // a slow roll lets a highlight run along the edge of the blade
      stage: { pos: [0.0, T + 0.07, -0.25], rot: [0.6, -0.25, 0.0] },
      present: (tl, item) => {
        tl.fromTo(item.present.rotation, { x: 0.15 }, { x: -0.18, duration: 1.4, ease: 'sine.inOut' }, '<0.25');
        tl.to(item.present.rotation, { x: -0.08, y: 0.18, duration: 1.0, ease: 'sine.inOut' });
      },
      sound: 'tokenSlide',
      settleSound: 'tokenClink',
    },
    blackout_shield: {
      stage: { pos: [0.02, T + 0.07, -0.25], rot: [0.6, -0.12, 0.0] },
      present: (tl, item) => {
        // tilt sweeps the lamp's highlight across the face, then rests where it glints
        tl.to(item.present.rotation, { x: -0.22, duration: 0.7, ease: 'sine.inOut' }, '<0.4');
        tl.to(item.present.rotation, { x: -0.12, z: 0.05, duration: 0.9, ease: 'sine.inOut' });
      },
      sound: 'tokenSlide',
    },
  };
}

export class ItemInspectionController {
  /**
   * @param presets optional (desk) => ({ [itemId]: { stage, present, sound, settleSound } })
   *        — lets other environments (the convenience store) author their own moves
   * @param softLight item ids that get a softer attention light (shiny materials)
   * @param restingShot camera shot to return to after putting an item back
   */
  constructor({ desk, stage, director, room, audio, presets: presetsFn, softLight, restingShot = 'desk' }) {
    this.desk = desk;
    this.stage = stage; // world-space group for travelling items
    this.director = director;
    this.room = room;
    this.audio = audio;
    this.presets = (presetsFn || presets)(desk);
    this.softLight = new Set(softLight || ['revolver', 'knife', 'second_chance', 'blackout_shield', 'master_key']);
    this.restingShot = restingShot;
    this.active = null;
    // remember magnifier part rest pose
    const mag = desk.items.get('deep_scan');
    const g = mag?.model.userData.parts?.glass;
    if (g && !mag.model.userData.noGlassAnim) {
      this._glassRest = { pos: g.position.clone(), rot: g.rotation.clone() };
      mag.model.userData.reset = () => { g.position.copy(this._glassRest.pos); g.rotation.copy(this._glassRest.rot); };
    }
  }

  inspectShot(item) {
    const p = this.presets[item.id].stage.pos;
    const T = new THREE.Vector3(...p);
    // item sits in the left-centre of frame; the right side is kept empty for UI
    return {
      pos: T.clone().add(new THREE.Vector3(-0.075, 0.3, 0.37)),
      look: T.clone().add(new THREE.Vector3(0.078, 0.0, -0.01)),
    };
  }

  /** Returns a timeline: SELECTING (first 0.35 s) then INSPECTING. */
  inspect(item, { onSelected } = {}) {
    const P = this.presets[item.id];
    this.active = item;
    // the hover lift/tilt eases out while the item rises (no 4 mm drop on click)
    if (item.hover > 0) item.setHover(false);
    const tl = gsap.timeline();

    // Step 1 — selection: focus light + push-in begins, the rest recedes
    tl.call(() => {
      this.desk.aimFocusLight(item.getFocusPoint());
      this.director.setDOF(true, 0.0022, 1.0); // blur fades in with the push, never pops
    });
    // metal reads better with a softer attention light (no blown-out flats).
    // overwrite: takes over any hover fade still running → one continuous ramp, no dip.
    gsap.killTweensOf(this.desk.focusLight);
    tl.to(this.desk.focusLight, { overwrite: true, intensity: this.softLight.has(item.id) ? 0.9 : 1.6, duration: 0.6, ease: 'sine.out' }, 0);
    tl.to(this.room, { lampLevel: 0.8, duration: 0.8, ease: 'sine.inOut', onUpdate: () => this.room.setLampLevel(this.room.lampLevel) }, 0);
    tl.add(this.director.moveAlong([this.inspectShot(item)], { duration: 1.9, ease: 'power2.inOut' }), 0.05);
    tl.call(() => onSelected?.(), null, 0.35);

    // Step 2 — presentation: travel to the stage
    tl.call(() => {
      item.detachTo(this.stage);
      this.audio.play(P.sound, { position: item.getFocusPoint().toArray(), gain: 0.6, dur: 0.7 });
    }, null, 0.3);
    const root = item.root;
    const startPos = new THREE.Vector3(), startQ = new THREE.Quaternion();
    const endPos = new THREE.Vector3(...P.stage.pos);
    const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...P.stage.rot, 'YXZ'));
    const prog = { t: 0 };
    // rise clear of the desk (and anything beside it) before travelling
    const clear = 0.045;
    tl.call(() => { startPos.copy(root.position); startQ.copy(root.quaternion); }, null, 0.3);
    tl.to(prog, {
      t: 1, duration: 1.5, ease: 'power2.inOut',
      onUpdate: () => {
        const t = prog.t;
        // Lift first, then travel: the item rises clear of whatever lies
        // around it before moving sideways, then settles into the
        // presentation pose. y never dips below the clearance arc.
        const rise = smooth01(t / 0.35);
        const travel = smooth01((t - 0.18) / 0.82);
        root.position.x = startPos.x + (endPos.x - startPos.x) * travel;
        root.position.z = startPos.z + (endPos.z - startPos.z) * travel;
        const base = startPos.y + (endPos.y - startPos.y) * travel;
        root.position.y = Math.max(base, startPos.y + clear * rise) + Math.sin(travel * Math.PI) * 0.01;
        root.quaternion.slerpQuaternions(startQ, endQ, smooth01((t - 0.1) / 0.9));
        item.shadow.material.opacity = item.shadowBase * (1 - Math.min(1, t * 2));
        this.desk.aimFocusLight(item.getFocusPoint());
      },
    }, 0.32);
    P.present(tl, item);
    if (P.settleSound) tl.call(() => this.audio.play(P.settleSound, { position: endPos.toArray(), gain: 0.15 }), null, 1.7);
    return tl;
  }

  /** Put the active item back exactly where it rests; camera returns to the desk. */
  returnItem(item = this.active, { camera = true } = {}) {
    const tl = gsap.timeline();
    if (!item) return tl;
    const root = item.root;
    if (root.parent !== this.stage) item.detachTo(this.stage);
    const rest = item.restIn(this.stage);
    const startPos = root.position.clone(), startQ = root.quaternion.clone();
    const prog = { t: 0 };
    const glass = item.id === 'deep_scan' && this._glassRest ? item.model.userData.parts.glass : null;
    const clearR = 0.035;

    tl.to(item.present.rotation, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' }, 0);
    if (glass) {
      tl.to(glass.position, { x: this._glassRest.pos.x, y: this._glassRest.pos.y, z: this._glassRest.pos.z, duration: 0.8, ease: 'power2.inOut' }, 0);
      tl.to(glass.rotation, { x: this._glassRest.rot.x, y: this._glassRest.rot.y, z: this._glassRest.rot.z, duration: 0.8, ease: 'power2.inOut' }, 0);
    }
    tl.to(prog, {
      t: 1, duration: 1.35, ease: 'sine.inOut',
      onUpdate: () => {
        const t = prog.t;
        const travel = smooth01(t / 0.8);
        const drop = smooth01((t - 0.78) / 0.22);
        root.position.x = startPos.x + (rest.pos.x - startPos.x) * travel;
        root.position.z = startPos.z + (rest.pos.z - startPos.z) * travel;
        // stay above the clearance height until directly over the rest spot
        const hover = Math.max(startPos.y, rest.pos.y + clearR);
        root.position.y = travel < 1 ? hover + (rest.pos.y + clearR - hover) * travel : rest.pos.y + clearR;
        root.position.y += (rest.pos.y - (rest.pos.y + clearR)) * drop;
        root.quaternion.slerpQuaternions(startQ, rest.quat, smooth01(t / 0.7));
        item.shadow.material.opacity = item.shadowBase * Math.max(0, (prog.t - 0.6) / 0.4);
      },
    }, 0.1);
    tl.call(() => {
      item.restoreRest(); // exact assignment — no accumulated error
      this.audio.play(item.id === 'second_chance' || item.id === 'blackout_shield' ? 'tokenClink' : 'woodContact', { position: item.getFocusPoint().toArray(), gain: item.id === 'deep_scan' ? 0.25 : 0.12, pitch: 0.8 });
    }, null, 1.46);
    tl.to(this.desk.focusLight, { intensity: 0, duration: 0.7, ease: 'sine.inOut' }, 0.2);
    tl.to(this.room, { lampLevel: 1, duration: 0.9, ease: 'sine.inOut', onUpdate: () => this.room.setLampLevel(this.room.lampLevel) }, 0.2);
    if (camera) {
      tl.call(() => this.director.setDOF(false, undefined, 0.6), null, 0.5);
      tl.add(this.director.moveAlong([this.restingShot], { duration: 1.5, ease: 'power2.inOut' }), 0.05);
    }
    tl.call(() => { this.active = null; });
    return tl;
  }
}

function smooth01(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
