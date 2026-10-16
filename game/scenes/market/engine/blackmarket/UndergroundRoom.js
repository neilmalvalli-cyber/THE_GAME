import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { concreteTextures, woodTextures, metalTextures } from '../core/proceduralTextures.js';
import { LAYOUT } from './layout.js';

/**
 * UndergroundRoom
 * ---------------
 * Concrete room + entrance corridor + industrial lamp + atmosphere.
 * Lighting rig (deliberately few dynamic lights):
 *   - lampSpot      : the only key light, shadow-casting, aimed at the desk
 *   - bounce        : warm, shadowless fill faking light bouncing off the desk
 *   - corridorBulb  : dim practical at the far end of the corridor
 *   - doorSpill     : light that escapes through the door when it opens
 *   - hemi          : near-zero ambient so blacks never go flat digital-black
 */
export class UndergroundRoom {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'UndergroundRoom';
    this.lampLevel = 0;
    this.corridorLevel = 0;
    this._build();
  }

  _build() {
    const R = LAYOUT.room, C = LAYOUT.corridor, D = LAYOUT.door;
    const g = this.group;

    // ── materials
    const wallTex = concreteTextures({ seed: 7, repeat: [2.5, 1.3], wet: 0.8 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8e8a84, ...wallTex, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
    const floorTex = concreteTextures({ seed: 13, repeat: [3, 3], wet: 1 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x6c6964, ...floorTex, roughness: 0.95, normalScale: new THREE.Vector2(0.6, 0.6) });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x55524e, ...concreteTextures({ seed: 19, repeat: [3, 3], wet: 0.4 }), roughness: 1 });
    this.materials = { wallMat, floorMat, ceilMat };

    const plane = (w, h, mat, pos, rotY = 0, rotX = 0, repeatScale) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(...pos); m.rotation.set(rotX, rotY, 0);
      m.receiveShadow = true;
      if (repeatScale) {
        // keep texel density constant per wall size
        const uv = m.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / repeatScale, uv.getY(i) * h / repeatScale);
      }
      g.add(m);
      return m;
    };

    const W = R.x1 - R.x0, Dp = R.z1 - R.z0, H = R.h;
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    plane(W, Dp, floorMat, [cx, 0, cz], 0, -Math.PI / 2, 2);
    plane(W, Dp, ceilMat, [cx, H, cz], 0, Math.PI / 2, 2);
    plane(W, H, wallMat, [cx, H / 2, R.z0], 0, 0, 2.2);              // back wall (behind dealer)
    plane(W, H, wallMat, [cx, H / 2, R.z1], Math.PI, 0, 2.2);        // front wall (behind player)
    plane(Dp, H, wallMat, [R.x0, H / 2, cz], Math.PI / 2, 0, 2.2);   // left wall
    // right wall with door opening (three pieces)
    const dz0 = D.z - D.w / 2, dz1 = D.z + D.w / 2;
    const segA = dz0 - R.z0, segB = R.z1 - dz1;
    plane(segA, H, wallMat, [R.x1, H / 2, R.z0 + segA / 2], -Math.PI / 2, 0, 2.2);
    plane(segB, H, wallMat, [R.x1, H / 2, dz1 + segB / 2], -Math.PI / 2, 0, 2.2);
    plane(D.w, H - D.h, wallMat, [R.x1, D.h + (H - D.h) / 2, D.z], -Math.PI / 2, 0, 2.2);

    // skirting stain band (water line) — darker strip near floor
    const stain = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    stain.position.set(cx, 0.18, R.z0 + 0.002);
    g.add(stain);

    // ── corridor
    const CL = C.x1 - C.x0, CW = C.w, CH = C.h;
    const ccx = (C.x0 + C.x1) / 2;
    plane(CL, CW, floorMat, [ccx, 0, D.z], 0, -Math.PI / 2, 2);
    plane(CL, CW, ceilMat, [ccx, CH, D.z], 0, Math.PI / 2, 2);
    plane(CL, CH, wallMat, [ccx, CH / 2, D.z - CW / 2], 0, 0, 2.2);
    plane(CL, CH, wallMat, [ccx, CH / 2, D.z + CW / 2], Math.PI, 0, 2.2);
    plane(CW, CH, wallMat, [C.x1, CH / 2, D.z], -Math.PI / 2, 0, 2.2);
    // corridor-side wall around the door (faces +x)
    const outerW = CW, lintel = CH - D.h;
    const sideW = (outerW - D.w) / 2;
    plane(sideW, CH, wallMat, [R.x1 + 0.001, CH / 2, D.z - D.w / 2 - sideW / 2], Math.PI / 2, 0, 2.2);
    plane(sideW, CH, wallMat, [R.x1 + 0.001, CH / 2, D.z + D.w / 2 + sideW / 2], Math.PI / 2, 0, 2.2);
    plane(D.w, lintel, wallMat, [R.x1 + 0.001, D.h + lintel / 2, D.z], Math.PI / 2, 0, 2.2);

    // corridor practical: caged bulb
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.6 });
    const cb = new THREE.Group();
    cb.position.set(C.x1 - 1.2, CH - 0.12, D.z);
    const bulbC = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb36b, emissiveIntensity: 0 }));
    cb.add(bulbC);
    const cage = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0x111111, wireframe: true }));
    cage.rotation.x = Math.PI; cb.add(cage);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), cageMat);
    base.position.y = 0.06; cb.add(base);
    g.add(cb);
    this.corridorBulbMesh = bulbC;
    this.corridorBulb = new THREE.PointLight(0xffa860, 0, 7, 2);
    this.corridorBulb.position.copy(cb.position).add(new THREE.Vector3(0, -0.05, 0));
    this.corridorBulb.castShadow = true;
    this.corridorBulb.shadow.mapSize.set(1024, 1024);
    this.corridorBulb.shadow.bias = -0.0008;
    this.corridorBulb.shadow.radius = 3;
    g.add(this.corridorBulb);

    // conduit pipes along the corridor ceiling
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2b2a28, metalness: 0.7, roughness: 0.55 });
    for (const dz of [-0.45, -0.32]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, CL, 10), pipeMat);
      p.rotation.z = Math.PI / 2; p.position.set(ccx, CH - 0.08, D.z + dz); p.castShadow = true;
      g.add(p);
    }
    // a couple of conduits in the room
    for (const [x, z, len] of [[R.x0 + 0.15, cz, Dp]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 10), pipeMat);
      p.rotation.x = Math.PI / 2; p.position.set(x, H - 0.12, z); g.add(p);
    }

    this._buildLamp();
    this._buildShelves();
    this._buildChair();
    this._buildAtmosphere();

    // ── fill lights
    this.hemi = new THREE.HemisphereLight(0x3a4250, 0x0d0b09, 0.05);
    g.add(this.hemi);
    this.bounce = new THREE.PointLight(0xffa766, 0, 3.2, 2);
    this.bounce.position.set(LAYOUT.desk.x, LAYOUT.desk.top + 0.35, LAYOUT.desk.z + 0.1);
    g.add(this.bounce);

    // small caged practical above the door (inside): keeps the exit readable
    // in the dark without competing with the desk lamp
    {
      const D2 = LAYOUT.door;
      const dl = new THREE.Group();
      dl.position.set(LAYOUT.room.x1 - 0.06, D2.h + 0.22, D2.z);
      this.doorBulbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa25a, emissiveIntensity: 0 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), this.doorBulbMat);
      const cage = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x111111, wireframe: true }));
      cage.rotation.z = Math.PI / 2;
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.6 }));
      plate.rotation.z = Math.PI / 2; plate.position.x = 0.045;
      dl.add(b, cage, plate);
      this.group.add(dl);
      this.doorLight = new THREE.PointLight(0xff9a50, 0, 3.5, 2);
      this.doorLight.position.copy(dl.position).add(new THREE.Vector3(-0.08, -0.05, 0));
      this.group.add(this.doorLight);
    }

    // light escaping through the door as it opens
    this.doorSpill = new THREE.SpotLight(0xffc48a, 0, 9, 0.32, 0.8, 1.6);
    this.doorSpill.position.set(R.x1 - 1.4, 2.0, D.z);
    this.doorSpill.target.position.set(R.x1 + 3, 0, D.z);
    this.doorSpill.castShadow = true;
    this.doorSpill.shadow.mapSize.set(1024, 1024);
    this.doorSpill.shadow.radius = 3;
    this.doorSpill.shadow.bias = -0.0006;
    g.add(this.doorSpill, this.doorSpill.target);
  }

  _buildLamp() {
    const L = LAYOUT.lamp, H = LAYOUT.room.h;
    const lamp = new THREE.Group();
    lamp.position.set(L.x, L.y, L.z);
    lamp.name = 'OverheadLamp';

    // enamel shade: lathe profile, dark outside, off-white inside
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const r = 0.035 + Math.pow(t, 1.7) * 0.2;
      const y = 0.11 - t * 0.17;
      pts.push(new THREE.Vector2(r, y));
    }
    const shadeGeo = new THREE.LatheGeometry(pts, 48);
    const metal = metalTextures({ seed: 77, size: 256, baseRough: 0.5, scratchCount: 80 });
    const outer = new THREE.MeshStandardMaterial({ color: 0x1e2620, metalness: 0.35, roughness: 0.55, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, side: THREE.FrontSide });
    const inner = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.45, side: THREE.BackSide, emissive: 0xffd6a0, emissiveIntensity: 0 });
    const shadeO = new THREE.Mesh(shadeGeo, outer);
    const shadeI = new THREE.Mesh(shadeGeo, inner);
    shadeO.castShadow = true;
    lamp.add(shadeO, shadeI);
    this.shadeInner = inner;

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.006, 8, 48), outer);
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.06; lamp.add(rim);

    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.9, roughness: 0.4 }));
    socket.position.y = 0.13; lamp.add(socket);

    // bulb (tungsten filament glow)
    this.bulbMat = new THREE.MeshStandardMaterial({ color: 0x302820, emissive: 0xffb469, emissiveIntensity: 0, roughness: 0.2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 16), this.bulbMat);
    bulb.position.y = 0.04; lamp.add(bulb);

    // cord to ceiling
    const cordLen = H - L.y - 0.16;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, cordLen, 6), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.7 }));
    cord.position.y = 0.16 + cordLen / 2; lamp.add(cord);
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), outer);
    canopy.position.y = H - L.y - 0.015; lamp.add(canopy);

    // key light — the only shadow-casting light in the room
    const spot = new THREE.SpotLight(0xffc999, 0, 6, L.angle, L.penumbra, 2);
    spot.position.set(0, 0.03, 0);
    spot.castShadow = true;
    // Tight near/far = better depth precision; 4K map over a ~1.6 m footprint
    // (~0.4 mm per texel) plus a filtered kernel for soft contact edges.
    spot.shadow.mapSize.set(4096, 4096);
    spot.shadow.camera.near = 0.45; spot.shadow.camera.far = 2.6;
    spot.shadow.bias = -0.00004;
    spot.shadow.normalBias = 0.0035;
    spot.shadow.radius = 2.5;
    spot.shadow.blurSamples = 16;
    lamp.add(spot, spot.target);
    spot.target.position.set(L.aimX, LAYOUT.desk.top - L.y, L.aimZ);
    this.lampSpot = spot;

    // slight sway so the lamp feels physically hung
    this.lamp = lamp;
    this.group.add(lamp);
  }

  _buildShelves() {
    const R = LAYOUT.room;
    const wood = woodTextures({ seed: 88, tone: [40, 28, 18] });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, ...wood, roughness: 1 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x24272a, metalness: 0.8, roughness: 0.6 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x4d3f2f, roughness: 0.95 });
    const binderMat = [0x1d2228, 0x2c2420, 0x26281f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    const rng = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

    const unit = (x, z, rotY, w = 1.1) => {
      const u = new THREE.Group(); u.position.set(x, 0, z); u.rotation.y = rotY;
      const H = 1.9, Dd = 0.38;
      for (const sx of [-w / 2, w / 2]) for (const sz of [-Dd / 2, Dd / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, H, 0.03), metalMat);
        post.position.set(sx, H / 2, sz); u.add(post);
      }
      for (const y of [0.08, 0.55, 1.02, 1.49, 1.86]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, Dd), shelfMat);
        s.position.y = y; s.castShadow = s.receiveShadow = true; u.add(s);
        // contents
        let px = -w / 2 + 0.05;
        while (px < w / 2 - 0.12) {
          const kind = rng();
          if (kind < 0.45) {
            const bw = 0.18 + rng() * 0.2, bh = 0.12 + rng() * 0.22;
            const b = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, 0.28, 2, 0.01), boxMat);
            b.position.set(px + bw / 2, y + 0.0125 + bh / 2, (rng() - 0.5) * 0.04); b.rotation.y = (rng() - 0.5) * 0.12;
            b.castShadow = b.receiveShadow = true; u.add(b); px += bw + 0.03;
          } else if (kind < 0.8) {
            const n = 2 + Math.floor(rng() * 4);
            for (let i = 0; i < n; i++) {
              const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.24), binderMat[Math.floor(rng() * 3)]);
              b.position.set(px + 0.03, y + 0.0125 + 0.15, 0); b.rotation.z = i === n - 1 ? 0.18 : 0;
              u.add(b); px += 0.055;
            }
            px += 0.04;
          } else {
            px += 0.15 + rng() * 0.2; // gaps
          }
        }
      }
      this.group.add(u);
    };
    unit(R.x0 + 0.85, R.z0 + 0.22, 0, 1.2);
    unit(R.x1 - 0.85, R.z0 + 0.22, 0, 1.1);
    unit(R.x0 + 0.22, R.z0 + 1.9, Math.PI / 2, 1.0);
  }

  _buildChair() {
    // Worn bentwood-style chair behind the desk (mostly hidden by the dealer).
    const C = LAYOUT.dealer;
    const wood = woodTextures({ seed: 55, tone: [46, 30, 18] });
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a8a78, ...wood, roughness: 1 });
    const ch = new THREE.Group();
    ch.position.set(C.x, 0, C.z + 0.02);
    const seatH = C.seatHeight;
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.045, 0.44, 3, 0.012), mat);
    seat.position.y = seatH - 0.03; ch.add(seat);
    for (const [x, z] of [[-0.21, 0.19], [0.21, 0.19], [-0.21, -0.19], [0.21, -0.19]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, seatH - 0.05, 10), mat);
      leg.position.set(x, (seatH - 0.05) / 2, z); leg.rotation.z = x * 0.08; ch.add(leg);
    }
    for (const x of [-0.2, 0.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.52, 10), mat);
      post.position.set(x, seatH + 0.24, -0.2); post.rotation.x = -0.12; ch.add(post);
    }
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.07, 0.03, 2, 0.01), mat);
    rail.position.set(0, seatH + 0.46, -0.23); rail.rotation.x = -0.12; ch.add(rail);
    ch.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(ch);
  }

  _buildAtmosphere() {
    const L = LAYOUT.lamp;
    // ── volumetric light cone (cheap analytic scattering shader)
    const h = L.y - 0.05;
    const r = Math.tan(L.angle) * h * 0.92;
    const coneGeo = new THREE.CylinderGeometry(0.16, r, h, 64, 1, true);
    coneGeo.translate(0, -h / 2, 0);
    this.coneMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffc48e) }, uH: { value: h } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity, uTime, uH; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
        float n3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(n3(i),n3(i+vec3(1,0,0)),f.x),mix(n3(i+vec3(0,1,0)),n3(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(n3(i+vec3(0,0,1)),n3(i+vec3(1,0,1)),f.x),mix(n3(i+vec3(0,1,1)),n3(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float core = pow(facing, 2.2);                 // thicker through the middle of the cone
          float t = clamp(-vY / uH, 0.0, 1.0);           // 0 at lamp, 1 at desk
          float fall = (1.0 - t*0.75) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.82, t);
          float drift = 0.65 + 0.35 * vnoise(vW*3.0 + vec3(0.0, uTime*0.05, uTime*0.03));
          float a = core * fall * drift * uIntensity * 0.055;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(coneGeo, this.coneMat);
    cone.position.copy(this.lamp.position);
    cone.renderOrder = 10;
    this.group.add(cone);
    this.cone = cone;

    // ── dust motes: only visible where they cross the lamp's cone
    const N = 900;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 1.1;
      pos[i * 3] = L.x + Math.cos(a) * rr;
      pos[i * 3 + 1] = 0.5 + Math.random() * (L.y - 0.5);
      pos[i * 3 + 2] = L.z + Math.sin(a) * rr;
      seed[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uIntensity: { value: 0 },
        uLamp: { value: new THREE.Vector3(L.x, L.y, L.z) }, uCos: { value: Math.cos(L.angle) },
        uPx: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime, uPx; uniform vec3 uLamp; uniform float uCos;
        varying float vLit;
        void main(){
          vec3 p = position;
          float s = aSeed * 6.2831;
          p.x += sin(uTime*0.07 + s) * 0.12 + sin(uTime*0.23 + s*3.0)*0.02;
          p.z += cos(uTime*0.05 + s*1.7) * 0.12;
          p.y += mod(-uTime*0.008*(0.4+aSeed) + aSeed*2.0, 2.0) - 1.0;
          vec3 d = normalize(p - uLamp);
          float inCone = smoothstep(uCos - 0.06, uCos + 0.12, dot(d, vec3(0,-1,0)));
          vLit = inCone * (0.4 + 0.6*fract(aSeed*13.7)) * smoothstep(0.2, 0.9, uLamp.y - p.y);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = uPx * (0.9 + 1.6*fract(aSeed*7.3)) * (1.4 / max(-mv.z, 0.35));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity; varying float vLit;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = dot(c,c);
          float a = smoothstep(0.25, 0.0, r) * vLit * uIntensity * 0.28;
          gl_FragColor = vec4(vec3(1.0,0.86,0.68)*a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    // ── door beam (light shaft through the opening into the corridor)
    const D = LAYOUT.door;
    // A sloped sheet from the top of the opening down onto the corridor floor:
    // reads as the shaft of lamp light falling through the gap.
    const hw = D.w * 0.42, far = 2.4;
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, D.h * 0.95, -hw, 0, D.h * 0.95, hw, far, 0.01, -hw * 1.5, far, 0.01, hw * 1.5,
    ], 3));
    beamGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 1, 1, 0], 2));
    beamGeo.setIndex([0, 2, 1, 1, 2, 3]);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 }, uOpen: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity, uOpen; varying vec2 vUv;
        void main(){
          float along = vUv.x;
          float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          float a = (1.0 - along*0.8) * smoothstep(0.0, 0.08, along) * edge * uIntensity * uOpen * 0.09;
          gl_FragColor = vec4(vec3(1.0,0.82,0.62)*a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(LAYOUT.room.x1, 0, D.z);
    this.beam.renderOrder = 11;
    this.group.add(this.beam);
  }

  /** 0..1 — drives every light-dependent element of the overhead lamp. */
  setLampLevel(v) {
    this.lampLevel = v;
    const L = LAYOUT.lamp;
    this.lampSpot.intensity = L.intensity * v;
    this.bulbMat.emissiveIntensity = 14 * v;
    this.shadeInner.emissiveIntensity = 0.35 * v;
    this.bounce.intensity = L.bounce * v;
    this.coneMat.uniforms.uIntensity.value = v;
    this.dustMat.uniforms.uIntensity.value = v;
    this.beamMat.uniforms.uIntensity.value = v;
    // the door practical shares the room's circuit (it dies and returns with the lamp)
    const d = Math.min(1, v * 1.2);
    this.doorLight.intensity = 0.55 * d;
    this.doorBulbMat.emissiveIntensity = 3 * d;
  }

  setCorridorLevel(v) {
    this.corridorLevel = v;
    this.corridorBulb.intensity = 5.5 * v;
    this.corridorBulbMesh.material.emissiveIntensity = 6 * v;
    this.hemi.intensity = 0.05 * Math.max(v * 0.6, this.lampLevel);
  }

  /** 0..1 door openness (from MetalDoor) → light spill into the corridor. */
  setDoorOpen(open) {
    this.beamMat.uniforms.uOpen.value = open;
    this.doorSpill.intensity = 7 * open * this.lampLevel;
  }

  update(dt, t) {
    this.coneMat.uniforms.uTime.value = t;
    this.dustMat.uniforms.uTime.value = t;
    // barely-perceptible sway of a hanging lamp; shadows breathe with it
    const sway = Math.sin(t * 0.6) * 0.004 + Math.sin(t * 1.37) * 0.0015;
    this.lamp.rotation.z = sway;
    this.lamp.rotation.x = Math.cos(t * 0.45) * 0.003;
    this.cone.rotation.copy(this.lamp.rotation);
    this.hemi.intensity = 0.05 * Math.max(this.corridorLevel * 0.6, this.lampLevel);
  }
}
