// Owns the one DetectiveDeskScene for the whole team session.
//
// The scene is created once, kept mounted in a persistent container, and
// paused (not destroyed) while hidden. The route only sets a *target*
// ("file 3 open" / "all files on the desk" / "leave as is"); reconcile()
// moves the scene toward it using the scene's own legal transitions, and
// runs again on every state change. Rapid navigation therefore never
// overlaps timelines — a request made mid-animation is applied when the
// current animation settles.
import { DetectiveDeskScene, webglAvailable, type CaseReport, type DeskState } from './engine/DetectiveDeskScene.js';
import { profile, onQuality, useQuality } from '../../perf/quality';
import { isCaseSolved } from '../../services/scoring';
import { getCaseFragment } from '../../services/phone';
import { CASES, getLevel, levelKey, pad2 } from '../../data/cases';
import { useGameStore } from '../../state/gameStore';
import { useSceneStore } from '../../state/sceneStore';
import { playLightSwitch } from '../../audio/uiAudio';

type Target = number | null | 'keep';
type Listener<A extends unknown[]> = (...args: A) => void;

const SETTLED: ReadonlySet<DeskState> = new Set(['DESK_IDLE', 'FOLDER_HOVER', 'FOLDER_OPEN']);

class DeskController {
  readonly el: HTMLDivElement;
  private scene: DetectiveDeskScene | null = null;
  private initPromise: Promise<void> | null = null;
  private target: Target = 'keep';
  private revealed = false;
  private visible = false;
  private running = false;
  private hoverPhoto: { caseId: number; index: number } | null = null;
  private userOpenListeners = new Set<Listener<[number]>>();
  private photoSelectListeners = new Set<Listener<[number, number, string | undefined]>>();
  private unsubs: (() => void)[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'scene-layer scene-layer--desk';
    this.el.setAttribute('aria-label', 'Detective desk with five case files');
    this.el.style.visibility = 'hidden';
  }

  get instance() { return this.scene; }
  get isRevealed() { return this.revealed; }

  // ------------------------------------------------------------ lifecycle
  attach(host: HTMLElement) {
    this.el.classList.remove('scene-layer--parked');
    if (this.el.parentElement !== host) host.appendChild(this.el);
  }

  /** The team interface unmounted: keep the built desk, hidden and paused, for the next visit. */
  detach() {
    this.park();
  }

  private park() {
    this.setRunning(false);
    this.setVisible(false);
    this.el.classList.add('scene-layer--parked');
    if (this.el.parentElement !== document.body) document.body.appendChild(this.el);
  }

  /**
   * Build the desk ahead of time (procedural textures take a few seconds of main-thread
   * work). Called when the browser is idle on the role screen, so the phone intro never
   * has to share the main thread with it.
   */
  preload() {
    if (this.initPromise) return;
    if (!this.el.parentElement) this.park();
    void this.init();
  }

  /**
   * The desk's foley (whooshes, slams, paper) runs on its own AudioContext, which browsers
   * only allow after a user gesture. Called from the Team Login click, and again on reveal.
   */
  unlockAudio() {
    void this.scene?.unlockAudio().catch(() => undefined);
  }

  /** Resolves once the desk is built (or failed to build). */
  whenReady(): Promise<void> {
    return this.initPromise ?? Promise.resolve();
  }

  /** Team Login starts a new session: same built scene, revealed afresh after the call. */
  resetForNewSession() {
    this.revealed = false;
    this.target = 'keep';
    this.hoverPhoto = null;
    this.setRunning(false);
    this.setVisible(false);
    if (this.scene) useSceneStore.getState().set({ deskPhase: 'ready', deskState: this.scene.getState(), deskOpenId: null });
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    const store = useSceneStore.getState();
    if (!webglAvailable()) {
      store.set({ deskPhase: 'error', deskError: 'WEBGL_UNAVAILABLE' });
      this.initPromise = Promise.resolve();
      return this.initPromise;
    }
    store.set({ deskPhase: 'loading', deskError: null });
    const scene = new DetectiveDeskScene(this.el, { backButton: false, cases: CASES.map((c) => ({ title: c.title })), quality: profile() });
    scene.onSlow = () => useQuality.getState().reportSlow();
    onQuality((_q, p) => scene.setQuality(p));
    this.initPromise = scene.init().then(
      () => {
        this.scene = scene;
        scene.tempo = 1.25; // folder open/close: same choreography, tighter rhythm
        scene.setMuted(useGameStore.getState().settings.muted);
        scene.pause(); // rendered once for warm-up; nothing to show until revealed
        this.bind(scene);
        this.syncProgress();
        useSceneStore.getState().set({ deskPhase: 'ready', deskState: scene.getState() });
        this.el.dataset.phase = 'ready'; // observable build state (debugging / tests)
      },
      (err: Error) => {
        console.error('[desk] init failed', err);
        useSceneStore.getState().set({ deskPhase: 'error', deskError: err?.message || 'INIT_FAILED' });
      },
    );
    return this.initPromise;
  }

  private bind(scene: DetectiveDeskScene) {
    this.unsubs.push(scene.onStateChange((next, prev, ctx) => {
      useSceneStore.getState().set({ deskState: next, deskOpenId: scene.openId });
      if (next === 'FOLDER_SELECTING' && ctx.folderId != null && this.target !== ctx.folderId) {
        // the player clicked a file on the desk: that becomes the target
        this.target = ctx.folderId;
        for (const cb of this.userOpenListeners) cb(ctx.folderId);
      }
      if (next === 'FOLDER_OPEN' && ctx.folderId != null) this.showReport(ctx.folderId);
      if (next === 'DESK_IDLE' && (prev === 'FOLDERS_DROPPING' || prev === 'FOLDER_RETURNING')) useGameStore.getState().markDeskLanded();
      if (useSceneStore.getState().deskPhase === 'revealing' && next === 'DESK_IDLE') useSceneStore.getState().set({ deskPhase: 'revealed' });
      queueMicrotask(() => this.reconcile());
    }));
    this.unsubs.push(scene.onPolaroidHover((caseId, index) => {
      this.hoverPhoto = caseId != null && index != null ? { caseId, index } : null;
      const open = scene.openId;
      if (open != null) this.showReport(open);
    }));
    this.unsubs.push(scene.onPolaroidSelect((caseId, index, pointerType) => {
      for (const cb of this.photoSelectListeners) cb(caseId, index, pointerType);
    }));
    // progress changes (a level solved, a selection restored) redraw the open file
    this.unsubs.push(useGameStore.subscribe((s, prev) => {
      if (s.progress !== prev.progress) this.syncProgress();
      if (s.settings.muted !== prev.settings.muted) scene.setMuted(s.settings.muted);
    }));
  }

  // ------------------------------------------------------------ events
  onUserOpen(cb: Listener<[number]>) { this.userOpenListeners.add(cb); return () => { this.userOpenListeners.delete(cb); }; }
  onPhotoSelect(cb: Listener<[number, number, string | undefined]>) { this.photoSelectListeners.add(cb); return () => { this.photoSelectListeners.delete(cb); }; }

  // ------------------------------------------------------------ reveal
  /**
   * First appearance of the desk this session.
   *  'flicker'  — after the phone intro: silence, a switch, the light stutters on, the files slam down
   *  'landing'  — the files slam down after a normal fade (first visit without the intro)
   *  'restore'  — the desk as the player left it (returning, refresh, deep link)
   */
  async reveal(mode: 'flicker' | 'landing' | 'restore') {
    await this.init();
    const scene = this.scene;
    if (!scene || this.revealed) return;
    this.revealed = true;
    this.unlockAudio();
    this.setVisible(true);
    this.setRunning(true);
    if (mode === 'restore') {
      scene.restoreDesk({ fade: 0.7 });
      useGameStore.getState().markDeskLanded();
      useSceneStore.getState().set({ deskPhase: 'revealed', deskState: scene.getState() });
      this.reconcile();
      return;
    }
    useSceneStore.getState().set({ deskPhase: 'revealing' });
    if (mode === 'flicker') {
      // the call has already ended in darkness (the intro holds black for a second):
      // a short beat, then the switch — any longer reads as the page having stalled
      scene.post.fade.value = 1;
      await new Promise((r) => setTimeout(r, scene.reducedMotion ? 60 : 150));
      if (!this.scene) return;
      scene.playIntro({ lightIn: 'flicker' });
      window.setTimeout(playLightSwitch, scene.reducedMotion ? 0 : 480);
    } else {
      scene.playIntro();
    }
  }

  /** Dev: replay the five-file landing from the idle desk. */
  replayLanding(): boolean {
    if (!this.scene || !this.revealed) return false;
    return this.scene.playFolderEntrance();
  }

  // ------------------------------------------------------------ visibility
  setVisible(v: boolean) {
    if (this.visible === v) return;
    this.visible = v;
    this.el.style.visibility = v ? 'visible' : 'hidden';
  }

  /** Render loop on/off. Audio is suspended with it. */
  setRunning(on: boolean) {
    const scene = this.scene;
    if (!scene || this.running === on) return;
    this.running = on;
    if (on) {
      scene.resume();
      void scene.audio.ctx?.resume().catch(() => undefined);
    } else {
      scene.pause();
      void scene.audio.ctx?.suspend().catch(() => undefined);
    }
  }

  /** The desk light goes down (leaving for the Black Market). */
  fadeOut(duration = 0.6): Promise<void> {
    const scene = this.scene;
    if (!scene || !this.visible) return Promise.resolve();
    return new Promise((resolve) => {
      const start = scene.post.fade.value, t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / (duration * 1000));
        scene.post.fade.value = start + (1 - start) * k;
        if (k < 1 && this.running) requestAnimationFrame(step); else { scene.post.fade.value = 1; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  /** Undo a fadeOut that was not followed by entering the market (the player changed their mind). */
  fadeIn(duration = 0.45): Promise<void> {
    const scene = this.scene;
    if (!scene) return Promise.resolve();
    return new Promise((resolve) => {
      const start = scene.post.fade.value, t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / (duration * 1000));
        scene.post.fade.value = start * (1 - k);
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Back from the Black Market: the same desk, light flickering back on. */
  async returnFromMarket(flicker: (set: (v: number) => void) => Promise<void>) {
    await this.init();
    const scene = this.scene;
    if (!scene) return;
    if (!this.revealed) { this.revealed = true; scene.resetDesk(); useGameStore.getState().markDeskLanded(); }
    useSceneStore.getState().set({ deskPhase: 'revealed', deskState: scene.getState() });
    scene.post.fade.value = 1;
    this.setVisible(true);
    this.setRunning(true);
    await flicker((v) => { scene.post.fade.value = 1 - v; });
    this.reconcile();
  }

  // ------------------------------------------------------------ route target
  /** number: that file open · null: all files on the desk · 'keep': leave it as it is. */
  setTarget(t: Target) {
    if (t === 'keep') return;
    this.target = t;
    this.reconcile();
  }

  reconcile() {
    const scene = this.scene;
    if (!scene || !this.revealed || this.target === 'keep') return;
    const state = scene.getState();
    if (!SETTLED.has(state)) return; // an animation owns the desk; we run again when it settles
    const want = this.target;
    if (state === 'FOLDER_OPEN') {
      if (want === null || want !== scene.openId) scene.closeFolder();
      return;
    }
    if (want != null) scene.openFolder(want);
  }

  // ------------------------------------------------------------ case content
  /** Push the selected level + completed stamps into the scene. */
  syncProgress() {
    const scene = this.scene;
    if (!scene) return;
    const { progress } = useGameStore.getState();
    for (const c of CASES) {
      const sel = progress.selectedLevel[c.id] ?? 1;
      scene.setSelectedPhoto(c.id, sel - 1);
      c.levels.forEach((l, i) => scene.setPhotoStatus(c.id, i, { completed: levelKey(c.id, l.number) in progress.completed || levelKey(c.id, l.number) in progress.skipped }));
      // a solved case carries the stamp and its code fragment on the cover
      scene.setCaseSolved(c.id, isCaseSolved(c.id, progress.completed, progress.skipped) ? getCaseFragment(c.id) : null);
    }
    if (scene.openId != null) this.showReport(scene.openId);
  }

  /** The level the report shows: the hovered photo, else the selected one. */
  reportLevel(caseId: number): number {
    if (this.hoverPhoto && this.hoverPhoto.caseId === caseId) return this.hoverPhoto.index + 1;
    return useGameStore.getState().progress.selectedLevel[caseId] ?? 1;
  }

  private showReport(caseId: number) {
    const scene = this.scene;
    const c = CASES.find((x) => x.id === caseId);
    if (!scene || !c) return;
    const n = this.reportLevel(caseId);
    const lvl = getLevel(caseId, n);
    if (!lvl) return;
    const completed = levelKey(caseId, n) in useGameStore.getState().progress.completed;
    const report: CaseReport = {
      caseLabel: `CASE ${pad2(caseId)}`,
      caseTitle: c.title,
      levelLabel: `LEVEL ${pad2(n)}`,
      title: lvl.title,
      difficulty: lvl.difficulty,
      reward: `${lvl.reward} coins`,
      status: completed ? 'Completed' : 'Available',
      description: lvl.description,
      hint: completed ? 'Solved. Reward paid.' : 'Select the photograph to open this level.',
      completed,
    };
    scene.setCaseReport(caseId, report);
  }

  setSelectedLevel(caseId: number, level: number) {
    this.scene?.setSelectedPhoto(caseId, level - 1);
    if (this.scene?.openId === caseId) this.showReport(caseId);
  }

  async pickPhoto(caseId: number, level: number): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    useSceneStore.getState().set({ photoSelecting: true });
    // never let a pick that cannot play (or never settles) block the way into the level
    try { await Promise.race([scene.playPhotoSelect(caseId, level - 1), new Promise((r) => setTimeout(r, 1800))]); } finally { useSceneStore.getState().set({ photoSelecting: false }); }
  }

  setMuted(m: boolean) { this.scene?.setMuted(m); }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.scene?.dispose();
    this.scene = null;
    this.initPromise = null;
    this.revealed = false;
    this.running = false;
    this.visible = false;
    this.el.style.visibility = 'hidden';
    useSceneStore.getState().set({ deskPhase: 'unloaded', deskState: null, deskOpenId: null });
  }
}

export const deskController = new DeskController();
