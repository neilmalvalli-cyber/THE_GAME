// End-to-end test against a REAL backend: the app built with NEXT_PUBLIC_GAME_BACKEND=supabase,
// talking to Supabase (Auth + PostgREST + Postgres with migration 004 and the seed).
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… node scripts/e2e-supabase.mjs   (same value as the server's ADMIN_PASSWORD)
// Needs the dev server (dev hooks drive the market and power-up calls through the real
// server actions; the 3D scenes themselves are covered by scripts/e2e.mjs).
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD (the server\'s ADMIN_PASSWORD).'); process.exit(2); }
const { ANSWERS } = await import(pathToFileURL(resolve('game/data/secrets.ts')).href);

const tag = Date.now().toString(36).slice(-5);
const TEAM_A = `Owls ${tag}`, TEAM_B = `Ring ${tag}`, PW = 'pass-1234';
const results = [];
const errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function until(page, pred, timeout = 30000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { if (await pred()) return true; } catch { /* navigating */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await page.waitForTimeout(300);
  }
}
const store = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => store(page, () => { const s = window.THE_GAME_DEV.useGameStore.getState(); return { balance: s.wallet.balance, completed: Object.keys(s.progress.completed), skipped: Object.keys(s.progress.skipped), inventory: s.inventory, purchases: s.purchases, effects: s.effects, inbox: s.inbox.messages.map((m) => m.subject), introSeen: s.introSeen, fragments: s.fragments }; });

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return page;
}

// the role screen builds the 3D desk in idle time: let it finish before typing (software GL is slow)
async function openLogin(page, which = 'Team Login') {
  await page.goto(BASE + '/');
  await page.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 120000 });
  await page.getByText(which).click();
}

async function register(page, name) {
  await openLogin(page);
  await page.fill('input[name=team]', name);
  await page.fill('input[name=password]', PW);
  await page.fill('input[name=confirm]', PW);
  await page.getByRole('button', { name: 'Create Team' }).last().click();
  await until(page, async () => (await page.evaluate(() => location.pathname)).startsWith('/team/'), 30000, `${name} registered`);
  await page.waitForFunction(() => window.THE_GAME_DEV?.backend, null, { timeout: 60000 });
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    // ------------------------------------------------------------ registration
    const a = await openPage(browser);
    await register(a, TEAM_A);
    check('New team registers on the server and starts with the intro', (await a.evaluate(() => location.pathname)) === '/team/intro');
    await a.evaluate(() => document.querySelector('.tg-skip')?.click());
    await until(a, async () => (await a.evaluate(() => location.pathname)) === '/team/desk', 30000, 'desk');
    await until(a, async () => (await state(a)).balance === 100, 15000, 'server balance');
    check('Starting balance comes from the server (100 coins)', (await state(a)).balance === 100);

    const dup = await openPage(browser);
    await openLogin(dup);
    await dup.fill('input[name=team]', TEAM_A.toUpperCase());
    await dup.fill('input[name=password]', PW);
    await dup.fill('input[name=confirm]', PW);
    await dup.getByRole('button', { name: 'Create Team' }).last().click();
    await dup.locator('.auth__error').waitFor();
    check('Team names are unique (case-insensitive) on the server', /taken/i.test(await dup.locator('.auth__error').innerText()));
    await dup.context().close();

    // ------------------------------------------------------------ answers are server-side
    const scripts = await a.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js')));
    let leaked = false;
    for (const url of scripts) { const body = await (await fetch(url)).text(); if (body.includes(ANSWERS['1-1']) || body.includes(ANSWERS['6-4'])) leaked = true; }
    check('No answers in the JavaScript sent to the browser', !leaked && scripts.length > 0, `${scripts.length} scripts scanned`);

    await a.goto(BASE + '/team/case/1/level/2');
    await a.locator('#answer, .answer__choices').first().waitFor({ timeout: 60000 });
    await a.fill('#answer', 'definitely wrong');
    await a.locator('.answer__submit').click();
    await a.locator('.answer__feedback.is-error').waitFor();
    check('Wrong answer rejected by the server', /incorrect/i.test(await a.locator('.answer__feedback').innerText()));
    await a.waitForTimeout(1100); // server rate limit: one attempt per second per level
    await a.fill('#answer', ANSWERS['1-2'].toLowerCase());
    await a.locator('.answer__submit').click();
    await a.locator('.answer__feedback.is-success').waitFor();
    const afterSolve = await state(a);
    check('Correct answer verified by the server; coins + level recorded', afterSolve.completed.includes('case-01/level-02') && afterSolve.balance > 100, `balance ${afterSolve.balance}`);
    const solvedBalance = afterSolve.balance;

    // ------------------------------------------------------------ another device, same team
    const a2 = await openPage(browser);
    await openLogin(a2);
    await a2.getByRole('tab', { name: 'Login to Existing Team' }).click();
    await a2.fill('input[name=team]', TEAM_A.toLowerCase());
    await a2.fill('input[name=password]', 'wrong-password');
    await a2.getByRole('button', { name: 'Login', exact: true }).click();
    await a2.locator('.auth__error').waitFor();
    check('Wrong team password rejected', /incorrect/i.test(await a2.locator('.auth__error').innerText()));
    await a2.fill('input[name=password]', PW);
    await a2.getByRole('button', { name: 'Login', exact: true }).click();
    await until(a2, async () => (await a2.evaluate(() => location.pathname)) === '/team/desk', 30000, 'second device desk');
    await a2.waitForFunction(() => window.THE_GAME_DEV?.backend, null, { timeout: 60000 });
    const s2 = await state(a2);
    check('Second device: returning team skips the intro and sees the same progress', s2.introSeen && s2.balance === solvedBalance && s2.completed.includes('case-01/level-02'), `balance ${s2.balance}`);
    await a2.context().close();

    // ------------------------------------------------------------ admin
    const adm = await openPage(browser);
    await openLogin(adm, 'Admin Login');
    await adm.fill('input[name=admin-password]', 'wrong');
    await adm.getByRole('button', { name: 'Login', exact: true }).click();
    await adm.locator('.auth__error').waitFor();
    check('Admin login rejects a wrong password', (await adm.evaluate(() => location.pathname)) === '/');
    await adm.fill('input[name=admin-password]', ADMIN_PASSWORD);
    await adm.getByRole('button', { name: 'Login', exact: true }).click();
    await adm.getByRole('button', { name: 'Market Operations' }).waitFor({ timeout: 30000 });
    check('Admin signs in with the admin password (checked on the server)', (await adm.evaluate(() => location.pathname)) === '/admin');

    const b = await openPage(browser);
    await register(b, TEAM_B);
    await b.evaluate(() => document.querySelector('.tg-skip')?.click());
    await until(b, async () => (await b.evaluate(() => location.pathname)) === '/team/desk', 30000, 'B desk');

    await adm.getByRole('button', { name: 'Teams', exact: true }).first().click();
    await until(adm, async () => { const t = await adm.getByTestId('teams-table').innerText(); return t.includes(TEAM_A) && t.includes(TEAM_B); }, 20000, 'teams listed');
    check('Admin team list comes from the server (both teams)', true);

    // ------------------------------------------------------------ markets (server rules)
    // start from a known market state (an earlier run may have left the Black Market on)
    await adm.getByRole('button', { name: 'Market Operations' }).click();
    if (await adm.getByRole('button', { name: 'Deactivate Black Market', exact: true }).count()) {
      await adm.getByRole('button', { name: 'Deactivate Black Market', exact: true }).click();
      await adm.getByRole('button', { name: 'Confirm deactivation' }).click();
    }
    if (await adm.getByRole('button', { name: 'Reopen market' }).count()) await adm.getByRole('button', { name: 'Reopen market' }).click();
    await until(adm, async () => (await adm.getByTestId('black-status').innerText()).toLowerCase().includes('locked') || !(await adm.getByTestId('black-status').innerText()).toLowerCase().includes('active'), 15000, 'BM locked');
    await until(a, async () => (await store(a, () => window.THE_GAME_DEV.marketState.getMarketState().blackMarketStatus)) === 'locked', 15000, 'team sees BM locked');
    const buy = (page, id, market, key) => store(page, ([id, market, key]) => window.THE_GAME_DEV.backend.purchase(id, key, market), [id, market, key]);
    const closed = await buy(a, 'firewall', 'black', 'bm-early');
    check('Black Market purchase refused while locked', !closed.ok && closed.reason === 'market-closed', closed.message);
    await adm.getByRole('button', { name: 'Market Operations' }).click();
    await adm.getByRole('button', { name: 'Activate Black Market', exact: true }).click();
    await adm.getByRole('button', { name: 'Confirm activation' }).click();
    await until(adm, async () => (await adm.getByTestId('black-status').innerText()).toLowerCase().includes('active'), 15000, 'BM active');
    await until(a, async () => (await a.locator('.topbar__item', { hasText: 'Black Market' }).count()) === 1, 15000, 'team sees BM');
    check('Admin activation reaches the team (Black Market door appears)', true);
    const hintBuy = await buy(a, 'powerful_hint', 'black', 'bm-hint-1');
    const again = await buy(a, 'powerful_hint', 'black', 'bm-hint-1');
    const sA = await state(a);
    check('Black Market sale at the discount price; inventory from the server', hintBuy.ok && sA.balance === solvedBalance - 30 && sA.inventory.powerful_hint === 1, JSON.stringify(hintBuy));
    check('Same purchase id is never charged twice', !again.ok && again.reason === 'duplicate');
    const broke = await buy(a, 'master_key', 'black', 'bm-mk');
    check('Insufficient funds refused by the server', !broke.ok && broke.reason === 'insufficient-funds', broke.message);

    // ------------------------------------------------------------ power-ups
    await a.goto(BASE + '/team/case/2/level/1');
    await a.waitForFunction(() => window.THE_GAME_DEV?.backend, null, { timeout: 60000 });
    await a.getByRole('button', { name: /Use Powerful Hint \(1\)/ }).click();
    await a.getByTestId('powerful-hint').waitFor({ timeout: 15000 });
    check('Powerful Hint text comes from the server', (await a.getByTestId('powerful-hint').innerText()).length > 25);
    const glitchBuy = await buy(a, 'store_glitch_attack', 'normal', 'st-glitch');
    check('Normal Market sale at the list price', glitchBuy.ok, JSON.stringify(glitchBuy));
    const bId = await store(b, () => window.THE_GAME_DEV.useGameStore.getState().team.id);
    const hit = await store(a, (id) => window.THE_GAME_DEV.backend.launchSabotageRemote('glitch', id), bId);
    check('Glitch Attack launched at a rival', hit.ok, hit.message);
    await b.getByTestId('glitch-fx').waitFor({ timeout: 15000 });
    check('Rival is glitched on its own device (via server sync)', true);
    await until(b, async () => (await state(b)).inbox.some((s) => /hit your team/.test(s)), 15000, 'B told');
    check('Rival is told by mail', true);
    const self = await store(a, (id) => window.THE_GAME_DEV.backend.launchSabotageRemote('glitch', id), await store(a, () => window.THE_GAME_DEV.useGameStore.getState().team.id));
    check('Cannot attack yourself', !self.ok);

    // ------------------------------------------------------------ admin mail + market shutdown
    await adm.getByRole('button', { name: 'Mail Operations' }).click();
    await adm.getByRole('button', { name: 'Compose message' }).click();
    await adm.getByTestId('composer').waitFor({ timeout: 10000 });
    await adm.locator('[data-testid=composer] input:not([type=radio]):not([type=search])').first().fill('Server mail check');
    await adm.locator('[data-testid=composer] textarea').fill('Delivered by the server.');
    await adm.getByRole('button', { name: 'Send message' }).click();
    await adm.getByRole('button', { name: 'Send message' }).click().catch(() => undefined); // double click
    await until(a, async () => (await state(a)).inbox.filter((s) => s === 'Server mail check').length === 1, 20000, 'mail delivered');
    await until(b, async () => (await state(b)).inbox.includes('Server mail check'), 20000, 'mail delivered to B');
    check('Admin mail reaches every team once', true);

    await adm.getByRole('button', { name: 'Market Operations' }).click();
    await adm.getByRole('button', { name: 'Shut down market' }).click();
    await adm.getByRole('button', { name: 'Confirm shutdown' }).click();
    await until(a, async () => (await store(a, () => window.THE_GAME_DEV.marketState.getMarketState().normalMarketStatus)) === 'closed', 15000, 'team sees shutdown');
    const shut = await buy(a, 'store_firewall', 'normal', 'st-shut');
    check('Shutdown reaches the team and the server refuses sales', !shut.ok && shut.reason === 'market-closed');
    await adm.getByRole('button', { name: 'Reopen market' }).click();

    // ------------------------------------------------------------ phone + logout
    const phone = await store(a, () => window.THE_GAME_DEV.backend.verifyPhoneRemote('000000000'));
    check('Wrong phone code refused by the server', !phone.ok);
    await a.goto(BASE + '/team/desk');
    await a.waitForFunction(() => window.THE_GAME_DEV?.backend, null, { timeout: 60000 });
    await a.waitForFunction(() => window.THE_GAME_DEV?.useSceneStore?.getState().deskState === 'DESK_IDLE', null, { timeout: 240000, polling: 1000 }); await a.locator('.topbar__item[aria-label^="Leave"]').click({ force: true }); // visible + idle desk checked above; rAF is starved under software GL
    await a.getByRole('button', { name: 'Return to Login', exact: true }).click();
    await until(a, async () => (await a.evaluate(() => location.pathname)) === '/', 10000, 'logged out');
    await a.goto(BASE + '/team/desk');
    await until(a, async () => (await a.evaluate(() => location.pathname)) === '/', 10000, 'guarded');
    check('Logout ends the server session (team pages redirect to login)', true);

    const relevant = errors.filter((e) => !/fonts\.g|Failed to load resource|ERR_|net::|WebGL|GPU|swiftshader/i.test(e));
    check('No console / page errors', relevant.length === 0, relevant.slice(0, 4).join(' || '));
  } finally {
    await browser.close();
  }
}

try { await run(); } catch (e) { check('Test run completed', false, e.message); }
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
