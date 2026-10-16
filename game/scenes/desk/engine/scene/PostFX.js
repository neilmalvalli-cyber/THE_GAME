import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 1.05 },
    uFade: { value: 1 },          // 1 = black (intro hand-off), 0 = clear
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uFade; uniform vec2 uResolution;
    varying vec2 vUv;
    // Dave Hoskins' hash12: no visible lattice/striping at screen resolution
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0) * 0.82;
      float v = 1.0 - smoothstep(0.18, 1.0, length(d) * uVignette);
      c.rgb *= mix(0.12, 1.0, v);
      c.rgb *= vec3(1.03, 1.0, 0.94);                       // warm grade
      float frame = floor(uTime * 24.0);
      float g = hash(floor(vUv * uResolution) + vec2(frame * 37.0, frame * 91.0)) - 0.5;
      c.rgb += g * uGrain * (0.25 + c.rgb);                   // luminance-weighted film grain
      c.rgb *= 1.0 - uFade;
      gl_FragColor = c;
    }`,
};

/** Render pipeline: scene → depth of field → grade/grain/vignette/fade → tone map. */
export class PostFX {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const isWebGL2 = renderer.capabilities.isWebGL2;
    this.isWebGL2 = isWebGL2;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: isWebGL2 ? samples : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));

    this.dofDesk = 0.0016;
    this.dofOpen = 0.011;
    this.dof = { aperture: this.dofDesk, focus: 16, enabled: true };
    this.bokeh = new BokehPass(scene, camera, { focus: 16, aperture: this.dofDesk, maxblur: 0.009 });
    this.composer.addPass(this.bokeh);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.fade = this.grade.uniforms.uFade;
  }

  /** The DOF pass also needs the quality tier's permission (it re-renders scene depth). */
  setDofEnabled(v) { this.dof.enabled = v; this.bokeh.enabled = v && this.qualityDof !== false; }

  /** MSAA on the composer targets; reallocated on the next frame. */
  setSamples(n) {
    const s = this.isWebGL2 ? n : 0;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples !== s) { t.samples = s; t.dispose(); }
    }
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.grade.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  render(time, dt) {
    this.grade.uniforms.uTime.value = time;
    const u = this.bokeh.uniforms;
    u.focus.value = this.dof.focus;
    u.aperture.value = this.dof.aperture;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.dispose();
  }
}
