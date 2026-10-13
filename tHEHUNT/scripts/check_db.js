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

async function main() {
  const { data: challenges, error: cErr } = await sb
    .from('challenges')
    .select('id, title, final_fragment, fragment_order')
    .order('fragment_order', { ascending: true });
  console.log('CHALLENGES in DB:');
  console.log(challenges || cErr);

  const { data: teams, error: tErr } = await sb.from('teams').select('*').limit(2);
  console.log('\nTEAMS in DB:');
  console.log(teams || tErr);

  const { data: surprise, error: sErr } = await sb.from('surprise_events').select('*');
  console.log('\nSURPRISE EVENTS in DB:');
  console.log(surprise || sErr);
}

main().catch(console.error);
