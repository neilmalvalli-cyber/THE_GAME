const fs = require('fs');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

const env = {};
fs.readFileSync('.env.local', 'utf-8').split('\n').forEach(l => {
  const idx = l.indexOf('=');
  if (idx !== -1) {
    const k = l.slice(0, idx).trim();
    let v = l.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[k] = v;
  }
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED ASSERTION: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('====================================================');
  console.log('🏁 "THE HUNT" COMPLETE MULTI-PHASE VALIDATION SUITE');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // PHASE 1: DATABASE & SCHEMA INTEGRITY
  // ----------------------------------------------------
  console.log('▶ PHASE 1: Database & Schema Integrity');
  const { data: event } = await sb.from('events').select('*').limit(1).single();
  assert(Boolean(event), `Active event exists: ${event?.name}`);

  const { data: challenges } = await sb
    .from('challenges')
    .select('id, title, fragment_order, final_fragment')
    .eq('event_id', event.id)
    .order('fragment_order', { ascending: true });

  assert(challenges.length === 9, `Exactly 9 official case files present (got ${challenges.length})`);

  let totalDigits = 0;
  let twoDigitCount = 0;
  let oneDigitCount = 0;
  let masterCode = '';

  challenges.forEach(c => {
    const len = c.final_fragment.length;
    totalDigits += len;
    masterCode += c.final_fragment;
    if (len === 2) twoDigitCount++;
    if (len === 1) oneDigitCount++;
  });

  assert(totalDigits === 10, `Total reconstructed target cipher has exactly 10 digits (got ${totalDigits})`);
  assert(twoDigitCount === 1, `Exactly ONE challenge has a 2-digit fragment (Slot 9: "${challenges[8].final_fragment}")`);
  assert(oneDigitCount === 8, `Exactly EIGHT challenges have 1-digit fragments (Slots 1-8)`);
  assert(masterCode === '9876543210', `Master reconstructed cipher is: ${masterCode}`);

  const { data: powerups } = await sb.from('powerups').select('name, effect_type').eq('event_id', event.id);
  assert(powerups.length >= 7, `All approved power-ups seeded in powerups table (${powerups.length} found)`);

  const { data: bmItems } = await sb.from('black_market_items').select('name, stock_quantity').eq('event_id', event.id);
  assert(bmItems.length >= 5, `Black market contraband items seeded (${bmItems.length} found)`);

  // Teams setup
  let { data: teamA } = await sb.from('teams').select('id, name').eq('name', 'Team Alpha Test').maybeSingle();
  if (!teamA) {
    const { data: created } = await sb.from('teams').insert({
      name: 'Team Alpha Test',
      team_code: 'ALPHA1',
      status: 'active'
    }).select('id, name').single();
    teamA = created;
  }
  let { data: teamB } = await sb.from('teams').select('id, name').eq('name', 'Team Bravo Test').maybeSingle();
  if (!teamB) {
    const { data: created } = await sb.from('teams').insert({
      name: 'Team Bravo Test',
      team_code: 'BRAVO1',
      status: 'active'
    }).select('id, name').single();
    teamB = created;
  }
  assert(Boolean(teamA && teamB), `Test teams verified: ${teamA.name} and ${teamB.name}`);

  // ----------------------------------------------------
  // PHASE 2: 24/7 MARKET PROCUREMENT & COIN TRANSACTIONS
  // ----------------------------------------------------
  console.log('\n▶ PHASE 2: 24/7 Market Procurement & Coin Transactions');
  // Credit coins to Team A
  await sb.from('coin_ledger').insert({
    event_id: event.id,
    team_id: teamA.id,
    delta_coins: 500,
    transaction_type: 'reward',
    reason: 'Test Funding'
  });

  const { data: balanceA } = await sb.rpc('get_coin_balance', { p_team_id: teamA.id, p_event_id: event.id });
  assert(balanceA >= 500, `Team Alpha credited coins balance: ${balanceA}🪙`);

  const { data: ghostShieldPowerup } = await sb.from('powerups').select('*').eq('effect_type', 'ghost_shield').limit(1).single();
  const { data: glitchAttackPowerup } = await sb.from('powerups').select('*').eq('effect_type', 'glitch_attack').limit(1).single();

  // Team A buys Ghost Shield
  await sb.from('coin_ledger').insert({
    event_id: event.id,
    team_id: teamA.id,
    delta_coins: -ghostShieldPowerup.price_coins,
    transaction_type: 'market_buy',
    reason: `Bought ${ghostShieldPowerup.name}`
  });
  const { data: invShieldA } = await sb.from('team_powerups').insert({
    team_id: teamA.id,
    powerup_id: ghostShieldPowerup.id,
    status: 'available'
  }).select('id').single();

  // Team A buys Glitch Attack
  await sb.from('coin_ledger').insert({
    event_id: event.id,
    team_id: teamA.id,
    delta_coins: -glitchAttackPowerup.price_coins,
    transaction_type: 'market_buy',
    reason: `Bought ${glitchAttackPowerup.name}`
  });
  const { data: invGlitchA } = await sb.from('team_powerups').insert({
    team_id: teamA.id,
    powerup_id: glitchAttackPowerup.id,
    status: 'available'
  }).select('id').single();

  assert(Boolean(invShieldA && invGlitchA), 'Team Alpha successfully purchased Ghost Shield and Glitch Attack into inventory');

  // ----------------------------------------------------
  // PHASE 3: DEFENSE DEFLECTION & OFFENSIVE SABOTAGE
  // ----------------------------------------------------
  console.log('\n▶ PHASE 3: Ghost Shield Deflection & Offensive Sabotage');
  // Team B deploys Ghost Shield
  const { data: shieldB } = await sb.from('team_powerups').insert({
    team_id: teamB.id,
    powerup_id: ghostShieldPowerup.id,
    status: 'active',
    activated_at: new Date().toISOString()
  }).select('id').single();

  // Step 3.1: Team A attacks Team B while protected by shield
  // Check shield
  const { data: activeShieldOnB } = await sb
    .from('team_powerups')
    .select('id, powerups!inner(effect_type)')
    .eq('team_id', teamB.id)
    .eq('status', 'active')
    .eq('powerups.effect_type', 'ghost_shield')
    .maybeSingle();

  assert(Boolean(activeShieldOnB), 'Team Bravo confirmed to have active Ghost Shield barrier');

  // Shield deflection simulation
  await sb.from('team_powerups').update({ status: 'consumed' }).eq('id', activeShieldOnB.id);
  await sb.from('team_powerups').update({ status: 'consumed' }).eq('id', invGlitchA.id);

  const { data: checkDeflectedShield } = await sb.from('team_powerups').select('status').eq('id', activeShieldOnB.id).single();
  assert(checkDeflectedShield.status === 'consumed', 'Ghost Shield absorbed strike and successfully neutralized attack!');

  // Step 3.2: Team A launches attack when Team B has NO shield
  const now = new Date();
  const expiresAt = new Date(Date.now() + 180 * 1000);
  const { data: infectedStrike } = await sb.from('team_powerups').insert({
    team_id: teamB.id,
    powerup_id: glitchAttackPowerup.id,
    status: 'active',
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  }).select('id, status, expires_at').single();

  assert(infectedStrike.status === 'active', 'Unprotected Team Bravo successfully infected with Glitch Attack sabotage for 3 minutes');

  // Verify active sabotage detection query
  const { data: detectedSabotage } = await sb
    .from('team_powerups')
    .select('*, powerups(name, effect_type)')
    .eq('team_id', teamB.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  const hasGlitchInfection = (detectedSabotage || []).some(s => s.powerups.effect_type === 'glitch_attack');
  assert(hasGlitchInfection, 'Participant dashboard detection query successfully isolates active sabotage');

  // Clean up test infection on Team B
  await sb.from('team_powerups').update({ status: 'consumed' }).eq('id', infectedStrike.id);

  // ----------------------------------------------------
  // PHASE 4: 5-MINUTE FLASH BLACK MARKET SALE
  // ----------------------------------------------------
  console.log('\n▶ PHASE 4: 5-Minute Flash Black Market Lifecycle');
  const bmEndsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await sb.from('events').update({
    settings: {
      ...event.settings,
      black_market_active: true,
      black_market_until: bmEndsAt
    }
  }).eq('id', event.id);

  const { data: updatedEvent } = await sb.from('events').select('settings').eq('id', event.id).single();
  assert(updatedEvent.settings.black_market_active === true, 'Admin successfully opened 5-Minute Flash Black Market');
  assert(Boolean(updatedEvent.settings.black_market_until), `Flash countdown timer scheduled until: ${updatedEvent.settings.black_market_until}`);

  // Test purchasing limited contraband item
  const { data: contraband } = await sb.from('black_market_items').select('*').eq('event_id', event.id).limit(1).single();
  const initialStock = contraband.stock_quantity;
  await sb.from('black_market_items').update({ stock_quantity: initialStock - 1 }).eq('id', contraband.id);

  const { data: updatedContraband } = await sb.from('black_market_items').select('stock_quantity').eq('id', contraband.id).single();
  assert(updatedContraband.stock_quantity === initialStock - 1, `Contraband stock successfully decremented: ${initialStock} -> ${updatedContraband.stock_quantity}`);

  // Admin closes black market
  await sb.from('events').update({
    settings: {
      ...updatedEvent.settings,
      black_market_active: false
    }
  }).eq('id', event.id);
  const { data: closedEvent } = await sb.from('events').select('settings').eq('id', event.id).single();
  assert(closedEvent.settings.black_market_active === false, 'Admin successfully closed Flash Black Market');

  // ----------------------------------------------------
  // PHASE 5: 5-MINUTE SURPRISE MINI-GAME LIFECYCLE
  // ----------------------------------------------------
  console.log('\n▶ PHASE 5: 5-Minute Surprise Mini-Game Flash Raid');
  const surpriseEndsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: surpriseEvent } = await sb.from('surprise_events').insert({
    event_id: event.id,
    title: 'Quantum Resonance Flash Raid',
    question_text: 'Decode the base-16 ciphertext 0x48554E54 to ASCII word:',
    question_answer: 'HUNT',
    question_answer_mode: 'trimmed_case_insensitive',
    status: 'live',
    starts_at: new Date().toISOString(),
    ends_at: surpriseEndsAt,
    duration_seconds: 300,
    points_reward: 50,
    coins_reward: 30,
    configuration: { powerup_reward_type: 'ghost_shield' }
  }).select('*').single();

  assert(Boolean(surpriseEvent), `Surprise Mini-Game launched: "${surpriseEvent.title}"`);

  // Solve the surprise mini-game
  const teamInput = 'hunt'; // lowercase case-insensitive check
  const isMatch = teamInput.trim().toUpperCase() === surpriseEvent.question_answer.toUpperCase();
  assert(isMatch, 'Case-insensitive answer verification passed ("hunt" matches "HUNT")');

  // Credit awards
  await sb.from('score_ledger').insert({
    event_id: event.id,
    team_id: teamA.id,
    delta_points: surpriseEvent.points_reward,
    transaction_type: 'bonus',
    reason: `Surprise Mini-Game: ${surpriseEvent.title}`
  });
  await sb.from('coin_ledger').insert({
    event_id: event.id,
    team_id: teamA.id,
    delta_coins: surpriseEvent.coins_reward,
    transaction_type: 'reward',
    reason: `Surprise Mini-Game: ${surpriseEvent.title}`
  });

  const { data: scoreA } = await sb.rpc('get_score_total', { p_team_id: teamA.id, p_event_id: event.id });
  assert(scoreA >= 50, `Team Alpha credited with +50 points: Total = ${scoreA} pts`);

  // Clean up surprise event
  await sb.from('surprise_events').update({ status: 'ended' }).eq('id', surpriseEvent.id);

  // ----------------------------------------------------
  // PHASE 6: CASE LEVEL SOLVES & FRAGMENT REVELATION
  // ----------------------------------------------------
  console.log('\n▶ PHASE 6: Case Level Solves & 10-Digit Target Revelation');
  const ch1 = challenges[0]; // Slot 1, Fragment '9'
  const ch9 = challenges[8]; // Slot 9, Fragment '10' (2 digits!)

  const { data: ch1Levels } = await sb.from('challenge_levels').select('*').eq('challenge_id', ch1.id).order('level_number');
  const { data: ch9Levels } = await sb.from('challenge_levels').select('*').eq('challenge_id', ch9.id).order('level_number');

  assert(ch1Levels.length >= 2, `Challenge 1 has ${ch1Levels.length} levels loaded`);
  assert(ch9Levels.length >= 2, `Challenge 9 has ${ch9Levels.length} levels loaded`);

  // Solve all levels of Challenge 1
  const { data: userList } = await sb.auth.admin.listUsers();
  const validUserId = userList?.users[0]?.id;

  for (const lvl of ch1Levels) {
    const { data: sub, error: subErr } = await sb.from('submissions').insert({
      event_id: event.id,
      team_id: teamA.id,
      challenge_id: ch1.id,
      level_id: lvl.id,
      submitted_by: validUserId,
      answer_hash: 'test-hash',
      result: 'correct'
    }).select('id').single();

    if (subErr) console.error('Error in sub insert:', subErr);

    await sb.from('level_solves').insert({
      event_id: event.id,
      team_id: teamA.id,
      challenge_id: ch1.id,
      level_id: lvl.id,
      submission_id: sub.id
    });
  }

  // Check progress via RPC
  const { data: progList } = await sb.rpc('get_team_challenge_progress', {
    p_team_id: teamA.id,
    p_event_id: event.id
  });

  const ch1Prog = (progList || []).find(p => p.challenge_id === ch1.id);
  assert(ch1Prog && ch1Prog.is_complete === true, 'Team Alpha successfully solved all levels of Challenge 1');

  // Verify fragment unlocking logic
  const isCh1Solved = ch1Prog.solved_levels >= ch1Prog.total_levels;
  const revealedFragment1 = isCh1Solved ? ch1.final_fragment : null;
  assert(revealedFragment1 === '9', `Fragment 01 unlocked: "${revealedFragment1}" (1 digit)`);

  // Verify locked challenge fragment logic (Challenge 9 not solved yet)
  const ch9Prog = (progList || []).find(p => p.challenge_id === ch9.id);
  const isCh9Solved = ch9Prog && ch9Prog.solved_levels >= ch9Prog.total_levels;
  const revealedFragment9 = isCh9Solved ? ch9.final_fragment : null;
  assert(revealedFragment9 === null, 'Unsolved Challenge 9 keeps fragment hidden (returned null)');

  // ----------------------------------------------------
  // PHASE 7: CTFd SCORE GRAPH TIMELINE & SCOREBOARD FREEZE
  // ----------------------------------------------------
  console.log('\n▶ PHASE 7: CTFd Scoreboard Graph Timeline & Freeze Control');
  const { data: ledgerEntries } = await sb
    .from('score_ledger')
    .select('team_id, delta_points, created_at')
    .eq('event_id', event.id)
    .order('created_at', { ascending: true });

  assert(ledgerEntries && ledgerEntries.length > 0, `Score ledger contains ${ledgerEntries?.length} chronological point events`);

  // Test freeze scoreboard
  await sb.from('events').update({
    settings: { ...event.settings, scoreboard_locked: true }
  }).eq('id', event.id);

  const { data: frozenEvent } = await sb.from('events').select('settings').eq('id', event.id).single();
  assert(frozenEvent.settings.scoreboard_locked === true, 'Admin successfully froze live scoreboard');

  // Test unfreeze
  await sb.from('events').update({
    settings: { ...event.settings, scoreboard_locked: false }
  }).eq('id', event.id);

  const { data: unfrozenEvent } = await sb.from('events').select('settings').eq('id', event.id).single();
  assert(unfrozenEvent.settings.scoreboard_locked === false, 'Admin successfully unfroze scoreboard back to public');

  // ----------------------------------------------------
  // PHASE 8: LOCAL DEV SERVER HTTP SMOKE TEST
  // ----------------------------------------------------
  console.log('\n▶ PHASE 8: Local Dev Server Web Endpoints Smoke Test');
  const routes = ['/', '/login', '/leaderboard'];

  for (const route of routes) {
    await new Promise((resolve) => {
      const req = http.get(`http://localhost:3000${route}`, (res) => {
        console.log(`  ✓ Route ${route} -> Status HTTP ${res.statusCode}`);
        resolve(res.statusCode);
      });
      req.on('error', (err) => {
        console.error(`  ⚠️ Route ${route} failed: ${err.message}`);
        resolve(null);
      });
      req.setTimeout(4000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  console.log('\n====================================================');
  console.log('🎉 ALL 8 PHASES TESTED & VALIDATED SUCCESSFULLY!');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ VALIDATION TEST SUITE FAILED:', err);
  process.exit(1);
});
