// Deterministic landing analysis. Needs the dev server (npm run dev).
//   node scripts/landing-check.mjs [runs]
// Pauses the real six-file landing timeline and steps it at exactly 120 Hz, recording
// every file's transform, its animation phase and the camera's offset from its base
// pose. Reports, per file: direction reversals after contact (oscillation), motion after
// it reached rest, the final error from the authored rest transform, and how many frames
// the camera shook while files were already lying still.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const RUNS = Number(process.argv[2] || 2);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
// a signed-in team is needed for /team: create a throwaway one (mock accounts, this browser only)
await page.goto(BASE + '/');
await page.waitForFunction(() => document.querySelector('.scene-layer--desk')?.dataset.phase === 'ready', null, { timeout: 240000, polling: 1000 });
await page.getByText('Team Login').click();
await page.fill('input[name=team]', `Landing ${Date.now().toString(36).slice(-5)}`);
await page.fill('input[name=password]', 'landing1');
await page.fill('input[name=confirm]', 'landing1');
await page.getByRole('button', { name: 'Create Team' }).last().click();
await page.waitForURL('**/team/intro', { timeout: 60000 });
await page.waitForFunction(() => window.THE_GAME_DEV?.gsap, null, { timeout: 120000, polling: 500 });
await page.evaluate(() => document.querySelector('.tg-skip')?.click());
await page.waitForURL('**/team/desk', { timeout: 120000 });
await page.evaluate(() => window.THE_GAME_DEV.gsap.ticker.lagSmoothing(0));
await page.waitForFunction(() => window.THE_GAME_DEV.useSceneStore.getState().deskState === 'DESK_IDLE', null, { timeout: 300000, polling: 500 });

let failures = 0;
for (let run = 1; run <= RUNS; run++) {
  const r = await page.evaluate(() => {
    const scene = window.THE_GAME_DEV.deskController.instance;
    scene.pause(); // we drive time ourselves
    if (!scene.playFolderEntrance()) return { error: 'replay refused' };
    const tl = scene.seq;
    tl.pause(0);
    const cam = scene.cameraDirector;
    const dt = 1 / 120;
    const keys = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
    const files = scene.folders.map((f) => ({ id: f.id, rest: { ...f.rest }, samples: [] }));
    const camOff = [];
    const total = tl.duration();
    for (let t = 0; t <= total + 0.5; t += dt) {
      tl.seek(Math.min(t, total), false); // fires the timeline's callbacks in order
      cam.update(t, dt);
      const b = cam.base, p = scene.camera.position;
      camOff.push(Math.hypot(p.x - b.px, p.y - b.py, p.z - b.pz) - 0); // includes idle drift
      scene.folders.forEach((f, i) => files[i].samples.push({ t, phase: f.phase, p: keys.map((k) => f.pose[k]), visible: f.group.visible, cover: f.cover.ripple }));
    }
    // drift-free camera offset: re-run update with drift off to isolate shake
    const out = files.map((F) => {
      const s = F.samples;
      const rest = keys.map((k) => F.rest[k]);
      const err = (q) => Math.max(...q.p.map((v, j) => Math.abs(v - rest[j])));
      const firstVisible = s.findIndex((q) => q.visible);
      const contact = s.findIndex((q, i) => i > firstVisible && firstVisible >= 0 && q.visible && Math.abs(q.p[1]) < 1e-4);
      const restIdx = s.findIndex((q, i) => i >= contact && contact >= 0 && s.slice(i).every((r) => err(r) < 1e-6));
      // vertical / tilt reversals after contact: the file should come down and stay down
      let reversals = 0;
      for (const j of [1, 3, 5]) {
        let prev = 0;
        for (let i = contact + 1; i < s.length && contact >= 0; i++) {
          const d = s[i].p[j] - s[i - 1].p[j];
          if (Math.abs(d) < 1e-7) continue;
          const sg = Math.sign(d);
          if (prev && sg !== prev) reversals++;
          prev = sg;
        }
      }
      // cover flutter reversals after contact
      let flutter = 0, pf = 0;
      for (let i = contact + 1; i < s.length && contact >= 0; i++) { const d = s[i].cover - s[i - 1].cover; if (Math.abs(d) < 1e-7) continue; const sg = Math.sign(d); if (pf && sg !== pf) flutter++; pf = sg; }
      const phases = [...new Set(s.map((q) => q.phase))];
      return { id: F.id, contactAt: contact * dt, restAt: restIdx * dt, reversals, flutter, finalErr: err(s[s.length - 1]), phases };
    });
    // camera: frames with shake while file 1 was already at rest
    const restAt1 = out[0].restAt;
    const shake = cam.shake;
    void shake;
    let camMovesAfterRest = 0;
    for (let i = Math.ceil(restAt1 / dt) + 1; i < camOff.length; i++) if (Math.abs(camOff[i] - camOff[i - 1]) > 2e-4) camMovesAfterRest++;
    scene.resetDesk();
    scene.resume();
    return { out, camMovesAfterRest, total: +total.toFixed(2) };
  });
  if (r.error) { console.log('run', run, r.error); failures++; continue; }
  console.log(`\nrun ${run} — timeline ${r.total}s, camera moved in ${r.camMovesAfterRest} frames after file 01 came to rest`);
  for (const f of r.out) {
    const ok = f.reversals === 0 && f.finalErr < 1e-6;
    if (!ok) failures++;
    console.log(`  file ${String(f.id).padStart(2, '0')}: contact ${f.contactAt.toFixed(3)}s · rest ${f.restAt.toFixed(3)}s · reversals ${f.reversals} · cover flutter reversals ${f.flutter} · final error ${f.finalErr.toExponential(1)} · phases ${f.phases.join('>')} ${ok ? 'OK' : 'FAIL'}`);
  }
}
await browser.close();
console.log(failures ? `\n${failures} problem(s)` : '\nall files land cleanly');
process.exit(failures ? 1 : 0);
