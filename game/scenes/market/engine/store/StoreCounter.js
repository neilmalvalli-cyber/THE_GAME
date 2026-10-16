import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MarketItem } from '../blackmarket/MarketItem.js';
import { makeRng, fbm } from '../core/proceduralTextures.js';
import { STORE } from './storeLayout.js';
import { buildHintDropPack, buildShieldPack, buildSecondChanceCan, buildDeepScanBox, buildGlitchPack, buildOverclockPack } from './storeProducts.js';

/**
 * The checkout counter: laminate top, register with a customer display,
 * flatbed barcode scanner, coin tray, receipt printer, an impulse-buy box and
 * a stack of paper bags. The four power-ups sit on the counter, pickable.
 */
export class StoreCounter {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'StoreCounter';
    this.items = new Map();
    this._buildCounter();
    this._buildRegister();
    this._buildScanner();
    this._buildPrinter();
    this._buildExtras();
    this._buildItems();
    // Under bright fluorescents an extra "attention" spotlight is invisible but
    // still costs every pixel, so the store uses a stand-in with the same API.
    this.focusLight = { intensity: 0, position: new THREE.Vector3(0.1, 2.0, 0.6), target: new THREE.Object3D() };
  }

  get top() { return STORE.counter.top; }

  _buildCounter() {
    const C = STORE.counter;
    const topMat = new THREE.MeshStandardMaterial({ ...speckledLaminate(), roughness: 1 });
    const front = new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.55 });
    const kick = new THREE.MeshStandardMaterial({ color: 0x1b1d1e, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.3 });
    const g = new THREE.Group(); g.position.set(C.x, 0, C.z);
    const top = new THREE.Mesh(new RoundedBoxGeometry(C.w, 0.04, C.d, 3, 0.008), topMat);
    top.position.y = C.top - 0.02; top.castShadow = top.receiveShadow = true; g.add(top);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(C.w + 0.004, 0.012, 0.01), trim);
    edge.position.set(0, C.top - 0.03, C.d / 2 + 0.002); g.add(edge);
    const body = new THREE.Mesh(new THREE.BoxGeometry(C.w - 0.04, C.top - 0.14, C.d - 0.06), front);
    body.position.y = 0.1 + (C.top - 0.14) / 2; body.castShadow = body.receiveShadow = true; g.add(body);
    const k = new THREE.Mesh(new THREE.BoxGeometry(C.w - 0.08, 0.1, C.d - 0.1), kick);
    k.position.y = 0.05; g.add(k);
    // vertical groove panels on the customer side
    for (let i = -3; i <= 3; i++) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.006, C.top - 0.2, 0.004), new THREE.MeshStandardMaterial({ color: 0x245955, roughness: 0.6 }));
      groove.position.set(i * 0.26, 0.12 + (C.top - 0.2) / 2, C.d / 2 - 0.028); g.add(groove);
    }
    this.group.add(g);
  }

  _buildRegister() {
    const C = STORE.counter;
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.45, metalness: 0.2 });
    const reg = new THREE.Group(); reg.position.set(C.x + 0.68, C.top, C.z - 0.2); reg.rotation.y = -0.35;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.1, 0.36, 3, 0.012), dark); base.position.y = 0.05; reg.add(base);
    const drawerFace = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.01), new THREE.MeshStandardMaterial({ color: 0x2d3136, roughness: 0.5 }));
    drawerFace.position.set(0, 0.045, 0.181); reg.add(drawerFace);
    // keypad
    const keys = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.012, 0.13, 2, 0.003), new THREE.MeshStandardMaterial({ map: keypadTex(), roughness: 0.5 }));
    keys.position.set(0.04, 0.106, 0.08); keys.rotation.x = 0.15; reg.add(keys);
    // operator monitor
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.16, 12), dark); neck.position.set(0, 0.18, -0.09); reg.add(neck);
    const mon = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.2, 0.03, 2, 0.008), dark); mon.position.set(0, 0.32, -0.1); mon.rotation.x = -0.12; reg.add(mon);
    // customer display (faces the player)
    this.displayCanvas = document.createElement('canvas'); this.displayCanvas.width = 256; this.displayCanvas.height = 96;
    this.displayTex = new THREE.CanvasTexture(this.displayCanvas); this.displayTex.colorSpace = THREE.SRGBColorSpace;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.22, 8), dark); pole.position.set(-0.12, 0.21, 0.1); reg.add(pole);
    const disp = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.06, 0.02, 2, 0.004), dark); disp.position.set(-0.12, 0.34, 0.1); reg.add(disp);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.045), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: this.displayTex, emissiveIntensity: 1.4 }));
    screen.position.set(-0.12, 0.34, 0.111); reg.add(screen);
    this.setDisplay('WELCOME');
    reg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.register = reg;
    this.drawer = drawerFace;
    this.group.add(reg);
    // coin tray in front of the register
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.012, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }));
    tray.position.set(C.x + 0.56, C.top + 0.006, C.z + 0.18);
    const trayBase = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), new THREE.MeshStandardMaterial({ color: 0x6b6e71, metalness: 1, roughness: 0.4 }));
    trayBase.rotation.x = -Math.PI / 2; trayBase.position.set(C.x + 0.56, C.top + 0.001, C.z + 0.18);
    this.group.add(tray, trayBase);
    this.coinTray = new THREE.Vector3(C.x + 0.56, C.top + 0.002, C.z + 0.18);
    // coins (hidden until payment)
    this.coins = [];
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.0022, 24), coinMat);
      c.visible = false; c.castShadow = true; this.group.add(c); this.coins.push(c);
    }
  }

  setDisplay(text, sub = '') {
    const x = this.displayCanvas.getContext('2d');
    x.fillStyle = '#031208'; x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#5dff9a'; x.font = 'bold 38px "Courier New", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#5dff9a'; x.shadowBlur = 8;
    x.fillText(text, 128, sub ? 36 : 48);
    if (sub) { x.font = '22px "Courier New", monospace'; x.fillText(sub, 128, 74); }
    this.displayTex.needsUpdate = true;
  }

  _buildScanner() {
    const C = STORE.counter;
    // flatbed scanner set into the counter top
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.006, 0.18, 2, 0.002), new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.4, metalness: 0.4 }));
    frame.position.set(C.x + 0.3, C.top + 0.001, C.z + 0.1);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.14), new THREE.MeshPhysicalMaterial({ color: 0x10140f, roughness: 0.05, metalness: 0, clearcoat: 1, emissive: 0xff1a0a, emissiveIntensity: 0.05 }));
    glass.rotation.x = -Math.PI / 2; glass.position.set(C.x + 0.3, C.top + 0.0045, C.z + 0.1);
    this.scanGlass = glass.material;
    this.group.add(frame, glass);
    this.scanSpot = new THREE.Vector3(C.x + 0.3, C.top + 0.0045, C.z + 0.1);
    // red laser fan (visible only while scanning)
    const fan = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.12), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fan.position.set(C.x + 0.3, C.top + 0.06, C.z + 0.1);
    fan.renderOrder = 7;
    this.laser = fan;
    this.group.add(fan);
  }

  _buildPrinter() {
    const C = STORE.counter;
    const p = new THREE.Group(); p.position.set(C.x + 0.86, C.top, C.z + 0.05); p.rotation.y = -0.5;
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.11, 0.17, 3, 0.015), new THREE.MeshStandardMaterial({ color: 0xdedfe0, roughness: 0.5 }));
    body.position.y = 0.055; p.add(body);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.004, 0.01), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    slot.position.set(0, 0.105, 0.05); p.add(slot);
    // receipt strip grows out of the slot during a purchase
    const rc = document.createElement('canvas'); rc.width = 128; rc.height = 256;
    const rx = rc.getContext('2d');
    rx.fillStyle = '#f8f7f2'; rx.fillRect(0, 0, 128, 256);
    rx.fillStyle = '#333'; rx.font = 'bold 13px "Courier New", monospace'; rx.textAlign = 'center';
    rx.fillText('* RECEIPT *', 64, 22);
    rx.font = '11px "Courier New", monospace'; rx.textAlign = 'left';
    ['POWER-UP     1', '----------------', 'PAID   COINS', '', 'THANK YOU', 'COME AGAIN'].forEach((l, i) => rx.fillText(l, 10, 52 + i * 18));
    for (let i = 0; i < 30; i++) rx.fillRect(10 + i * 3.6, 200, i % 3 ? 1 : 2, 30);
    const rTex = new THREE.CanvasTexture(rc); rTex.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.16), new THREE.MeshStandardMaterial({ map: rTex, roughness: 0.6, side: THREE.DoubleSide }));
    strip.geometry.translate(0, 0.08, 0); // grows from its bottom edge
    strip.position.set(0, 0.107, 0.05); strip.rotation.x = -0.35; strip.scale.y = 0.001;
    p.add(strip);
    this.receipt = strip;
    p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(p);
  }

  _buildExtras() {
    const C = STORE.counter;
    // impulse-buy box of generic candy bars
    const box = new THREE.Group(); box.position.set(C.x - 0.78, C.top, C.z - 0.2); box.rotation.y = 0.15;
    const bm = new THREE.MeshStandardMaterial({ color: 0xf2b72f, roughness: 0.6 });
    for (const [w, h, d, x, y, z] of [[0.22, 0.004, 0.15, 0, 0.002, 0], [0.22, 0.06, 0.004, 0, 0.03, -0.075], [0.22, 0.03, 0.004, 0, 0.015, 0.075], [0.004, 0.06, 0.15, -0.11, 0.03, 0], [0.004, 0.06, 0.15, 0.11, 0.03, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bm); m.position.set(x, y, z); box.add(m);
    }
    const rng = makeRng(5);
    const cols = [0xd8382f, 0x7a3b1f, 0x2f8fd8, 0x3cb371];
    for (let i = 0; i < 9; i++) {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.012, 0.13, 2, 0.004), new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.35, metalness: 0.3 }));
      bar.position.set(-0.095 + i * 0.024, 0.012 + rng() * 0.01, 0); bar.rotation.x = -0.25; box.add(bar);
    }
    box.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(box);
    // stack of folded paper bags + the bag used for a purchase
    const kraft = new THREE.MeshStandardMaterial({ map: kraftTex(), roughness: 0.9 });
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.12), kraft);
    stack.position.set(C.x - 0.58, C.top + 0.015, C.z - 0.24); stack.rotation.y = -0.1; stack.castShadow = stack.receiveShadow = true;
    this.group.add(stack);
    this.bag = buildPaperBag(kraft);
    this.bag.visible = false;
    this.group.add(this.bag);
  }

  _buildItems() {
    const C = STORE.counter, top = C.top;
    const add = (it, x, z, ry) => { it.setRest(this.group, [C.x + x, top, C.z + z], ry); this.items.set(it.id, it); };
    add(new MarketItem({ id: 'hint_drop', title: 'POWERFUL HINT', model: buildHintDropPack(), hit: [0.13, 0.03, 0.19], shadow: [0.15, 0.21], hover: { lift: 0.005, tiltX: -0.07 } }), -0.56, 0.12, 0.14);
    add(new MarketItem({ id: 'blackout_shield', title: 'FIREWALL', model: buildShieldPack(), hit: [0.13, 0.03, 0.19], shadow: [0.15, 0.21], hover: { lift: 0.005, tiltX: -0.07 } }), -0.33, 0.15, -0.1);
    add(new MarketItem({ id: 'second_chance', title: 'SKIP TOKEN', model: buildSecondChanceCan(), hit: [0.075, 0.13, 0.075], shadow: [0.09, 0.09], hover: { lift: 0.006, tiltX: -0.05 } }), -0.12, 0.02, 0.4);
    add(new MarketItem({ id: 'deep_scan', title: 'FREEZE', model: buildDeepScanBox(), hit: [0.14, 0.05, 0.22], shadow: [0.16, 0.24], hover: { lift: 0.004, tiltX: -0.05 } }), 0.06, 0.12, 0.18);
    // THE GAME: two more power-ups, a step further back on the counter
    add(new MarketItem({ id: 'glitch_pack', title: 'GLITCH ATTACK', model: buildGlitchPack(), hit: [0.13, 0.03, 0.19], shadow: [0.15, 0.21], hover: { lift: 0.005, tiltX: -0.07 } }), -0.46, -0.13, -0.08);
    add(new MarketItem({ id: 'overclock_pack', title: 'OVERCLOCK', model: buildOverclockPack(), hit: [0.13, 0.03, 0.19], shadow: [0.15, 0.21], hover: { lift: 0.005, tiltX: -0.07 } }), -0.2, -0.12, 0.1);
  }

  get hitTargets() { return [...this.items.values()].filter((i) => !i.transferred).map((i) => i.hit); }

  aimFocusLight(p) { this.focusLight.target.position.copy(p); this.focusLight.target.updateMatrixWorld(); }

  resetLayout() {
    for (const it of this.items.values()) { it.transferred = false; it.restoreRest(); }
    this.bag.visible = false;
    this.receipt.scale.y = 0.001;
    this.laser.material.opacity = 0;
    for (const c of this.coins) c.visible = false;
    this.setDisplay('WELCOME');
  }
}

function buildPaperBag(kraft) {
  const g = new THREE.Group();
  const W = 0.18, D = 0.11, H = 0.22, t = 0.0015;
  const inner = kraft.clone(); inner.color = new THREE.Color(0x8a7558);
  for (const [w, h, d, x, y, z] of [[W, t, D, 0, t / 2, 0], [W, H, t, 0, H / 2, D / 2], [W, H, t, 0, H / 2, -D / 2], [t, H, D, W / 2, H / 2, 0], [t, H, D, -W / 2, H / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), kraft); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  // serrated top edge
  // folded rim (a ring, so the bag stays open)
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 0.9 });
  for (const [w, d, x, z] of [[W + 0.004, 0.004, 0, D / 2], [W + 0.004, 0.004, 0, -D / 2], [0.004, D, W / 2, 0], [0.004, D, -W / 2, 0]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), rimMat); r.position.set(x, H - 0.006, z); g.add(r);
  }
  // darker inside walls so the opening reads
  for (const [w, h, d, x, y, z] of [[W - 0.004, H - 0.01, 0.001, 0, H / 2, D / 2 - 0.0012], [W - 0.004, H - 0.01, 0.001, 0, H / 2, -D / 2 + 0.0012], [0.001, H - 0.01, D - 0.004, W / 2 - 0.0012, H / 2, 0], [0.001, H - 0.01, D - 0.004, -W / 2 + 0.0012, H / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), inner); m.position.set(x, y, z); g.add(m);
  }
  g.userData.height = H;
  return g;
}

function speckledLaminate() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4e52'; x.fillRect(0, 0, S, S);
  const rng = makeRng(8);
  for (let i = 0; i < 9000; i++) {
    const v = rng();
    x.fillStyle = v < 0.5 ? `rgba(30,32,34,${0.4 + rng() * 0.5})` : v < 0.85 ? `rgba(140,142,140,${0.3 + rng() * 0.4})` : `rgba(210,205,190,${0.4 + rng() * 0.5})`;
    x.fillRect(rng() * S, rng() * S, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(3, 1.2);
  // roughness: satin with worn, shinier hand-contact zone at the front
  const r = document.createElement('canvas'); r.width = r.height = 256;
  const rx = r.getContext('2d'); const img = rx.createImageData(256, 256);
  const n = fbm(256, 256, { seed: 12, scale: 3, octaves: 4 });
  for (let i = 0; i < 256 * 256; i++) { const v = 120 + n[i] * 70; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  rx.putImageData(img, 0, 0);
  const rough = new THREE.CanvasTexture(r); rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return { map, roughnessMap: rough };
}

function keypadTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#1e2124'; x.fillRect(0, 0, 256, 160);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
    x.fillStyle = k > 3 ? '#3a6f9a' : '#d9d9d6';
    x.beginPath(); x.roundRect(10 + k * 40, 10 + r * 36, 34, 30, 5); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function kraftTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b8955f'; x.fillRect(0, 0, 256, 256);
  const rng = makeRng(14);
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${rng() < 0.5 ? '90,60,30' : '230,210,170'},${rng() * 0.15})`; x.fillRect(rng() * 256, rng() * 256, 1 + rng() * 6, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
