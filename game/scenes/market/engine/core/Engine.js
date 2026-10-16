import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Engine
 * ------
 * One renderer, one camera, one composer shared by every environment
 * (phone intro, detective desk, Black Market). Environments are plain
 * THREE.Scene graphs that are swapped in and out — never destroyed — which is
 * how the desk keeps its exact state while the player is in the market.
 */

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.55 },
    uFade: { value: 0 }, // 0 = visible, 1 = black
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uFade;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // Luminance-weighted grain: stronger in mid-tones, quiet in pure black (like film, not TV static)
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      float g = hash(vUv*vec2(1920.0,1080.0) + fract(uTime*7.13)*100.0) - 0.5;
      c.rgb += g * uGrain * smoothstep(0.0, 0.35, l) * (1.0 - l*0.6);
      vec2 d = vUv - 0.5; d.x *= 1.25;
      c.rgb *= mix(1.0, smoothstep(0.85, 0.15, length(d)), uVignette);
      c.rgb *= 1.0 - uFade;
      gl_FragColor = c;
    }
  `,
};

export class Engine {
  constructor(container, { pixelRatioCap = 2, minPixelRatio = 0.85, adaptive = true } = {}) {
    this.container = container;
    this.supported = Engine.isWebGLAvailable();
    if (!this.supported) return;

    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // antialias off: everything is rendered through the composer's own targets,
    // so canvas MSAA only cost bandwidth. Resolution is handled adaptively below.
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, pixelRatioCap);
    this.minPixelRatio = Math.min(minPixelRatio, this.maxPixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    this.adaptive = adaptive;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.info.autoReset = false; // the composer renders several passes per frame
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    // PCF (not PCFSoft) honours shadow.radius: a wide, smooth filter kernel
    // instead of the blocky 2×2 look of PCFSoft at grazing angles.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.03, 60);
    this.activeScene = new THREE.Scene();

    // Post chain: render → (optional) depth of field → grain/vignette/fade → tone map + sRGB
    const composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(this.activeScene, this.camera);
    composer.addPass(this.renderPass);
    this.bokeh = new BokehPass(this.activeScene, this.camera, { focus: 1.6, aperture: 0.0018, maxblur: 0.006 });
    this.bokeh.enabled = false;
    composer.addPass(this.bokeh);
    this.grain = new ShaderPass(GrainVignetteShader);
    composer.addPass(this.grain);
    composer.addPass(new OutputPass());
    this.composer = composer;

    this.updaters = new Set();
    this.time = 0;
    this.stats = { fps: 0, ms: 0, calls: 0, triangles: 0, pixelRatio: this.pixelRatio };
    this._perf = { acc: 0, n: 0, slow: 0, fast: 0, cooldown: 0, ups: 0, floor: 0 };
    // THE GAME: per-tier scene cost (see perf/quality.ts); setSceneQuality() changes it
    this.sceneQuality = { shadowScale: 1, shadowEvery: 1, pointShadows: true, dof: true };
    this._frame = 0;
    this._scenes = new Set();
    // THE GAME integration: GSAP stays on its own ticker. The desk, phone, pages and this
    // engine all share one GSAP, and this loop is stopped whenever the market is hidden;
    // driving GSAP from here would freeze every other animation in the app.
    this._raf = 0;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._ro = new ResizeObserver(this._onResize);
    this._ro.observe(container);

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      this.onContextLost?.();
    });
  }

  static isWebGLAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
    } catch {
      return false;
    }
  }

  get fade() { return this.grain.uniforms.uFade.value; }
  set fade(v) { this.grain.uniforms.uFade.value = v; }

  setScene(scene) {
    this.activeScene = scene;
    if (!scene.userData.shadowLights) {
      const list = [];
      scene.traverse((o) => { if (o.isLight && o.castShadow) list.push(o); });
      scene.userData.shadowLights = list;
      for (const l of list) l.userData.authoredMapSize = l.shadow.mapSize.x;
      this._scenes.add(scene);
      this._applyShadowQuality(scene);
    }
    this.renderPass.scene = scene;
    this.bokeh.scene = scene;
  }

  /**
   * Graphics tier for every scene on this engine: shadow-map resolution, whether point
   * lights cast (cube) shadows, how often moving shadows are re-rendered, and depth of field.
   */
  setSceneQuality(q) {
    this.sceneQuality = { ...this.sceneQuality, ...q };
    for (const sc of this._scenes) this._applyShadowQuality(sc);
    if (!this.sceneQuality.dof) this.bokeh.enabled = false;
  }

  _applyShadowQuality(scene) {
    const q = this.sceneQuality;
    for (const l of scene.userData.shadowLights || []) {
      const size = Math.max(256, Math.round((l.userData.authoredMapSize || 1024) * q.shadowScale));
      const cast = l.isPointLight ? q.pointShadows : true;
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose(); l.shadow.map = null; // reallocated at the new size on the next shadow pass
        l.shadow.needsUpdate = true;
      }
      l.castShadow = cast;
    }
    scene.userData.shadowsDirty = 2;
  }

  setDepthOfField(enabled, focus, aperture) {
    this.bokeh.enabled = enabled && this.sceneQuality.dof;
    if (focus !== undefined) this.bokeh.uniforms.focus.value = focus;
    if (aperture !== undefined) this.bokeh.uniforms.aperture.value = aperture;
  }

  /** Register a per-frame callback (dt, elapsed). Returns an unsubscribe fn. */
  onUpdate(fn) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  start() {
    if (this._raf) return;
    let last = -1;
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const raw = last < 0 ? 1 / 60 : (now - last) / 1000;
      // THE GAME: optional frame cap (LOW graphics tier) — skip frames, keep time continuous
      if (this.fpsCap && last >= 0 && raw < 1 / this.fpsCap - 0.004) return;
      last = now;
      // One clamped delta for everything: a hitch slows the moment down a touch
      // instead of making the camera jump; a hidden tab resumes where it was.
      const dt = Math.min(raw, 1 / 20);
      this.time += dt;
      const t = this.time;
      for (const fn of this.updaters) fn(dt, t);
      this.grain.uniforms.uTime.value = t;
      const sc = this.activeScene;
      // A switched-off light still re-renders its shadow map every frame (a point
      // light = 6 extra scene renders). Freeze shadow maps of lights that are off.
      for (const l of sc.userData.shadowLights || []) l.shadow.autoUpdate = l.visible && l.intensity > 0.001;
      if (sc.userData.staticShadows) {
        this.renderer.shadowMap.autoUpdate = false;
        if (sc.userData.shadowsDirty) { this.renderer.shadowMap.needsUpdate = true; sc.userData.shadowsDirty = Math.max(0, sc.userData.shadowsDirty - 1); }
      } else {
        // moving shadows (dealer's hands, items) refresh every Nth frame on lower tiers
        this._frame = (this._frame + 1) % 600;
        this.renderer.shadowMap.autoUpdate = this._frame % (this.sceneQuality.shadowEvery || 1) === 0 || !!sc.userData.shadowsDirty;
        if (sc.userData.shadowsDirty) sc.userData.shadowsDirty--;
      }
      // fully faded to black (or covered by the folders page): draw the black
      // frame once, then stop spending the GPU on a picture nobody can see
      const black = this.fade >= 0.999;
      if (!(black && this._blackShown)) {
        this.renderer.info.reset();
        this.composer.render(dt);
        this._blackShown = black;
        this._measure(raw);
      } else {
        this._perf.acc = 0; this._perf.n = 0;
      }
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** Frame-time watchdog: steps the render resolution down when frames run long. */
  _measure(raw) {
    const P = this._perf;
    if (raw > 0.25) return; // tab switch / breakpoint: not a real frame
    P.acc += raw; P.n++;
    if (P.n < 45) return;
    const avg = P.acc / P.n;
    P.acc = 0; P.n = 0;
    this.stats.fps = Math.round(1 / avg);
    this.stats.ms = +(avg * 1000).toFixed(1);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.pixelRatio = this.pixelRatio;
    if (!this.adaptive) return;
    if (P.cooldown > 0) { P.cooldown--; return; }
    if (avg > 1 / 48) { P.slow++; P.fast = 0; } else if (avg < 1 / 100) { P.fast++; P.slow = 0; } else { P.slow = 0; P.fast = 0; }
    if (P.slow >= 2 && this.pixelRatio > this.minPixelRatio) {
      this.setPixelRatio(Math.max(this.minPixelRatio, this.pixelRatio - 0.25));
      P.slow = 0; P.cooldown = 3;
    } else if (P.slow >= 3 && this.pixelRatio <= this.minPixelRatio) {
      // already at the lowest resolution and still slow: ask for a cheaper graphics tier
      P.slow = 0; P.cooldown = 4;
      this.onSlow?.();
    } else if (P.fast >= 6 && this.pixelRatio < this.maxPixelRatio && P.ups < 2) {
      // only on high-refresh displays with lots of headroom, and never ping-pong
      this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.25));
      P.fast = 0; P.cooldown = 6; P.ups++;
    }
  }

  setPixelRatio(r) {
    if (r === this.pixelRatio) return;
    this.pixelRatio = r;
    this.renderer.setPixelRatio(r);
    this.composer.setPixelRatio?.(r);
    this.resize();
  }

  /**
   * Compile every material in a scene — including objects that are hidden until
   * a cinematic reveals them (bags, coins, receipts) and their shadow-depth
   * variants — so nothing compiles a shader mid-animation (the classic hitch).
   */
  precompile(scene) {
    const hidden = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const prevScene = this.activeScene, prevFade = this.fade;
    try {
      this.renderer.compile(scene, this.camera);
      // one real (black) frame renders the shadow maps with everything visible
      this.setScene(scene);
      this.fade = 1;
      this.renderer.shadowMap.needsUpdate = true;
      for (const l of scene.userData.shadowLights || []) l.shadow.needsUpdate = true;
      this.composer.render(0);
    } finally {
      for (const o of hidden) o.visible = false;
      this.setScene(prevScene);
      this.fade = prevFade;
    }
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    // Keep a minimum HORIZONTAL field of view so the desk stays framed on
    // narrow / portrait screens (vertical FOV grows as the aspect drops).
    const minH = THREE.MathUtils.degToRad(58);
    const vForH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minH / 2) / (w / h)));
    this.camera.fov = Math.min(80, Math.max(38, vForH));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.onResize?.(w, h);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect();
    this.updaters.clear();
    this.composer?.dispose?.();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

/** Dispose every geometry/material/texture under an object. */
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}
