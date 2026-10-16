const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  console.log('Testing connection to Supabase...')

  // 1. Ensure live event exists
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'live')
    .limit(1)
    .single()

  let eventId = existingEvent?.id
  if (!eventId) {
    const { data: newEvent, error: evError } = await supabase
      .from('events')
      .insert({
        name: 'THE HUNT 2026',
        description: 'Official CSI NMAMIT Digital Treasure Hunt',
        status: 'live',
        starts_at: new Date().toISOString(),
        starting_coins: 100,
      })
      .select('id')
      .single()

    if (evError) {
      console.error('Event creation error:', evError)
    } else {
      eventId = newEvent.id
      console.log('Created live event: THE HUNT 2026')
    }
  } else {
    console.log('Found existing live event:', eventId)
  }

  // 2. Ensure sample challenge exists
  if (eventId) {
    const { data: challenges } = await supabase
      .from('challenges')
      .select('id')
      .eq('event_id', eventId)
      .limit(1)

    if (!challenges || challenges.length === 0) {
      const { data: ch, error: chErr } = await supabase
        .from('challenges')
        .insert({
          event_id: eventId,
          title: 'Operation Cipher Genesis',
          category: 'Crypto',
          description: 'Initial decryption trial for all operatives.',
          display_order: 1,
          status: 'published',
        })
        .select()
        .single()

      if (!chErr && ch) {
        await supabase.from('challenge_levels').insert([
          {
            challenge_id: ch.id,
            level_number: 1,
            title: 'Level 1: The Caesar Breach',
            prompt: 'Intercepted message: "WKH KXQW EHJLQV". Shifted by 3 letters backwards.',
            answer: 'THE HUNT BEGINS',
            answer_mode: 'trimmed_case_insensitive',
            points_reward: 100,
            coins_reward: 50,
            hint_text: 'Apply Caesar shift -3.',
            hint_cost: 10,
            status: 'published',
          },
          {
            challenge_id: ch.id,
            level_number: 2,
            title: 'Level 2: Binary Genesis',
            prompt: 'Convert to ASCII: 01000011 01010011 01001001',
            answer: 'CSI',
            answer_mode: 'trimmed_case_insensitive',
            points_reward: 200,
            coins_reward: 75,
            hint_text: '8 bits per character. 01000011 is 67.',
            hint_cost: 15,
            status: 'published',
          },
        ])
        console.log('Created sample challenge with 2 levels')
      }
    }
  }

  // 3. Create Admin User
  console.log('Creating Admin Account: admin@hunt.com...')
  const { data: adminUser, error: adminErr } = await supabase.auth.admin.createUser({
    email: 'admin@hunt.com',
    password: 'admin123',
    email_confirm: true,
    user_metadata: { display_name: 'Admin Commander' },
  })

  if (adminErr) {
    console.log('Admin user status:', adminErr.message)
    // If user already exists, fetch ID
    const { data: list } = await supabase.auth.admin.listUsers()
    const found = list?.users?.find((u) => u.email === 'admin@hunt.com')
    if (found) {
      await supabase
        .from('user_roles')
        .upsert({ user_id: found.id, role: 'admin' })
      console.log('Updated admin@hunt.com role to admin in user_roles')
    }
  } else if (adminUser?.user) {
    console.log('Created admin user:', adminUser.user.id)
    await supabase
      .from('user_roles')
      .upsert({ user_id: adminUser.user.id, role: 'admin' })
    console.log('Assigned admin role to admin@hunt.com')
  }

  // 4. Create Participant User
  console.log('Creating Participant Account: player@hunt.com...')
  const { data: playerUser, error: playerErr } = await supabase.auth.admin.createUser({
    email: 'player@hunt.com',
    password: 'player123',
    email_confirm: true,
    user_metadata: { display_name: 'Agent Alpha' },
  })

  if (playerErr) {
    console.log('Player user status:', playerErr.message)
  } else if (playerUser?.user) {
    console.log('Created participant user:', playerUser.user.id)
    await supabase
      .from('user_roles')
      .upsert({ user_id: playerUser.user.id, role: 'participant' })
    console.log('Assigned participant role to player@hunt.com')
  }

  console.log('Done!')
}

main()
