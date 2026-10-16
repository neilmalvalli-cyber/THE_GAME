import * as THREE from 'three';
import { gsap } from 'gsap';
import { LAYOUT, TIMING, SELECT, STATES as S, buildLayout, buildThrows, impactTimes, layoutExtent } from './config.js';
import { AnimationStateManager } from './core/AnimationStateManager.js';
import { CameraDirector } from './core/CameraDirector.js';
import { CinematicAudioController } from './core/CinematicAudioController.js';
import { DeskEnvironment } from './scene/DeskEnvironment.js';
import { CaseFolder } from './scene/CaseFolder.js';
import { PostFX } from './scene/PostFX.js';
import { createAssets } from './scene/sharedAssets.js';
import { stampSolved, loadFonts } from './scene/textures.js';
import { buildDropTimeline } from './sequences/FolderDropSequence.js';
import { FolderHoverController } from './sequences/FolderHoverController.js';
import { buildOpenTimeline, buildCloseTimeline } from './sequences/FolderOpenSequence.js';
import { BackButton } from './ui/BackButton.js';
import { drawCaseReport } from './scene/caseReport.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/**
 * THE GAME — detective desk sequence.
 *
 * Public API (stable, for later website integration):
 *   await scene.init()
 *   scene.playIntro()             full hand-off from the phone-call intro → slam → idle
 *   scene.playFolderEntrance()    replay just the slam (from the idle desk)
 *   scene.openFolder(id)          1..5
 *   scene.closeFolder()
 *   scene.resetDesk()             hard reset to the idle desk
 *   scene.onFolderOpened(cb)      cb(id) – returns unsubscribe
 *   scene.onStateChange(cb)       cb(next, prev, ctx) – returns unsubscribe
 *   scene.onPolaroidHover(cb)     cb(folderId, index|null) while a file is open
 *   scene.onPolaroidSelect(cb)    cb(folderId, index) – click on a photo (hook for puzzle levels)
 *   scene.setReducedMotion(bool) / scene.setMuted(bool) / scene.unlockAudio()
 *   scene.dispose()
 *
 * Integration additions (THE GAME frontend, all additive):
 *   new DetectiveDeskScene(el, { cases })      case titles typed onto the covers
 *   scene.playIntro({ lightIn: 'flicker' })    light flickers on instead of the slow fade
 *   scene.restoreDesk({ fade })                settled desk without the slam (returning players)
 *   scene.pause() / scene.resume()             stop / restart the render loop while hidden
 *   scene.setSelectedPhoto(folderId, index)    keeps the selected Polaroid lifted
 *   scene.playPhotoSelect(folderId, index)     short "bring it closer" pick, resolves when done
 *   scene.setCaseReport(folderId, report)      typed level report on the inside of the cover
 *   scene.setPhotoStatus(folderId, i, status)  VERIFIED stamp on a solved Polaroid
 */
export class DetectiveDeskScene {
  constructor(container, { reducedMotion, onProgress, backButton = true, cases = null, quality = null } = {}) {
    /** THE GAME: graphics tier ({ pixelRatio, msaa, shadowMap, dof, dust, fpsCap }); null = full quality. */
    this.quality = quality;
    this.useBackButton = backButton;
    this.cases = cases;
    this.paused = false;
    this.tempo = 1;           // >1 tightens open/close without changing their choreography
    this._selectedPhoto = new Map(); // folderId → index kept lifted while the file is open
    this.container = container;
    this.reducedMotion = reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.onProgress = onProgress || (() => {});
    this.state = new AnimationStateManager(S.INTRO_TRANSITION);
    this.audio = new CinematicAudioController();
    this.seq = null;          // the one active top-level timeline
    this.openId = null;
    this.cameraMode = 'intro';
    this._openedCbs = new Set();
    this._photoHoverCbs = new Set();
    this._photoSelectCbs = new Set();
    this._dropCbs = new Set();
    this._focusTarget = new THREE.Vector3(0, 0, 0.3);
    this._focusDesk = new THREE.Vector3(0, 0, 0.3);
    this._focusOpen = new THREE.Vector3(0, SELECT.y + 0.05, SELECT.z);
    this.stats = { fps: 0, pixelRatio: 1, ms: 0, calls: 0, triangles: 0, shadowRenders: 0 };
    this._prCap = 2;
  }

  async init() {
    if (!webglAvailable()) throw new Error('WEBGL_UNAVAILABLE');
    this.onProgress('fonts');
    await loadFonts();

    // renderer
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.quality?.pixelRatio ?? 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.VSMShadowMap;
    // the lamp's soft shadow (blurred VSM) is the most expensive thing on screen: render it
    // only when something that casts it has moved (see _shadowsChanged), not every frame
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.info.autoReset = false; // several passes per frame: count them all
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    r.domElement.style.touchAction = 'none';
    this.container.appendChild(r.domElement);
    this._onContextLost = (e) => { e.preventDefault(); this.container.dispatchEvent(new CustomEvent('webglcontextlost')); };
    r.domElement.addEventListener('webglcontextlost', this._onContextLost);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 80);
    this.cameraDirector = new CameraDirector(this.camera);
    this.cameraDirector.reducedMotion = this.reducedMotion;

    // let the loading text paint before the heavy texture generation
    await new Promise((res) => setTimeout(res, 30)); // (not rAF: it never fires in a hidden tab)
    this.onProgress('wood');
    this.env = new DeskEnvironment(r, this.scene, { reducedMotion: this.reducedMotion });
    await new Promise((res) => setTimeout(res, 0));
    this.onProgress('files');
    // one file per case: layout, throws and timing all derive from the case list
    const count = this.cases?.length ?? LAYOUT.length;
    this.layout = buildLayout(count);
    this.throws = buildThrows(count);
    this.impacts = impactTimes(count);
    if (count !== LAYOUT.length) { // five keep the authored framing
      const ext = layoutExtent(this.layout);
      this.cameraDirector.setDeskExtent(ext);
      this._focusDesk.set(ext.cx, 0, ext.cz);
    }
    this.assets = createAssets(r, count, this.cases);

    this.folders = this.layout.map((layout, i) => {
      const f = new CaseFolder({ id: layout.id, layout, throwCfg: this.throws[i], shared: this.assets.shared, textures: this.assets.perFolder[i] });
      this.scene.add(f.group);
      this.scene.add(f.blob);
      return f;
    });

    this.post = new PostFX(r, this.scene, this.camera, { samples: this.quality?.msaa ?? 4 });
    if (this.reducedMotion) this.post.setDofEnabled(false);
    if (this.quality) this.setQuality(this.quality, { resize: false });

    this.hover = new FolderHoverController({
      dom: r.domElement, camera: this.camera, folders: this.folders, state: this.state, audio: this.audio,
      onSelect: (id) => this.openFolder(id),
      getOpenFolder: () => (this.state.is(S.FOLDER_OPEN) ? this.folders.find((f) => f.id === this.openId) : null),
      onPhotoHover: (fid, i) => { for (const cb of this._photoHoverCbs) cb(fid, i); },
      onPhotoSelect: (fid, i, pointerType) => { for (const cb of this._photoSelectCbs) cb(fid, i, pointerType); },
      getSelectedPhoto: (fid) => this._selectedPhoto.get(fid) ?? null,
    });
    this.hover.reducedMotion = this.reducedMotion;

    if (this.useBackButton) {
      this.backButton = new BackButton(this.container, () => this.closeFolder());
      this.state.subscribe((next) => this.backButton.show(next === S.FOLDER_OPEN));
    }

    this._resize = () => this.resize();
    this._ro = new ResizeObserver(this._resize);
    this._ro.observe(this.container);
    this.resize();

    // initial: black, folders hidden, camera at the intro pose
    this._prepareIntro();
    // pre-compile shaders & upload textures so the first frames don't hitch
    this.folders.forEach((f) => { f.group.visible = true; });
    r.compile(this.scene, this.camera);
    // compile() builds programs but uploads a texture only when its object is first drawn,
    // and from the intro camera most files are out of view: their covers and photos would
    // then upload (with mipmaps) in the frame each file is thrown in — a visible hitch on
    // the first throw. Upload every texture now, while the desk is still hidden.
    const uploaded = new Set();
    this.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) for (const k in m) {
        const v = m[k];
        if (v && v.isTexture && !uploaded.has(v)) { uploaded.add(v); r.initTexture(v); }
      }
    });
    this.post.render(0, 0);
    this.folders.forEach((f) => { f.group.visible = false; f.update(true); });

    this.clock = new THREE.Clock();
    this._frames = 0; this._fpsT = 0;
    r.setAnimationLoop(() => this._tick());
    this.onProgress('ready');
    return this;
  }

  // ---------------------------------------------------------------- loop ---
  _tick() {
    // frame cap (LOW tier): skip frames until the interval has passed, keep time continuous
    this._acc = (this._acc || 0) + this.clock.getDelta();
    const cap = this.quality?.fpsCap || 0;
    if (cap && this._acc < 1 / cap - 0.004) return;
    const raw = this._acc;
    this._acc = 0;
    const dt = Math.min(raw, 0.05);
    const t = this.clock.elapsedTime;
    const t0 = performance.now();
    this.env.update(t);
    for (const f of this.folders) f.update();
    this.cameraDirector.update(t, dt);
    this.hover.update();
    // focus pull: follow the desk or the opened file
    this._focusTarget.lerp(this.openId != null ? this._focusOpen : this._focusDesk, 1 - Math.pow(0.002, dt));
    this.post.dof.focus = this.camera.position.distanceTo(this._focusTarget);
    if (this._shadowsChanged()) { this.renderer.shadowMap.needsUpdate = true; this.stats.shadowRenders++; }
    this.renderer.info.reset();
    this.post.render(t, dt);
    this._ms = (this._ms || 0) * 0.9 + (performance.now() - t0) * 0.1;
    this._frames++; this._fpsT += raw;
    if (this._fpsT >= 0.5) {
      this.stats.fps = Math.round(this._frames / this._fpsT); this._frames = 0; this._fpsT = 0;
      // adaptive resolution: step the pixel ratio down if we can't hold ~45 fps
      // only re-size while the desk is calm: a resolution change re-allocates the render
      // targets, which mid-slam or mid-open shows up as a hitch in the animation
      const calm = this.state.is(S.DESK_IDLE, S.FOLDER_HOVER, S.FOLDER_OPEN) && !gsap.isTweening(this.cameraDirector.base);
      if (!calm) this._lowCount = 0;
      else if (document.visibilityState === 'visible' && t > 3) {
        this._lowCount = this.stats.fps < 45 ? (this._lowCount || 0) + 1 : 0;
        if (this._lowCount >= 4 && this._prCap > 1) {
          this._prCap = Math.max(1, this._prCap - 0.25);
          this._lowCount = 0;
          this.resize();
        }
      }
      this.stats.pixelRatio = this.renderer.getPixelRatio();
      this.stats.ms = +this._ms.toFixed(1);
      this.stats.calls = this.renderer.info.render.calls;
      this.stats.triangles = this.renderer.info.render.triangles;
      // still too slow at the lowest resolution: tell the app (AUTO quality steps down a tier)
      if (calm && document.visibilityState === 'visible' && t > 5 && this._prCap <= 1 && this.stats.fps < 28) {
        this._slowCount = (this._slowCount || 0) + 1;
        if (this._slowCount >= 6) { this._slowCount = 0; this.onSlow?.(); }
      } else this._slowCount = 0;
    }
  }

  /** True when any shadow caster moved / appeared since the last shadow render. */
  _shadowsChanged() {
    if (!this._casters) {
      this._casters = [];
      this.scene.traverse((o) => { if (o.isMesh && o.castShadow) this._casters.push(o); });
      this._casterSig = new Float64Array(this._casters.length * 4);
    }
    this.scene.updateMatrixWorld();
    let changed = false;
    const sig = this._casterSig;
    for (let i = 0; i < this._casters.length; i++) {
      const o = this._casters[i], e = o.matrixWorld.elements;
      let vis = o.visible;
      for (let p = o.parent; vis && p; p = p.parent) vis = p.visible;
      const a = e[12] + e[13] * 3.1 + e[14] * 7.3, b = e[0] + e[5] * 1.7 + e[10] * 2.9 + e[4] * 0.37 + e[8] * 0.53, c = e[1] + e[2] * 1.3 + e[6] * 2.1;
      const v = vis ? 1 : 0, k = i * 4;
      if (sig[k] !== a || sig[k + 1] !== b || sig[k + 2] !== c || sig[k + 3] !== v) { sig[k] = a; sig[k + 1] = b; sig[k + 2] = c; sig[k + 3] = v; changed = true; }
    }
    return changed;
  }

  /** THE GAME: apply a graphics tier live (resolution, MSAA, shadow size, DOF, dust, frame cap). */
  setQuality(q, { resize = true } = {}) {
    this.quality = q;
    if (!this.renderer) return;
    this._prCap = q.pixelRatio;
    this.post.setSamples(q.msaa);
    this.post.qualityDof = q.dof;
    this.post.setDofEnabled(!this.reducedMotion);
    const sh = this.env.lamp.shadow;
    if (sh.mapSize.x !== q.shadowMap) {
      sh.mapSize.set(q.shadowMap, q.shadowMap);
      sh.map?.dispose(); sh.map = null;
      sh.mapPass?.dispose?.(); sh.mapPass = null;
    }
    this.env.setDust?.(q.dust);
    this.renderer.shadowMap.needsUpdate = true;
    if (resize) this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const pr = Math.min(window.devicePixelRatio, this._prCap ?? 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
    // keep framing correct on resize when the camera is parked
    // Re-frame only a parked camera. getTweensOf() also sees moves that are scheduled but not
    // yet started (the intro's camera move begins 0.15 s in): isTweening() missed those, so a
    // resize in that window snapped to the intro pose and killed the move to the desk.
    if (gsap.getTweensOf(this.cameraDirector.base).length === 0) {
      if (this.cameraMode === 'desk') this.cameraDirector.set(this.cameraDirector.deskPose());
      else if (this.cameraMode === 'open') this.cameraDirector.set(this.cameraDirector.openPose());
      else if (this.cameraMode === 'intro' && this.state.is(S.INTRO_TRANSITION)) this.cameraDirector.set(this.cameraDirector.introPose());
    }
  }

  // ------------------------------------------------------------- helpers ---
  _killSeq() {
    if (this.seq) { this.seq.kill(); this.seq = null; }
    this.cameraDirector.kill();
    gsap.killTweensOf([this.env.levels, this.env.reading, this.env.lampTarget.position, this.post.dof, this.post.fade, this.cameraDirector]);
    for (const f of this.folders) { gsap.killTweensOf(f.pose); gsap.killTweensOf(f.cover); }
  }

  _restoreLook() {
    this.env.levels.lamp = 1; this.env.levels.ambient = 1; this.env.reading.level = 0;
    this.env.lampTarget.position.set(0.6, 0, 0.5);
    this.post.dof.aperture = this.post.dofDesk;
    this.post.fade.value = 0;
    this.cameraDirector.drift = 1;
  }

  _prepareIntro() {
    for (const f of this.folders) { f.resetToRest(); f.phase = 'WAITING'; f.group.visible = false; f.update(true); }
    this._restoreLook();
    this.env.levels.lamp = 0.0;
    this.env.levels.ambient = 0.0;
    this.post.fade.value = 1;
    this.cameraMode = 'intro';
    this.cameraDirector.set(this.cameraDirector.introPose());
  }

  _dropInto(tl, at, immediate = false) {
    // Reset every file to rest *now* (when the sequence is built), not in the frame the
    // first file launches: five cover re-deforms in that frame made the first throw hitch.
    // playIntro has already reset them in _prepareIntro; a replay does it here.
    if (immediate) for (const f of this.folders) { f.resetToRest(); f.group.visible = false; f.update(true); }
    const begin = () => {
      this.state.transition(S.FOLDERS_DROPPING);
      for (const f of this.folders) f.group.visible = false;
    };
    const drop = buildDropTimeline({
      folders: this.folders, throws: this.throws, impacts: this.impacts, audio: this.audio, cameraDirector: this.cameraDirector, reduced: this.reducedMotion,
      onLaunch: (id) => { for (const cb of this._dropCbs) cb('launch', id); },
      onLand: (id) => { for (const cb of this._dropCbs) cb('land', id); },
    });
    // start early by the drop's lead-in so the first impact still lands on time
    const start = Math.max(0, at - (drop.data?.lead ?? 0));
    if (immediate) begin(); else tl.call(begin, null, start);
    tl.add(drop, start);
    tl.call(() => {
      for (const f of this.folders) { Object.assign(f.pose, f.rest); f.group.visible = true; }
      this.state.transition(S.DESK_IDLE);
      this.hover.refresh();
    });
  }

  // ---------------------------------------------------------- public API ---
  async unlockAudio() { await this.audio.unlock(); }

  /** Darkness → reveal the table → five files slam down → interactive.
   *  `lightIn: 'flicker'` — the room light stutters on (after the phone call) instead of fading up. */
  playIntro({ lightIn = 'fade' } = {}) {
    this._killSeq();
    this.hover.clear();
    this.openId = null;
    this.state.force(S.INTRO_TRANSITION);
    this._prepareIntro();
    const rm = this.reducedMotion;
    const tl = gsap.timeline();
    if (lightIn === 'flicker' && !rm) {
      // dims · dark · weak flicker · dark · sudden light · small wobble · steady (~1.2 s)
      const steps = [[0.18, 0.08], [0, 0.1], [0.32, 0.05], [0.08, 0.07], [0, 0.18], [1, 0.03], [0.72, 0.08], [0.95, 0.07], [0.86, 0.09], [1, 0.25]];
      let at = 0;
      for (const [v, d] of steps) {
        tl.to(this.post.fade, { value: 1 - v, duration: d, ease: 'none' }, at);
        tl.to(this.env.levels, { lamp: v, ambient: v, duration: d, ease: 'none' }, at);
        at += d;
      }
    } else {
      tl.to(this.post.fade, { value: 0, duration: rm ? 0.6 : TIMING.introFade, ease: 'power1.inOut' }, 0);
      tl.to(this.env.levels, { lamp: 1, duration: rm ? 0.5 : 1.6, ease: 'power2.out' }, rm ? 0 : 0.25);
      tl.to(this.env.levels, { ambient: 1, duration: rm ? 0.5 : 2.2, ease: 'power1.inOut' }, 0.1);
    }
    // after the flicker the room is already lit, so the move to the desk can be brisker
    const camDur = lightIn === 'flicker' ? 2.3 : TIMING.introCamera;
    if (rm) tl.call(() => this.cameraDirector.set(this.cameraDirector.deskPose()), null, 0);
    else tl.add(this.cameraDirector.to(this.cameraDirector.deskPose(), camDur, 'power3.inOut'), 0.15);
    tl.call(() => { this.cameraMode = 'desk'; }, null, rm ? 0 : 0.15 + camDur);
    this._dropInto(tl, rm ? 0.6 : 0.15 + camDur);
    this.seq = tl;
    return tl;
  }

  /** Replay only the slam, from the idle desk. */
  playFolderEntrance() {
    if (!this.state.is(S.DESK_IDLE, S.FOLDER_HOVER)) return false;
    this._killSeq();
    this.hover.clear();
    this._restoreLook();
    this.cameraMode = 'desk';
    this.cameraDirector.set(this.cameraDirector.deskPose());
    const tl = gsap.timeline();
    this._dropInto(tl, 0, true);
    this.seq = tl;
    return true;
  }

  openFolder(id) {
    const f = this.folders.find((x) => x.id === id);
    if (!f || !this.state.is(S.DESK_IDLE, S.FOLDER_HOVER)) return false;
    if (!this.state.transition(S.FOLDER_SELECTING, { folderId: id })) return false;
    this.hover.release(id);
    this.openId = id;
    f.phase = 'SELECTING';
    this.cameraMode = 'open';
    if (this.seq) this.seq.kill();
    this.seq = buildOpenTimeline({
      folder: f, env: this.env, cameraDirector: this.cameraDirector, audio: this.audio, post: this.post, reduced: this.reducedMotion,
      on: {
        opening: () => { f.phase = 'OPENING'; this.state.transition(S.FOLDER_OPENING, { folderId: id }); },
        open: () => {
          f.phase = 'OPEN';
          const sel = this._selectedPhoto.get(id);
          if (sel != null) f.polaroids.hover(sel, true, this.reducedMotion);
          this.state.transition(S.FOLDER_OPEN, { folderId: id });
          for (const cb of this._openedCbs) cb(id);
          this.hover.refresh();
        },
      },
    });
    this.seq.timeScale(this.seq.timeScale() * this.tempo);
    return true;
  }

  closeFolder() {
    if (!this.state.is(S.FOLDER_OPEN)) return false;
    const id = this.openId, f = this.folders.find((x) => x.id === id);
    this.hover.clearPhotos();
    f.phase = 'CLOSING';
    this.state.transition(S.FOLDER_CLOSING, { folderId: id });
    if (this.seq) this.seq.kill();
    this.seq = buildCloseTimeline({
      folder: f, env: this.env, cameraDirector: this.cameraDirector, audio: this.audio, post: this.post, reduced: this.reducedMotion,
      on: {
        returning: () => { this.state.transition(S.FOLDER_RETURNING, { folderId: id }); this.openId = null; this.cameraMode = 'desk'; },
        done: () => { f.phase = 'IDLE'; this.state.transition(S.DESK_IDLE); this.hover.refresh(); },
      },
    });
    this.seq.timeScale(this.seq.timeScale() * this.tempo);
    return true;
  }

  /** Hard reset: everything exactly at rest, desk view, interactive. */
  resetDesk() {
    this._killSeq();
    this.hover.clear();
    this.openId = null;
    for (const f of this.folders) { f.resetToRest(); f.phase = 'IDLE'; f.group.visible = true; f.update(true); }
    this._restoreLook();
    this.cameraMode = 'desk';
    this.cameraDirector.set(this.cameraDirector.deskPose());
    this._focusTarget.copy(this._focusDesk);
    this.state.force(S.DESK_IDLE);
  }

  /** Settled desk, no slam: for players returning to a desk they have already seen. */
  restoreDesk({ fade = 0.6 } = {}) {
    this.resetDesk();
    if (fade > 0 && !this.reducedMotion) {
      this.post.fade.value = 1;
      gsap.to(this.post.fade, { value: 0, duration: fade, ease: 'power1.out' });
    }
  }

  /** Stop rendering while the desk is hidden (timelines keep their state). */
  pause() {
    if (this.paused || !this.renderer) return;
    this.paused = true;
    this.renderer.setAnimationLoop(null);
  }

  resume() {
    if (!this.paused || !this.renderer) return;
    this.paused = false;
    // swallow the time spent hidden, keeping elapsed time continuous (camera drift, dust and
    // lamp flicker are functions of it — a jump would snap the view on return)
    const elapsed = this.clock.elapsedTime;
    this.clock.getDelta();
    this.clock.elapsedTime = elapsed;
    this.resize();
    this.hover.refresh();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  /** The Polaroid that stays lifted while its file is open (null clears). */
  setSelectedPhoto(folderId, index) {
    const prev = this._selectedPhoto.get(folderId) ?? null;
    if (index == null) this._selectedPhoto.delete(folderId); else this._selectedPhoto.set(folderId, index);
    const f = this.folders?.find((x) => x.id === folderId);
    if (!f || !this.state.is(S.FOLDER_OPEN) || this.openId !== folderId) return;
    const hovered = this.hover.hoveredPhoto?.folderId === folderId ? this.hover.hoveredPhoto.index : null;
    if (prev != null && prev !== index && prev !== hovered) f.polaroids.hover(prev, false, this.reducedMotion);
    if (index != null) f.polaroids.hover(index, true, this.reducedMotion);
  }

  /** Short pick-up: the photo comes toward the viewer. Resolves when it has. */
  playPhotoSelect(folderId, index) {
    const f = this.folders?.find((x) => x.id === folderId);
    if (!f || !this.state.is(S.FOLDER_OPEN)) return Promise.resolve(false);
    this.audio.photoShift(folderId * 10 + index);
    return f.polaroids.pick(index, this.reducedMotion).then(() => true);
  }

  /** Redraw the typed report on the inside of a file's cover (left page when open). */
  setCaseReport(folderId, report) {
    const f = this.folders?.find((x) => x.id === folderId);
    if (!f) return;
    const map = f.materials.coverInner.map;
    if (!map.userData.base) {
      const base = document.createElement('canvas');
      base.width = map.image.width; base.height = map.image.height;
      base.getContext('2d').drawImage(map.image, 0, 0);
      map.userData.base = base;
    }
    const ctx = map.image.getContext('2d');
    ctx.drawImage(map.userData.base, 0, 0);
    if (report) drawCaseReport(ctx, map.image.width, map.image.height, report);
    map.needsUpdate = true;
  }

  /** THE GAME: SOLVED stamp + earned fragment on a file's cover (null clears it). */
  setCaseSolved(folderId, fragment) {
    const f = this.folders?.find((x) => x.id === folderId);
    const map = f?.materials.coverOuter.map;
    if (!map?.image?.getContext) return;
    if (!map.userData.base) {
      const base = document.createElement('canvas');
      base.width = map.image.width; base.height = map.image.height;
      base.getContext('2d').drawImage(map.image, 0, 0);
      map.userData.base = base;
    }
    const key = fragment == null ? null : String(fragment);
    if (map.userData.solved === key) return;
    map.userData.solved = key;
    const ctx = map.image.getContext('2d');
    ctx.drawImage(map.userData.base, 0, 0);
    if (key != null) stampSolved(ctx, map.image.width, map.image.height, folderId, key);
    map.needsUpdate = true;
  }

  /** Mark a Polaroid (e.g. { completed: true } draws a VERIFIED stamp). */
  setPhotoStatus(folderId, index, status) {
    const f = this.folders?.find((x) => x.id === folderId);
    f?.polaroids.setStatus(index, status);
  }

  onFolderOpened(cb) { this._openedCbs.add(cb); return () => this._openedCbs.delete(cb); }
  onStateChange(cb) { return this.state.subscribe(cb); }
  onPolaroidHover(cb) { this._photoHoverCbs.add(cb); return () => this._photoHoverCbs.delete(cb); }
  /** cb('launch' | 'land', folderId) during the slam – e.g. to sync UI or analytics. */
  onFolderDrop(cb) { this._dropCbs.add(cb); return () => this._dropCbs.delete(cb); }
  onPolaroidSelect(cb) { this._photoSelectCbs.add(cb); return () => this._photoSelectCbs.delete(cb); }
  getState() { return this.state.state; }

  setReducedMotion(v) {
    this.reducedMotion = v;
    this.cameraDirector.reducedMotion = v;
    this.hover.reducedMotion = v;
    this.env.setReducedMotion(v);
    this.post.setDofEnabled(!v);
  }

  setMuted(m) { this.audio.setMuted(m); }

  /** Debug/test helper: max deviation of every folder from its rest transform. */
  measureDrift() {
    let max = 0;
    for (const f of this.folders) for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz']) max = Math.max(max, Math.abs(f.pose[k] - f.rest[k]));
    return max;
  }

  dispose() {
    this.paused = true;
    this._killSeq();
    this.renderer.setAnimationLoop(null);
    this._ro?.disconnect();
    this.hover.dispose();
    this.backButton?.dispose();
    this.folders.forEach((f) => { this.scene.remove(f.group); this.scene.remove(f.blob); f.dispose(); });
    this.assets.dispose();
    this.env.dispose();
    this.post.dispose();
    this.audio.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this._openedCbs.clear();
  }
}
