'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { challengeSchema, levelSchema } from '@/lib/validators/challenges'
import type { ActionResult, Challenge, ChallengeLevel, ChallengeProgress } from '@/lib/types/database'

// ============================================================
// HELPERS
// ============================================================

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated. Please log in first.')

  const adminDb = createAdminClient()
  const { data: roleData } = await adminDb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!roleData || roleData.role !== 'admin') {
    throw new Error(`Unauthorized: You are currently logged in as "${user.email}". Admin role is required. Please sign in as admin@hunt.com.`)
  }

  return user
}

// ============================================================
// PARTICIPANT: Get challenges for dashboard
// ============================================================

export async function getParticipantChallenges(): Promise<ActionResult<ChallengeProgress[]>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: false, error: 'Not on a team', code: 'NO_TEAM' }

  const adminDb = createAdminClient()

  // Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['live', 'paused', 'ready'])
    .limit(1)
    .single()

  if (!event) return { success: true, data: [] }

  const { data: progress } = await adminDb.rpc('get_team_challenge_progress', {
    p_team_id: membership.team_id,
    p_event_id: event.id,
  })

  if (!progress || progress.length === 0) return { success: true, data: [] }

  const challengeIds = progress.map((p: any) => p.challenge_id).filter(Boolean)
  const { data: challengeDetails } = challengeIds.length > 0
    ? await adminDb
        .from('challenges')
        .select('id, category, description, final_fragment, fragment_order')
        .in('id', challengeIds)
    : { data: [] }

  const detailsMap = new Map<string, any>(
    (challengeDetails || []).map((cd: any) => [cd.id, cd])
  )

  const enriched: ChallengeProgress[] = progress.map((p: any) => {
    const details = detailsMap.get(p.challenge_id)
    const total = Number(p.total_levels) || 0
    const solved = Number(p.solved_levels) || 0
    const progress_percentage = total > 0 ? Math.round((solved / total) * 100) : 0
    const isSolved = solved >= total && total > 0

    return {
      ...p,
      id: p.challenge_id,
      title: p.challenge_title,
      category: details?.category || null,
      description: details?.description || null,
      progress_percentage,
      final_fragment: isSolved ? (details?.final_fragment || null) : null,
      fragment_length: details?.final_fragment ? String(details.final_fragment).length : 1,
      fragment_order: details?.fragment_order ?? null,
    }
  })

  return { success: true, data: enriched }
}

// ============================================================
// PARTICIPANT: Get challenge levels
// ============================================================

export async function getChallengeLevels(challengeId: string): Promise<ActionResult<{
  challenge: Challenge
  levels: Array<{
    id: string
    level_number: number
    title: string
    prompt: string
    hint_cost: number
    points: number
    points_reward: number
    coins_reward: number
    status: string
    max_attempts: number | null
    attachments: unknown[]
    is_solved: boolean
    is_unlocked: boolean
    hint_purchased: boolean
    hint_text?: string
    attempt_count: number
  }>
  active_sabotage?: {
    type: string
    name: string
    expires_at: string
    seconds_remaining: number
  } | null
}>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { success: false, error: 'Not on a team' }

  // Get the challenge
  const { data: challenge } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single()

  if (!challenge) return { success: false, error: 'Challenge not found' }

  const adminDb = createAdminClient()

  // Get levels (without answer)
  const { data: levels } = await adminDb
    .from('challenge_levels')
    .select('id, level_number, title, prompt, hint_cost, points_reward, coins_reward, status, max_attempts, attachments')
    .eq('challenge_id', challengeId)
    .eq('status', 'published')
    .order('level_number', { ascending: true })

  if (!levels) return { success: true, data: { challenge: challenge as Challenge, levels: [] } }

  // Get team's solves for this challenge
  const { data: solves } = await adminDb
    .from('level_solves')
    .select('level_id')
    .eq('team_id', membership.team_id)
    .eq('challenge_id', challengeId)

  const solvedLevelIds = new Set((solves || []).map(s => s.level_id))

  // Get hint purchases
  const levelIds = levels.map(l => l.id)
  const { data: hintPurchases } = await adminDb
    .from('hint_purchases')
    .select('level_id')
    .eq('team_id', membership.team_id)
    .in('level_id', levelIds)

  const purchasedHintLevelIds = new Set((hintPurchases || []).map(h => h.level_id))

  // Get attempt counts
  const { data: submissions } = await adminDb
    .from('submissions')
    .select('level_id')
    .eq('team_id', membership.team_id)
    .in('level_id', levelIds)

  const attemptCounts = new Map<string, number>()
  ;(submissions || []).forEach(s => {
    attemptCounts.set(s.level_id, (attemptCounts.get(s.level_id) || 0) + 1)
  })

  // Get hint texts for purchased hints
  let hintTexts = new Map<string, string>()
  if (purchasedHintLevelIds.size > 0) {
    const { data: hintsData } = await adminDb
      .from('challenge_levels')
      .select('id, hint_text')
      .in('id', Array.from(purchasedHintLevelIds))

    ;(hintsData || []).forEach(h => {
      if (h.hint_text) hintTexts.set(h.id, h.hint_text)
    })
  }

  // Build level list with unlock state
  const enrichedLevels = levels.map((level, index) => {
    const isSolved = solvedLevelIds.has(level.id)
    // Level is unlocked if: it's level 1, OR the previous level is solved
    const isUnlocked = level.level_number === 1 || (index > 0 && solvedLevelIds.has(levels[index - 1].id))
    const hintPurchased = purchasedHintLevelIds.has(level.id)

    return {
      ...level,
      points: level.points_reward,
      is_solved: isSolved,
      is_unlocked: isUnlocked,
      hint_purchased: hintPurchased,
      hint_text: hintPurchased ? hintTexts.get(level.id) : undefined,
      attempt_count: attemptCounts.get(level.id) || 0,
    }
  })

  // Check active sabotage for this team
  const { data: activeAttacks } = await adminDb
    .from('team_powerups')
    .select('id, expires_at, powerups(name, effect_type)')
    .eq('team_id', membership.team_id)
    .eq('status', 'active')

  const timeLockAttack = (activeAttacks || []).find(att => {
    const p = att.powerups as any
    return p?.effect_type === 'time_lock' && att.expires_at && new Date(att.expires_at).getTime() > Date.now()
  })

  const glitchAttack = (activeAttacks || []).find(att => {
    const p = att.powerups as any
    return p?.effect_type === 'glitch_attack' && att.expires_at && new Date(att.expires_at).getTime() > Date.now()
  })

  const chosenAttack = timeLockAttack || glitchAttack
  let activeSabotage = null
  if (chosenAttack) {
    const p = chosenAttack.powerups as any
    const remaining = Math.max(0, Math.floor((new Date(chosenAttack.expires_at!).getTime() - Date.now()) / 1000))
    if (remaining > 0) {
      activeSabotage = {
        type: p?.effect_type || '',
        name: p?.name || (p?.effect_type === 'time_lock' ? 'Time Lock' : 'Glitch Attack'),
        expires_at: chosenAttack.expires_at!,
        seconds_remaining: remaining,
      }
    }
  }

  return {
    success: true,
    data: {
      challenge: challenge as Challenge,
      levels: enrichedLevels,
      active_sabotage: activeSabotage,
    },
  }
}

// ============================================================
// ADMIN: Get all challenges with full details
// ============================================================

export async function adminGetChallenges(): Promise<ActionResult<Array<Challenge & { level_count: number }>>> {
  try {
    await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const adminDb = createAdminClient()

  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: true, data: [] }

  const { data: challenges } = await adminDb
    .from('challenges')
    .select('*, challenge_levels(id)')
    .eq('event_id', event.id)
    .order('display_order', { ascending: true })

  if (!challenges) return { success: true, data: [] }

  const result = challenges.map((c: any) => ({
    ...c,
    level_count: c.challenge_levels?.length || 0,
    challenge_levels: undefined,
  }))

  return { success: true, data: result }
}

// ============================================================
// ADMIN: Get single challenge with levels
// ============================================================

export async function adminGetChallenge(challengeId: string): Promise<ActionResult<{ challenge: Challenge; levels: ChallengeLevel[] }>> {
  try {
    await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const adminDb = createAdminClient()

  const { data: challenge } = await adminDb
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single()

  if (!challenge) return { success: false, error: 'Challenge not found' }

  const { data: levels } = await adminDb
    .from('challenge_levels')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('level_number', { ascending: true })

  return { success: true, data: { challenge: challenge as Challenge, levels: (levels || []) as ChallengeLevel[] } }
}

export async function adminGetLevels(challengeId: string): Promise<ActionResult<ChallengeLevel[]>> {
  const res = await adminGetChallenge(challengeId)
  if (!res.success || !res.data) return { success: false, error: res.error || 'Failed to get levels' }
  return { success: true, data: res.data.levels }
}

// ============================================================
// ADMIN: Create challenge
// ============================================================

export async function adminCreateChallenge(input: unknown): Promise<ActionResult<Challenge>> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const parsed = challengeSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const adminDb = createAdminClient()

  // Get or create event
  let { data: event } = await adminDb
    .from('events')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) {
    const { data: newEvent } = await adminDb
      .from('events')
      .insert({ name: 'THE HUNT', status: 'draft' })
      .select('id')
      .single()
    event = newEvent
  }

  if (!event) return { success: false, error: 'Failed to get/create event' }

  const { data: challenge, error } = await adminDb
    .from('challenges')
    .insert({
      event_id: event.id,
      ...parsed.data,
    })
    .select()
    .single()

  if (error) {
    console.error('Create challenge error:', error)
    return { success: false, error: 'Failed to create challenge' }
  }

  // Audit
  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'create_challenge',
    target_type: 'challenge',
    target_id: challenge.id,
    metadata: { title: parsed.data.title },
  })

  return { success: true, data: challenge as Challenge }
}

// ============================================================
// ADMIN: Update challenge
// ============================================================

export async function adminUpdateChallenge(challengeId: string, input: unknown): Promise<ActionResult<Challenge>> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const parsed = challengeSchema.partial().safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const adminDb = createAdminClient()

  const { data: challenge, error } = await adminDb
    .from('challenges')
    .update(parsed.data)
    .eq('id', challengeId)
    .select()
    .single()

  if (error) {
    console.error('Update challenge error:', error)
    return { success: false, error: 'Failed to update challenge' }
  }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'update_challenge',
    target_type: 'challenge',
    target_id: challengeId,
    metadata: { changes: parsed.data },
  })

  return { success: true, data: challenge as Challenge }
}

// ============================================================
// ADMIN: Create level
// ============================================================

export async function adminCreateLevel(input: unknown): Promise<ActionResult<ChallengeLevel>> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const parsed = levelSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const adminDb = createAdminClient()

  const { data: level, error } = await adminDb
    .from('challenge_levels')
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'A level with this number already exists for this challenge' }
    }
    console.error('Create level error:', error)
    return { success: false, error: 'Failed to create level' }
  }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'create_level',
    target_type: 'challenge_level',
    target_id: level.id,
    metadata: { challenge_id: parsed.data.challenge_id, level_number: parsed.data.level_number },
  })

  return { success: true, data: level as ChallengeLevel }
}

// ============================================================
// ADMIN: Update level
// ============================================================

export async function adminUpdateLevel(levelId: string, input: unknown): Promise<ActionResult<ChallengeLevel>> {
  let user
  try {
    user = await requireAdmin()
  } catch {
    return { success: false, error: 'Unauthorized' }
  }

  const parsed = levelSchema.partial().safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const adminDb = createAdminClient()

  const { data: level, error } = await adminDb
    .from('challenge_levels')
    .update(parsed.data)
    .eq('id', levelId)
    .select()
    .single()

  if (error) {
    console.error('Update level error:', error)
    return { success: false, error: 'Failed to update level' }
  }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'update_level',
    target_type: 'challenge_level',
    target_id: levelId,
    metadata: { changes: Object.keys(parsed.data) },
  })

  return { success: true, data: level as ChallengeLevel }
}

// ============================================================
// ADMIN: Create Challenge + All Levels at once (Spreadsheet / Form)
// ============================================================

export async function adminCreateChallengeWithLevels(input: {
  title: string
  category?: string
  description?: string
  final_fragment?: string
  fragment_order?: number
  levels: Array<{
    level_number: number
    title: string
    prompt: string
    answer: string
    points?: number
    points_reward?: number
    coins_reward: number
    hint_text?: string
    hint_cost?: number
  }>
}): Promise<ActionResult<{ challenge_id: string; level_count: number }>> {
  let user
  try {
    user = await requireAdmin()
  } catch (err: any) {
    return { success: false, error: err.message || 'Unauthorized' }
  }

  if (!input.title?.trim()) {
    return { success: false, error: 'Challenge title is required' }
  }
  if (!input.levels || input.levels.length === 0) {
    return { success: false, error: 'At least one level is required' }
  }

  const adminDb = createAdminClient()

  // Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['draft', 'ready', 'live', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) {
    return { success: false, error: 'No active event found. Please initialize an event first.' }
  }

  // Count existing challenges for display order
  const { count } = await adminDb
    .from('challenges')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', event.id)

  // 1. Insert challenge
  const { data: challenge, error: chalError } = await adminDb
    .from('challenges')
    .insert({
      event_id: event.id,
      title: input.title.trim(),
      category: input.category?.trim() || 'General',
      description: input.description?.trim() || null,
      final_fragment: input.final_fragment?.trim() || null,
      fragment_order: input.fragment_order ? Number(input.fragment_order) : ((count || 0) + 1),
      display_order: (count || 0) + 1,
      status: 'published',
    })
    .select()
    .single()

  if (chalError || !challenge) {
    return { success: false, error: chalError?.message || 'Failed to create challenge' }
  }

  // 2. Prepare levels
  const levelRows = input.levels.map((lvl, idx) => ({
    challenge_id: challenge.id,
    level_number: lvl.level_number || idx + 1,
    title: lvl.title?.trim() || `Level ${idx + 1}`,
    prompt: lvl.prompt?.trim() || '',
    answer: lvl.answer?.trim() || '',
    answer_mode: 'trimmed_case_insensitive',
    points_reward: Number(lvl.points_reward ?? lvl.points) || 100,
    coins_reward: Number(lvl.coins_reward) || 50,
    hint_text: lvl.hint_text?.trim() || null,
    hint_cost: Number(lvl.hint_cost) || 0,
    status: 'published',
  }))

  const { error: lvlError } = await adminDb
    .from('challenge_levels')
    .insert(levelRows)

  if (lvlError) {
    // Delete orphan challenge so we don't leave incomplete challenges
    await adminDb.from('challenges').delete().eq('id', challenge.id)
    return { success: false, error: `Challenge creation failed: ${lvlError.message}` }
  }

  // Audit log
  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'create_challenge_with_levels',
    target_type: 'challenge',
    target_id: challenge.id,
    metadata: { title: input.title, level_count: levelRows.length },
  })

  return { success: true, data: { challenge_id: challenge.id, level_count: levelRows.length } }
}

// ============================================================
// ADMIN: Delete Challenge
// ============================================================

export async function adminDeleteChallenge(challengeId: string): Promise<ActionResult> {
  let user
  try {
    user = await requireAdmin()
  } catch (err: any) {
    return { success: false, error: err.message || 'Unauthorized' }
  }

  const adminDb = createAdminClient()
  const { error } = await adminDb.from('challenges').delete().eq('id', challengeId)
  if (error) {
    return { success: false, error: error.message }
  }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'delete_challenge',
    target_type: 'challenge',
    target_id: challengeId,
  })

  return { success: true }
}
