import * as THREE from 'three';
import gsap from 'gsap';
import { BlackMarketStateManager, S } from '../blackmarket/BlackMarketStateManager.js';
import { BlackMarketCameraDirector } from '../blackmarket/BlackMarketCameraDirector.js';
import { ItemInspectionController } from '../blackmarket/ItemInspectionController.js';
import { Sequencer } from '../core/Sequencer.js';
import { disposeObject } from '../core/Engine.js';
import { ConvenienceStore } from './ConvenienceStore.js';
import { StoreCounter } from './StoreCounter.js';
import { STORE } from './storeLayout.js';
import { StoreCrimeScene } from './StoreCrimeScene.js';

/**
 * StoreScene — the "legit" market: a late-night convenience store.
 *
 * Same feel and the same systems as the Black Market (camera director,
 * pick-up/inspection, state machine, Back button), but no character: the
 * power-ups sit on the checkout counter and the store itself does the
 * talking — doors, scanner, register, printer, fluorescent tubes.
 *
 * Public API (mirrors BlackMarketScene; invalid calls resolve to false):
 *   enterStore()  exitStore()  inspectMarketItem(id)  returnToMarketDesk()
 *   goBack()  showDealer()/showStore()  showTable()  backAction
 *   playPurchaseAnimation(id)  requestPurchase(id, confirm)  playDealerTwoTap()
 *   resetStore()  skipEntrance()  forceExit()
 *   onStoreEntered(cb)  onStoreExited(cb)  onPurchaseAnimationComplete(cb)  onStateChange(cb)
 * Generic aliases (enter / exit / reset / onEntered / onExited) let shared UI
 * drive either scene.
 *
 * State names are shared with the Black Market: DEALER_VIEW = the wide store
 * view, DEALER_ACCEPTING_PAYMENT = the register taking coins, DEALER_TWO_TAP =
 * the register's double confirmation beep.
 */

const T = STORE.counter.top;

export const STORE_SHOTS = {
  // on the wet pavement, looking through the glass doors at the lit counter
  outside: { pos: [0.3, 1.6, 6.0], look: [0, 1.3, 0] },
  entering: { pos: [0.25, 1.62, 2.2], look: [0, 1.2, -0.6] },
  // standing at the counter (the few seconds' hold)
  counterClose: { pos: [0, 1.55, 0.75], look: [0, 1.1, -1.0] },
  // the "back" view: a step back, the aisles and counter in frame
  dealerView: { pos: [1.0, 1.7, 2.4], look: [-0.2, 1.0, -0.8] },
  // looking down over the power-ups on the counter
  desk: { pos: [0, 2.0, 0.25], look: [0, T, -0.55] },
  // checkout: scanner, coin tray, register display, printer, bag
  purchase: { pos: [0.2, 1.58, 0.42], look: [0.34, T + 0.08, -0.62] },
  // THE GAME: the market is closed — held outside at the tape, looking in through the glass
  closedFront: { pos: [0.75, 1.68, 7.3], look: [0, 1.15, 1.8] },
  closedPeek: { pos: [0.5, 1.62, 6.1], look: [-0.25, 0.85, 1.2] },
};

/** Inspection moves for the packaged power-ups. */
function storePresets(counter) {
  const top = counter.top;
  return {
    hint_drop: {
      stage: { pos: [-0.02, top + 0.085, -0.22], rot: [0.78, 0.14, 0] },
      present: (tl, item) => { tl.to(item.present.rotation, { y: -0.14, duration: 1.6, ease: 'sine.inOut' }, '<0.2'); },
      sound: 'paperSlide',
    },
    blackout_shield: {
      stage: { pos: [0.0, top + 0.085, -0.22], rot: [0.78, -0.12, 0] },
      present: (tl, item) => {
        // tilt runs the tube reflection across the blister
        tl.to(item.present.rotation, { x: -0.18, duration: 0.8, ease: 'sine.inOut' }, '<0.35');
        tl.to(item.present.rotation, { x: -0.06, y: 0.1, duration: 0.9, ease: 'sine.inOut' });
      },
      sound: 'paperSlide',
    },
    second_chance: {
      // the can stays upright and turns once so the label wraps past
      stage: { pos: [0.0, top + 0.05, -0.24], rot: [-0.32, 0, 0] },
      present: (tl, item) => {
        tl.fromTo(item.present.rotation, { y: 0 }, { y: Math.PI * 2 - 0.35, duration: 2.0, ease: 'power2.out' }, '<0.1');
      },
      sound: 'tokenSlide',
      settleSound: 'can',
    },
    glitch_pack: {
      stage: { pos: [0.0, top + 0.085, -0.22], rot: [0.78, 0.1, 0] },
      present: (tl, item) => { tl.to(item.present.rotation, { y: -0.12, duration: 1.6, ease: 'sine.inOut' }, '<0.2'); },
      sound: 'paperSlide',
    },
    overclock_pack: {
      stage: { pos: [0.0, top + 0.085, -0.22], rot: [0.78, -0.1, 0] },
      present: (tl, item) => { tl.to(item.present.rotation, { y: 0.12, duration: 1.6, ease: 'sine.inOut' }, '<0.2'); },
      sound: 'paperSlide',
    },
    deep_scan: {
      stage: { pos: [-0.01, top + 0.09, -0.22], rot: [0.68, -0.08, 0] },
      present: (tl, item) => {
        tl.to(item.present.rotation, { y: 0.16, duration: 1.4, ease: 'sine.inOut' }, '<0.25');
        tl.to(item.present.rotation, { x: 0.08, duration: 1.0, ease: 'sine.inOut' }, '<0.3');
      },
      sound: 'paperSlide',
    },
  };
}

/** How each product stands when dropped into the bag (half height above its pivot). */
const BAG_POSE = {
  hint_drop: { rot: [Math.PI / 2, 0, 0], lift: 0.09 },
  blackout_shield: { rot: [Math.PI / 2, 0, 0], lift: 0.09 },
  deep_scan: { rot: [Math.PI / 2, 0, 0], lift: 0.105 },
  second_chance: { rot: [0, 0.6, 0], lift: 0 },
  glitch_pack: { rot: [Math.PI / 2, 0, 0], lift: 0.09 },
  overclock_pack: { rot: [Math.PI / 2, 0, 0], lift: 0.09 },
};

export class StoreScene {
  constructor({ engine, audio, origin, debug = false }) {
    this.engine = engine;
    this.audio = audio;
    this.origin = origin;
    this.state = new BlackMarketStateManager({ debug });
    this.seq = new Sequencer();
    this.listeners = { entered: new Set(), exited: new Set(), purchase: new Set(), state: new Set(), tap: new Set() };
    this.pointer = new THREE.Vector2(9, 9);
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;
    this.inspected = null;
    this.ambientEnabled = true;
    this._pointerDirty = false;
    this.kind = 'store';
    /** THE GAME: the Admin has shut the market down (crime scene, doors stay shut). */
    this.closed = false;
    /** THE GAME: id → sold out (set by the integration; sold-out stock is not on the counter). */
    this.isSoldOut = null;
    this.state.subscribe((next, prev, meta) => this._onState(next, prev, meta));
    this.ready = this._build();
  }

  // ════════════════════════════════════════════════════════════ build

  async _build() {
    const scene = new THREE.Scene();
    scene.name = 'ConvenienceStore';
    scene.background = new THREE.Color(0x04060a);
    scene.fog = new THREE.FogExp2(0x05070b, 0.035);
    this.scene = scene;

    this.room = new ConvenienceStore();
    this.desk = new StoreCounter(); // "desk" so shared controllers work unchanged
    this.stage = new THREE.Group(); this.stage.name = 'Stage';
    this.crime = new StoreCrimeScene();
    scene.add(this.room.group, this.desk.group, this.stage, this.crime.group);
    this._buildEnvironment();

    this.director = new BlackMarketCameraDirector({ camera: this.engine.camera, engine: this.engine, shots: STORE_SHOTS });
    this.inspection = new ItemInspectionController({
      desk: this.desk, stage: this.stage, director: this.director, room: this.room, audio: this.audio,
      presets: storePresets, softLight: ['second_chance', 'blackout_shield', 'deep_scan', 'glitch_pack', 'overclock_pack'], restingShot: 'desk',
    });

    const setLamp = this.room.setLampLevel.bind(this.room);
    this.room.setLampLevel = (v) => { setLamp(v); scene.environmentIntensity = 0.08 + 0.5 * v; };

    this._resetInternals();
    this._unsub = this.engine.onUpdate((dt, t) => this._update(dt, t));
    this._bindPointer();
    // The store is static apart from what we animate: shadows re-render only
    // while something moves (see _update), not every frame.
    scene.userData.staticShadows = true;
    scene.userData.shadowsDirty = 2;
    this.engine.precompile(scene);
    return 'store';
  }

  _buildEnvironment() {
    // bright white box with ceiling strips: gives cans, blisters and chrome a store-like reflection
    const pm = new THREE.PMREMGenerator(this.engine.renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x101214);
    const box = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 6), new THREE.MeshBasicMaterial({ color: 0x8c8e8a, side: THREE.BackSide }));
    box.position.y = 1.3; env.add(box);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeef6ff).multiplyScalar(6) });
    for (const x of [-2.5, 0, 2.5]) for (const z of [-0.8, 1.0]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.25), strip); s.position.set(x, 2.75, z); env.add(s);
    }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: 0x0a0c10 }));
    front.position.set(0, 1.2, 2.95); front.rotation.y = Math.PI; env.add(front);
    this.scene.environment = pm.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 0.58;
    pm.dispose();
  }

  _resetInternals() {
    this.seq.cancel();
    gsap.killTweensOf(this.room);
    gsap.killTweensOf(this.desk.focusLight);
    this.inspection.active = null;
    this.inspected = null;
    this.hovered = null;
    this.desk.resetLayout();
    this.desk.focusLight.intensity = 0;
    this.desk.drawer.position.z = 0.181;
    this.desk.scanGlass.emissiveIntensity = 0.05;
    this.room._exiting = false;
    for (const t of this.room.tubes) t.flicker = 1;
    this.room.setDoorOpen(0);
    this.director.setDOF(false);
    this.director.attend(null);
  }

  // ════════════════════════════════════════════════════════════ events

  _emit(type, ...args) { for (const fn of this.listeners[type]) fn(...args); }
  onStoreEntered(cb) { this.listeners.entered.add(cb); return () => this.listeners.entered.delete(cb); }
  onStoreExited(cb) { this.listeners.exited.add(cb); return () => this.listeners.exited.delete(cb); }
  onPurchaseAnimationComplete(cb) { this.listeners.purchase.add(cb); return () => this.listeners.purchase.delete(cb); }
  onStateChange(cb) { this.listeners.state.add(cb); return () => this.listeners.state.delete(cb); }
  onDealerTap(cb) { this.listeners.tap.add(cb); return () => this.listeners.tap.delete(cb); }

  _onState(next, prev, meta) {
    if (!this.state.interactive && this.hovered) {
      if (next === S.ITEM_SELECTING || next === S.PURCHASE_STARTING) this._handOffHover();
      else this._setHovered(null);
    }
    this.engine.renderer.domElement.style.cursor = next === S.DEALER_VIEW ? 'pointer' : 'default';
    this._emit('state', next, prev, meta);
  }

  // ════════════════════════════════════════════════════════════ helpers

  _lampTo(tl, v, { dur = 0.5, at, ease = 'sine.inOut' } = {}) {
    tl.to(this.room, { lampLevel: v, duration: dur, ease, onUpdate: () => this.room.setLampLevel(this.room.lampLevel) }, at);
    return tl;
  }

  _doorTo(tl, v, { dur, ease = 'power2.inOut', at } = {}) {
    tl.to(this.room, { doorOpen: v, duration: dur, ease, onUpdate: () => this.room.setDoorOpen(this.room.doorOpen) }, at);
    return tl;
  }

  _footsteps(tl, from, count, interval = 0.55, gain = 0.35) {
    for (let i = 0; i < count; i++) tl.call(() => this.audio.play('footstep', { gain: gain * (0.85 + Math.random() * 0.3), pitch: 1.3 }), null, from + i * interval);
  }

  _doorPos() { return [0, 1.2, STORE.room.z1]; }
  _regPos() { return [0.68, T + 0.2, -0.8]; }

  // ════════════════════════════════════════════════════════════ CLOSED (THE GAME)

  _applyStock() {
    if (!this.isSoldOut) return;
    for (const it of this.desk.items.values()) {
      const out = this.isSoldOut(it.id);
      it.transferred = out;
      it.root.visible = !out;
    }
  }

  /** Switch the whole set between the open store and the sealed crime scene, at once. */
  _applyLook(closed) {
    const room = this.room;
    this.crime.setActive(closed);
    room._crime = closed;
    room.neonMat.opacity = closed ? 0 : 1;
    room.setDoorOpen(0);
    if (closed) {
      // most fixtures dead, two hanging on; the stock on the counter is gone (taken as evidence)
      room.tubes.forEach((t, i) => { t.flicker = t.fridge ? 0.35 : (i === 2 || i === 4 ? 0.9 : 0); });
      room.lampLevel = 0.24;
      room.setLampLevel(0.24);
      for (const it of this.desk.items.values()) { it.transferred = true; it.root.visible = false; }
      this.desk.setDisplay('CLOSED', 'NO SALE');
      this.desk.drawer.position.z = 0.181 + 0.07;
    } else {
      for (const t of room.tubes) t.flicker = 1;
      room.lampLevel = 1;
      room.setLampLevel(1);
      this.desk.resetLayout();
      this._applyStock();
      this.desk.drawer.position.z = 0.181;
      this.desk.setDisplay('WELCOME', 'SELF CHECKOUT');
    }
    this.scene.userData.shadowsDirty = 3;
  }

  /**
   * THE GAME: the Admin opened or closed the market. Outside the store this only
   * changes what the next visit finds; inside, the change is played out:
   *   close  → the lights fail, black, and we are back out at the tape
   *   reopen → black, the clean store, and the doors open for us
   * A purchase already being rung up always finishes first.
   */
  async setClosed(closed) {
    if (this.closed === closed && !this._closingRun) return true;
    this.closed = closed;
    await this.ready;
    if (this.state.is(S.MARKET_INACTIVE, S.MARKET_LOADING)) { this._applyLook(closed); return true; }
    // wait out a paid purchase (the transaction already happened; the animation completes)
    while (this.state.is(S.PURCHASE_STARTING, S.DEALER_ACCEPTING_PAYMENT, S.DEALER_TWO_TAP, S.ITEM_DELIVERY, S.PURCHASE_COMPLETE, S.MARKET_EXITING)) {
      if (this.state.is(S.MARKET_EXITING)) return true; // leaving anyway; the next visit sees the new state
      await new Promise((r) => { const off = this.state.subscribe(() => { off(); r(); }); });
    }
    if (this.state.is(S.MARKET_INACTIVE)) { this._applyLook(this.closed); return true; }
    if (this.closed !== closed) return true; // superseded while we waited
    this._closingRun = true;
    try { return closed ? await this._playShutdown() : await this._playReopen(); } finally { this._closingRun = false; }
  }

  async _playShutdown() {
    this.seq.cancel();
    this._setHovered(null);
    this.state.force(S.VIEW_CHANGING);
    const reduced = this.engine.reducedMotion;
    {
      const tl = gsap.timeline();
      tl.call(() => { this.director.setDOF(false); this.room._exiting = true; }, null, 0);
      // the lights stutter and fail together; a warning buzz from the register
      tl.call(() => this.audio.play('beep', { position: this._regPos(), gain: 0.5, pitch: 0.42, dur: 0.35 }), null, 0.05);
      tl.call(() => this.audio.play('beep', { position: this._regPos(), gain: 0.5, pitch: 0.42, dur: 0.35 }), null, 0.5);
      const apply = () => this.room.setLampLevel(this.room.lampLevel);
      for (const tube of this.room.tubes) {
        let at = 0.1 + Math.random() * 0.25;
        for (const [v, dur] of (reduced ? [[0, 0.3]] : [[0.2, 0.05], [1, 0.06], [0.05, 0.08], [0.7, 0.05], [0, 0.1]])) { tl.to(tube, { flicker: v, duration: dur, ease: 'none', onUpdate: apply }, at); at += dur; }
      }
      tl.call(() => { this.audio.stopStoreAmbience(0.4); this.audio.play('lampOn', { gain: 0.7 }); }, null, 0.75);
      tl.to(this.engine, { fade: 1, duration: 0.4, ease: 'power2.in' }, 0.8);
      tl.to({}, { duration: 0.6 });
      if (!(await this.seq.run(tl))) return false;
    }
    this._resetInternals();
    this.room._exiting = false;
    this._applyLook(true);
    this.director.set('closedFront');
    {
      const tl = gsap.timeline();
      tl.to(this.engine, { fade: 0, duration: reduced ? 0.5 : 1.4, ease: 'sine.inOut' }, 0.2);
      tl.add(this.director.moveAlong(['closedPeek'], { duration: reduced ? 0.6 : 3.2, ease: 'power2.inOut' }), 0.6);
      if (!(await this.seq.run(tl))) return false;
    }
    this.state.force(S.DEALER_VIEW);
    return true;
  }

  async _playReopen() {
    this.seq.cancel();
    this.state.force(S.VIEW_CHANGING);
    const reduced = this.engine.reducedMotion;
    {
      const tl = gsap.timeline();
      tl.to(this.engine, { fade: 1, duration: 0.6, ease: 'power2.in' });
      if (!(await this.seq.run(tl))) return false;
    }
    this._resetInternals();
    this._applyLook(false);
    this.director.set('outside');
    {
      const tl = gsap.timeline();
      tl.to(this.engine, { fade: 0, duration: reduced ? 0.5 : 1.2, ease: 'sine.inOut' }, 0.2);
      tl.add(this.director.moveAlong([{ pos: [0.28, 1.6, 4.6], look: [0, 1.25, 0] }], { duration: reduced ? 0.5 : 1.8, ease: 'sine.inOut' }), 0.3);
      if (!(await this.seq.run(tl))) return false;
    }
    if (!(await this._walkIn())) return false;
    this.state.force(S.MARKET_IDLE);
    this._pointerDirty = true;
    return true;
  }

  /** Entrance version of _walkIn: advances DOOR_OPENING → ROOM_REVEAL → DEALER_INTRO. */
  _walkInStaged() { return this._walkIn(true); }

  /** The doors open for us, we walk to the counter and look down (shared by enter / reopen). */
  async _walkIn(staged = false) {
    const seq = this.seq;
    const reduced = this.engine.reducedMotion;
    {
      const tl = gsap.timeline();
      tl.call(() => {
        this.audio.play('doorSlide', { position: this._doorPos(), dur: 1.3 });
        this.audio.startStoreAmbience(1.6);
      });
      this._doorTo(tl, 1, { dur: 1.3, ease: 'power2.inOut' });
      tl.call(() => this.audio.play('chime', { position: [0.8, 2.3, STORE.room.z1 - 0.2], gain: 0.9 }), null, 0.35);
      if (!(await seq.run(tl))) return false;
    }
    if (staged) this.state.to(S.ROOM_REVEAL);
    {
      const tl = gsap.timeline();
      tl.add(this.director.moveAlong(['entering', 'counterClose'], { duration: reduced ? 0.6 : 4.0, ease: 'power2.inOut' }), 0);
      if (!reduced) this._footsteps(tl, 0.4, 6, 0.55);
      tl.call(() => this.audio.play('doorSlide', { position: this._doorPos(), dur: 1.2, gain: 0.6 }), null, 2.4);
      this._doorTo(tl, 0, { dur: 1.2, at: 2.4 });
      if (!(await seq.run(tl))) return false;
    }
    if (staged) this.state.to(S.DEALER_INTRO);
    {
      const tl = gsap.timeline();
      tl.call(() => { this.desk.setDisplay('WELCOME', 'SELF CHECKOUT'); this.audio.play('beep', { position: this._regPos(), gain: 0.4, pitch: 0.75, dur: 0.12 }); }, null, 0.6);
      tl.add(this.director.moveAlong(['desk'], { duration: reduced ? 0.6 : 2.6, ease: 'power2.inOut' }), reduced ? 0.8 : 2.6);
      if (!(await seq.run(tl))) return false;
    }
    return true;
  }

  /** Closed: up to the doors, which do not open; then a long look through the glass. */
  async _enterClosed() {
    this._resetInternals();
    this._applyLook(true);
    this.engine.setScene(this.scene);
    this.engine.fade = 1;
    this.director.set('outside');
    this.state.to(S.MARKET_ENTERING);
    const seq = this.seq;
    const reduced = this.engine.reducedMotion;
    {
      const tl = gsap.timeline();
      tl.to({}, { duration: 0.8 });
      tl.to(this.engine, { fade: 0, duration: reduced ? 0.5 : 1.6, ease: 'sine.inOut' });
      tl.add(this.director.moveAlong(['closedFront'], { duration: reduced ? 0.5 : 2.6, ease: 'sine.inOut' }), 1.0);
      if (!(await seq.run(tl))) return false;
    }
    // the sensor sees us; the doors jolt against the lock and stay shut
    this.state.to(S.DOOR_OPENING);
    {
      const tl = gsap.timeline();
      const led = this.room.sensorLed.material;
      for (let i = 0; i < 3; i++) {
        tl.to(led, { emissiveIntensity: 6, duration: 0.06 }, i * 0.32);
        tl.to(led, { emissiveIntensity: 0.6, duration: 0.2 }, i * 0.32 + 0.08);
      }
      tl.call(() => this.audio.play('doorSlide', { position: this._doorPos(), dur: 0.35, gain: 0.5 }), null, 0.2);
      this._doorTo(tl, 0.035, { dur: 0.16, ease: 'power2.out', at: 0.22 });
      this._doorTo(tl, 0, { dur: 0.22, ease: 'power2.in', at: 0.4 });
      tl.call(() => this.audio.play('beep', { position: this._doorPos(), gain: 0.35, pitch: 0.45, dur: 0.3 }), null, 0.62);
      tl.call(() => this.audio.play('beep', { position: this._doorPos(), gain: 0.35, pitch: 0.45, dur: 0.3 }), null, 1.0);
      tl.to(led, { emissiveIntensity: 2, duration: 0.3 }, 1.2);
      tl.to({}, { duration: 0.4 });
      if (!(await seq.run(tl))) return false;
    }
    // a step closer to the glass: what happened inside
    this.state.to(S.ROOM_REVEAL);
    {
      const tl = gsap.timeline();
      tl.add(this.director.moveAlong(['closedPeek'], { duration: reduced ? 0.6 : 3.4, ease: 'power2.inOut' }), 0);
      if (!reduced) this._footsteps(tl, 0.2, 3, 0.6, 0.25);
      if (!(await seq.run(tl))) return false;
    }
    this.state.to(S.DEALER_INTRO);
    this.state.force(S.DEALER_VIEW);
    this._emit('entered');
    return true;
  }

  // ════════════════════════════════════════════════════════════ ENTER

  async enterStore() {
    if (!this.state.to(S.MARKET_LOADING)) return false;
    await this.ready;
    await this.audio.unlock();
    if (this.origin?.leave) await this.origin.leave();
    if (!this.state.is(S.MARKET_LOADING)) return false;
    if (this.closed) return this._enterClosed();

    this._resetInternals();
    this._applyLook(false);
    this.engine.setScene(this.scene);
    this.engine.fade = 1;
    this.room.setLampLevel(1);
    this.director.set('outside');
    this.state.to(S.MARKET_ENTERING);
    const seq = this.seq;
    const reduced = this.engine.reducedMotion;

    // ── black; rain-quiet street; then the lit shopfront fades up out of the dark
    {
      const tl = gsap.timeline();
      tl.to({}, { duration: 1.2 });
      tl.to(this.engine, { fade: 0, duration: reduced ? 0.5 : 1.6, ease: 'sine.inOut' });
      tl.add(this.director.moveAlong([{ pos: [0.28, 1.6, 4.6], look: [0, 1.25, 0] }], { duration: reduced ? 0.5 : 2.4, ease: 'sine.inOut' }), 1.4);
      if (!(await seq.run(tl))) return false;
    }
    // ── doors open, walk to the counter, look down (states advance as each part starts)
    this.state.to(S.DOOR_OPENING);
    if (!(await this._walkInStaged())) return false;
    this.state.to(S.MARKET_IDLE);
    this._emit('entered');
    return true;
  }

  async skipEntrance() {
    await this.ready;
    await this.audio.unlock();
    this.seq.cancel();
    if (this.state.is(S.MARKET_INACTIVE) && this.origin?.leave) await this.origin.leave({ instant: true });
    this._resetInternals();
    this.engine.setScene(this.scene);
    this.engine.fade = 0;
    if (this.closed) {
      this._applyLook(true);
      this.director.set('closedPeek');
      this.state.force(S.DEALER_VIEW);
      this._emit('entered');
      return true;
    }
    this._applyLook(false);
    this.desk.setDisplay('WELCOME', 'SELF CHECKOUT');
    this.audio.startStoreAmbience(0.5);
    this.director.set('desk');
    this.state.force(S.MARKET_IDLE);
    this._emit('entered');
    return true;
  }

  // ════════════════════════════════════════════════════════════ HOVER

  _bindPointer() {
    const el = this.engine.renderer.domElement;
    this._onMove = (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._pointerDirty = true;
    };
    this._onLeave = () => { this.pointer.set(9, 9); this._pointerDirty = true; };
    this._onClick = (e) => {
      if (this.engine.activeScene !== this.scene) return;
      this._onMove(e);
      if (this.state.is(S.DEALER_VIEW)) { if (!this.closed) this.showTable(); return; }
      this._pick();
      if (this.state.interactive && this.hovered) this.inspectMarketItem(this.hovered.id);
    };
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerleave', this._onLeave);
    el.addEventListener('click', this._onClick);
  }

  _pick() {
    if (this.closed) { this._setHovered(null); return; }
    if (!this.state.interactive || this.engine.activeScene !== this.scene) return;
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);
    const hit = this.raycaster.intersectObjects(this.desk.hitTargets, false)[0];
    this._setHovered(hit ? hit.object.userData.marketItem : null);
  }

  _handOffHover() {
    clearTimeout(this._releaseTimer);
    this.hovered = null;
    this.engine.renderer.domElement.style.cursor = 'default';
  }

  _setHovered(item) {
    if (item === this.hovered) return;
    const prev = this.hovered;
    this.hovered = item;
    prev?.setHover(false);
    const el = this.engine.renderer.domElement;
    clearTimeout(this._releaseTimer);
    if (item) {
      item.setHover(true);
      this.audio.play('paperSlide', { gain: 0.035, dur: 0.1, position: item.getFocusPoint().toArray() });
      this.director.attend(item.getFocusPoint(), 1);
      this.desk.aimFocusLight(item.getFocusPoint());
      gsap.to(this.desk.focusLight, { intensity: 1.1, duration: 0.3, ease: 'power2.out', overwrite: true });
      this.desk.setDisplay(item.title.length > 10 ? item.title.split(' ')[0] : item.title, '1 POWER-UP');
      if (this.state.is(S.MARKET_IDLE)) this.state.to(S.ITEM_HOVER, { item: item.id });
      else if (this.state.is(S.ITEM_HOVER)) this._emit('state', S.ITEM_HOVER, S.ITEM_HOVER, { item: item.id });
      el.style.cursor = 'pointer';
    } else {
      const release = () => {
        if (this.hovered) return;
        this.director.attend(null);
        gsap.to(this.desk.focusLight, { intensity: 0, duration: 0.35, ease: 'power2.inOut', overwrite: true });
        if (!this.inspected) this.desk.setDisplay('WELCOME', 'SELF CHECKOUT');
      };
      if (this.state.interactive) this._releaseTimer = setTimeout(release, 220);
      else release();
      if (this.state.is(S.ITEM_HOVER)) this.state.to(S.MARKET_IDLE);
      el.style.cursor = 'default';
    }
  }

  // ════════════════════════════════════════════════════════════ INSPECT

  async inspectMarketItem(itemId) {
    if (this.closed) return false;
    const item = this.desk.items.get(itemId);
    if (!item || item.transferred) return false;
    if (!this.state.to(S.ITEM_SELECTING, { item: itemId })) return false;
    this._handOffHover();
    for (const it of this.desk.items.values()) if (it !== item && it.hover > 0) it.setHover(false);
    this.inspected = item;
    this.desk.setDisplay(item.title.length > 10 ? item.title.split(' ')[0] : item.title, '1 POWER-UP');
    const tl = this.inspection.inspect(item, { onSelected: () => this.state.to(S.ITEM_INSPECTING, { item: itemId }) });
    if (!(await this.seq.run(tl))) return false;
    if (this.state.is(S.ITEM_SELECTING)) this.state.to(S.ITEM_INSPECTING, { item: itemId });
    this.state.to(S.ITEM_INSPECTED, { item: itemId });
    return true;
  }

  async returnToMarketDesk() {
    if (!this.state.to(S.ITEM_RETURNING, { item: this.inspected?.id })) return false;
    const item = this.inspected;
    const tl = this.inspection.returnItem(item);
    if (item.id === 'second_chance') tl.call(() => this.audio.play('can', { position: item.getFocusPoint().toArray(), gain: 0.5 }), null, 1.46);
    if (!(await this.seq.run(tl))) return false;
    this.inspected = null;
    this.desk.setDisplay('WELCOME', 'SELF CHECKOUT');
    this.state.to(S.MARKET_IDLE);
    this._pointerDirty = true;
    return true;
  }

  /** Step back from the counter: the store, aisles and coolers in view. */
  async showDealer() {
    if (this.closed) return false;
    if (!this.state.to(S.VIEW_CHANGING, { view: 'store' })) return false;
    this._setHovered(null);
    const tl = gsap.timeline();
    tl.add(this.director.moveAlong(['dealerView'], { duration: this.engine.reducedMotion ? 0.6 : 2.4, ease: 'power2.inOut' }));
    if (!this.engine.reducedMotion) this._footsteps(tl, 0.3, 3, 0.5, 0.25);
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.DEALER_VIEW);
    return true;
  }
  showStore() { return this.showDealer(); }

  async showTable() {
    if (this.closed) return false;
    if (!this.state.to(S.VIEW_CHANGING, { view: 'table' })) return false;
    const tl = gsap.timeline();
    tl.add(this.director.moveAlong(['desk'], { duration: this.engine.reducedMotion ? 0.6 : 2.2, ease: 'power2.inOut' }));
    if (!this.engine.reducedMotion) this._footsteps(tl, 0.3, 3, 0.5, 0.25);
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.MARKET_IDLE);
    this._pointerDirty = true;
    return true;
  }

  goBack() {
    if (this.state.is(S.ITEM_INSPECTED)) return this.returnToMarketDesk();
    if (this.state.interactive) return this.showDealer();
    if (this.state.is(S.DEALER_VIEW)) return this.exitStore();
    return Promise.resolve(false);
  }

  get backAction() {
    if (this.closed) return this.state.is(S.DEALER_VIEW) ? 'exit' : null;
    if (this.state.is(S.ITEM_INSPECTED)) return 'return';
    if (this.state.interactive) return 'dealer';
    if (this.state.is(S.DEALER_VIEW)) return 'exit';
    return null;
  }

  // ════════════════════════════════════════════════════════════ PURCHASE

  /**
   * World-space glide of an item's root: rises clear first, travels, settles.
   * Returns a tween; `getEnd` is read when the tween starts (live positions).
   */
  _glide(item, getEnd, { duration = 1.0, clear = 0.05, ease = 'power2.inOut' } = {}) {
    const root = item.root;
    const s = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
    let end;
    const prog = { t: 0 };
    return gsap.to(prog, {
      t: 1, duration, ease,
      onStart: () => {
        if (root.parent !== this.stage) item.detachTo(this.stage);
        s.pos.copy(root.position); s.q.copy(root.quaternion);
        end = getEnd();
        prog.t = 0;
      },
      onUpdate: () => {
        const t = prog.t;
        const rise = smooth01(t / 0.3), travel = smooth01((t - 0.12) / 0.88);
        root.position.x = s.pos.x + (end.pos.x - s.pos.x) * travel;
        root.position.z = s.pos.z + (end.pos.z - s.pos.z) * travel;
        const base = s.pos.y + (end.pos.y - s.pos.y) * travel;
        const arc = Math.max(s.pos.y, end.pos.y) + clear;
        root.position.y = travel < 1 ? Math.max(base, s.pos.y + (arc - s.pos.y) * rise * (1 - smooth01((travel - 0.7) / 0.3))) : end.pos.y;
        root.quaternion.slerpQuaternions(s.q, end.q, smooth01(t / 0.85));
        item.shadow.material.opacity = item.shadowBase * Math.max(0, 1 - t * 3);
        this.desk.aimFocusLight(item.getFocusPoint());
      },
    });
  }

  _poseQ(rot) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')); }

  /**
   * Animation only — call AFTER the backend confirms. Scan → coins → double
   * beep → receipt → into the bag → the bag slides over to you.
   */
  async playPurchaseAnimation(itemId) {
    if (this.closed) return false;
    const item = this.desk.items.get(itemId);
    if (!item || item.transferred) return false;
    if (this.inspected && this.inspected !== item) return false;
    if (!this.state.to(S.PURCHASE_STARTING, { item: itemId })) return false;
    this._handOffHover();
    for (const it of this.desk.items.values()) if (it !== item && it.hover > 0) it.setHover(false);
    if (item.hover > 0) item.setHover(false);
    const d = this.desk, seq = this.seq;
    const reduced = this.engine.reducedMotion;
    const short = item.title.length > 10 ? item.title.split(' ')[0] : item.title;
    const can = item.id === 'second_chance';

    // ── 1. over the scanner: the red fan sweeps, beep
    {
      const tl = gsap.timeline();
      tl.call(() => this.director.setDOF(false, undefined, 0.6), null, 0);
      tl.add(this.director.moveAlong(['purchase'], { duration: reduced ? 0.6 : 1.8, ease: 'power2.inOut' }), 0);
      tl.to(item.present.rotation, { x: 0, y: 0, z: 0, duration: 0.6, ease: 'power2.inOut' }, 0);
      tl.to(this.room, { lampLevel: 1, duration: 0.6, onUpdate: () => this.room.setLampLevel(this.room.lampLevel) }, 0);
      tl.to(d.focusLight, { intensity: 0, duration: 0.6, overwrite: true }, 0);
      tl.call(() => this.audio.play(can ? 'tokenSlide' : 'paperSlide', { position: item.getFocusPoint().toArray(), gain: 0.4, dur: 0.6 }), null, 0.1);
      // barcode side down, a hand's width over the glass
      const scanRot = can ? [Math.PI / 2 - 0.15, 0, 0] : [0, 0.08, 0];
      tl.add(this._glide(item, () => ({ pos: d.scanSpot.clone().add(new THREE.Vector3(-0.07, can ? 0.07 : 0.06, can ? -0.06 : 0)), q: this._poseQ(scanRot) }), { duration: 1.1, clear: 0.06 }), 0.1);
      // the pass across the glass
      tl.to(item.root.position, { x: `+=${0.14}`, duration: 0.55, ease: 'sine.inOut' }, 1.25);
      tl.to(d.laser.material, { opacity: 0.55, duration: 0.08 }, 1.25);
      tl.to(d.scanGlass, { emissiveIntensity: 1.2, duration: 0.08 }, 1.25);
      tl.call(() => { this.audio.play('beep', { position: d.scanSpot.toArray(), gain: 0.9 }); d.setDisplay(short, '1 x POWER-UP'); }, null, 1.55);
      tl.to(d.laser.material, { opacity: 0, duration: 0.2 }, 1.7);
      tl.to(d.scanGlass, { emissiveIntensity: 0.05, duration: 0.3 }, 1.7);
      if (!(await seq.run(tl))) return false;
    }
    // ── 2. payment: coins rattle into the tray, the drawer kicks open
    this.state.to(S.DEALER_ACCEPTING_PAYMENT, { item: itemId });
    {
      const tl = gsap.timeline();
      // the item is set down on the scanner glass while we pay
      tl.add(this._glide(item, () => ({ pos: d.scanSpot.clone(), q: this._poseQ(can ? [0, 0.4, 0] : [0, 0, 0]) }), { duration: 0.7, clear: 0.0 }), 0);
      tl.to(item.shadow.material, { opacity: item.shadowBase, duration: 0.25 }, 0.5);
      tl.call(() => this.audio.play(can ? 'can' : 'paperSlide', { position: d.scanSpot.toArray(), gain: can ? 0.4 : 0.2, dur: 0.12 }), null, 0.68);
      tl.call(() => d.setDisplay('INSERT', 'COINS'), null, 0.2);
      d.coins.forEach((c, i) => {
        const tx = d.coinTray.x + (Math.random() - 0.5) * 0.04, tz = d.coinTray.z + (Math.random() - 0.5) * 0.04;
        const at = 0.5 + i * 0.11;
        tl.call(() => {
          c.visible = true;
          c.position.set(tx, d.coinTray.y + 0.12, tz + 0.03);
          c.rotation.set(Math.random(), Math.random() * 6, Math.random());
        }, null, at);
        tl.to(c.position, { y: d.coinTray.y + 0.0012 + i * 0.0022 * 0.5, z: tz, duration: 0.22, ease: 'power2.in' }, at);
        tl.to(c.rotation, { x: 0, z: 0, duration: 0.26, ease: 'bounce.out' }, at + 0.12);
      });
      tl.call(() => this.audio.play('coins', { position: d.coinTray.toArray(), gain: 0.9 }), null, 0.66);
      tl.call(() => this.audio.play('coins', { position: d.coinTray.toArray(), gain: 0.5 }), null, 0.92);
      tl.call(() => { this.audio.play('register', { position: this._regPos(), gain: 0.8 }); d.setDisplay('PAID', 'THANK YOU'); }, null, 1.35);
      tl.to(d.drawer.position, { z: 0.181 + 0.07, duration: 0.18, ease: 'power3.out' }, 1.4);
      tl.to(d.drawer.position, { z: 0.181, duration: 0.5, ease: 'power2.inOut' }, 2.0);
      if (!(await seq.run(tl))) return false;
    }
    // ── 3. the register confirms: two short beeps (the store's version of the two taps)
    this.state.to(S.DEALER_TWO_TAP, { item: itemId });
    {
      const tl = gsap.timeline();
      tl.call(() => { this.audio.play('beep', { position: this._regPos(), gain: 0.6, pitch: 1.12 }); this._emit('tap', 0); }, null, 0.05);
      tl.call(() => { this.audio.play('beep', { position: this._regPos(), gain: 0.6, pitch: 1.12 }); this._emit('tap', 1); }, null, 0.3);
      tl.to({}, { duration: 0.5 });
      if (!(await seq.run(tl))) return false;
    }
    // ── 4. receipt prints; a bag pops open; the product drops in; the bag slides to you
    this.state.to(S.ITEM_DELIVERY, { item: itemId });
    {
      const tl = gsap.timeline();
      const bag = d.bag;
      const bagPos = new THREE.Vector3(0.1, T, -0.31);
      tl.call(() => this.audio.play('printer', { position: [0.86, T + 0.1, -0.55], dur: 1.0 }), null, 0);
      tl.fromTo(d.receipt.scale, { y: 0.001 }, { y: 1, duration: 1.0, ease: 'none' }, 0);
      tl.call(() => {
        bag.visible = true; bag.position.copy(bagPos); bag.rotation.set(0, -0.12, 0); bag.scale.set(1, 0.06, 0.4);
        this.audio.play('bag', { position: bagPos.toArray(), gain: 0.8, dur: 0.45 });
      }, null, 0.35);
      tl.to(bag.scale, { y: 1, z: 1, duration: 0.45, ease: 'back.out(1.6)' }, 0.35);
      // up and over the bag mouth, then down inside
      const pose = BAG_POSE[item.id];
      const qIn = this._poseQ([pose.rot[0], pose.rot[1] - 0.12, pose.rot[2]]);
      const over = () => ({ pos: bagPos.clone().add(new THREE.Vector3(0, bag.userData.height + pose.lift + 0.04, 0)), q: qIn });
      tl.add(this._glide(item, over, { duration: 0.9, clear: 0.02 }), 0.75);
      tl.to(item.root.position, { y: T + 0.008 + pose.lift, duration: 0.35, ease: 'power2.in' }, 1.7);
      tl.call(() => this.audio.play('bag', { position: bagPos.toArray(), gain: 0.6, dur: 0.3 }), null, 1.98);
      tl.call(() => { if (can) this.audio.play('can', { position: bagPos.toArray(), gain: 0.3 }); }, null, 2.02);
      // the product rides along inside the bag from here
      tl.call(() => { bag.attach(item.root); }, null, 2.08);
      // the receipt tears off
      tl.call(() => this.audio.play('paperSlide', { position: [0.86, T + 0.1, -0.55], gain: 0.4, dur: 0.15 }), null, 2.2);
      tl.to(d.receipt.scale, { y: 0.001, duration: 0.15, ease: 'power2.in' }, 2.25);
      // slides across the counter to you, then is picked up out of frame
      tl.call(() => this.audio.play('paperSlide', { position: bagPos.toArray(), gain: 0.5, dur: 0.7 }), null, 2.5);
      tl.to(bag.position, { x: 0.02, z: -0.22, duration: 0.7, ease: 'power2.inOut' }, 2.5);
      tl.to(bag.rotation, { y: 0.05, duration: 0.7, ease: 'power2.inOut' }, 2.5);
      tl.to(bag.position, { y: T + 0.3, z: 0.42, duration: 0.8, ease: 'power2.in' }, 3.35);
      tl.to(bag.rotation, { x: -0.35, duration: 0.8, ease: 'power2.in' }, 3.35);
      tl.call(() => this.audio.play('bag', { gain: 0.5, dur: 0.4 }), null, 3.4);
      if (!(await seq.run(tl))) return false;
    }
    // ── 5. done: the counter resets, the camera settles back over the products
    this.state.to(S.PURCHASE_COMPLETE, { item: itemId });
    {
      item.transferred = true;
      item.restoreRest();          // hidden (transferred) and back on its rest parent
      d.bag.visible = false;
      d.bag.position.set(0, -10, 0); d.bag.rotation.set(0, 0, 0); d.bag.scale.set(1, 1, 1);
      const tl = gsap.timeline();
      tl.add(this.director.moveAlong(['desk'], { duration: reduced ? 0.6 : 2.0, ease: 'power2.inOut' }), 0);
      tl.call(() => { for (const c of d.coins) c.visible = false; d.setDisplay('WELCOME', 'SELF CHECKOUT'); }, null, 1.0);
      if (!(await seq.run(tl))) return false;
    }
    this.inspected = null;
    this.inspection.active = null;
    this.state.to(S.MARKET_IDLE);
    this._emit('purchase', itemId);
    this._pointerDirty = true;
    return true;
  }

  async requestPurchase(itemId, confirm) {
    if (!this.state.can(S.PURCHASE_STARTING)) return false;
    let ok = false;
    try { ok = await confirm(itemId); } catch { ok = false; }
    if (!ok) return false;
    return this.playPurchaseAnimation(itemId);
  }

  /** The store's two-tone signature: two register beeps (distant when outside). */
  async playDealerTwoTap({ distant } = {}) {
    await this.audio.unlock();
    if (this.state.is(S.MARKET_INACTIVE) || distant) {
      this.audio.play('beep', { gain: 0.15, pitch: 1.12, wet: 2 });
      this.audio.play('beep', { gain: 0.15, pitch: 1.12, wet: 2, at: 0.25 });
      return true;
    }
    if (!this.state.to(S.DEALER_TWO_TAP)) return false;
    const tl = gsap.timeline();
    tl.call(() => { this.audio.play('beep', { position: this._regPos(), gain: 0.6, pitch: 1.12 }); this._emit('tap', 0); }, null, 0);
    tl.call(() => { this.audio.play('beep', { position: this._regPos(), gain: 0.6, pitch: 1.12 }); this._emit('tap', 1); }, null, 0.25);
    tl.to({}, { duration: 0.5 });
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.MARKET_IDLE);
    return true;
  }

  // ════════════════════════════════════════════════════════════ EXIT

  /** Leave: the fluorescent tubes stutter and die one by one → black → main page flickers on. */
  async exitStore() {
    const fromInspected = this.state.is(S.ITEM_INSPECTED);
    if (!this.state.to(S.MARKET_EXITING)) return false;
    this._setHovered(null);
    const seq = this.seq;
    const reduced = this.engine.reducedMotion;
    if (fromInspected && this.inspected) {
      if (!(await seq.run(this.inspection.returnItem(this.inspected, { camera: false })))) return false;
      this.inspected = null;
    }
    if (this.closed) {
      // nothing to switch off: we just walk away from the tape into the dark
      const tl = gsap.timeline();
      tl.add(this.director.moveAlong(['closedFront'], { duration: reduced ? 0.5 : 1.6, ease: 'power2.in' }), 0);
      tl.to(this.engine, { fade: 1, duration: 0.9, ease: 'power2.in' }, 0.5);
      tl.to({}, { duration: 0.5 });
      if (!(await seq.run(tl))) return false;
      this.state.to(S.MARKET_INACTIVE);
      if (this.origin?.restore) await this.origin.restore({ transition: 'flicker' });
      this._emit('exited');
      return true;
    }
    {
      const tl = gsap.timeline();
      tl.call(() => this.director.setDOF(false), null, 0);
      tl.call(() => { this.room._exiting = true; this.desk.setDisplay('CLOSED'); }, null, 0.4);
      const tubes = this.room.tubes;
      const apply = () => this.room.setLampLevel(this.room.lampLevel);
      // each fixture fails on its own, nearest the door first; the last one by the counter holds out
      const order = [...tubes].sort((a, b) => b.id - a.id);
      order.forEach((tube, k) => {
        const start = 0.5 + (reduced ? 0 : k * 0.14 + Math.random() * 0.08);
        const steps = reduced ? [[0, 0.4]] : [[0.25, 0.04], [1, 0.06], [0.1, 0.05], [0.8, 0.07], [0.0, 0.06], [0.5, 0.03], [0.0, 0.12]];
        let at = start;
        for (const [v, dur] of steps) {
          tl.to(tube, { flicker: v, duration: dur, ease: 'none', onUpdate: apply }, at);
          at += dur;
        }
        if (k % 2 === 0) tl.call(() => this.audio.play('lampOn', { position: [0, STORE.room.h, 0.5], gain: 0.35 }), null, start);
      });
      // the room light (lights, not just tubes) dies with them
      const allOut = 0.5 + (reduced ? 0.4 : order.length * 0.14 + 0.5);
      this._lampTo(tl, 0.55, { dur: allOut * 0.6, at: 0.5, ease: 'none' });
      this._lampTo(tl, 0, { dur: 0.15, at: allOut - 0.1, ease: 'none' });
      tl.call(() => { this.audio.stopStoreAmbience(0.4); this.audio.play('lampOn', { gain: 0.8 }); }, null, allOut);
      tl.to(this.engine, { fade: 1, duration: 0.35, ease: 'power2.in' }, allOut + 0.05);
      tl.to({}, { duration: 1.1 });
      if (!(await seq.run(tl))) return false;
    }
    this.state.to(S.MARKET_INACTIVE);
    if (this.origin?.restore) await this.origin.restore({ transition: 'flicker' });
    this._emit('exited');
    return true;
  }

  async forceExit() {
    this.seq.cancel();
    this._resetInternals();
    this.audio.stopAll(0.2);
    if (this.state.is(S.MARKET_INACTIVE)) return true;
    this.state.force(S.MARKET_INACTIVE);
    this.engine.fade = 1;
    if (this.origin?.restore) await this.origin.restore();
    this._emit('exited');
    return true;
  }

  resetStore() {
    this._resetInternals();
    if (this.state.is(S.MARKET_INACTIVE)) return true;
    if (this.state.is(S.MARKET_LOADING)) { this.state.force(S.MARKET_INACTIVE); return true; }
    this.engine.fade = 0;
    this.room.setLampLevel(1);
    this.desk.setDisplay('WELCOME', 'SELF CHECKOUT');
    this.director.set('desk');
    this.state.force(S.MARKET_IDLE);
    return true;
  }

  /** Atmosphere: a single tube stutters. */
  triggerAmbient(name = 'tubeFlicker') {
    if (name !== 'tubeFlicker' || this.room._exiting) return;
    const tube = this.room.tubes[Math.floor(Math.random() * this.room.tubes.length)];
    const tl = gsap.timeline();
    for (const [v, d] of [[0.2, 0.04], [1, 0.05], [0.4, 0.03], [1, 0.08]]) tl.to(tube, { flicker: v, duration: d, ease: 'none' });
    this.audio.play('lampOn', { position: [0, STORE.room.h, 0.5], gain: 0.15 });
  }

  setAmbientEvents(on) {
    this.ambientEnabled = on;
  }

  // generic aliases (shared UI / dev panel)
  enter() { return this.enterStore(); }
  exit() { return this.exitStore(); }
  reset() { return this.resetStore(); }
  onEntered(cb) { return this.onStoreEntered(cb); }
  onExited(cb) { return this.onStoreExited(cb); }

  // ════════════════════════════════════════════════════════════ frame

  _update(dt, t) {
    if (this.engine.activeScene !== this.scene) return;
    this.room.update(dt, t);
    if (this.crime.active) {
      this.crime.update(dt, t);
      // one of the two surviving tubes keeps catching and failing
      const tube = this.room.tubes[2];
      if (tube && !this._closingRun) {
        tube.flicker = (Math.sin(t * 13.1) > 0.92 || Math.random() < 0.004) ? 0.05 : 0.9 + Math.sin(t * 47) * 0.05;
        this.room.setLampLevel(this.room.lampLevel);
      }
    }
    this.director.update(dt, t);
    this.audio.updateListener(this.engine.camera);
    // a rare, random tube stutter while browsing
    if (this.ambientEnabled && !this.closed && this.state.is(S.MARKET_IDLE, S.DEALER_VIEW, S.ITEM_HOVER) && Math.random() < dt / 40) this.triggerAmbient();
    if (this._pointerDirty && this.state.interactive) { this._pointerDirty = false; this._pick(); }
    // keep shadows live while anything moves (+ a short tail so the last pose lands)
    const calm = this.state.is(S.MARKET_IDLE, S.DEALER_VIEW, S.MARKET_INACTIVE) && !this._anyHoverMotion();
    if (!calm) this.scene.userData.shadowsDirty = 10;
  }

  _anyHoverMotion() {
    for (const it of this.desk.items.values()) if (it._hoverTween?.isActive()) return true;
    return false;
  }

  dispose() {
    this.seq.cancel();
    this._unsub?.();
    this.state.dispose();
    const el = this.engine.renderer.domElement;
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerleave', this._onLeave);
    el.removeEventListener('click', this._onClick);
    disposeObject(this.scene);
    this.scene.environment?.dispose();
  }
}

function smooth01(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
