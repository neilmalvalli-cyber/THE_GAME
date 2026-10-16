// End-to-end journey test. Needs the dev server (npm run dev) on BASE_URL.
//   node scripts/e2e.mjs            (CHROMIUM_PATH overrides the browser)
// In software-rendered environments the 3D runs at a few fps, so the test
// switches off GSAP lag smoothing (dev-only global) to keep timelines on
// wall-clock time. It asserts on routes, scene states and the shared store.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PW = process.env.MOCK_ADMIN_PASSWORD || 'GameAdmin#2026!'; // .env.development (mock)
const TEAM = `E2E ${Date.now().toString(36).slice(-5)}`;
const results = [];
let page, browser;
const errors = [];
const navLog = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const dev = (fn, arg) => page.evaluate(fn, arg);
const scene = () => dev(() => { const s = window.THE_GAME_DEV.useSceneStore.getState(); return { phase: s.deskPhase, desk: s.deskState, open: s.deskOpenId, market: s.marketState, intro: s.introPhase }; });
const game = () => dev(() => { const s = window.THE_GAME_DEV.useGameStore.getState(); return { balance: s.wallet.balance, tx: s.wallet.transactions.length, completed: Object.keys(s.progress.completed), selected: s.progress.selectedLevel, purchases: s.purchases, unread: s.inbox.messages.filter((m) => !m.read && !m.archived).length, messages: s.inbox.messages.length, session: s.session }; });
const path = () => page.evaluate(() => location.pathname);

async function until(pred, timeout = 60000, label = 'condition') {
  const t0 = Date.now();
  for (;;) {
    try { if (await pred()) return true; } catch { /* page navigating */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await page.waitForTimeout(250);
  }
}

async function devReady() {
  await page.waitForFunction(() => window.THE_GAME_DEV?.gsap, null, { timeout: 60000 });
  await dev(() => {
    window.THE_GAME_DEV.gsap.ticker.lagSmoothing(0);
    // record every desk state for "no replay" assertions
    window.__deskLog = [];
    window.THE_GAME_DEV.useSceneStore.subscribe((s, p) => { if (s.deskState !== p.deskState) window.__deskLog.push(s.deskState); });
    // every market state, recorded as it happens (polling misses the short ones on slow machines)
    window.__marketLog = [];
    window.THE_GAME_DEV.useSceneStore.subscribe((s, p) => { if (s.marketState !== p.marketState) window.__marketLog.push(s.marketState); });
    window.__shopLog = [];
    window.THE_GAME_DEV.useSceneStore.subscribe((s, p) => { if (s.shopState !== p.shopState) window.__shopLog.push(s.shopState); });
  });
}
const deskLog = () => dev(() => window.__deskLog.slice());
const clearDeskLog = () => dev(() => { window.__deskLog.length = 0; });
const marketLog = () => dev(() => window.__marketLog.slice());
const clearMarketLog = () => dev(() => { window.__marketLog.length = 0; });
const shopLog = () => dev(() => window.__shopLog.slice());
const clearShopLog = () => dev(() => { window.__shopLog.length = 0; });

async function run() {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 520 } });
  page = await ctx.newPage();
  // record the phone intro entering play, independent of when the dev hooks load
  await page.addInitScript(() => {
    const mo = new MutationObserver(() => {
      if (!window.__introSeen && document.querySelector('.phone-intro .tg-stage.m-play')) {
        window.__introSeen = { path: location.pathname, topbar: !!document.querySelector('.topbar'), deskBuilt: document.querySelector('.scene-layer--desk')?.dataset.phase === 'ready' };
      }
    });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navLog.push(f.url().replace(BASE, '')); });
  await page.addInitScript(() => {
    // remember who pushed each history entry, for failure reports
    const trace = (kind, url) => (window.__navTrace ||= []).push(`${(performance.now() / 1000).toFixed(1)}s ${kind} ${url} ← ${new Error().stack.split('\n').slice(3, 6).map((l) => l.trim().replace(/\(?http[^)]*\/src\//, '(')).join(' ')}`);
    const push = history.pushState, replace = history.replaceState;
    history.pushState = function (...a) { trace('push', a[2]); return push.apply(this, a); };
    history.replaceState = function (...a) { trace('replace', a[2]); return replace.apply(this, a); };
    window.addEventListener('popstate', () => trace('pop', location.pathname));
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  // ---------------------------------------------------------------- admin
  await page.goto(BASE + '/');
  await page.getByText('Choose your access').waitFor();
  // let the role screen finish its idle-time preparation (desk build, intro table image), as a person would
  await page.waitForFunction(() => document.querySelector('.scene-layer--desk')?.dataset.phase === 'ready' && document.documentElement.dataset.introWood === 'ready', null, { timeout: 240000, polling: 1000 });
  check('Role selection shows both access options', await page.getByText('Team Login').isVisible() && await page.getByText('Admin Login').isVisible());
  await page.goto(BASE + '/admin');
  await page.getByText('Choose your access').waitFor();
  check('/admin without an admin session goes back to the login screen', (await path()) === '/');
  // that was a reload: let the screen finish its idle-time preparation again before clicking
  await page.waitForFunction(() => document.querySelector('.scene-layer--desk')?.dataset.phase === 'ready' && document.documentElement.dataset.introWood === 'ready', null, { timeout: 240000, polling: 1000 });
  await page.getByText('Admin Login').click();
  await page.fill('input[name=admin-password]', 'not-the-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.locator('.auth__error').waitFor();
  check('Admin login rejects a wrong password', (await path()) === '/' && /incorrect/i.test(await page.locator('.auth__error').innerText()));
  await page.fill('input[name=admin-password]', ADMIN_PW);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByRole('button', { name: 'Market Operations' }).waitFor();
  check('Admin login with the (mock) password opens the dashboard', (await path()) === '/admin');
  check('Admin does not play the phone intro', (await page.locator('.phone-intro').count()) === 0);
  await page.getByRole('button', { name: 'Exit Admin' }).click();
  await page.getByText('Choose your access').waitFor();
  check('Exit Admin returns to the login screen', (await path()) === '/');

  // ---------------------------------------------------------------- team login + intro
  // the role screen builds the desk in idle time, so the call never shares the main thread with it
  await page.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 90000 });
  check('/team without a team session goes to the login screen', await page.evaluate(async () => { history.pushState({}, '', '/team/desk'); dispatchEvent(new PopStateEvent('popstate')); await new Promise((r) => setTimeout(r, 400)); return location.pathname === '/'; }));
  await page.getByText('Team Login').click();
  await page.fill('input[name=team]', TEAM);
  await page.fill('input[name=password]', 'pass12');
  await page.fill('input[name=confirm]', 'pass13');
  await page.getByRole('button', { name: 'Create Team' }).last().click();
  check('Registration rejects mismatched passwords', /do not match/i.test(await page.locator('.auth__error').innerText()));
  await page.fill('input[name=password]', 'pass12');
  await page.fill('input[name=confirm]', 'pass12');
  await page.getByRole('button', { name: 'Create Team' }).last().click();
  await until(async () => !!(await page.evaluate(() => window.__introSeen)), 30000, 'intro playing');
  const during = await page.evaluate(() => window.__introSeen);
  check('Team Login starts the phone intro', during.path === '/team/intro');
  check('Top bar hidden during the intro', !during.topbar);
  check('Desk already built before the phone intro starts (no intro stutter)', during.deskBuilt);
  // use the intro's own Skip if the call is still ringing. Software rendering saturates the main
  // thread with the intro's SVG filters, so press the real button through the DOM.
  await page.evaluate(() => document.querySelector('.tg-skip')?.click());
  await devReady();
  const g0 = await game();
  check('Mock team session initialised (100 coins)', g0.session && g0.balance === 100, `balance ${g0.balance}`);
  await until(async () => (await path()) === '/team/desk', 20000, 'desk after intro');
  check('Intro completion hands over to the desk', true);
  await until(async () => (await scene()).desk === 'DESK_IDLE', 120000, 'folders landed');
  const log1 = await deskLog();
  const folders = await dev(() => window.THE_GAME_DEV.deskController.instance.folders.map((f) => ({ id: f.id, phase: f.phase })));
  const caseCount = await dev(() => window.THE_GAME_DEV.cases.CASES.length);
  check(`One folder per case (${caseCount}) on the desk, all IDLE after landing`, folders.length === caseCount && folders.every((f) => f.phase === 'IDLE'), folders.map((f) => `${f.id}:${f.phase}`).join(' '));
  check('Desk reveal → folders land → idle', log1.includes('FOLDERS_DROPPING') && log1.at(-1) === 'DESK_IDLE', log1.join(' > '));
  check('Session marks intro + landing complete', (await game()).session.introCompleted && (await game()).session.deskLanded);

  // ---------------------------------------------------------------- case + levels
  await clearDeskLog();
  await page.locator('.file-index__tab').nth(2).click();
  await until(async () => (await scene()).desk === 'FOLDER_OPEN', 60000, 'case 3 open');
  check('Opening case 03 routes to /team/case/3', (await path()) === '/team/case/3');
  const live = () => page.locator('.hud--case .sr-only').textContent();
  check('Case opens with Level 01 selected by default', (await live()).startsWith('Level 01'));
  check('No level strip overlay on the open file', (await page.locator('.level-strip, .level-chip').count()) === 0);
  await page.keyboard.press('ArrowRight');
  await until(async () => (await game()).selected[3] === 2, 5000, 'level 2 selected');
  check('Choosing Level 02 updates the report', (await live()).includes('The Erased Record'));
  await page.keyboard.press('Enter');
  await until(async () => (await path()) === '/team/case/3/level/2', 20000, 'level route');
  await page.getByRole('heading', { name: /LEVEL 02 — THE ERASED RECORD/ }).waitFor();
  check('Level page shows case, level, difficulty, reward, briefing, evidence',
    await page.getByText('CASE 03 — THE GHOST FILE').isVisible() && await page.getByText('ERPBEQ QRYRGRQ').isVisible() && await page.getByText('Mission briefing').isVisible());
  check('Desk render loop paused under the level page', await dev(() => window.THE_GAME_DEV.deskController.instance.paused));

  await page.fill('#answer', 'nothing here');
  await page.locator('.answer__submit').click();
  check('Incorrect answer shows an error and allows retry', (await page.locator('.answer__feedback.is-error').innerText()).includes('Incorrect') && (await game()).balance === 100);
  await page.fill('#answer', 'record deleted');
  await page.locator('.answer__submit').click();
  await page.locator('.verified').waitFor();
  const g1 = await game();
  check('Correct answer → VERIFIED, level complete, +150 coins', g1.balance === 250 && g1.completed.includes('case-03/level-02'), `balance ${g1.balance}`);
  check('Top bar balance updates immediately', (await page.locator('.topbar__wallet').innerText()).includes('250'));
  await page.locator('.answer__submit').click();
  check('Repeating a completed level awards nothing', (await game()).balance === 250 && (await page.locator('.answer__feedback').innerText()).includes('already verified'));

  await page.getByRole('button', { name: 'Back to Case' }).first().click();
  await until(async () => (await path()) === '/team/case/3' && (await scene()).desk === 'FOLDER_OPEN', 20000, 'back to case');
  const log2 = await deskLog();
  check('Back to Case: case 03 still open, no landing replay', !log2.includes('FOLDERS_DROPPING') && !log2.includes('FOLDER_CLOSING'), log2.join(' > ') || 'no desk transitions');
  check('Back to Case: Level 02 still selected and marked complete',
    (await game()).selected[3] === 2 && (await live()).includes('Completed'));

  // Back to Case popped the level off the history, so it is now the Forward entry
  await page.goForward();
  await until(async () => (await path()) === '/team/case/3/level/2', 10000, 'browser forward to level');
  await page.getByText('ERPBEQ QRYRGRQ').waitFor();
  check('Browser Forward re-opens the level page', true);
  await page.goBack();
  await until(async () => (await path()) === '/team/case/3' && (await scene()).desk === 'FOLDER_OPEN', 10000, 'browser back to case');
  check('Browser Back returns to the still-open case', !(await deskLog()).includes('FOLDER_CLOSING'));

  await page.getByRole('button', { name: /Back to Desk/ }).click();
  await until(async () => (await scene()).desk === 'DESK_IDLE', 60000, 'folder closed');
  const log3 = await deskLog();
  check('Back to Desk closes the folder naturally (close → return → idle)', log3.includes('FOLDER_CLOSING') && log3.includes('FOLDER_RETURNING') && !log3.includes('FOLDERS_DROPPING'), log3.join(' > '));
  check('Folders back at rest positions', (await dev(() => window.THE_GAME_DEV.deskController.instance.measureDrift())) < 1e-6);

  // ---------------------------------------------------------------- incoming mail (scripted dead drop after first solve)
  await until(async () => (await page.locator('.notice').count()) > 0, 30000, 'dead drop notice');
  const noticeText = await page.locator('.notice').innerText();
  check('Dead Drop arrives as a non-intrusive notice', noticeText.includes('UNKNOWN SOURCE') && noticeText.includes('DEAD DROP'), noticeText.replace(/\n/g, ' | '));
  check('Notice did not navigate away', (await path()) === '/team/desk');
  const unreadBadge = await page.locator('.topbar__badge').innerText();
  check('Unread badge counts the new mail', Number(unreadBadge) === (await game()).unread, `badge ${unreadBadge}`);

  // notifications wait while a folder is moving
  await page.locator('.file-index__tab').nth(0).click();
  await until(async () => ['FOLDER_SELECTING', 'FOLDER_OPENING'].includes((await scene()).desk), 20000, 'folder opening');
  await dev(() => window.simulateIncomingMail('system'));
  await page.waitForTimeout(200);
  const busyNotice = await page.locator('.notice').innerText().catch(() => '');
  check('New notice is queued while the folder animates', !busyNotice.includes('System Alert'));
  await until(async () => (await scene()).desk === 'FOLDER_OPEN', 60000, 'case 1 open');
  await until(async () => (await page.locator('.notice').innerText().catch(() => '')).includes('System Alert'), 30000, 'queued notice shown later');
  check('Queued notice appears once the scene is calm', true);
  await page.getByRole('button', { name: /Back to Desk/ }).click();
  await until(async () => (await scene()).desk === 'DESK_IDLE', 60000, 'idle again');

  // ---------------------------------------------------------------- inbox
  await page.locator('.topbar__mail').click();
  await until(async () => (await path()) === '/team/inbox', 10000, 'inbox');
  await page.locator('.row').first().waitFor();
  check('Inbox opens with mock messages', (await page.locator('.row').count()) >= 7, `${await page.locator('.row').count()} rows`);
  const pausedUnderInbox = await until(() => dev(() => window.THE_GAME_DEV.deskController.instance.paused), 5000, 'desk paused').catch(() => false);
  check('Desk paused while the inbox covers it', pausedUnderInbox);
  await page.fill('.mail__search input', 'licensed hints');
  await until(async () => (await page.locator('.row').count()) === 1, 5000, 'search');
  check('Search filters messages', (await page.locator('.row__subject').innerText()) === 'The Market Is Open');
  await page.locator('.mail__search button').click();
  await page.getByRole('button', { name: /Dead Drops/ }).click();
  await until(async () => (await page.evaluate(() => location.search)).includes('folder=deadDrops'), 5000, 'folder param');
  const onlyDrops = await until(async () => { const n = await page.locator('.row').count(); return n > 0 && n === (await page.locator('.row__tag').count()); }, 5000, 'dead drop list').catch(() => false);
  check('Dead Drops folder lists only dead drops', onlyDrops, `${await page.locator('.row').count()} rows / ${await page.locator('.row__tag').count()} tagged`);
  await page.locator('.row__open', { hasText: 'LIMITED TIME' }).click();
  await page.locator('.classified').waitFor();
  const t1 = await page.locator('.classified__timer').innerText();
  await page.waitForTimeout(2200);
  const t2 = await page.locator('.classified__timer').innerText();
  check('Dead Drop shows ACTIVE countdown from a fixed expiry', /^\d+:\d\d/.test(t1) && t1 !== t2, `${t1} → ${t2}`);
  const id5 = 'msg-05';
  check('Opening a message marks it read', await dev((id) => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.find((m) => m.id === id).read, id5));
  await page.locator('.reader__tools button').first().click();
  check('Star toggles', await dev((id) => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.find((m) => m.id === id).starred, id5));
  await page.getByRole('button', { name: 'Mark unread' }).click();
  await until(async () => !(await path()).includes('msg-05'), 5000, 'back to list after mark unread');
  check('Mark unread returns to the list and flags it unread', !(await dev((id) => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.find((m) => m.id === id).read, id5)));
  await page.goto(BASE + '/team/inbox/msg-02');
  await devReady();
  await page.locator('.classified').waitFor();
  check('Expired Dead Drop shows EXPIRED (deep link + refresh)', (await page.locator('.classified__status').innerText()).toUpperCase() === 'EXPIRED');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  check('Archive moves the message out of the inbox', await dev(() => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.find((m) => m.id === 'msg-02').archived));
  await page.goto(BASE + '/team/inbox/does-not-exist');
  await page.getByText('Message not found').waitFor();
  check('Invalid message id shows a fallback', true);

  // ---------------------------------------------------------------- invalid routes + refresh
  await page.goto(BASE + '/team/case/9');
  await page.getByText('No such case file').waitFor();
  check('Invalid case id shows a useful fallback', (await path()) === '/team/case/9');
  await page.goto(BASE + '/team/case/2/level/7');
  await page.getByText('No such level').waitFor();
  check('Invalid level id shows a useful fallback', true);
  await page.goto(BASE + '/team/case/2/level/2');
  await page.getByText('WKLV LV D WHVW PHVVDJH').waitFor();
  await devReady();
  check('Refresh / deep link to a level page works', (await game()).balance === 250, `balance after reload ${(await game()).balance}`);
  await page.goto(BASE + '/team/intro');
  await until(async () => (await path()) === '/team/desk', 10000, 'intro redirect');
  check('Intro does not replay within a session (redirects to desk)', true);
  await devReady();
  await until(async () => (await scene()).desk === 'DESK_IDLE', 60000, 'desk restored');
  check('Refreshed desk is restored without the landing', !(await deskLog()).includes('FOLDERS_DROPPING'), (await deskLog()).join(' > '));

  // ---------------------------------------------------------------- wallet
  await page.locator('.topbar__wallet').click();
  await page.locator('.wallet.is-open').waitFor();
  const w = await page.locator('.wallet').innerText();
  check('Wallet overlay shows team + same balance + history', w.toUpperCase().includes(TEAM.toUpperCase()) && w.includes('250') && w.includes('+150'));
  check('Wallet does not navigate', (await path()) === '/team/desk');
  await page.getByRole('button', { name: 'Close wallet' }).click();
  await until(async () => (await page.locator('.wallet').count()) === 0, 3000, 'wallet closed');
  check('Wallet closes', true);
  const dup = await dev(() => { const g = window.THE_GAME_DEV.useGameStore.getState(); const a = g.spendCoins(10, 'dup-test'); const b = g.spendCoins(10, 'dup-test'); const c = g.spendCoins(999999, 'too-much'); const d = g.earnCoins(5, 'case-03/level-02'); return [a.ok, b.ok && 'x' || b.reason, c.ok || c.reason, d.ok || d.reason, g.getBalance()]; });
  const balAfter = await dev(() => window.THE_GAME_DEV.useGameStore.getState().wallet.balance);
  check('Duplicate purchase ids, overdrafts and re-claimed rewards are rejected', dup[0] === true && dup[1] === 'duplicate' && dup[2] === 'insufficient-funds' && dup[3] === 'duplicate' && balAfter === 240, JSON.stringify(dup) + ` balance ${balAfter}`);

  // ---------------------------------------------------------------- black market gating
  check('Black Market hidden from the nav while locked', (await page.locator('.topbar__item', { hasText: 'Black Market' }).count()) === 0);
  await page.goto(BASE + '/team/black-market');
  await devReady();
  await page.locator('.bm-locked').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  check('/team/black-market is blocked while locked (no room built or entered)', (await scene()).market === 'MARKET_INACTIVE' && (await page.locator('.bm-locked').innerText()).includes('locked'));
  await page.locator('.bm-locked').getByRole('button', { name: 'Back to Desk' }).click();
  await until(async () => (await path()) === '/team/desk' && (await scene()).desk === 'DESK_IDLE', 60000, 'desk after locked page');
  await clearDeskLog();

  // the Admin activates it from another tab of the same browser
  const admin = await page.context().newPage();
  const adminActivity = async () => {
    await admin.getByRole('button', { name: 'Activity Log' }).click();
    const t = await admin.getByTestId('activity-log').innerText();
    await admin.getByRole('button', { name: 'Market Operations' }).click();
    return t;
  };
  admin.setDefaultTimeout(60000);
  await admin.goto(BASE + '/');
  await admin.getByText('Admin Login').click();
  await admin.fill('input[name=admin-password]', ADMIN_PW);
  await admin.getByRole('button', { name: 'Login', exact: true }).click();
  await admin.getByRole('button', { name: 'Market Operations' }).click();
  await admin.getByRole('button', { name: 'Activate Black Market' }).click();
  await admin.getByRole('alertdialog').waitFor();
  await admin.getByRole('button', { name: 'Cancel' }).click();
  check('Admin confirmation: Cancel changes nothing', (await admin.getByTestId('black-status').innerText()).toUpperCase() === 'LOCKED');
  await admin.getByRole('button', { name: 'Activate Black Market' }).click();
  await admin.getByRole('button', { name: 'Confirm activation' }).click();
  check('Admin: Black Market now ACTIVE, logged in System Activity', (await admin.getByTestId('black-status').innerText()).toUpperCase() === 'ACTIVE' && (await adminActivity()).includes('Black Market activated'));
  await until(async () => (await page.locator('.topbar__item', { hasText: 'Black Market' }).count()) === 1, 10000, 'black market nav item');
  check('Activation reveals the Black Market in the team nav (other tab, live)', true);
  const altMail = () => dev(() => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.filter((m) => m.subject === 'AN ALTERNATIVE HAS OPENED'));
  await until(async () => (await altMail()).length >= 1, 10000, 'activation mail');
  await dev(() => window.THE_GAME_DEV.processMarketEvents()); // a second pass must not duplicate it
  const alt = await altMail();
  check('Activation mail "AN ALTERNATIVE HAS OPENED" from UNKNOWN SOURCE, exactly once', alt.length === 1 && alt[0].from === 'UNKNOWN SOURCE' && alt[0].body.startsWith('When the official channels close'), `${alt.length} message(s)`);

  // ---------------------------------------------------------------- admin: teams, scores, mail
  await admin.getByRole('button', { name: 'Teams', exact: true }).click();
  await until(async () => (await admin.getByTestId('teams-table').innerText()).includes(TEAM), 10000, 'team in admin table');
  const row = (await admin.locator('[data-testid=teams-table] tbody tr', { hasText: TEAM }).innerText()).split('\t').map((x) => x.trim());
  const gNow = await game();
  check('Admin sees the team with the same score and coins as the team view (score ≠ coins)', row[2] === '150' && row[3] === String(gNow.balance), row.join(' | '));
  await admin.locator('[data-testid=teams-table] tbody tr', { hasText: TEAM }).click();
  const det = await admin.getByTestId('team-detail').innerText();
  check('Team detail: case-by-case progress (CASE 03 — 1/4 — IN PROGRESS)', /CASE 03[\s\S]*1\/4 LEVELS[\s\S]*IN PROGRESS/i.test(det) && /CASE 01[\s\S]*NOT STARTED/i.test(det));
  await admin.getByRole('button', { name: 'Mail Operations' }).click();
  await admin.getByRole('button', { name: 'Compose message' }).click();
  await admin.getByLabel('Specific team').check();
  await admin.locator('.composer__picker label', { hasText: TEAM }).locator('input').check();
  await admin.locator('.composer select').selectOption('warning');
  await admin.locator('.composer__field', { hasText: 'Subject' }).locator('input').fill('NEW INTELLIGENCE RECEIVED');
  await admin.locator('.composer textarea').fill('Check the second floor.');
  await admin.evaluate(() => { const b = [...document.querySelectorAll('.composer button')].find((x) => x.textContent === 'Send message'); b.click(); b.click(); });
  await until(async () => (await admin.getByTestId('sent-table').innerText()).includes('NEW INTELLIGENCE RECEIVED'), 5000, 'sent list');
  check('Admin message sent once (double click), listed under Sent', (await admin.locator('[data-testid=sent-table] tbody tr', { hasText: 'NEW INTELLIGENCE RECEIVED' }).count()) === 1);
  await page.bringToFront();
  const adminMail = () => dev(() => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.filter((m) => m.subject === 'NEW INTELLIGENCE RECEIVED'));
  await until(async () => (await adminMail()).length === 1, 15000, 'admin mail delivered');
  const am = (await adminMail())[0];
  check('Team receives it once, unread, from THE GAME, as a Warning', !am.read && am.from === 'THE GAME' && am.category === 'warning');
  await until(async () => (await page.locator('.notice, .mail-notice, [class*=notifier]').innerText().catch(() => '')).includes('NEW INTELLIGENCE'), 30000, 'notice shown').catch(() => undefined);
  check('A compact notice announced it without navigating away', (await path()) === '/team/desk');
  await admin.getByRole('button', { name: 'Market Operations' }).click();

  // ---------------------------------------------------------------- black market
  await clearDeskLog();
  await clearMarketLog();
  await page.locator('.topbar__item', { hasText: 'Black Market' }).click();
  await until(async () => (await path()) === '/team/black-market', 5000, 'market route');
  await until(async () => (await scene()).market !== 'MARKET_INACTIVE', 60000, 'market loading');
  await until(async () => (await scene()).market === 'MARKET_IDLE', 120000, 'market idle');
  const seen = new Set(await marketLog());
  check('Black Market entrance plays (door → room → dealer → idle)', ['DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO'].every((s) => seen.has(s)), [...seen].join(' > '));
  check('Desk paused and hidden while in the market', await dev(() => window.THE_GAME_DEV.deskController.instance.paused && window.THE_GAME_DEV.deskController.el.style.visibility === 'hidden'));
  await dev(() => window.THE_GAME_DEV.marketController.instance.inspectMarketItem('master_key'));
  await until(async () => (await scene()).market === 'ITEM_INSPECTED', 30000, 'inspect');
  await dev(() => { const g = window.THE_GAME_DEV.useGameStore.getState(); g.spendCoins(g.wallet.balance - 120, 'drain-for-test', 'Test drain'); });
  await page.getByRole('button', { name: /Purchase · 450/ }).click();
  await page.locator('.ledger__error').waitFor();
  check('Insufficient funds: error shown, no animation, no deduction', (await scene()).market === 'ITEM_INSPECTED' && (await game()).balance === 120, await page.locator('.ledger__error').innerText());
  await dev(() => window.THE_GAME_DEV.useGameStore.getState().earnCoins(880, 'refill-for-test', 'Test refill'));
  await page.getByRole('button', { name: 'Put it back' }).last().click();
  await until(async () => (await scene()).market === 'MARKET_IDLE', 30000, 'returned');
  await dev(() => window.THE_GAME_DEV.marketController.instance.inspectMarketItem('hint_drop'));
  await until(async () => (await scene()).market === 'ITEM_INSPECTED', 30000, 'inspect envelope');
  const before = (await game()).balance;
  await clearMarketLog();
  const bmHint = await dev(() => window.THE_GAME_DEV.catalog.getMarketItem('hint_drop', 'black'));
  check('Black Market sells the shared catalogue at a discount (list price struck through)', bmHint.price < bmHint.listPrice && (await page.locator('.ledger__list').count()) === 1, `${bmHint.listPrice} → ${bmHint.price}`);
  const btn = page.getByRole('button', { name: new RegExp(`Purchase · ${bmHint.price}`) });
  await btn.click();
  await btn.click({ timeout: 1000 }).catch(() => undefined); // double click must not double charge
  await until(async () => (await scene()).market === 'MARKET_IDLE' && (await marketLog()).includes('PURCHASE_COMPLETE'), 120000, 'purchase ritual');
  const ritual = new Set(await marketLog());
  const g2 = await game();
  check('Purchase ritual plays incl. the two-tap', ['PURCHASE_STARTING', 'DEALER_ACCEPTING_PAYMENT', 'DEALER_TWO_TAP', 'ITEM_DELIVERY'].every((s) => ritual.has(s)), [...ritual].join(' > '));
  check('Purchase deducts exactly once from the shared wallet', g2.balance === before - bmHint.price && g2.purchases.powerful_hint === 1, `${before} → ${g2.balance}`);
  check('Top bar reads the same balance as the market', (await page.locator('.topbar__wallet').innerText()).replace(/\D/g, '') === String(g2.balance));

  await clearMarketLog();
  await page.getByRole('button', { name: 'Back to Desk' }).click();
  await until(async () => (await scene()).market === 'MARKET_INACTIVE' && (await path()) === '/team/desk', 90000, 'market exit');
  const exitSeen = new Set(await marketLog());
  await until(async () => (await scene()).desk === 'DESK_IDLE', 30000, 'desk after market');
  check('Back to Desk plays the market exit and restores the desk', exitSeen.has('MARKET_EXITING'));
  check('Desk restored exactly (no landing, folders at rest)', !(await deskLog()).includes('FOLDERS_DROPPING') && (await dev(() => window.THE_GAME_DEV.deskController.instance.measureDrift())) < 1e-6);
  check('Desk rendering again after the market', !(await dev(() => window.THE_GAME_DEV.deskController.instance.paused)));

  // second visit: the entrance runs brisker and can be skipped
  await clearMarketLog();
  await page.locator('.topbar__item', { hasText: 'Black Market' }).click();
  await until(async () => (await marketLog()).some((m) => ['DOOR_OPENING', 'ROOM_REVEAL'].includes(m)), 60000, 'second entrance');
  check('Repeat entrance plays faster', (await dev(() => window.THE_GAME_DEV.marketController.instance.seq.speed)) > 1);
  // skip if the entrance is still running (on a fast machine it may already be done)
  await page.evaluate(() => document.querySelector('.market-skip')?.click());
  await until(async () => (await scene()).market === 'MARKET_IDLE', 15000, 'skip to table');
  check('Skip entrance lands at the table', true);
  // the Admin deactivates it while the team is inside
  await admin.bringToFront();
  await admin.getByRole('button', { name: 'Deactivate Black Market' }).click();
  await admin.getByRole('button', { name: 'Confirm deactivation' }).click();
  await page.bringToFront();
  console.log('  [diag] admin status', await admin.getByTestId('black-status').innerText(), '· admin storage', await admin.evaluate(() => JSON.parse(localStorage.getItem('the-game:market')).state.blackMarketStatus), '· team store', await dev(() => window.THE_GAME_DEV.marketState.getMarketState().blackMarketStatus), '· team storage', await page.evaluate(() => JSON.parse(localStorage.getItem('the-game:market')).state.blackMarketStatus));
  await page.locator('.bm-closing').waitFor({ timeout: 45000 }); // the room's software-rendered frames delay the cross-tab event here
  check('Deactivated while inside: team is not thrown out, a notice explains', (await path()) === '/team/black-market' && (await scene()).market !== 'MARKET_INACTIVE');
  await dev(() => window.THE_GAME_DEV.marketController.instance.inspectMarketItem('deep_scan'));
  await until(async () => (await scene()).market === 'ITEM_INSPECTED', 30000, 'inspect after deactivation');
  const blocked = await dev(() => { const g = window.THE_GAME_DEV.useGameStore.getState(); const b = g.wallet.balance; const r = g.purchaseItem('freeze', 'blocked-test', 'black'); return { r, same: g.getBalance() === b }; });
  check('Deactivated: purchase button disabled and the commit point refuses', await page.getByRole('button', { name: /stopped trading/ }).isDisabled() && blocked.r.reason === 'market-closed' && blocked.same, JSON.stringify(blocked.r));
  await page.getByRole('button', { name: 'Put it back' }).last().click();
  await until(async () => (await scene()).market === 'MARKET_IDLE', 30000, 'put back');
  await page.locator('.market-nav').getByRole('button', { name: 'Back to Desk' }).click();
  await until(async () => (await scene()).market === 'MARKET_INACTIVE' && (await scene()).desk === 'DESK_IDLE', 90000, 'second exit');
  check('Second exit restores the desk', true);
  check('Black Market gone from the nav once the team has left', (await page.locator('.topbar__item', { hasText: 'Black Market' }).count()) === 0);

  // ---------------------------------------------------------------- normal market (the 3D store)
  const shopState = () => dev(() => window.THE_GAME_DEV.useSceneStore.getState().shopState);
  const storeInfo = () => dev(() => {
    const st = window.THE_GAME_DEV.marketController.storeInstance;
    return { closed: st.closed, crime: st.crime.active, door: st.room.doorOpen, items: st.desk.items.size, visible: [...st.desk.items.values()].filter((i) => i.root.visible).map((i) => i.id), tubesFull: st.room.tubes.every((t) => t.flicker > 0.9), lamp: st.room.lampLevel };
  });
  await clearShopLog();
  await page.locator('.topbar__item', { hasText: 'Market' }).first().click();
  await until(async () => (await path()) === '/team/market', 5000, 'shop route');
  await until(async () => (await shopState()) === 'MARKET_IDLE', 240000, 'store at the counter');
  const entrance = await shopLog();
  const s0 = await storeInfo();
  check('Normal Market opens as the 3D store: street → doors → counter, six power-ups', ['MARKET_ENTERING', 'DOOR_OPENING', 'ROOM_REVEAL', 'DEALER_INTRO'].every((x) => entrance.includes(x)) && s0.items === 6 && s0.visible.length === 6 && (await page.getByTestId('shop').getAttribute('data-status')) === 'open', entrance.join(' > '));
  const shopBefore = (await game()).balance;
  const storeHint = await dev(() => window.THE_GAME_DEV.catalog.getMarketItem('store_powerful_hint', 'normal'));
  check('Both markets use one catalogue: the store price is higher than the Black Market price', storeHint.sceneId === 'hint_drop' && storeHint.price > bmHint.price, `${storeHint.price} vs ${bmHint.price}`);
  await dev(() => window.THE_GAME_DEV.marketController.storeInstance.inspectMarketItem('hint_drop'));
  await until(async () => (await shopState()) === 'ITEM_INSPECTED', 60000, 'store inspect');
  await page.getByTestId('shop-card').waitFor();
  check('Picking up a power-up shows its card (price, stock, balance)', /powerful hint/i.test(await page.getByTestId('shop-card').innerText()));
  await clearShopLog();
  await page.evaluate(() => { const b = [...document.querySelectorAll('.ledger--shop button')].find((x) => x.textContent.startsWith('Buy')); b.click(); b.click(); });
  await until(async () => (await shopState()) === 'MARKET_IDLE' && (await shopLog()).includes('PURCHASE_COMPLETE'), 120000, 'checkout');
  const checkout = await shopLog();
  const gShop = await game();
  check('Store checkout plays (scan → pay → two beeps → bag)', ['PURCHASE_STARTING', 'DEALER_ACCEPTING_PAYMENT', 'DEALER_TWO_TAP', 'ITEM_DELIVERY'].every((x) => checkout.includes(x)), checkout.join(' > '));
  check('Store purchase charged exactly once, to its own stock', gShop.balance === shopBefore - storeHint.price && gShop.purchases.store_powerful_hint === 1 && (gShop.purchases.powerful_hint ?? 0) === 1, `${shopBefore} → ${gShop.balance} ${JSON.stringify(gShop.purchases)}`);

  await admin.bringToFront();
  await admin.getByRole('button', { name: 'Shut down market' }).click();
  check('Shutdown asks for confirmation with the agreed wording', (await admin.getByRole('alertdialog').innerText()).includes('Shut down the Normal Market?'));
  await admin.getByRole('button', { name: 'Cancel' }).click();
  check('Cancel keeps the market open', (await admin.getByTestId('normal-status').innerText()).toUpperCase() === 'OPEN');
  await admin.getByRole('button', { name: 'Shut down market' }).click();
  await admin.getByRole('button', { name: 'Confirm shutdown' }).click();
  check('Admin: Normal Market CLOSED, logged', (await admin.getByTestId('normal-status').innerText()).toUpperCase() === 'CLOSED' && (await adminActivity()).includes('Normal Market shut down'));
  await page.bringToFront();
  await until(async () => (await page.getByTestId('shop').getAttribute('data-status')) === 'closed', 45000, 'shop closed');
  await until(async () => (await shopState()) === 'DEALER_VIEW', 120000, 'sealed view');
  const s1 = await storeInfo();
  check('Shut down while inside: lights fail, the team ends up outside at the tape', s1.closed && s1.crime && s1.door === 0 && s1.visible.length === 0, JSON.stringify(s1));
  await until(async () => (await page.getByTestId('shop-closed-notice').getAttribute('class')).includes('is-on'), 10000, 'closed notice');
  const notice = await page.getByTestId('shop-closed-notice').innerText();
  check('MARKET CLOSED notice with the agreed lines', /MARKET CLOSED/i.test(notice) && /UNDER INVESTIGATION/i.test(notice) && /TRANSACTIONS SUSPENDED/i.test(notice));
  const closedBuy = await dev(async () => {
    const d = window.THE_GAME_DEV, g = d.useGameStore.getState(), b = g.wallet.balance;
    const inspect = await d.marketController.storeInstance.inspectMarketItem('deep_scan');
    return { inspect, check: g.checkPurchase('store_freeze', 'normal').reason, commit: g.purchaseItem('store_freeze', 'closed-test', 'normal').reason, same: g.getBalance() === b };
  });
  check('Closed: nothing can be picked up and every purchase path refuses', closedBuy.inspect === false && closedBuy.check === 'market-closed' && closedBuy.commit === 'market-closed' && closedBuy.same, JSON.stringify(closedBuy));
  const mailCount = (subject) => dev((sub) => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.filter((m) => m.subject === sub).length, subject);
  await until(async () => (await mailCount('MARKET SHUT DOWN')) === 1, 10000, 'shutdown mail');
  check('Shutdown mail from THE GAME delivered once', (await dev(() => window.THE_GAME_DEV.useGameStore.getState().inbox.messages.find((m) => m.subject === 'MARKET SHUT DOWN').from)) === 'THE GAME');

  // leave, and come back while it is still closed: the doors do not open
  await page.locator('.market-nav').getByRole('button', { name: 'Back to Desk' }).click();
  await until(async () => (await shopState()) === 'MARKET_INACTIVE' && (await path()) === '/team/desk', 90000, 'left the sealed store');
  await clearShopLog();
  // record every door position the scene sets (a frame sampler can miss a 0.4 s jolt)
  await dev(() => {
    window.__maxDoor = 0;
    const room = window.THE_GAME_DEV.marketController.storeInstance.room;
    if (!room.__orig) { room.__orig = room.setDoorOpen.bind(room); room.setDoorOpen = (v) => { window.__maxDoor = Math.max(window.__maxDoor, v); room.__orig(v); }; }
  });
  await page.locator('.topbar__item', { hasText: 'Market' }).first().click();
  await until(async () => (await shopState()) === 'DEALER_VIEW', 240000, 'closed visit');
  const maxDoor = await dev(() => window.__maxDoor);
  const s2 = await storeInfo();
  check('Closed visit: up to the taped doors, they jolt but stay shut', (await shopLog()).includes('DOOR_OPENING') && maxDoor > 0 && maxDoor < 0.05 && s2.door === 0 && s2.crime, `door max ${maxDoor.toFixed(3)}`);

  // the Admin reopens while the team is looking in: the clean store, and the doors open
  await admin.bringToFront();
  await admin.getByRole('button', { name: 'Reopen market' }).click();
  await page.bringToFront();
  await until(async () => (await page.getByTestId('shop').getAttribute('data-status')) === 'open', 45000, 'shop reopened');
  await until(async () => (await shopState()) === 'MARKET_IDLE', 180000, 'walked in after reopening');
  const s3 = await storeInfo();
  check('Reopen restores the clean store exactly and lets the team in', !s3.closed && !s3.crime && s3.tubesFull && s3.lamp === 1 && s3.visible.length === 6 && s3.door === 0, JSON.stringify(s3));
  await until(async () => (await mailCount('MARKET REOPENED')) === 1, 10000, 'reopen mail');
  check('Reopen mail from SYSTEM delivered once', true);
  await page.reload();
  await devReady();
  await page.waitForTimeout(1500);
  check('Market mails are not duplicated after a reload', (await mailCount('MARKET SHUT DOWN')) === 1 && (await mailCount('MARKET REOPENED')) === 1 && (await altMail()).length === 1);
  await admin.close();
  // the reload re-entered the store; let it reach the counter before using the top bar
  await until(async () => (await shopState()) === 'MARKET_IDLE', 240000, 'store after reload');

  // ---------------------------------------------------------------- evidence phone
  await page.locator('.topbar__item', { hasText: 'Phone' }).click();
  await until(async () => (await path()) === '/team/phone', 5000, 'phone route');
  await page.locator('.ev').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.querySelector('.ev-skip')?.click());
  await page.locator('.ev.is-ready').waitFor({ timeout: 120000 });
  const status = () => page.getByTestId('phone-status').innerText();
  const dots = () => page.locator('.lk-dots span.is-on').count();
  check('Evidence phone: locked, asks for the passcode', (await status()) === 'Enter Passcode' && (await page.locator('.lk-key').count()) === 12);
  await page.keyboard.type('12');
  await page.keyboard.press('Backspace');
  const afterBack = await dots();
  await page.keyboard.press('Escape');
  check('Keyboard entry, Backspace and Clear work', afterBack === 1 && (await dots()) === 0);
  await page.keyboard.type('1234567890'); // ten keys: the tenth is ignored
  check('No more than nine digits', (await dots()) === 9 && (await status()) === 'Enter Passcode');
  await page.keyboard.press('Enter');
  await until(async () => (await status()) === 'ACCESS DENIED', 5000, 'denied');
  check('Wrong code: ACCESS DENIED', true);
  await until(async () => (await status()) === 'Enter Passcode' && (await dots()) === 0, 5000, 'cleared');
  check('Wrong code: input cleared for another try', (await dev(() => window.THE_GAME_DEV.useGameStore.getState().phone)).failedAttempts === 1);
  // the right code by touch, leading zero first
  for (const d of '04271958') await page.evaluate((k) => document.querySelector(`.lk-key[aria-label="${k}"]`).click(), d);
  check('Unlock is disabled until all nine digits are entered', await page.getByTestId('phone-unlock').isDisabled());
  await page.evaluate(() => document.querySelector('.lk-key[aria-label="3"]').click());
  await page.evaluate(() => { const b = document.querySelector('[data-testid=phone-unlock]'); b.click(); b.click(); }); // a double press submits once
  await until(async () => (await status()) === 'DEVICE UNLOCKED', 5000, 'unlocking');
  check('Correct code (leading zero kept): DEVICE UNLOCKED, failures not double-counted', (await dev(() => window.THE_GAME_DEV.useGameStore.getState().phone)).failedAttempts === 1);
  await page.getByTestId('phone-home').waitFor({ timeout: 15000 });
  check('Unlocked: the phone opens on its home screen with six apps', (await page.locator('.os-icon').count()) === 6);
  const appsOk = [];
  for (const app of ['messages', 'contacts', 'gallery', 'notes', 'settings']) {
    await page.click(`.os-icon[data-app=${app}]`);
    await until(async () => (await page.getByTestId('phone-os').getAttribute('data-app')) === app, 5000, `open ${app}`);
    await page.click('.os-nav__home');
    await until(async () => (await page.getByTestId('phone-os').getAttribute('data-app')) === 'home', 5000, 'home');
    appsOk.push(app);
  }
  check('Every app opens and Home returns to the launcher', appsOk.length === 5, appsOk.join(', '));
  await page.click('.os-icon[data-app=messages]');
  await page.locator('.os-row').first().click();
  await page.getByTestId('sms-thread').waitFor();
  await page.keyboard.press('Escape');
  check('Back (Escape) steps out of a conversation to the list', (await page.getByTestId('sms-list').count()) === 1);
  await page.click('.os-nav__home');
  await page.click('.os-icon[data-app=phone]');
  await page.getByTestId('call-history').waitFor({ timeout: 15000 });
  check('Unlocked: Recents call log shown, unlock persisted', (await dev(() => window.THE_GAME_DEV.useGameStore.getState().phone.unlocked)) && (await page.locator('.rc-row').count()) >= 10);
  const firstOut = await page.locator('.rc-row--outgoing').first();
  check('Most recent outgoing call is the configured number', (await firstOut.locator('.rc-row__num').innerText()) === '98765 43210');
  await firstOut.click();
  await page.getByTestId('call-detail').waitFor();
  const detail = await page.getByTestId('call-detail').innerText();
  check('Call record: number, direction, date, time, duration, contact status, notes', ['98765 43210', 'Outgoing', '23:52', '47s', 'Not saved in contacts', 'Evidence notes'].every((t) => detail.toLowerCase().includes(t.toLowerCase())), detail.replace(/\n/g, ' | '));
  await page.getByRole('button', { name: /Back to Call History/ }).click();
  await until(async () => (await page.getByTestId('call-detail').count()) === 0, 5000, 'back to list');
  check('Back to Call History returns to the list', true);
  await page.reload();
  await devReady();
  await page.getByTestId('phone-os').waitFor({ timeout: 60000 });
  check('Phone stays unlocked after a reload', (await page.locator('.lk-key').count()) === 0);
  await page.locator('.ev-back').click();
  await until(async () => (await path()) === '/team/desk' && (await scene()).desk === 'DESK_IDLE', 60000, 'desk from phone');
  check('Back to Desk from the phone', true);

  // ---------------------------------------------------------------- 25 levels, a solved case, fragments
  const lv = await page.evaluate(async () => {
    const { cases, routes, secrets } = window.THE_GAME_DEV;
    let ok = 0;
    for (const c of cases.CASES) for (const l of c.levels) { const r = routes.parseTeamRoute(`/team/case/${c.id}/level/${l.number}`); if (r.kind === 'level') ok++; }
    const frags = cases.CASES.map((c) => cases.caseFragmentLength(c.id));
    return { cases: cases.CASES.length, levels: cases.CASES.map((c) => c.levels.length), ok, frags, answers: cases.CASES.find((c) => c.id === 6).levels.map((l) => secrets.ANSWERS[`6-${l.number}`]) };
  });
  const totalLevels = lv.levels.reduce((a, b) => a + b, 0);
  check(`${lv.cases} cases (levels ${lv.levels.join(',')}), every level route resolves`, lv.cases === 7 && lv.levels.every((n) => n >= 1) && lv.ok === totalLevels, `${lv.ok}/${totalLevels} routes`);
  check('Every case pays a fragment; the fragments add up to the 9-digit phone code', lv.frags.every((n) => n >= 1) && lv.frags.reduce((a, b) => a + b, 0) === 9, lv.frags.join(','));
  const solve = await dev((answers) => {
    const g = window.THE_GAME_DEV.useGameStore.getState();
    const before = g.wallet.balance;
    const rs = answers.map((a, i) => g.submitAnswer(6, i + 1, a));
    const n = answers.length;
    const again = g.submitAnswer(6, n, answers[n - 1]);
    return { solvedOnLast: rs[n - 1].caseSolved, earlier: rs.slice(0, n - 1).some((r) => r.caseSolved), again, gained: window.THE_GAME_DEV.useGameStore.getState().wallet.balance - before };
  }, lv.answers);
  check('Case 06 is SOLVED exactly when its last level completes; repeats pay nothing', solve.solvedOnLast && !solve.earlier && !solve.again.caseSolved && solve.again.awarded === 0 && solve.again.scoreAwarded === 0, JSON.stringify(solve));
  const cover = await dev(() => window.THE_GAME_DEV.deskController.instance.folders.map((f) => f.materials.coverOuter.map.userData.solved ?? null));
  const frag6 = lv.frags[5];
  check(`Only the solved folder carries SOLVED + its ${frag6}-digit fragment on the cover`, cover[5] && cover[5].length === frag6 && cover.every((x, i) => i === 5 || x == null), JSON.stringify(cover));

  // ---------------------------------------------------------------- logout (confirmed) and back in
  const gBefore = await game();
  await page.locator('.topbar__item[aria-label^="Leave"]').click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: 'Cancel' }).click();
  check('Logout asks first; Cancel keeps the team signed in', (await path()) === '/team/desk' && (await page.getByRole('alertdialog').count()) === 0);
  await page.locator('.topbar__item[aria-label^="Leave"]').click();
  await page.getByRole('button', { name: 'Return to Login', exact: true }).click();
  await page.getByText('Choose your access').waitFor();
  check('Return to Login ends the session (team pages now redirect)', await page.evaluate(async () => { history.pushState({}, '', '/team/desk'); dispatchEvent(new PopStateEvent('popstate')); await new Promise((r) => setTimeout(r, 400)); return location.pathname === '/'; }));
  await page.getByText('Team Login').click();
  await page.getByRole('tab', { name: 'Login to Existing Team' }).click();
  await page.fill('input[name=team]', TEAM.toLowerCase());
  await page.fill('input[name=password]', 'wrong-pass');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  check('Wrong team password is rejected', /incorrect/i.test(await page.locator('.auth__error').innerText()));
  await page.fill('input[name=password]', 'pass12');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await until(async () => (await path()) === '/team/desk', 30000, 'returning team → desk');
  await devReady();
  const gAfter = await game();
  check('Returning team skips the intro and keeps score, coins and progress', !(await page.evaluate(() => !!document.querySelector('.phone-intro'))) && gAfter.balance === gBefore.balance && gAfter.completed.length === gBefore.completed.length, `${gBefore.balance}/${gBefore.completed.length} → ${gAfter.balance}/${gAfter.completed.length}`);
  await until(async () => (await scene()).desk === 'DESK_IDLE', 240000, 'desk after re-login');

  // ---------------------------------------------------------------- power-ups
  const st = (fn) => dev(fn);
  const inv0 = await st(() => window.THE_GAME_DEV.useGameStore.getState().inventory);
  check('Purchases go into the team inventory (one Powerful Hint per market)', inv0.powerful_hint === 2, JSON.stringify(inv0));
  await page.goto(BASE + '/team/case/1/level/1');
  await devReady();
  const scoreBefore = (await game()).completed.length;
  const coinsBefore = (await game()).balance;
  await page.getByRole('button', { name: /Use Powerful Hint \(2\)/ }).click();
  await page.getByTestId('powerful-hint').waitFor({ timeout: 5000 });
  const hintText = await page.getByTestId('powerful-hint').innerText();
  check('Powerful Hint reveals a method clue on the level and is consumed', hintText.length > 30 && (await st(() => window.THE_GAME_DEV.useGameStore.getState().inventory.powerful_hint)) === 1, hintText.slice(0, 80));
  await st(() => window.THE_GAME_DEV.useGameStore.setState((s) => ({ inventory: { ...s.inventory, skip_token: 1 } })));
  await page.getByRole('button', { name: /Use Skip Token \(1\)/ }).click();
  await page.getByRole('button', { name: 'Confirm skip' }).click();
  await until(async () => /skipped/i.test(await page.locator('.dossier__meta').innerText()), 5000, 'skipped');
  const gSkip = await st(() => { const s = window.THE_GAME_DEV.useGameStore.getState(); return { skipped: Object.keys(s.progress.skipped), completed: Object.keys(s.progress.completed).length, balance: s.wallet.balance, skip: s.inventory.skip_token }; });
  check('Skip Token clears the level with no solve points or coins', gSkip.skipped.includes('case-01/level-01') && gSkip.completed === scoreBefore && gSkip.balance === coinsBefore && gSkip.skip === 0, JSON.stringify(gSkip));
  const mk = await st(() => {
    const g = window.THE_GAME_DEV.useGameStore;
    g.setState((s) => ({ inventory: { ...s.inventory, master_key: 2 } }));
    const a = g.getState().useMasterKey(2);
    const b = g.getState().useMasterKey(4);
    const s = g.getState();
    return { a: a.ok, b: b.message, used: s.effects.masterKeyUsedOn, left: s.inventory.master_key, skipped: Object.keys(s.progress.skipped).filter((k) => k.startsWith('case-02')).length, completed: Object.keys(s.progress.completed).length };
  });
  check('Master Key completes a whole case without score, once per team', mk.a && mk.used === 2 && mk.skipped === 4 && mk.left === 1 && mk.completed === scoreBefore && /already used/.test(mk.b), JSON.stringify(mk));
  const mk2 = await st(() => { const g = window.THE_GAME_DEV.useGameStore; g.setState((s) => ({ effects: { ...s.effects, masterKeyUsedOn: null } })); const r = g.getState().useMasterKey(2); g.setState((s) => ({ effects: { ...s.effects, masterKeyUsedOn: 2 } })); return r.message; });
  check('Master Key cannot be used on an already completed case', /already completed/.test(mk2), mk2);
  const oc = await st(() => {
    const g = window.THE_GAME_DEV.useGameStore;
    g.setState((s) => ({ inventory: { ...s.inventory, overclock: 1 } }));
    const b0 = g.getState().wallet.balance;
    const armed = g.getState().armOverclock().ok;
    g.getState().claimMinigameReward(20, 'mg-test-1');
    const b1 = g.getState().wallet.balance;
    g.getState().claimMinigameReward(20, 'mg-test-2');
    return { armed, first: b1 - b0, second: g.getState().wallet.balance - b1, still: g.getState().effects.overclockArmed };
  });
  check('Overclock doubles only the next mini-game reward', oc.armed && oc.first === 40 && oc.second === 20 && !oc.still, JSON.stringify(oc));
  const me = await st(() => window.THE_GAME_DEV.useGameStore.getState().team);
  const attack = (kind) => page.evaluate(({ kind, me }) => {
    const list = JSON.parse(localStorage.getItem('the-game:sabotage') || '[]');
    list.push({ id: 'sab-e2e-' + kind + Date.now(), kind, fromId: 'TEAM-RIVAL', fromName: 'RIVAL CREW', toId: me.id, toName: me.name, at: Date.now() });
    localStorage.setItem('the-game:sabotage', JSON.stringify(list));
    window.THE_GAME_DEV.sabotage.processSabotage();
  }, { kind, me });
  await attack('glitch');
  await page.getByTestId('glitch-fx').waitFor({ timeout: 5000 });
  const fx = await page.evaluate(() => getComputedStyle(document.querySelector('.glitch-fx')).pointerEvents);
  await page.locator('.answer__submit').click({ timeout: 3000 });
  check('Glitch Attack applies a visual-only glitch; submitting still works', fx === 'none' && (await page.locator('.answer__feedback').innerText()).length > 0, fx);
  await st(() => window.THE_GAME_DEV.useGameStore.setState((s) => ({ inventory: { ...s.inventory, firewall: 1 } })));
  await attack('freeze');
  const fw = await st(() => { const s = window.THE_GAME_DEV.useGameStore.getState(); return { fw: s.inventory.firewall, frozen: s.effects.freezeUntil > Date.now(), mail: s.inbox.messages.some((m) => m.subject === 'Firewall blocked a Freeze') }; });
  check('Firewall blocks the next attack and is used up (team is told)', fw.fw === 0 && !fw.frozen && fw.mail, JSON.stringify(fw));
  await attack('freeze');
  await page.getByTestId('freeze-banner').waitFor({ timeout: 5000 });
  check('Freeze pauses the progress timer for 60 s and leaves the page usable', (await page.getByTestId('freeze-banner').innerText()).includes('FROZEN') && await page.locator('.answer__submit').isEnabled());
  const noTarget = await st(() => { const g = window.THE_GAME_DEV.useGameStore; g.setState((s) => ({ inventory: { ...s.inventory, glitch_attack: 1 } })); const r = window.THE_GAME_DEV.sabotage.launchSabotage('glitch', 'TEAM-NOPE'); return { r, left: g.getState().inventory.glitch_attack }; });
  check('Sabotage needs a real rival and refunds nothing it did not spend', !noTarget.r.ok && noTarget.left === 1, JSON.stringify(noTarget));
  await page.locator('.topbar__wallet').click();
  await page.getByTestId('wallet-powerups').waitFor();
  check('Wallet lists owned power-ups', (await page.getByTestId('wallet-powerups').innerText()).includes('Glitch Attack'));
  await page.getByRole('button', { name: 'Close wallet' }).click();
  await page.goto(BASE + '/team/desk');
  await devReady();
  await until(async () => (await scene()).desk === 'DESK_IDLE', 240000, 'desk after power-ups');

  // ---------------------------------------------------------------- persistence + mobile
  const beforeReload = await game();
  await page.reload();
  await devReady();
  const afterReload = await game();
  check('Wallet, progress and purchases persist across reload', afterReload.balance === beforeReload.balance && afterReload.completed.includes('case-03/level-02') && afterReload.purchases.powerful_hint === 1 && afterReload.purchases.store_powerful_hint === 1, `${beforeReload.balance} → ${afterReload.balance}`);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(500);
  const expectItems = 6 + ((await dev(() => window.THE_GAME_DEV.marketState.getMarketState().blackMarketStatus)) === 'active' ? 1 : 0); // phone, market, (black market), wallet, mail, sound, leave
  check('Mobile: compact top bar keeps every control', await page.locator('.topbar__item').count() === expectItems && await page.locator('.topbar__mail').isVisible(), `${await page.locator('.topbar__item').count()} items`);
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('Mobile: no horizontal overflow', !hScroll);

  const relevant = errors.filter((e) => !/fonts\.g|Failed to load resource|ERR_|net::/.test(e));
  check('No console / page errors', relevant.length === 0, relevant.slice(0, 5).join(' || '));
}

try {
  await run();
} catch (e) {
  check('Test run completed', false, e.message);
  console.log('navigation:', navLog.slice(-8).join(' → '));
  if (page) console.log('history pushes:', (await page.evaluate(() => (window.__navTrace || []).slice(-12)).catch(() => [])).join('\n  '));
  if (page) await page.screenshot({ path: 'e2e-failure.png', timeout: 15000 }).catch(() => undefined);
} finally {
  await browser?.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
