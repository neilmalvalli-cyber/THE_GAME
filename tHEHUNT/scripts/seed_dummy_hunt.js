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

async function seedHunt() {
  console.log('--- 1. FETCHING ACTIVE EVENT ---');
  let { data: event } = await sb.from('events').select('id, name').limit(1).maybeSingle();
  if (!event) {
    const { data: newEv } = await sb.from('events').insert({
      name: 'THE HUNT 2026 // OPERATION CIPHER',
      status: 'live',
      settings: { black_market_active: false, scoreboard_locked: false }
    }).select('id, name').single();
    event = newEv;
  }
  console.log('Event active:', event.id, event.name);

  console.log('\n--- 2. SEEDING 9 DUMMY CASE FILES (TOTAL 10 DIGITS) ---');
  // 8 challenges with 1 digit, 1 challenge with 2 digits -> 8*1 + 2 = 10 digits total!
  const dummyChallenges = [
    {
      title: 'Operation Zero-Trace',
      category: 'Crypto',
      description: 'Decode the intercepted frequency transmission to extract Fragment 01.',
      final_fragment: '9',
      fragment_order: 1,
      levels: [
        { title: 'Level 1: Caesar Recon', prompt: 'Decrypt the ROT13 cipher: PURPX_VASVAGEEVGL', answer: 'CHECK_INFINITY', points: 100, coins_reward: 50, hint_text: 'ROT13 alphabet shift by 13 positions.', hint_cost: 10 },
        { title: 'Level 2: Polybius Matrix', prompt: 'Convert coordinate pairs (1,1)(2,4)(3,1) to ASCII keyword:', answer: 'ALPHA', points: 150, coins_reward: 75, hint_text: 'Use standard 5x5 Polybius grid.', hint_cost: 15 }
      ]
    },
    {
      title: 'Project Dark-Net',
      category: 'Web Exploitation',
      description: 'Bypass authorization barriers on legacy relay servers to recover Fragment 02.',
      final_fragment: '8',
      fragment_order: 2,
      levels: [
        { title: 'Level 1: Cookie Manipulation', prompt: 'Identify the role parameter that grants administrative token: role=????', answer: 'admin', points: 100, coins_reward: 50, hint_text: 'Look at standard role values.', hint_cost: 10 },
        { title: 'Level 2: Header Injection', prompt: 'What HTTP header indicates the client IP behind proxy? (X-Forwarded-???)', answer: 'For', points: 150, coins_reward: 75, hint_text: 'Standard RFC header: X-Forwarded-For', hint_cost: 15 }
      ]
    },
    {
      title: 'Neural Breach',
      category: 'Reverse Engineering',
      description: 'Decompile the firmware binary on the sentinel node to extract Fragment 03.',
      final_fragment: '7',
      fragment_order: 3,
      levels: [
        { title: 'Level 1: String Dump', prompt: 'What Linux utility dumps human-readable ASCII strings from binaries?', answer: 'strings', points: 100, coins_reward: 50, hint_text: 'Standard GNU coreutil: strings', hint_cost: 10 },
        { title: 'Level 2: Opcode Inspection', prompt: 'In x86 assembly, what 1-byte opcode does hexadecimal 0x90 represent?', answer: 'NOP', points: 150, coins_reward: 75, hint_text: 'No-operation instruction.', hint_cost: 15 }
      ]
    },
    {
      title: 'Ghost Protocol',
      category: 'Forensics',
      description: 'Reconstruct fragmented packet captures to extract Fragment 04.',
      final_fragment: '6',
      fragment_order: 4,
      levels: [
        { title: 'Level 1: PCAP Magic Bytes', prompt: 'What is the 4-byte hexadecimal magic number for standard PCAP files? (d4 c3 b2 ??)', answer: 'a1', points: 100, coins_reward: 50, hint_text: 'Little-endian pcap magic byte sequence.', hint_cost: 10 },
        { title: 'Level 2: Wireshark Recon', prompt: 'What protocol does Wireshark filter syntax "tcp.port == 53" target?', answer: 'DNS', points: 150, coins_reward: 75, hint_text: 'Domain resolution protocol.', hint_cost: 15 }
      ]
    },
    {
      title: 'Sentinel Grid',
      category: 'OSINT',
      description: 'Geolocate satellite telemetry transmitters to extract Fragment 05.',
      final_fragment: '5',
      fragment_order: 5,
      levels: [
        { title: 'Level 1: Domain Registry', prompt: 'What protocol queries authoritative databases for domain registrant records?', answer: 'WHOIS', points: 100, coins_reward: 50, hint_text: 'Standard WHOIS database query.', hint_cost: 10 },
        { title: 'Level 2: EXIF Metadata', prompt: 'What image metadata standard records GPS coordinates inside JPEG photos?', answer: 'EXIF', points: 150, coins_reward: 75, hint_text: 'Exchangeable Image File Format.', hint_cost: 15 }
      ]
    },
    {
      title: 'Binary Nexus',
      category: 'Crypto',
      description: 'Crack RSA modulus factorization to unlock Fragment 06.',
      final_fragment: '4',
      fragment_order: 6,
      levels: [
        { title: 'Level 1: Prime Generation', prompt: 'What is the only even prime number?', answer: '2', points: 100, coins_reward: 50, hint_text: 'Smallest prime number.', hint_cost: 10 },
        { title: 'Level 2: Modulo Arithmetic', prompt: 'Calculate (17 mod 5):', answer: '2', points: 150, coins_reward: 75, hint_text: 'Remainder after division.', hint_cost: 15 }
      ]
    },
    {
      title: 'Quantum Shadow',
      category: 'Trivia & Logic',
      description: 'Solve cryptographic logic gates to extract Fragment 07.',
      final_fragment: '3',
      fragment_order: 7,
      levels: [
        { title: 'Level 1: XOR Truth Table', prompt: 'In boolean logic, what is 1 XOR 1?', answer: '0', points: 100, coins_reward: 50, hint_text: 'Exclusive OR returns 0 when inputs match.', hint_cost: 10 },
        { title: 'Level 2: Bitwise Shift', prompt: 'Calculate 8 >> 2 (bitwise right shift 8 by 2):', answer: '2', points: 150, coins_reward: 75, hint_text: 'Divide by 2^2.', hint_cost: 15 }
      ]
    },
    {
      title: 'Apex Terminal',
      category: 'Web Exploitation',
      description: 'Inspect DOM storage nodes to extract Fragment 08.',
      final_fragment: '2',
      fragment_order: 8,
      levels: [
        { title: 'Level 1: Storage API', prompt: 'What browser HTML5 Web Storage object persists data across browser restarts?', answer: 'localStorage', points: 100, coins_reward: 50, hint_text: 'Window.localStorage', hint_cost: 10 },
        { title: 'Level 2: Same-Origin Policy', prompt: 'What 4-letter acronym denotes Cross-Origin Resource Sharing?', answer: 'CORS', points: 150, coins_reward: 75, hint_text: 'CORS headers.', hint_cost: 15 }
      ]
    },
    {
      title: 'The Vault Master Key',
      category: 'Crypto',
      description: 'CRITICAL MASTER KEY FILE: Decrypt the final 2-DIGIT fragment to complete the master telephone sequence!',
      final_fragment: '10', // 2 DIGITS!
      fragment_order: 9,
      levels: [
        { title: 'Level 1: Master Vault Gate', prompt: 'What hashing algorithm outputs a 128-bit digest and was designed by Ronald Rivest in 1991?', answer: 'MD5', points: 200, coins_reward: 100, hint_text: 'Message Digest 5', hint_cost: 20 },
        { title: 'Level 2: Grand Decryption', prompt: 'What cryptographic term describes the readable output of decryption?', answer: 'plaintext', points: 250, coins_reward: 150, hint_text: 'Opposite of ciphertext.', hint_cost: 25 }
      ]
    }
  ];

  // Upsert challenges
  for (const cData of dummyChallenges) {
    const { levels, ...challengeFields } = cData;

    let { data: existing } = await sb
      .from('challenges')
      .select('id')
      .eq('event_id', event.id)
      .eq('title', challengeFields.title)
      .maybeSingle();

    let challengeId;
    if (existing) {
      challengeId = existing.id;
      await sb.from('challenges').update({
        ...challengeFields,
        status: 'published',
        display_order: challengeFields.fragment_order,
      }).eq('id', challengeId);
      console.log(`Updated challenge: ${challengeFields.title} (Slot ${challengeFields.fragment_order}, Fragment: "${challengeFields.final_fragment}")`);
    } else {
      const { data: created, error } = await sb.from('challenges').insert({
        event_id: event.id,
        ...challengeFields,
        status: 'published',
        display_order: challengeFields.fragment_order,
      }).select('id').single();
      if (error) {
        console.error('Failed creating challenge:', error);
        continue;
      }
      challengeId = created.id;
      console.log(`Created challenge: ${challengeFields.title} (Slot ${challengeFields.fragment_order}, Fragment: "${challengeFields.final_fragment}")`);
    }

    // Upsert levels
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i];
      const { data: exLvl } = await sb
        .from('challenge_levels')
        .select('id')
        .eq('challenge_id', challengeId)
        .eq('level_number', i + 1)
        .maybeSingle();

      const lvlPayload = {
        challenge_id: challengeId,
        level_number: i + 1,
        title: lvl.title,
        prompt: lvl.prompt,
        answer: lvl.answer,
        answer_mode: 'trimmed_case_insensitive',
        points_reward: lvl.points,
        coins_reward: lvl.coins_reward,
        hint_text: lvl.hint_text,
        hint_cost: lvl.hint_cost,
        status: 'published',
      };

      if (exLvl) {
        const { error: uErr } = await sb.from('challenge_levels').update(lvlPayload).eq('id', exLvl.id);
        if (uErr) console.error('Error updating level:', uErr);
      } else {
        const { error: iErr } = await sb.from('challenge_levels').insert(lvlPayload);
        if (iErr) console.error('Error inserting level:', iErr);
      }
    }
  }

  console.log('\n--- 3. VERIFYING SEEDED 10-DIGIT TARGET MATH ---');
  const { data: allChallenges } = await sb
    .from('challenges')
    .select('title, fragment_order, final_fragment')
    .eq('event_id', event.id)
    .order('fragment_order', { ascending: true });

  let totalDigits = 0;
  let fullSequence = '';
  allChallenges.forEach(c => {
    const len = c.final_fragment ? c.final_fragment.length : 0;
    totalDigits += len;
    fullSequence += c.final_fragment;
    console.log(`Slot ${c.fragment_order}: Fragment "${c.final_fragment}" (${len} digit${len > 1 ? 's' : ''}) -> ${c.title}`);
  });

  console.log(`\nTOTAL DIGITS ACROSS ALL CHALLENGES: ${totalDigits}`);
  console.log(`FULL ASSEMBLED MASTER PHONE CODE: ${fullSequence}`);
  if (totalDigits === 10) {
    console.log('✅ PERFECT! Exactly 10 digits total (one 2-digit, eight 1-digit).');
  } else {
    console.log(`⚠️ Warning: Expected 10 digits, got ${totalDigits}`);
  }
}

seedHunt().catch(console.error);
