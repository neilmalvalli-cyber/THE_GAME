const fs = require('fs');
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

const OFFICIAL_TITLES = [
  'Operation Zero-Trace',
  'Project Dark-Net',
  'Neural Breach',
  'Ghost Protocol',
  'Sentinel Grid',
  'Binary Nexus',
  'Quantum Shadow',
  'Apex Terminal',
  'The Vault Master Key'
];

async function cleanNonOfficial() {
  const { data: all } = await sb.from('challenges').select('id, title, fragment_order, final_fragment');
  for (const c of all || []) {
    if (!OFFICIAL_TITLES.includes(c.title)) {
      console.log(`Deleting non-official challenge: "${c.title}" (${c.id})`);
      const { data: lvls } = await sb.from('challenge_levels').select('id').eq('challenge_id', c.id);
      const lvlIds = (lvls || []).map(l => l.id);

      if (lvlIds.length > 0) {
        await sb.from('hint_purchases').delete().in('level_id', lvlIds);
      }
      const { error: lsErr } = await sb.from('level_solves').delete().eq('challenge_id', c.id);
      if (lsErr) console.error('Error deleting level_solves:', lsErr);

      const { error: sErr } = await sb.from('submissions').delete().eq('challenge_id', c.id);
      if (sErr) console.error('Error deleting submissions:', sErr);

      const { error: clErr } = await sb.from('challenge_levels').delete().eq('challenge_id', c.id);
      if (clErr) console.error('Error deleting challenge_levels:', clErr);

      const { error: cErr } = await sb.from('challenges').delete().eq('id', c.id);
      if (cErr) console.error('Error deleting challenge:', cErr);
      else console.log(`Successfully purged: "${c.title}"`);
    }
  }

  const { data: remaining } = await sb
    .from('challenges')
    .select('title, fragment_order, final_fragment')
    .order('fragment_order', { ascending: true });

  let totalDigits = 0;
  let code = '';
  console.log('\n--- ACTIVE OFFICIAL CHALLENGES ---');
  remaining.forEach(c => {
    totalDigits += (c.final_fragment || '').length;
    code += c.final_fragment || '';
    console.log(`Slot ${c.fragment_order}: Fragment "${c.final_fragment}" (${(c.final_fragment || '').length} digit) - ${c.title}`);
  });

  console.log(`\nCOUNT: ${remaining.length} Challenges`);
  console.log(`TOTAL DIGITS: ${totalDigits}`);
  console.log(`MASTER 10-DIGIT CIPHER: ${code}`);
}

cleanNonOfficial().catch(console.error);
