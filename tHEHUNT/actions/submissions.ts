'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitAnswerSchema } from '@/lib/validators/submissions'
import { normalizeAnswer, hashAnswerForAudit, SUBMISSION_RATE_LIMIT_SECONDS, MAX_SUBMISSION_ATTEMPTS_PER_LEVEL } from '@/lib/constants'
import type { ActionResult, SubmitAnswerResult } from '@/lib/types/database'

/**
 * Submit an answer for a challenge level.
 * This is the most critical server action — it handles:
 * 1. Auth verification
 * 2. Team membership check
 * 3. Event state check
 * 4. Challenge/level state check
 * 5. Prerequisite check (sequential unlock)
 * 6. Rate limiting
 * 7. Attempt limiting
 * 8. Answer comparison (server-side only)
 * 9. Atomic solve + reward recording
 */
export async function submitAnswer(
  input: unknown
): Promise<ActionResult<SubmitAnswerResult>> {
  try {
    // 1. Validate input
    const parsed = submitAnswerSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input', code: 'INVALID_INPUT' }
    }
    const { level_id, answer } = parsed.data
    const idempotency_key = parsed.data.idempotency_key || crypto.randomUUID()

    // 2. Authenticate
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated', code: 'UNAUTHENTICATED' }
    }

    // 3. Get team membership
    const { data: membership } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return { success: false, error: 'You must be on a team to submit answers', code: 'NO_TEAM' }
    }
    const teamId = membership.team_id

    // 4. Check team status
    const { data: team } = await supabase
      .from('teams')
      .select('status')
      .eq('id', teamId)
      .single()

    if (!team || team.status !== 'active') {
      return { success: false, error: 'Your team is not active', code: 'TEAM_INACTIVE' }
    }

    // Use admin client for operations that need full access
    const adminDb = createAdminClient()

    // 5. Get the level with answer (admin client — bypasses RLS)
    const { data: level } = await adminDb
      .from('challenge_levels')
      .select('*, challenges!inner(event_id, status)')
      .eq('id', level_id)
      .single()

    if (!level) {
      return { success: false, error: 'Level not found', code: 'LEVEL_NOT_FOUND' }
    }

    // 6. Check challenge and level are published
    const challenge = (level as any).challenges
    if (challenge.status !== 'published') {
      return { success: false, error: 'Challenge is not available', code: 'CHALLENGE_UNAVAILABLE' }
    }
    if (level.status !== 'published') {
      return { success: false, error: 'Level is not available', code: 'LEVEL_UNAVAILABLE' }
    }

    // 7. Check event is live
    const { data: event } = await adminDb
      .from('events')
      .select('id, status')
      .eq('id', challenge.event_id)
      .single()

    if (!event || event.status !== 'live') {
      return { success: false, error: 'Event is not active', code: 'EVENT_NOT_LIVE' }
    }

    // 8. Check release time
    if (level.release_at && new Date(level.release_at) > new Date()) {
      return { success: false, error: 'This level is not yet available', code: 'LEVEL_NOT_RELEASED' }
    }

    // 9. Check deadline
    if (level.deadline_at && new Date(level.deadline_at) < new Date()) {
      return { success: false, error: 'Submission deadline has passed', code: 'DEADLINE_PASSED' }
    }

    // 10. Check prerequisite (sequential unlock)
    if (level.level_number > 1) {
      const { data: prevLevel } = await adminDb
        .from('challenge_levels')
        .select('id')
        .eq('challenge_id', level.challenge_id)
        .eq('level_number', level.level_number - 1)
        .single()

      if (prevLevel) {
        const { data: prevSolve } = await adminDb
          .from('level_solves')
          .select('id')
          .eq('team_id', teamId)
          .eq('level_id', prevLevel.id)
          .single()

        if (!prevSolve) {
          return { success: false, error: 'You must solve the previous level first', code: 'PREREQUISITE_NOT_MET' }
        }
      }
    }

    // 11. Check if already solved (idempotent)
    const { data: existingSolve } = await adminDb
      .from('level_solves')
      .select('id')
      .eq('team_id', teamId)
      .eq('level_id', level_id)
      .single()

    if (existingSolve) {
      return {
        success: true,
        data: { correct: true, already_solved: true },
      }
    }

    // 12. Check idempotency (if same key was used before)
    if (idempotency_key) {
      const { data: existingSubmission } = await adminDb
        .from('submissions')
        .select('id, result')
        .eq('idempotency_key', idempotency_key)
        .single()

      if (existingSubmission) {
        return {
          success: true,
          data: { correct: existingSubmission.result === 'correct', already_solved: existingSubmission.result === 'correct' },
        }
      }
    }

    // 13. Rate limiting — check last submission time
    const { data: recentSubmissions } = await adminDb
      .from('submissions')
      .select('created_at')
      .eq('team_id', teamId)
      .eq('level_id', level_id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (recentSubmissions && recentSubmissions.length > 0) {
      const lastSubmitTime = new Date(recentSubmissions[0].created_at)
      const secondsSince = (Date.now() - lastSubmitTime.getTime()) / 1000
      if (secondsSince < SUBMISSION_RATE_LIMIT_SECONDS) {
        return {
          success: false,
          error: `Please wait ${Math.ceil(SUBMISSION_RATE_LIMIT_SECONDS - secondsSince)} seconds before submitting again`,
          code: 'RATE_LIMITED',
        }
      }
    }

    // 14. Attempt limiting
    if (level.max_attempts) {
      const { count } = await adminDb
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('level_id', level_id)

      if (count && count >= level.max_attempts) {
        return {
          success: false,
          error: 'Maximum attempts reached for this level',
          code: 'MAX_ATTEMPTS',
        }
      }
    }

    // 15. Compare answer (server-side)
    const normalizedSubmission = normalizeAnswer(answer, level.answer_mode)
    const normalizedCorrect = normalizeAnswer(level.answer, level.answer_mode)
    const isCorrect = normalizedSubmission === normalizedCorrect

    // 16. Record the submission
    const { data: submission, error: submitError } = await adminDb
      .from('submissions')
      .insert({
        event_id: event.id,
        team_id: teamId,
        challenge_id: level.challenge_id,
        level_id: level_id,
        submitted_by: user.id,
        answer_hash: hashAnswerForAudit(answer),
        result: isCorrect ? 'correct' : 'incorrect',
        idempotency_key,
      })
      .select('id')
      .single()

    if (submitError || !submission) {
      // Could be idempotency key conflict — return gracefully
      if (submitError?.code === '23505') {
        return {
          success: true,
          data: { correct: isCorrect },
        }
      }
      console.error('Submission insert error:', submitError)
      return { success: false, error: 'Failed to record submission', code: 'DB_ERROR' }
    }

    // 17. If correct, award the solve
    if (isCorrect) {
      const { data: awarded } = await adminDb.rpc('award_solve', {
        p_event_id: event.id,
        p_team_id: teamId,
        p_challenge_id: level.challenge_id,
        p_level_id: level_id,
        p_submission_id: submission.id,
        p_points_reward: level.points_reward,
        p_coins_reward: level.coins_reward,
        p_idempotency_key: idempotency_key,
      })

      // 18. Find next level
      const { data: nextLevel } = await adminDb
        .from('challenge_levels')
        .select('id')
        .eq('challenge_id', level.challenge_id)
        .eq('level_number', level.level_number + 1)
        .eq('status', 'published')
        .single()

      // Calculate remaining attempts
      let attemptsRemaining: number | null = null
      if (level.max_attempts) {
        const { count } = await adminDb
          .from('submissions')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .eq('level_id', level_id)
        attemptsRemaining = level.max_attempts - (count || 0)
      }

      return {
        success: true,
        data: {
          correct: true,
          already_solved: awarded === false,
          points_earned: awarded ? level.points_reward : 0,
          coins_earned: awarded ? level.coins_reward : 0,
          next_level_id: nextLevel?.id || null,
          attempts_remaining: attemptsRemaining,
        },
      }
    }

    // 19. Incorrect answer
    let attemptsRemaining: number | null = null
    if (level.max_attempts) {
      const { count } = await adminDb
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('level_id', level_id)
      attemptsRemaining = level.max_attempts - (count || 0)
    }

    return {
      success: true,
      data: {
        correct: false,
        attempts_remaining: attemptsRemaining,
      },
    }
  } catch (error) {
    console.error('submitAnswer unexpected error:', error)
    return { success: false, error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }
  }
}
