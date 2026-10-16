import * as THREE from 'three';
import gsap from 'gsap';
import { BlackMarketStateManager, S } from './BlackMarketStateManager.js';
import { UndergroundRoom } from './UndergroundRoom.js';
import { MetalDoor } from './MetalDoor.js';
import { MerchandiseDesk } from './MerchandiseDesk.js';
import { DealerCharacter } from './DealerCharacter.js';
import { DealerAnimationController } from './DealerAnimationController.js';
import { BlackMarketCameraDirector, SHOTS } from './BlackMarketCameraDirector.js';
import { ItemInspectionController } from './ItemInspectionController.js';
import { PurchaseAnimationController } from './PurchaseAnimationController.js';
import { AmbientEventScheduler } from './AmbientEventScheduler.js';
import { Sequencer } from '../core/Sequencer.js';
import { disposeObject } from '../core/Engine.js';
import { LAYOUT } from './layout.js';

/**
 * BlackMarketScene — the reusable third environment.
 *
 * Public API (all safe to call at any time; invalid calls are rejected by the
 * state machine and resolve to false):
 *
 *   enterBlackMarket()            exitBlackMarket()
 *   inspectMarketItem(itemId)     returnToMarketDesk()
 *   playPurchaseAnimation(itemId) playDealerTwoTap()
 *   resetBlackMarket()
 *   onBlackMarketEntered(cb)      onBlackMarketExited(cb)
 *   onPurchaseAnimationComplete(cb)          (cb receives itemId)
 *
 * The scene does not know what it was entered from. The host passes
 * `origin.leave()` / `origin.restore()` hooks (the detective desk provides
 * them), which is how the desk keeps its state and never replays its intro.
 */
export class BlackMarketScene {
  constructor({ engine, audio, origin, debug = false, assetBase = '' }) {
    this.engine = engine;
    this.audio = audio;
    this.origin = origin;
    this.assetBase = assetBase;
    this.state = new BlackMarketStateManager({ debug });
    this.seq = new Sequencer();
    this.listeners = { entered: new Set(), exited: new Set(), purchase: new Set(), state: new Set(), tap: new Set() };
    this.pointer = new THREE.Vector2(9, 9);
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;
    this.inspected = null;
    this.ambientEnabled = true;
    this._pointerDirty = false;

    this.state.subscribe((next, prev, meta) => this._onState(next, prev, meta));
    this.ready = this._build();
  }

  // ════════════════════════════════════════════════════════════ build

  async _build() {
    const scene = new THREE.Scene();
    scene.name = 'BlackMarket';
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x030303, 0.11);
    this.scene = scene;

    this.room = new UndergroundRoom();
    this.door = new MetalDoor();
    this.desk = new MerchandiseDesk();
    this.dealer = new DealerCharacter();
    this.stage = new THREE.Group(); this.stage.name = 'Stage';
    scene.add(this.room.group, this.door.group, this.desk.group, this.dealer.group, this.stage);

    this._buildEnvironment();
    this.dealerMode = await this.dealer.load(this.assetBase);

    this.director = new BlackMarketCameraDirector({ camera: this.engine.camera, engine: this.engine });
    this.dealerAnim = new DealerAnimationController({ dealer: this.dealer, desk: this.desk, audio: this.audio });
    if (this.engine.reducedMotion) this.dealerAnim.timeScale = 1.5;
    this.inspection = new ItemInspectionController({ desk: this.desk, stage: this.stage, director: this.director, room: this.room, audio: this.audio });
    this.purchase = new PurchaseAnimationController({
      desk: this.desk, stage: this.stage, dealerAnim: this.dealerAnim, director: this.director,
      inspection: this.inspection, audio: this.audio, room: this.room, seq: this.seq,
    });
    // hands rest ON things (desk, ledger, items, the pouch) — never through them
    this.desk.addDome(this.purchase.pouch, 0.048, 0.066);
    this.dealer.surfaces = this.desk.surfaces;

    this.ambient = new AmbientEventScheduler({
      room: this.room, dealerAnim: this.dealerAnim, audio: this.audio, reducedMotion: this.engine.reducedMotion,
      isAllowed: () => (this.state.is(S.MARKET_IDLE, S.DEALER_VIEW) && !this.dealerAnim.idleTl ? 'idle' : this.state.is(S.ITEM_HOVER) ? 'hover' : null),
    });

    // lamp level drives environment reflections too
    const setLamp = this.room.setLampLevel.bind(this.room);
    this.room.setLampLevel = (v) => {
      setLamp(v);
      scene.environmentIntensity = 0.04 + 0.42 * v;
    };

    this._resetInternals();
    this._unsub = this.engine.onUpdate((dt, t) => this._update(dt, t));
    this._bindPointer();

    // warm up shaders/materials so the first frame inside the market doesn't hitch
    this.engine.precompile(scene);
    return this.dealerMode;
  }

  _buildEnvironment() {
    // A tiny, dark studio for reflections: a warm hot-spot above (the lamp),
    // faint grey walls. Gives metal and glass something real to reflect.
    const r = this.engine.renderer;
    const pm = new THREE.PMREMGenerator(r);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x020202);
    const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), new THREE.MeshBasicMaterial({ color: 0x0c0b0a, side: THREE.BackSide }));
    box.position.y = 1.2;
    env.add(box);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc48a).multiplyScalar(18) }));
    lamp.position.set(0, 2.2, -0.2);
    env.add(lamp);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd8b0).multiplyScalar(0.6), side: THREE.DoubleSide }));
    card.position.set(0, 0.5, -1.5);
    env.add(card);
    this.scene.environment = pm.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = 0.05;
    pm.dispose();
  }

  _resetInternals() {
    this.seq.cancel();
    gsap.killTweensOf(this.room);
    this.inspection.active = null;
    this.inspected = null;
    this.hovered = null;
    this.purchase.reset();
    this.dealerAnim.releaseAll();
    this.ambient.interrupt();
    this.dealerAnim.interruptIdle(false);
    this.desk.resetLayout();
    this.desk.focusLight.intensity = 0;
    this.door.setOpen(0);
    this.room.setDoorOpen(0);
    this.director.setDOF(false);
    this.director.attend(null);
  }

  // ════════════════════════════════════════════════════════════ events

  _emit(type, ...args) { for (const fn of this.listeners[type]) fn(...args); }
  onBlackMarketEntered(cb) { this.listeners.entered.add(cb); return () => this.listeners.entered.delete(cb); }
  onBlackMarketExited(cb) { this.listeners.exited.add(cb); return () => this.listeners.exited.delete(cb); }
  onPurchaseAnimationComplete(cb) { this.listeners.purchase.add(cb); return () => this.listeners.purchase.delete(cb); }
  onStateChange(cb) { this.listeners.state.add(cb); return () => this.listeners.state.delete(cb); }
  onDealerTap(cb) { this.listeners.tap.add(cb); return () => this.listeners.tap.delete(cb); }

  _onState(next, prev, meta) {
    const idle = next === S.MARKET_IDLE || next === S.DEALER_VIEW;
    this.dealerAnim?.setIdleAllowed(idle);
    if (idle || next === S.ITEM_HOVER) {
      if (this.ambientEnabled && !this.ambient._timer) this.ambient.start();
    } else if (this.ambient) {
      this.ambient.stop();
      this.ambient.interrupt();
    }
    if (!this.state.interactive && this.hovered) {
      // cinematics (inspect / purchase) inherit the hover pose; other changes release it softly
      if (next === S.ITEM_SELECTING || next === S.PURCHASE_STARTING) this._handOffHover();
      else this._setHovered(null);
    }
    this.engine.renderer.domElement.style.cursor = next === S.DEALER_VIEW ? 'pointer' : 'default';
    this._emit('state', next, prev, meta);
  }

  // ════════════════════════════════════════════════════════════ lamp helpers

  _lampTo(tl, v, { dur = 0.5, at, ease = 'sine.inOut' } = {}) {
    tl.to(this.room, {
      lampLevel: v, duration: dur, ease,
      onUpdate: () => { this.room.setLampLevel(this.room.lampLevel); this.audio.setLampBuzz(this.room.lampLevel * 0.35, this._lampPos()); },
    }, at);
    return tl;
  }

  _lampPos() { const L = LAYOUT.lamp; return [L.x, L.y, L.z]; }

  /** Irregular power-up flicker of a tungsten lamp. */
  _flickerOn(tl, at) {
    const steps = this.engine.reducedMotion
      ? [[1, 0.8]]
      : [[0.35, 0.05], [0.0, 0.07], [0.0, 0.25], [0.75, 0.04], [0.15, 0.06], [0.0, 0.12], [0.9, 0.05], [0.6, 0.08], [1.0, 0.35]];
    tl.addLabel('flicker', at);
    tl.call(() => this.audio.play('lampOn', { position: this._lampPos(), gain: 0.8 }), null, 'flicker');
    for (const [v, d] of steps) {
      this._lampTo(tl, v, { dur: d, ease: 'none' });
      if (v > 0.5) tl.call(() => this.audio.play('lampOn', { position: this._lampPos(), gain: 0.3 }));
    }
    return tl;
  }

  _doorTo(tl, v, { dur, ease = 'power1.inOut', at } = {}) {
    tl.to(this.door, {
      open: v, duration: dur, ease, onUpdate: () => { this.door.setOpen(this.door.open); this.room.setDoorOpen(this.door.open); },
    }, at);
    return tl;
  }

  _footsteps(tl, from, count, interval = 0.62, gain = 0.5) {
    for (let i = 0; i < count; i++) {
      tl.call(() => this.audio.play('footstep', { gain: gain * (0.85 + Math.random() * 0.3) }), null, from + i * interval);
    }
  }

  // ════════════════════════════════════════════════════════════ ENTER

  async enterBlackMarket() {
    if (!this.state.to(S.MARKET_LOADING)) return false;
    await this.ready;
    await this.audio.unlock();
    // leave wherever we came from (the folders page goes dark)
    if (this.origin?.leave) await this.origin.leave();
    if (!this.state.is(S.MARKET_LOADING)) return false;

    this._resetInternals();
    this.engine.setScene(this.scene);
    this.engine.fade = 1;
    this.dealerAnim.setPreIntro();
    this.room.setLampLevel(1);          // the room is lit — only the closed door hides it
    this.room.setCorridorLevel(0);      // we stand in total darkness
    this.audio.setLampBuzz(0.3, this._lampPos());
    this.director.set('doorway');
    this.state.to(S.MARKET_ENTERING);

    const seq = this.seq;
    const reduced = this.engine.reducedMotion;
    // ── a black screen; silence; the faint hum of something behind a door
    {
      const tl = gsap.timeline();
      tl.call(() => this.audio.startAmbience(3));
      tl.to({}, { duration: 1.4 });
      tl.to(this.engine, { fade: 0, duration: 0.6 }); // still black: the corridor is unlit
      if (!(await seq.run(tl))) return false;
    }
    // ── the door creaks open; a blade of warm light cuts across the dark
    this.state.to(S.DOOR_OPENING);
    {
      const tl = gsap.timeline();
      tl.call(() => this.audio.play('doorCreak', { position: this.door.audioPosition, dur: 3.0, gain: 1 }));
      this._doorTo(tl, 0.05, { dur: 0.4, ease: 'power2.out' });   // the latch gives
      tl.to({}, { duration: 0.35 });
      this._doorTo(tl, 0.86, { dur: 2.6, ease: 'sine.inOut' });
      if (!(await seq.run(tl))) return false;
    }
    // ── we move in on him (camera starts only once the slab is fully open)
    this.state.to(S.ROOM_REVEAL);
    {
      const tl = gsap.timeline();
      tl.add(this.director.moveAlong(['inside', 'dealerClose'], { duration: reduced ? 0.6 : 4.2, ease: 'power2.inOut' }), 0);
      if (!reduced) this._footsteps(tl, 0.5, 4, 0.62, 0.4);
      // the door swings shut behind us with a heavy, muffled thud (the lamp stays on)
      this._doorTo(tl, 0, { dur: 1.3, ease: 'power2.in', at: 2.6 });
      tl.call(() => this.audio.play('doorSlam', { position: this.door.audioPosition, gain: 0.55 }), null, 3.9);
      if (!(await seq.run(tl))) return false;
    }
    // ── a few seconds on the dealer: stillness, the head rises, a silent gesture
    this.state.to(S.DEALER_INTRO);
    {
      const tl = gsap.timeline();
      const intro = this.dealerAnim.intro();
      tl.add(intro, 0);
      // then down onto the table
      tl.add(this.director.moveAlong(['desk'], { duration: reduced ? 0.6 : 2.8, ease: 'power2.inOut' }), Math.max(3.4, intro.duration() - 0.8));
      if (!(await seq.run(tl))) return false;
    }
    this.state.to(S.MARKET_IDLE);
    this._emit('entered');
    return true;
  }

  /** Dev: jump straight into the idle market (no cinematic). */
  async skipEntrance() {
    await this.ready;
    await this.audio.unlock();
    this.seq.cancel();
    if (this.state.is(S.MARKET_INACTIVE) && this.origin?.leave) await this.origin.leave({ instant: true });
    this._resetInternals();
    this.engine.setScene(this.scene);
    this.engine.fade = 0;
    this.dealer.resetPose();
    this.dealer.pose.headPitch = 0.12;
    this.room.setLampLevel(1);
    this.room.setCorridorLevel(0);
    this.audio.startAmbience(0.5);
    this.audio.setLampBuzz(0.35, this._lampPos());
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
      if (this.state.is(S.DEALER_VIEW)) { this.showTable(); return; }
      this._pick();
      if (this.state.interactive && this.hovered) this.inspectMarketItem(this.hovered.id);
    };
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerleave', this._onLeave);
    el.addEventListener('click', this._onClick);
  }

  _pick() {
    if (!this.state.interactive || this.engine.activeScene !== this.scene) return;
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);
    const hit = this.raycaster.intersectObjects(this.desk.hitTargets, false)[0];
    this._setHovered(hit ? hit.object.userData.marketItem : null);
  }

  /**
   * A cinematic is taking over: forget the hover WITHOUT undoing its effects
   * (camera lean, item lift, attention light). The cinematic starts from
   * exactly what is on screen and blends those away itself — no snap, no dip.
   */
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
      this.audio.play('paperSlide', { gain: 0.04, dur: 0.12, position: item.getFocusPoint().toArray() });
      this.director.attend(item.getFocusPoint(), 1);
      this.desk.aimFocusLight(item.getFocusPoint());
      gsap.to(this.desk.focusLight, { intensity: 1.1, duration: 0.3, ease: 'power2.out', overwrite: true });
      this.dealerAnim.interruptIdle(true); // the dealer goes still while you look
      if (this.state.is(S.MARKET_IDLE)) this.state.to(S.ITEM_HOVER, { item: item.id });
      else if (this.state.is(S.ITEM_HOVER)) this._emit('state', S.ITEM_HOVER, S.ITEM_HOVER, { item: item.id });
      el.style.cursor = 'pointer';
    } else {
      // Brief grace period: gliding from one object to the next passes over
      // bare wood — don't swing the camera back to centre in between.
      const release = () => {
        if (this.hovered) return;
        this.director.attend(null);
        gsap.to(this.desk.focusLight, { intensity: 0, duration: 0.35, ease: 'power2.inOut', overwrite: true });
      };
      if (this.state.interactive) this._releaseTimer = setTimeout(release, 220);
      else release(); // leaving the table view: let go now (the camera move bakes the lean)
      if (this.state.is(S.ITEM_HOVER)) this.state.to(S.MARKET_IDLE);
      el.style.cursor = 'default';
    }
  }

  // ════════════════════════════════════════════════════════════ INSPECT

  async inspectMarketItem(itemId) {
    const item = this.desk.items.get(itemId);
    if (!item || item.transferred) return false;
    if (!this.state.to(S.ITEM_SELECTING, { item: itemId })) return false;
    this._handOffHover();
    // other items settle back softly; the chosen one keeps its lift and blends it out in the move
    for (const it of this.desk.items.values()) if (it !== item && it.hover > 0) it.setHover(false);
    this.dealerAnim.interruptIdle(true);
    this.inspected = item;
    const tl = this.inspection.inspect(item, { onSelected: () => this.state.to(S.ITEM_INSPECTING, { item: itemId }) });
    if (!(await this.seq.run(tl))) return false;
    if (this.state.is(S.ITEM_SELECTING)) this.state.to(S.ITEM_INSPECTING, { item: itemId });
    this.state.to(S.ITEM_INSPECTED, { item: itemId });
    return true;
  }

  async returnToMarketDesk() {
    if (!this.state.to(S.ITEM_RETURNING, { item: this.inspected?.id })) return false;
    const item = this.inspected;
    if (!(await this.seq.run(this.inspection.returnItem(item)))) return false;
    this.inspected = null;
    this.state.to(S.MARKET_IDLE);
    this._pointerDirty = true;
    return true;
  }

  /** Pull back from the table to the dealer sitting behind his desk. */
  async showDealer() {
    if (!this.state.to(S.VIEW_CHANGING, { view: 'dealer' })) return false;
    this._setHovered(null);
    const tl = gsap.timeline();
    tl.add(this.director.moveAlong(['dealerView'], { duration: this.engine.reducedMotion ? 0.6 : 2.2, ease: 'power2.inOut' }));
    tl.call(() => this.audio.play('fabric', { gain: 0.15, dur: 0.6 }), null, 0.2);
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.DEALER_VIEW);
    return true;
  }

  /** Lean back in over the table (items become pickable again). */
  async showTable() {
    if (!this.state.to(S.VIEW_CHANGING, { view: 'table' })) return false;
    const tl = gsap.timeline();
    tl.add(this.director.moveAlong(['desk'], { duration: this.engine.reducedMotion ? 0.6 : 2.0, ease: 'power2.inOut' }));
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.MARKET_IDLE);
    this._pointerDirty = true;
    return true;
  }

  /**
   * Context-aware "back":
   *   holding an item → put it back on the table
   *   at the table    → pull back to the dealer sitting
   *   dealer view     → leave the Black Market (lamp flicker → black)
   */
  goBack() {
    if (this.state.is(S.ITEM_INSPECTED)) return this.returnToMarketDesk();
    if (this.state.interactive) return this.showDealer();
    if (this.state.is(S.DEALER_VIEW)) return this.exitBlackMarket();
    return Promise.resolve(false);
  }

  /** What goBack() would do now: 'return' | 'dealer' | 'exit' | null. */
  get backAction() {
    if (this.state.is(S.ITEM_INSPECTED)) return 'return';
    if (this.state.interactive) return 'dealer';
    if (this.state.is(S.DEALER_VIEW)) return 'exit';
    return null;
  }

  // ════════════════════════════════════════════════════════════ PURCHASE

  /**
   * Animation only. Call this AFTER the backend has confirmed the purchase.
   * Resolves true when the ritual completes.
   */
  async playPurchaseAnimation(itemId) {
    const item = this.desk.items.get(itemId);
    if (!item || item.transferred) return false;
    if (this.inspected && this.inspected !== item) return false;
    if (!this.state.can(S.PURCHASE_STARTING)) return false;
    this._setHovered(null);
    this.dealerAnim.interruptIdle(false);
    this.ambient.interrupt();
    const ok = await this.purchase.play(item, {
      step: (s) => this.state.to(s, { item: itemId }),
      onTap: (i) => this._emit('tap', i),
    });
    if (!ok) return false;
    this.inspected = null;
    this.inspection.active = null;
    this.state.to(S.MARKET_IDLE);
    this._emit('purchase', itemId);
    this._pointerDirty = true;
    return true;
  }

  /**
   * Future backend integration: `confirm` is an async function that resolves
   * true/false (e.g. the wallet transaction). The ritual only plays on success.
   */
  async requestPurchase(itemId, confirm) {
    if (!this.state.can(S.PURCHASE_STARTING)) return false;
    let ok = false;
    try { ok = await confirm(itemId); } catch { ok = false; }
    if (!ok) return false;
    return this.playPurchaseAnimation(itemId);
  }

  // ════════════════════════════════════════════════════════════ TWO TAP

  /**
   * The dealer's signature. In the market (idle) the dealer performs it.
   * Anywhere else it plays the motif as a faint, distant sound — the hook for
   * future Dead Drop events on the detective desk.
   */
  async playDealerTwoTap({ distant } = {}) {
    if (this.state.is(S.MARKET_INACTIVE) || distant) {
      await this.audio.unlock();
      this.audio.playTwoTap({ distant: true });
      return true;
    }
    if (!this.state.to(S.DEALER_TWO_TAP)) return false;
    this.dealerAnim.interruptIdle(false);
    const tl = gsap.timeline();
    tl.add(this.dealerAnim.twoTap({ onTap: (i) => this._emit('tap', i) }));
    const settle = gsap.timeline();
    this.dealerAnim.settle(settle, { dur: 0.9, lean: 0.03, headPitch: 0.12 });
    tl.add(settle);
    if (!(await this.seq.run(tl))) return false;
    this.state.to(S.MARKET_IDLE);
    return true;
  }

  // ════════════════════════════════════════════════════════════ EXIT

  async exitBlackMarket() {
    const fromInspected = this.state.is(S.ITEM_INSPECTED);
    if (!this.state.to(S.MARKET_EXITING)) return false;
    this._setHovered(null);
    this.dealerAnim.interruptIdle(false);
    this.ambient.stop(); this.ambient.interrupt();
    const seq = this.seq;
    const reduced = this.engine.reducedMotion;

    // an item in hand is put down first
    if (fromInspected && this.inspected) {
      if (!(await seq.run(this.inspection.returnItem(this.inspected, { camera: false })))) return false;
      this.inspected = null;
    }
    {
      const tl = gsap.timeline();
      // the dealer settles back, perfectly still
      tl.add(this.dealerAnim.withdraw({ deep: false }), 0);
      tl.call(() => this.director.setDOF(false), null, 0);
      // the lamp starts to fail: stutters, dims, catches, dies
      const steps = reduced
        ? [[0, 0.6]]
        : [[0.55, 0.06], [1.0, 0.12], [0.2, 0.05], [0.85, 0.09], [0.0, 0.07], [0.6, 0.05], [0.05, 0.1], [0.4, 0.04], [0.0, 0.25]];
      tl.addLabel('fail', 0.6);
      tl.call(() => this.audio.play('lampOn', { position: this._lampPos(), gain: 0.6 }), null, 'fail');
      let first = true;
      for (const [v, d] of steps) {
        this._lampTo(tl, v, { dur: d, ease: 'none', at: first ? 'fail' : undefined });
        first = false;
      }
      tl.call(() => {
        this.audio.stopLampBuzz();
        this.audio.play('lampOn', { position: this._lampPos(), gain: 0.9 }); // the filament pops
      });
      // everything goes black
      tl.to(this.engine, { fade: 1, duration: 0.35, ease: 'power2.in' });
      tl.call(() => this.audio.stopAmbience(0.8));
      tl.to({}, { duration: 1.1 }); // hold the darkness
      if (!(await seq.run(tl))) return false;
    }
    // the main page comes back with its own flicker (provided by the host)
    this.room.setCorridorLevel(0);
    this.state.to(S.MARKET_INACTIVE);
    if (this.origin?.restore) await this.origin.restore({ transition: 'flicker' });
    this._emit('exited');
    return true;
  }

  /** Dev: leave instantly (no cinematic) and hand control back to the origin. */
  async forceExit() {
    this.seq.cancel();
    this._resetInternals();
    this.audio.stopAll(0.2);
    this.room.setLampLevel(0);
    this.room.setCorridorLevel(0);
    if (this.state.is(S.MARKET_INACTIVE)) return true;
    this.state.force(S.MARKET_INACTIVE);
    this.engine.fade = 1;
    if (this.origin?.restore) await this.origin.restore();
    this._emit('exited');
    return true;
  }

  // ════════════════════════════════════════════════════════════ RESET

  /** Restore the market to its initial arrangement (purchased items return). */
  resetBlackMarket() {
    this._resetInternals();
    this.dealer.resetPose();
    this.dealer.pose.headPitch = 0.12;
    if (this.state.is(S.MARKET_INACTIVE)) return true;
    if (this.state.is(S.MARKET_LOADING)) { this.state.force(S.MARKET_INACTIVE); return true; }
    // inside: snap to the idle desk view
    this.engine.fade = 0;
    this.room.setLampLevel(1);
    this.room.setCorridorLevel(0);
    this.audio.setLampBuzz(0.35, this._lampPos());
    this.director.set('desk');
    this.state.force(S.MARKET_IDLE);
    return true;
  }

  setAmbientEvents(on) {
    this.ambientEnabled = on;
    this.ambient.setEnabled(on && (this.state.is(S.MARKET_IDLE, S.ITEM_HOVER, S.DEALER_VIEW)));
    this.dealerAnim.idleEnabled = on;
    this.dealerAnim.setIdleAllowed(on && this.state.is(S.MARKET_IDLE, S.DEALER_VIEW));
  }

  triggerAmbient(name) { this.ambient.trigger(name); }

  // generic aliases (shared UI / dev panel drive either environment)
  get kind() { return 'blackmarket'; }
  enter() { return this.enterBlackMarket(); }
  exit() { return this.exitBlackMarket(); }
  reset() { return this.resetBlackMarket(); }
  onEntered(cb) { return this.onBlackMarketEntered(cb); }
  onExited(cb) { return this.onBlackMarketExited(cb); }

  // ════════════════════════════════════════════════════════════ frame

  _update(dt, t) {
    if (this.engine.activeScene !== this.scene) return;
    this.room.update(dt, t);
    this.dealer.update(dt, t);
    this.director.update(dt, t);
    this.audio.updateListener(this.engine.camera);
    if (this._pointerDirty && this.state.interactive) { this._pointerDirty = false; this._pick(); }
  }

  dispose() {
    this.seq.cancel();
    this._unsub?.();
    this.ambient?.dispose();
    this.dealerAnim?.dispose();
    this.state.dispose();
    const el = this.engine.renderer.domElement;
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerleave', this._onLeave);
    el.removeEventListener('click', this._onClick);
    disposeObject(this.scene);
    this.scene.environment?.dispose();
  }
}

export { S, SHOTS };
