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

async function setupMarket() {
  const { data: event } = await sb.from('events').select('id').limit(1).single();

  const bmItems = [
    {
      name: 'Time Lock (Flash Deal)',
      description: 'Underground exploit: +30s lockout on rival puzzle terminal.',
      price_coins: 50,
      stock_quantity: 4,
      per_team_limit: 1,
      is_enabled: true,
      effect_description: 'Offensive: Sabotage rival team timer.'
    },
    {
      name: 'Glitch Attack (Flash Deal)',
      description: 'Corrupts rival HUD with heavy visual artifacts for 3 minutes.',
      price_coins: 38,
      stock_quantity: 5,
      per_team_limit: 1,
      is_enabled: true,
      effect_description: 'Offensive: Sabotage rival visual HUD.'
    },
    {
      name: 'Master Key (Contraband)',
      description: 'Classified zero-day bypass: Instantly skip 1 tough puzzle level.',
      price_coins: 85,
      stock_quantity: 2,
      per_team_limit: 1,
      is_enabled: true,
      effect_description: 'Override: Bypasses 1 level immediately.'
    },
    {
      name: 'Forensic Vision (Flash Deal)',
      description: 'Decodes tactical hint on active puzzle without extra fee.',
      price_coins: 32,
      stock_quantity: 6,
      per_team_limit: 2,
      is_enabled: true,
      effect_description: 'Intel: 1 Level Hint Revealed.'
    },
    {
      name: 'Overclock (Flash Deal)',
      description: 'Boost next puzzle solve reward coins by 2x.',
      price_coins: 28,
      stock_quantity: 5,
      per_team_limit: 2,
      is_enabled: true,
      effect_description: 'Booster: 2x Coin Reward.'
    }
  ];

  for (const item of bmItems) {
    const { data: existing } = await sb
      .from('black_market_items')
      .select('id')
      .eq('event_id', event.id)
      .eq('name', item.name)
      .single();

    if (existing) {
      await sb.from('black_market_items').update(item).eq('id', existing.id);
      console.log(`Updated BM item: ${item.name}`);
    } else {
      await sb.from('black_market_items').insert({
        event_id: event.id,
        ...item
      });
      console.log(`Inserted BM item: ${item.name}`);
    }
  }

  const { data: allBM } = await sb.from('black_market_items').select('id, name, price_coins, stock_quantity');
  console.log('Black market items ready:', allBM);
}

setupMarket().catch(console.error);
