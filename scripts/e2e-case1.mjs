// Case 1 (The Fractured Truth) end to end against a REAL backend (Supabase build, migration 006 + seed).
//   BASE_URL=http://localhost:3000 ADMIN_PASSWORD=… node scripts/e2e-case1.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('Set ADMIN_PASSWORD (the server\'s ADMIN_PASSWORD).'); process.exit(2); }
const { ANSWERS, DEBRIEFS } = await import(pathToFileURL(resolve('game/data/secrets.ts')).href);

const TEAM = `Case1 ${Date.now().toString(36).slice(-5)}`, PW = 'pass-1234';
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
async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return page;
}
async function openLogin(page, which = 'Team Login') {
  await page.goto(BASE + '/');
  await page.waitForSelector('.scene-layer--desk[data-phase="ready"]', { state: 'attached', timeout: 120000 });
  await page.getByText(which).click();
}
const text = (page, id) => page.getByTestId(id).innerText();
const feedback = (page) => page.locator('#answer-feedback').innerText();
async function level(page, n) {
  await page.goto(`${BASE}/team/case/1/level/${n}`);
  await page.getByTestId('level-status').waitFor({ timeout: 60000 });
  await until(page, async () => (await page.getByTestId('attempts-left').count()) > 0, 20000, 'attempts shown');
}
async function submit(page) {
  await page.waitForTimeout(1100); // server rate limit: one attempt per second per level
  await page.locator('.answer__submit').click();
  await until(page, async () => (await feedback(page)).trim().length > 0, 20000, 'feedback');
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await openPage(browser);
    await openLogin(p);
    await p.fill('input[name=team]', TEAM);
    await p.fill('input[name=password]', PW);
    await p.fill('input[name=confirm]', PW);
    await p.getByRole('button', { name: 'Create Team' }).last().click();
    await until(p, async () => (await p.evaluate(() => location.pathname)).startsWith('/team/'), 30000, 'registered');
    await p.evaluate(() => document.querySelector('.tg-skip')?.click());
    await until(p, async () => (await p.evaluate(() => location.pathname)) === '/team/desk', 30000, 'desk');

    // no answers anywhere in what the browser downloads
    const scripts = await p.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
    let leaked = [];
    const secrets = [ANSWERS['1-1'], ANSWERS['1-4'], 'archive_02', '14:29:08', DEBRIEFS['1-4']?.split('\n').find((l) => l.length > 20)].filter(Boolean);
    for (const url of scripts) { const body = await (await fetch(url)).text(); for (const s of secrets) if (body.toLowerCase().includes(s.toLowerCase())) leaked.push(s); }
    const html = await (await fetch(BASE + '/team/case/1/level/4')).text();
    for (const s of secrets) if (html.toLowerCase().includes(s.toLowerCase())) leaked.push(`html:${s}`);
    check('No Case 1 answer or debrief in the page source or JS bundles', leaked.length === 0, leaked.join(', ') + ` (${scripts.length} scripts)`);

    // case overview: five investigations, all open
    await p.goto(`${BASE}/team/case/1`);
    await p.getByTestId('case-index').waitFor({ timeout: 60000 });
    await until(p, async () => (await p.locator('[data-testid^=case-row-]').count()) === 5, 30000, 'five rows');
    const idx = await text(p, 'case-index');
    check('Case overview lists five investigations, all NOT STARTED', (idx.match(/NOT STARTED/gi) ?? []).length === 5, idx.replace(/\s+/g, ' ').slice(0, 160));
    await p.locator('.paper-back.is-on').waitFor({ timeout: 150000 }).catch(async (e) => { await p.screenshot({ path: '/var/tmp/case1-overview.png' }); throw e; });
    check('Case overview has "Back to All Cases"', /Back to All Cases/i.test(await p.locator('.paper-back').innerText()));

    for (const n of [5, 3, 1, 4, 2]) {
      await level(p, n);
      const ok = !(await p.getByTestId('level-locked').count()) && (await text(p, 'attempts-left')).startsWith('8 / 8') && await p.locator('.answer__submit').isEnabled();
      check(`Level ${n} opens immediately with 8 attempts`, ok);
    }
    check('Level page has "Back to Case Files"', await p.getByRole('button', { name: /Back to Case Files/i }).count() > 0);
    const l2 = await p.locator('main, body').first().innerText();
    check('Level 2 page does not show the answer', !l2.toLowerCase().includes(`answer: ${ANSWERS['1-2']}`));

    // Level 1: eight wrong answers lock it
    await level(p, 1);
    await p.fill('#answer', 'nikola tesla');
    await submit(p);
    check('Wrong answer: "INCORRECT ANSWER — 7 ATTEMPTS REMAINING"', /INCORRECT ANSWER\s+—\s+7 ATTEMPTS REMAINING/i.test(await feedback(p)), await feedback(p));
    check('Status turns IN PROGRESS', /in progress/i.test(await text(p, 'level-status')));
    for (let i = 2; i <= 8; i++) { await p.fill('#answer', `wrong ${i}`); await submit(p); await until(p, async () => (await text(p, 'attempts-left')).startsWith(`${8 - i} /`), 15000, `attempt ${i}`); }
    await p.getByTestId('level-locked').waitFor({ timeout: 15000 });
    check('8th wrong answer locks the level (ATTEMPTS EXHAUSTED)', /attempts exhausted/i.test(await text(p, 'level-status')) && await p.locator('.answer__submit').isDisabled() && await p.locator('#answer').isDisabled());
    await level(p, 1);
    check('Lock survives a reload (server-side)', await p.getByTestId('level-locked').count() === 1 && (await text(p, 'attempts-left')).startsWith('0 /'));

    // other levels unaffected; Level 3 numeric
    await level(p, 3);
    check('Locking Level 1 leaves Level 3 open', (await text(p, 'attempts-left')).startsWith('8 / 8'));
    await p.fill('#answer', '02');
    await submit(p);
    await until(p, async () => /completed/i.test(await text(p, 'level-status')), 15000, 'L3 done');
    check('Level 3 accepts the numeric answer', true);

    // Level 4: three fields as one attempt, then the verification summary
    await level(p, 4);
    const [acc, ver, time] = ANSWERS['1-4'].split('|');
    await p.fill('input[name=field-account]', acc);
    await p.fill('input[name=field-version]', 'v9');
    await p.fill('input[name=field-time]', time);
    await submit(p);
    check('Level 4: one wrong field fails the whole attempt (7 left)', (await text(p, 'attempts-left')).startsWith('7 /'), await feedback(p));
    await p.fill('input[name=field-version]', ver.toUpperCase());
    await p.fill('input[name=field-time]', time.replace(/\s*UTC$/i, ''));
    await submit(p);
    await p.getByTestId('debrief').waitFor({ timeout: 15000 });
    check('Level 4 accepted; verification summary shown only after solving', (await text(p, 'debrief')).length > 20);
    check('Level 4 has the evidence Drive link', await p.locator('a[href*="drive.google.com/drive/folders/1xe1zbv03Z2v2Ao9YhZZidv-5spEgTFBH"]').count() === 1);

    // Level 5: witness cards
    await level(p, 5);
    check('Level 5 shows four witness cards', await p.locator('input[name=witness]').count() === 4);
    await p.locator('.witness-card', { hasText: '03' }).click();
    await submit(p);
    check('Wrong witness consumes one attempt', (await text(p, 'attempts-left')).startsWith('7 /'));
    await p.locator('.witness-card', { hasText: '02' }).click();
    await submit(p);
    await until(p, async () => /completed/i.test(await text(p, 'level-status')), 15000, 'L5 done');
    check('Witness 02 accepted', true);

    await level(p, 2);
    await p.fill('#answer', ANSWERS['1-2'].toUpperCase());
    await submit(p);
    await until(p, async () => /completed/i.test(await text(p, 'level-status')), 15000, 'L2 done');
    check('Case not closed while Level 1 is locked', await p.getByTestId('case-solved').count() === 0);

    // admin resets Level 1
    const adm = await openPage(browser);
    await openLogin(adm, 'Admin Login');
    await adm.fill('input[name=admin-password]', ADMIN_PASSWORD);
    await adm.getByRole('button', { name: 'Login', exact: true }).click();
    await adm.getByRole('button', { name: 'Market Operations' }).waitFor({ timeout: 30000 });
    await adm.getByRole('button', { name: 'Teams', exact: true }).first().click();
    await until(adm, async () => (await adm.getByTestId('teams-table').innerText()).includes(TEAM), 20000, 'team listed');
    await adm.getByTestId('teams-table').getByText(TEAM).click();
    const ctl = adm.getByTestId('level-controls-1');
    await ctl.waitFor({ timeout: 20000 });
    await until(adm, async () => /ATTEMPTS EXHAUSTED/.test(await ctl.innerText()) && /8 \/ 8/.test(await ctl.innerText()), 20000, 'admin sees the lock');
    check('Admin sees per-level status and attempts (Level 1 exhausted 8 / 8)', true);
    await ctl.locator('tr', { hasText: 'The First Destination' }).getByRole('button', { name: 'Reset attempts' }).click();
    await until(adm, async () => /attempts reset/i.test(await adm.locator('.ops__flash').innerText()), 15000, 'reset flash');
    check('Admin resets Level 1 attempts', true);

    await until(p, async () => { await level(p, 1); return (await text(p, 'attempts-left')).startsWith('8 / 8'); }, 30000, 'team sees reset');
    check('Team sees Level 1 reopened with 8 attempts', await p.locator('.answer__submit').isEnabled());
    await p.fill('#answer', ' C.V. Raman ');
    await submit(p);
    await p.getByTestId('case-solved').waitFor({ timeout: 20000 });
    const closed = await text(p, 'case-solved');
    check('All five verified (any order) → CASE FILE CLOSED screen', /ALL FIVE INVESTIGATIONS VERIFIED/i.test(closed) && /THE TRUTH HAS BEEN RECOVERED/i.test(closed) && /CASE STATUS: COMPLETED/i.test(closed), closed.replace(/\s+/g, ' ').slice(0, 200));

    await p.goto(`${BASE}/team/case/1`);
    await p.getByTestId('case-index').waitFor({ timeout: 60000 });
    await until(p, async () => ((await text(p, 'case-index')).match(/COMPLETED/gi) ?? []).length >= 5, 20000, 'overview complete');
    check('Case overview shows all five COMPLETED', true);

    // admin reopen + mark completed
    await ctl.locator('tr', { hasText: 'The Hidden Honeypot' }).getByRole('button', { name: 'Reopen' }).click();
    await until(adm, async () => /reopened/i.test(await adm.locator('.ops__flash').innerText()), 15000, 'reopen flash');
    await until(adm, async () => /NOT STARTED/.test(await ctl.locator('tr', { hasText: 'The Hidden Honeypot' }).innerText()), 15000, 'reopened row');
    check('Admin reopens a level', true);
    await ctl.locator('tr', { hasText: 'The Hidden Honeypot' }).getByRole('button', { name: 'Mark completed' }).click();
    await until(adm, async () => /COMPLETED/.test(await ctl.locator('tr', { hasText: 'The Hidden Honeypot' }).innerText()), 15000, 'completed row');
    check('Admin marks a level completed', true);
  } finally {
    await browser.close();
  }
  const real = errors.filter((e) => !/WebGL|GPU stall|swiftshader|Download the React DevTools|favicon/i.test(e));
  if (real.length) console.log('Console errors:\n  ' + [...new Set(real)].slice(0, 10).join('\n  '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
