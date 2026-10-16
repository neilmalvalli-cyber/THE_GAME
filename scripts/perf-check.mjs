// Performance + stability check (dev server, mock backend):
//   BASE_URL=http://localhost:3000 node scripts/perf-check.mjs [cycles]
// Repeats: enter Black Market → idle → inspect (real mouse click) → back → purchase
// (two-tap ritual) → exit, and records frame time, renderer load and memory per cycle.
// NOTE: numbers from a software-rendered (SwiftShader) browser are relative, not real FPS.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CYCLES = Number(process.argv[2] || 3);
const out = { scenes: {}, cycles: [], errors: [] };
let page;
const dev = (fn, a) => page.evaluate(fn, a);
const until = async (pred, ms, label) => {
  const t0 = Date.now();
  for (;;) { try { if (await pred()) return; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error('timeout: ' + label + ' state=' + JSON.stringify(await st().catch(() => null)) + ' inspected=' + (await dev(() => window.THE_GAME_DEV.marketController.instance?.inspected?.id).catch(() => '?'))); await page.waitForTimeout(250); }
};
const st = () => dev(() => { const s = window.THE_GAME_DEV.useSceneStore.getState(); return { desk: s.deskState, market: s.marketState }; });

/** Page frame rate over `ms` (all canvases), plus renderer / memory snapshot. */
const sample = (ms) => dev(async (ms) => {
  const times = [];
  await new Promise((done) => { let last = performance.now(); const t0 = last; const f = (now) => { times.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const e = window.THE_GAME_DEV.marketController.debugEngine;
  const r = e?.renderer;
  const lights = []; e?.activeScene?.traverse((o) => { if (o.isLight && o.castShadow) lights.push(`${o.type}:${o.shadow.mapSize.x}${o.visible && o.intensity > 0.001 ? '' : '(off)'}`); });
  return {
    frameMs: +avg.toFixed(1), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(1), frames: times.length,
    marketRunning: !!e?._raf, pixelRatio: e?.pixelRatio, dof: !!e?.bokeh?.enabled,
    calls: r?.info.render.calls, triangles: r?.info.render.triangles,
    geometries: r?.info.memory.geometries, textures: r?.info.memory.textures, programs: r?.info.programs?.length,
    shadowLights: lights.join(' '),
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  };
}, ms);

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  page = await (await browser.newContext({ viewport: { width: 1024, height: 640 } })).newPage();
  page.on('pageerror', (e) => out.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) out.errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 180000 });
  await page.getByText('Team Login').click();
  await page.fill('input[name=team]', `Perf ${Date.now().toString(36).slice(-4)}`);
  await page.fill('input[name=password]', 'pass12'); await page.fill('input[name=confirm]', 'pass12');
  await page.getByRole('button', { name: 'Create Team' }).last().click();
  await page.waitForFunction(() => window.THE_GAME_DEV?.gsap, null, { timeout: 60000 });
  // wall-clock timelines (software rendering runs at ~1-5 fps)
  await dev(() => window.THE_GAME_DEV.gsap.ticker.lagSmoothing(0));
  await page.evaluate(() => document.querySelector('.tg-skip')?.click());
  await until(async () => (await st()).desk === 'DESK_IDLE', 240000, 'desk idle');
  await dev(() => { const d = window.THE_GAME_DEV; d.useGameStore.getState().earnCoins(5000, 'perf-coins'); d.marketState.activateBlackMarket(); });
  out.scenes.deskIdle = await sample(5000);

  for (let c = 1; c <= CYCLES; c++) {
    const cy = { cycle: c };
    await page.locator('.topbar__item.topbar__black').click({ timeout: 60000 });
    await until(async () => (await st()).market !== 'MARKET_INACTIVE', 60000, 'market loading');
    const t0 = Date.now();
    await until(async () => !!(await dev(() => document.querySelector('.market-skip'))) || (await st()).market === 'MARKET_IDLE', 120000, 'entrance');
    cy.entrance = await sample(3000);
    await dev(() => document.querySelector('.market-skip')?.click());
    await until(async () => (await st()).market === 'MARKET_IDLE', 120000, 'market idle');
    cy.toIdleS = +((Date.now() - t0) / 1000).toFixed(1);
    cy.idle = await sample(6000);
    if (c === 1) cy.heaviest = await dev(() => {
      const e = window.THE_GAME_DEV.marketController.debugEngine, rows = [];
      e.activeScene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
        if (!vis) return;
        const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
        let n = o; const path = []; while (n && path.length < 3) { if (n.name) path.push(n.name); n = n.parent; }
        rows.push([Math.round(tris), o.castShadow ? 'cast' : '', g.type, path.join('<') || o.parent?.type]);
      });
      rows.sort((a, b) => b[0] - a[0]);
      return { meshes: rows.length, total: rows.reduce((n, r) => n + r[0], 0), top: rows.slice(0, 14).map((r) => r.join(' ')) };
    });
    // real mouse click on an item: project its position to the screen
    const pt = await dev(() => {
      const d = window.THE_GAME_DEV, e = d.marketController.debugEngine, it = d.marketController.instance.desk.items.get('hint_drop');
      const v = it.root.getWorldPosition(it.root.position.clone()).project(e.camera);
      const rect = e.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
    });
    await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(600); await page.mouse.click(pt.x, pt.y);
    cy.clickInspects = await until(async () => (await st()).market === 'ITEM_INSPECTED', 90000, 'inspect by click').then(() => true).catch(() => false);
    if (!cy.clickInspects) { await dev(() => window.THE_GAME_DEV.marketController.instance.inspectMarketItem('hint_drop')); await until(async () => (await st()).market === 'ITEM_INSPECTED', 60000, 'inspect'); }
    cy.inspected = await sample(4000);
    await dev(() => window.THE_GAME_DEV.marketController.instance.returnToMarketDesk());
    await until(async () => (await st()).market === 'MARKET_IDLE', 60000, 'back to desk');
    const id = c === 1 ? 'firewall' : c === 2 ? 'overclock' : 'skip_token';
    const sceneId = await dev((id) => window.THE_GAME_DEV.catalog.getMarketItem(id, 'black').sceneId, id);
    await dev(([id, sceneId]) => { const d = window.THE_GAME_DEV; window.__buy = d.marketController.instance.requestPurchase(sceneId, () => d.backend.purchase(id, 'perf-' + Date.now(), 'black').then((r) => r.ok)); }, [id, sceneId]);
    await until(async () => (await st()).market === 'DEALER_TWO_TAP', 120000, 'two-tap');
    cy.purchase = await sample(2500);
    await until(async () => (await dev(() => window.__buy.then((x) => x))) !== undefined && (await st()).market === 'MARKET_IDLE', 180000, 'purchase done');
    await page.locator('.market-nav').getByRole('button', { name: 'Back to Desk' }).click();
    await until(async () => (await st()).market === 'MARKET_INACTIVE' && (await st()).desk === 'DESK_IDLE', 120000, 'exit');
    await page.evaluate(() => window.gc?.());
    await page.waitForTimeout(1000);
    cy.afterExit = await sample(4000);
    out.cycles.push(cy);
    console.log(JSON.stringify(cy));
  }
  await browser.close();
}

try { await run(); } catch (e) { out.errors.push('RUN: ' + e.message); }
console.log('\nSUMMARY ' + JSON.stringify({ deskIdle: out.scenes.deskIdle, errors: out.errors.slice(0, 6) }));
process.exit(out.errors.some((e) => e.startsWith('RUN')) ? 1 : 0);
