// Every power-up, end to end, on the REAL backend (as at the event): two teams + the admin,
// using the actual screens (level page, wallet, mini-game banner, admin dashboard).
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… node scripts/e2e-powerups.mjs
// Needs the dev server with NEXT_PUBLIC_GAME_BACKEND=supabase and migrations 004 + 005.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD (the server\'s ADMIN_PASSWORD).'); process.exit(2); }
const { ANSWERS } = await import(pathToFileURL(resolve('game/data/secrets.ts')).href);
const tag = Date.now().toString(36).slice(-4);
const A = `Alpha ${tag}`, B = `Bravo ${tag}`, PW = 'pass-1234';
const results = []; const errors = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const until = async (page, pred, ms, label) => { const t0 = Date.now(); for (;;) { try { if (await pred()) return; } catch { /* navigating */ } if (Date.now() - t0 > ms) throw new Error('timeout: ' + label); await page.waitForTimeout(300); } };
const st = (p) => p.evaluate(() => { const s = window.THE_GAME_DEV.useGameStore.getState(); return { coins: s.wallet.balance, inv: s.inventory, completed: Object.keys(s.progress.completed), skipped: Object.keys(s.progress.skipped), fx: s.effects, fragments: s.fragments, mail: s.inbox.messages.map((m) => m.subject), score: Object.keys(s.progress.completed).length }; });
const buy = (p, id, market) => p.evaluate(([id, market]) => window.THE_GAME_DEV.backend.purchase(id, 'e2e-' + id + '-' + Math.random(), market), [id, market]);

async function page(browser) {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(m.text()); });
  return p;
}
async function register(p, name) {
  await p.goto(BASE + '/');
  await p.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 180000 });
  await p.getByText('Team Login').click();
  await p.fill('input[name=team]', name); await p.fill('input[name=password]', PW); await p.fill('input[name=confirm]', PW);
  await p.getByRole('button', { name: 'Create Team' }).last().click();
  await p.waitForFunction(() => window.THE_GAME_DEV?.backend, null, { timeout: 90000 });
  await p.evaluate(() => window.THE_GAME_DEV.gsap.ticker.lagSmoothing(0));
  await p.evaluate(() => document.querySelector('.tg-skip')?.click());
  await until(p, async () => (await p.evaluate(() => location.pathname)) === '/team/desk', 60000, name + ' desk');
}
const wallet = async (p) => { await p.locator('.topbar__wallet').click({ force: true }); await p.getByTestId('wallet-powerups').waitFor(); };
const closeWallet = (p) => p.getByRole('button', { name: 'Close wallet' }).click({ force: true });

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const a = await page(browser); await register(a, A);
    const b = await page(browser); await register(b, B);
    const bId = await b.evaluate(() => window.THE_GAME_DEV.useGameStore.getState().team.id);

    // admin: open the Black Market
    const adm = await page(browser);
    await adm.goto(BASE + '/');
    await adm.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 180000 });
    await adm.getByText('Admin Login').click();
    await adm.fill('input[name=admin-password]', ADMIN_PASSWORD);
    await adm.getByRole('button', { name: 'Login', exact: true }).click();
    await adm.getByRole('button', { name: 'Market Operations' }).click({ timeout: 60000 });
    await adm.getByTestId('minigame-ops').waitFor({ timeout: 30000 });
    await adm.waitForTimeout(6000); // the dashboard pulls the real market state every 4 s
    if (await adm.getByRole('button', { name: 'Activate Black Market', exact: true }).count()) {
      await adm.getByRole('button', { name: 'Activate Black Market', exact: true }).click();
      await adm.getByRole('button', { name: 'Confirm activation' }).click();
    }
    if (await adm.getByRole('button', { name: 'End mini-game' }).count()) await adm.getByRole('button', { name: 'End mini-game' }).click();

    // team A earns coins by solving levels on the server (cases 3–6)
    for (const c of [3, 4, 5, 6]) for (let l = 1; l <= 4; l++) {
      await a.evaluate(([c, l, ans]) => window.THE_GAME_DEV.backend.submitAnswer(c, l, ans), [c, l, ANSWERS[`${c}-${l}`]]);
      await a.waitForTimeout(150);
    }
    const s0 = await st(a);
    check('Team A earned coins from 16 server-checked solves', s0.coins > 1500 && s0.completed.length === 16, `${s0.coins} coins`);

    // purchases (same calls the 3D markets make)
    const bought = {};
    for (const [id, m] of [['powerful_hint', 'black'], ['skip_token', 'black'], ['master_key', 'black'], ['blackout_bundle', 'black'], ['store_overclock', 'normal'], ['store_freeze', 'normal'], ['store_freeze', 'normal'], ['store_glitch_attack', 'normal']]) {
      const r = await buy(a, id, m); bought[id] = (bought[id] || 0) + (r.ok ? 1 : 0);
      if (!r.ok) console.log('   buy', id, m, '→', r.message);
    }
    await until(a, async () => (await st(a)).inv.master_key === 1, 15000, 'inventory sync');
    const s1 = await st(a);
    check('Purchases land in the inventory (bundle = Glitch Attack + Firewall)', s1.inv.powerful_hint === 1 && s1.inv.skip_token === 1 && s1.inv.master_key === 1 && s1.inv.overclock === 1 && s1.inv.freeze === 2 && s1.inv.glitch_attack === 2 && s1.inv.firewall === 1, JSON.stringify(s1.inv));
    const bFw = await buy(b, 'store_firewall', 'normal');
    check('Team B buys a Firewall', bFw.ok, bFw.message || '');

    // 1. Powerful Hint (level page)
    await a.goto(BASE + '/team/case/1/level/1');
    await a.getByRole('button', { name: /Use Powerful Hint \(1\)/ }).click({ timeout: 90000 });
    await a.getByTestId('powerful-hint').waitFor({ timeout: 20000 });
    check('Powerful Hint: method clue shown, comes from the server', (await a.getByTestId('powerful-hint').innerText()).length > 25);

    // 2. Skip Token (level page)
    const scoreBefore = (await st(a)).completed.length;
    await a.getByRole('button', { name: /Use Skip Token \(1\)/ }).click();
    await a.getByRole('button', { name: 'Confirm skip' }).click();
    await until(a, async () => (await st(a)).skipped.includes('case-01/level-01'), 20000, 'skip');
    check('Skip Token: level cleared, no solve points', (await st(a)).completed.length === scoreBefore && /skipped/i.test(await a.locator('.dossier__meta').innerText()));

    // 3. Master Key (wallet) on case 2
    await wallet(a);
    await a.selectOption('select[aria-label="Master Key case"]', '2');
    await a.getByRole('button', { name: 'Unlock case' }).click();
    await until(a, async () => !!(await st(a)).fragments['2'], 20000, 'master key');
    const s3 = await st(a);
    check('Master Key: whole case completed, its fragment revealed, no score', ['case-02/level-01', 'case-02/level-04'].every((k) => s3.skipped.includes(k)) && s3.fragments['2']?.length === 2 && s3.completed.length === scoreBefore, `fragment ${s3.fragments['2']}`);
    check('Master Key: gone from the inventory (one use per team)', !s3.inv.master_key);

    // 4. Overclock (wallet) + admin mini-game (banner)
    await a.getByRole('button', { name: 'Arm' }).click();
    await until(a, async () => (await st(a)).fx.overclockArmed, 15000, 'armed');
    check('Overclock armed', true);
    await closeWallet(a);
    await adm.getByTestId('minigame-ops').waitFor({ timeout: 20000 });
    await adm.getByTestId('minigame-ops').getByLabel('Question').fill('What is 6 x 7?');
    await adm.getByTestId('minigame-ops').getByLabel('Answer').fill('42');
    await adm.getByTestId('minigame-ops').getByLabel('Reward (coins)').fill('25');
    await adm.getByRole('button', { name: 'Launch mini-game' }).click();
    await a.getByTestId('minigame').waitFor({ timeout: 20000 });
    await b.getByTestId('minigame').waitFor({ timeout: 20000 });
    check('Mini-game reaches both teams', true);
    const coinsA = (await st(a)).coins, coinsB = (await st(b)).coins;
    await a.getByLabel('Mini-game answer').fill('41'); await a.getByTestId('minigame').getByRole('button', { name: 'Submit' }).click();
    await a.locator('.minigame__note').waitFor({ timeout: 15000 });
    check('Mini-game: wrong answer refused', /not quite/i.test(await a.locator('.minigame__note').innerText()));
    await a.getByLabel('Mini-game answer').fill('42'); await a.getByTestId('minigame').getByRole('button', { name: 'Submit' }).click();
    await until(a, async () => (await st(a)).coins === coinsA + 50, 20000, 'A paid');
    check('Overclock doubles the mini-game reward (25 → 50) and is spent', !(await st(a)).fx.overclockArmed);
    await b.getByLabel('Mini-game answer').fill('42'); await b.getByTestId('minigame').getByRole('button', { name: 'Submit' }).click();
    await until(b, async () => (await st(b)).coins === coinsB + 25, 20000, 'B paid');
    check('Without Overclock the reward is normal (25)', true);
    await adm.getByRole('button', { name: 'End mini-game' }).click();
    await until(a, async () => (await a.getByTestId('minigame').count()) === 0, 20000, 'banner gone');
    check('Admin ends the mini-game; banner disappears', true);

    // 5. Firewall blocks a Freeze; 6. Freeze lands; 7. Glitch Attack lands (wallet)
    await wallet(a);
    await a.selectOption('select[aria-label="Freeze target"]', bId);
    await a.getByTestId('pu-freeze').getByRole('button', { name: 'Launch' }).click();
    await until(b, async () => (await st(b)).mail.some((s) => /Firewall blocked a Freeze/.test(s)), 20000, 'blocked mail');
    const sb1 = await st(b);
    check('Firewall blocks the first attack and is used up', !sb1.inv.firewall && sb1.fx.freezeUntil < Date.now());
    await a.selectOption('select[aria-label="Freeze target"]', bId);
    await a.getByTestId('pu-freeze').getByRole('button', { name: 'Launch' }).click();
    await b.getByTestId('freeze-banner').waitFor({ timeout: 20000 });
    check('Freeze: rival sees the 60 s banner, page stays usable', /FROZEN/.test(await b.getByTestId('freeze-banner').innerText()));
    await a.selectOption('select[aria-label="Glitch Attack target"]', bId);
    await a.getByTestId('pu-glitch_attack').getByRole('button', { name: 'Launch' }).click();
    await b.getByTestId('glitch-fx').waitFor({ timeout: 20000 });
    check('Glitch Attack: rival glitched (visual only)', (await b.evaluate(() => getComputedStyle(document.querySelector('.glitch-fx')).pointerEvents)) === 'none');
    await until(a, async () => (await st(a)).mail.some((s) => /landed on/.test(s)), 20000, 'attacker told');
    check('Attacker is told the outcome by mail', true);
    // 8. Blackout Bundle: its Glitch Attack + Firewall are usable
    const s8 = await st(a);
    check('Blackout Bundle items usable (second Glitch Attack + Firewall left)', s8.inv.glitch_attack === 1 && s8.inv.firewall === 1, JSON.stringify(s8.inv));
    await closeWallet(a);

    // admin: put the Black Market back
    await adm.getByRole('button', { name: 'Deactivate Black Market', exact: true }).click();
    await adm.getByRole('button', { name: 'Confirm deactivation' }).click();
    const relevant = errors.filter((e) => !/fonts\.g|Failed to load resource|ERR_|net::|WebGL|GPU|swiftshader/i.test(e));
    check('No console / page errors', relevant.length === 0, relevant.slice(0, 3).join(' || '));
  } finally { await browser.close(); }
}

try { await run(); } catch (e) { check('Test run completed', false, e.message); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed  (teams "${A}", "${B}")`);
process.exit(failed ? 1 : 0);
