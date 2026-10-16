import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TABLE } from '../config.js';
import { makeWalnut, makeDustSprite } from './textures.js';

/**
 * The table, the desk lamp and the air in the room.
 * If the intro project already has a table/lamp, replace `buildTable()` /
 * `buildLights()` with those and keep the public fields (lamp, lampTarget,
 * readingLight) so the sequences still work.
 */
export class DeskEnvironment {
  constructor(renderer, scene, { reducedMotion = false } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    this.group.name = 'DeskEnvironment';
    scene.add(this.group);

    // Dim neutral environment for PBR reflections (paper clips, wood sheen).
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.1;
    scene.background = new THREE.Color(0x060403);
    scene.fog = new THREE.Fog(0x060403, 24, 46);

    this.buildTable();
    this.buildLights();
    this.buildDust();
    this.levels = { lamp: 1, ambient: 1 }; // animated 0..1 multipliers (intro / focus)
  }

  buildTable() {
    const maps = makeWalnut(11);
    maps.map.anisotropy = maps.roughnessMap.anisotropy = maps.bumpMap.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Varnished desk top: clearcoat catches the lamp as a soft sheen,
    // which is what reads as furniture rather than a floor.
    this.tableMaterial = new THREE.MeshPhysicalMaterial({
      map: maps.map,
      roughnessMap: maps.roughnessMap,
      bumpMap: maps.bumpMap,
      bumpScale: 0.8,
      roughness: 1,
      metalness: 0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.6,
      envMapIntensity: 1.1,
    });
    this._maps = maps;
    const geo = new THREE.BoxGeometry(TABLE.W, TABLE.thickness, TABLE.D);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1c110a, roughness: 0.7 });
    this.table = new THREE.Mesh(geo, [edgeMat, edgeMat, this.tableMaterial, edgeMat, edgeMat, edgeMat]);
    this.table.position.y = -TABLE.thickness / 2;
    this.table.receiveShadow = true;
    this.table.name = 'Table';
    this.group.add(this.table);
  }

  buildLights() {
    // Warm desk lamp from upper left. decay 0 so intensity is easy to art-direct.
    this.lamp = new THREE.SpotLight(0xffc489, 3.2, 0, 0.64, 0.78, 0);
    this.lamp.position.set(-6.5, 12.5, -4.2);
    this.lampTarget = new THREE.Object3D();
    this.lampTarget.position.set(0.6, 0, 0.5);
    this.group.add(this.lampTarget);
    this.lamp.target = this.lampTarget;
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.camera.near = 6;
    this.lamp.shadow.camera.far = 30;
    this.lamp.shadow.bias = -0.00025;
    this.lamp.shadow.normalBias = 0.015;
    // VSM (set on the renderer) gives a real penumbra that widens with height
    this.lamp.shadow.radius = 14;
    this.lamp.shadow.blurSamples = 20;
    this.lamp.shadow.bias = -0.0006;
    if ('intensity' in this.lamp.shadow) this.lamp.shadow.intensity = 0.82;
    this.group.add(this.lamp);
    this.lampBase = 3.2;

    // Soft bounce so shadows are never pure black.
    this.hemi = new THREE.HemisphereLight(0x5a4a3c, 0x120a06, 0.55);
    this.group.add(this.hemi);
    this.hemiBase = 0.55;

    // Cool rim from the dark side (window light), very low.
    this.rim = new THREE.DirectionalLight(0x8aa0c0, 0.16);
    this.rim.position.set(9, 6, -6);
    this.group.add(this.rim);
    this.rimBase = 0.16;

    // Reading light: fades in over the opened file to separate it from the desk.
    this.readingLight = new THREE.SpotLight(0xffd7a8, 0, 0, 0.42, 0.9, 0);
    this.readingLight.position.set(-1.5, 9, 3.5);
    this.readingTarget = new THREE.Object3D();
    this.readingTarget.position.set(0, 0.9, 0.25);
    this.group.add(this.readingTarget);
    this.readingLight.target = this.readingTarget;
    this.group.add(this.readingLight);
    this.reading = { level: 0 };
  }

  buildDust() {
    const N = 240;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = 0.5 + Math.random() * 4.5; // stays well below the camera, even when it pushes in
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: makeDustSprite() },
        uLampPos: { value: this.lamp.position },
        uLampDir: { value: new THREE.Vector3() },
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */`
        attribute float seed;
        uniform float uTime; uniform vec3 uLampPos; uniform vec3 uLampDir; uniform float uPixelRatio;
        varying float vLit;
        void main(){
          vec3 p = position;
          float t = uTime * 0.05 + seed;
          p.x += sin(t * 1.3 + seed) * 0.6 + uTime * 0.012;
          p.y += sin(t * 0.9 + seed * 2.0) * 0.4 - mod(uTime * 0.02 + seed, 1.0) * 0.2;
          p.z += cos(t * 1.1 + seed * 1.7) * 0.6;
          // brightness from proximity to the lamp's cone axis
          vec3 toP = p - uLampPos;
          float along = dot(toP, uLampDir);
          vec3 perp = toP - uLampDir * along;
          float radius = along * 0.55;
          vLit = (1.0 - smoothstep(radius * 0.25, radius, length(perp))) * step(0.0, along);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min((1.2 + fract(seed) * 2.2) * uPixelRatio * (12.0 / -mv.z), 5.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uOpacity; varying float vLit;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).r * vLit * uOpacity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.68) * a, a);
        }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.visible = !this.reducedMotion;
    this.group.add(this.dust);
  }

  setReducedMotion(v) {
    this.reducedMotion = v;
    this.dust.visible = !v && this._dustAllowed !== false;
  }

  /** THE GAME: dust motes on/off by graphics tier (also off with reduced motion). */
  setDust(on) { this._dustAllowed = on; this.dust.visible = on && !this.reducedMotion; }

  update(time) {
    // Lamp: barely-perceptible filament variation.
    const flicker = this.reducedMotion ? 1 : 1 + Math.sin(time * 2.3) * 0.006 + Math.sin(time * 7.1 + 1.2) * 0.004;
    this.lamp.intensity = this.lampBase * this.levels.lamp * flicker;
    this.hemi.intensity = this.hemiBase * this.levels.ambient;
    this.rim.intensity = this.rimBase * this.levels.ambient;
    this.readingLight.intensity = 2.2 * this.reading.level;
    this.dustMat.uniforms.uTime.value = time;
    this.dustMat.uniforms.uOpacity.value = 0.4 * this.levels.lamp;
    this.dustMat.uniforms.uLampDir.value.copy(this.lampTarget.position).sub(this.lamp.position).normalize();
  }

  dispose() {
    this.envRT.dispose();
    Object.values(this._maps).forEach((t) => t.dispose());
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.dustMat.uniforms.uMap.value.dispose();
    this.scene.remove(this.group);
  }
}
