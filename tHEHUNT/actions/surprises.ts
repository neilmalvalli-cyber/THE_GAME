'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeAnswer, hashAnswerForAudit } from '@/lib/constants'
import type { ActionResult } from '@/lib/types/database'

export interface SurpriseMiniGameData {
  id: string
  title: string
  description: string | null
  question_text: string
  ends_at: string
  seconds_remaining: number
  points_reward: number
  coins_reward: number
  powerup_reward_name?: string | null
  is_solved: boolean
}

// ============================================================
// PARTICIPANT: Get Active 5-Minute Surprise Mini-Game
// ============================================================

export async function getActiveSurpriseMiniGame(): Promise<ActionResult<SurpriseMiniGameData | null>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: true, data: null }
  const teamId = membership.team_id

  const adminDb = createAdminClient()

  // 1. Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['live', 'ready', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: true, data: null }

  // 2. Query live surprise events
  const nowIso = new Date().toISOString()
  const { data: liveSurprise } = await adminDb
    .from('surprise_events')
    .select('*')
    .eq('event_id', event.id)
    .eq('status', 'live')
    .gt('ends_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!liveSurprise) return { success: true, data: null }

  const remaining = Math.max(0, Math.floor((new Date(liveSurprise.ends_at).getTime() - Date.now()) / 1000))
  if (remaining <= 0) {
    // Auto-expire
    await adminDb.from('surprise_events').update({ status: 'ended' }).eq('id', liveSurprise.id)
    return { success: true, data: null }
  }

  // 3. Check if team already solved this surprise mini-game
  const { data: existingSolve } = await adminDb
    .from('surprise_submissions')
    .select('id, result')
    .eq('surprise_event_id', liveSurprise.id)
    .eq('team_id', teamId)
    .eq('result', 'correct')
    .maybeSingle()

  const config = (liveSurprise.configuration as Record<string, any>) || {}

  return {
    success: true,
    data: {
      id: liveSurprise.id,
      title: liveSurprise.title,
      description: liveSurprise.description,
      question_text: liveSurprise.question_text || '',
      ends_at: liveSurprise.ends_at,
      seconds_remaining: remaining,
      points_reward: liveSurprise.points_reward,
      coins_reward: liveSurprise.coins_reward,
      powerup_reward_name: config.powerup_reward_name || null,
      is_solved: Boolean(existingSolve),
    },
  }
}

// ============================================================
// PARTICIPANT: Submit Surprise Mini-Game Answer
// ============================================================

export async function submitSurpriseMiniGameAnswer(params: {
  event_id: string
  answer: string
}): Promise<ActionResult<{ correct: boolean; points_earned: number; coins_earned: number; powerup_granted?: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) return { success: false, error: 'Not on a team' }
  const teamId = membership.team_id

  if (!params.answer?.trim()) {
    return { success: false, error: 'Answer cannot be blank' }
  }

  const adminDb = createAdminClient()

  // 1. Get surprise event
  const { data: surprise } = await adminDb
    .from('surprise_events')
    .select('*')
    .eq('id', params.event_id)
    .single()

  if (!surprise || surprise.status !== 'live') {
    return { success: false, error: 'Surprise event has expired or ended.' }
  }

  if (new Date(surprise.ends_at).getTime() < Date.now()) {
    await adminDb.from('surprise_events').update({ status: 'ended' }).eq('id', surprise.id)
    return { success: false, error: 'Time expired for this mini-game!' }
  }

  // 2. Check if already solved
  const { data: existingSolve } = await adminDb
    .from('surprise_submissions')
    .select('id')
    .eq('surprise_event_id', surprise.id)
    .eq('team_id', teamId)
    .eq('result', 'correct')
    .maybeSingle()

  if (existingSolve) {
    return { success: false, error: 'Your team has already solved this mini-game!' }
  }

  // 3. Compare answer
  const normalizedSubmission = normalizeAnswer(params.answer, surprise.question_answer_mode || 'trimmed_case_insensitive')
  const normalizedCorrect = normalizeAnswer(surprise.question_answer || '', surprise.question_answer_mode || 'trimmed_case_insensitive')
  const isCorrect = normalizedSubmission === normalizedCorrect

  if (!isCorrect) {
    return {
      success: true,
      data: { correct: false, points_earned: 0, coins_earned: 0 },
    }
  }

  // 4. Record solve
  await adminDb.from('surprise_submissions').insert({
    surprise_event_id: surprise.id,
    team_id: teamId,
    submitted_by: user.id,
    answer_hash: hashAnswerForAudit(params.answer),
    result: 'correct',
  })

  // 5. Award points & coins
  if (surprise.points_reward > 0) {
    await adminDb.from('score_ledger').insert({
      event_id: surprise.event_id,
      team_id: teamId,
      delta_points: surprise.points_reward,
      transaction_type: 'bonus',
      reason: `Surprise Mini-Game Solved: ${surprise.title}`,
      actor_user_id: user.id,
    })
  }

  if (surprise.coins_reward > 0) {
    await adminDb.from('coin_ledger').insert({
      event_id: surprise.event_id,
      team_id: teamId,
      delta_coins: surprise.coins_reward,
      transaction_type: 'reward',
      reason: `Surprise Mini-Game Solved: ${surprise.title}`,
      actor_user_id: user.id,
    })
  }

  // 6. Check if configured with powerup reward
  const config = (surprise.configuration as Record<string, any>) || {}
  let powerupGrantedName: string | undefined

  if (config.powerup_reward_type) {
    const { data: targetPowerup } = await adminDb
      .from('powerups')
      .select('id, name')
      .eq('event_id', surprise.event_id)
      .eq('effect_type', config.powerup_reward_type)
      .limit(1)
      .single()

    if (targetPowerup) {
      await adminDb.from('team_powerups').insert({
        team_id: teamId,
        powerup_id: targetPowerup.id,
        status: 'available',
      })
      powerupGrantedName = targetPowerup.name
    }
  }

  return {
    success: true,
    data: {
      correct: true,
      points_earned: surprise.points_reward,
      coins_earned: surprise.coins_reward,
      powerup_granted: powerupGrantedName,
    },
  }
}

// ============================================================
// ADMIN: Launch 5-Minute Surprise Mini-Game
// ============================================================

export async function adminLaunchSurpriseMiniGame(input: {
  title: string
  description?: string
  question_text: string
  question_answer: string
  duration_minutes?: number
  points_reward?: number
  coins_reward?: number
  powerup_reward_type?: string
}): Promise<ActionResult<{ event_id: string; ends_at: string }>> {
  const adminDb = createAdminClient()

  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['live', 'ready', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event found' }

  const durationMin = input.duration_minutes || 5
  const endsAt = new Date(Date.now() + durationMin * 60 * 1000).toISOString()

  // First, end any previously live surprise events
  await adminDb
    .from('surprise_events')
    .update({ status: 'ended' })
    .eq('event_id', event.id)
    .eq('status', 'live')

  const { data: created, error } = await adminDb
    .from('surprise_events')
    .insert({
      event_id: event.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      event_type: 'bonus_question',
      status: 'live',
      question_text: input.question_text.trim(),
      question_answer: input.question_answer.trim(),
      question_answer_mode: 'trimmed_case_insensitive',
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      duration_seconds: durationMin * 60,
      points_reward: Number(input.points_reward) || 50,
      coins_reward: Number(input.coins_reward) || 30,
      configuration: {
        powerup_reward_type: input.powerup_reward_type || null,
        powerup_reward_name: input.powerup_reward_type ? input.powerup_reward_type.replace('_', ' ').toUpperCase() : null,
      },
    })
    .select('id, ends_at')
    .single()

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to launch surprise event' }
  }

  return { success: true, data: { event_id: created.id, ends_at: created.ends_at } }
}

export async function adminEndSurpriseMiniGame(eventId: string): Promise<ActionResult> {
  const adminDb = createAdminClient()
  const { error } = await adminDb
    .from('surprise_events')
    .update({ status: 'ended' })
    .eq('id', eventId)

  if (error) return { success: false, error: error.message }
  return { success: true }
}
