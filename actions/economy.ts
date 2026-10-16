'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustBalanceSchema, purchaseHintSchema } from '@/lib/validators/economy'
import type { ActionResult, PurchaseResult, CoinLedgerEntry, ScoreLedgerEntry } from '@/lib/types/database'

// ============================================================
// PARTICIPANT: Get my coin balance
// ============================================================

export async function getMyCoinBalance(): Promise<ActionResult<{ balance: number; event_id: string }>> {
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
    .in('status', ['live', 'paused'])
    .limit(1)
    .single()
  if (!event) return { success: true, data: { balance: 0, event_id: '' } }

  const { data: balance } = await adminDb.rpc('get_coin_balance', {
    p_team_id: membership.team_id,
    p_event_id: event.id,
  })

  return { success: true, data: { balance: balance || 0, event_id: event.id } }
}

// ============================================================
// PARTICIPANT: Get my transaction history
// ============================================================

export async function getMyTransactions(): Promise<ActionResult<{ coins: CoinLedgerEntry[]; scores: ScoreLedgerEntry[] }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { success: false, error: 'Not on a team' }

  const { data: coins } = await supabase
    .from('coin_ledger')
    .select('*')
    .eq('team_id', membership.team_id)
    .order('created_at', { ascending: false })
    .limit(50)

  const { data: scores } = await supabase
    .from('score_ledger')
    .select('*')
    .eq('team_id', membership.team_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return { success: true, data: { coins: coins || [], scores: scores || [] } }
}

// ============================================================
// PARTICIPANT: Purchase a hint
// ============================================================

export async function purchaseHint(input: unknown): Promise<ActionResult<{ hint_text: string }>> {
  const parsed = purchaseHintSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { success: false, error: 'Not on a team' }

  const adminDb = createAdminClient()

  // Check if team is under an active TIME LOCK
  const { data: activeTimeLock } = await adminDb
    .from('team_powerups')
    .select('id, expires_at, powerups!inner(effect_type)')
    .eq('team_id', membership.team_id)
    .eq('status', 'active')
    .eq('powerups.effect_type', 'time_lock')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (activeTimeLock) {
    const remainingSec = Math.max(0, Math.floor((new Date(activeTimeLock.expires_at).getTime() - Date.now()) / 1000))
    return {
      success: false,
      error: `🧊 TERMINAL FROZEN: Time Lock in effect! Hint decryptors are frozen for another ${remainingSec}s.`,
      code: 'TIME_LOCKED',
    }
  }

  // Get the level's hint info
  const { data: level } = await adminDb
    .from('challenge_levels')
    .select('id, hint_text, hint_cost, challenge_id, challenges!inner(event_id)')
    .eq('id', parsed.data.level_id)
    .single()

  if (!level) return { success: false, error: 'Level not found' }
  if (!level.hint_text) return { success: false, error: 'No hint available for this level' }
  if (level.hint_cost <= 0) {
    // Free hint
    return { success: true, data: { hint_text: level.hint_text } }
  }

  // Check if already purchased
  const { data: existingPurchase } = await adminDb
    .from('hint_purchases')
    .select('id')
    .eq('team_id', membership.team_id)
    .eq('level_id', parsed.data.level_id)
    .single()

  if (existingPurchase) {
    // Already purchased — return the hint
    return { success: true, data: { hint_text: level.hint_text } }
  }

  // Use DB function for atomic purchase
  const eventId = (level as any).challenges.event_id
  const { data: purchased } = await adminDb.rpc('purchase_hint', {
    p_event_id: eventId,
    p_team_id: membership.team_id,
    p_level_id: parsed.data.level_id,
    p_cost: level.hint_cost,
  })

  if (!purchased) {
    return { success: false, error: 'Insufficient coins', code: 'INSUFFICIENT_FUNDS' }
  }

  return { success: true, data: { hint_text: level.hint_text } }
}

// ============================================================
// PARTICIPANT: Check if hint is purchased
// ============================================================

export async function isHintPurchased(levelId: string): Promise<ActionResult<{ purchased: boolean; hint_text?: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return { success: false, error: 'Not on a team' }

  const { data: purchase } = await supabase
    .from('hint_purchases')
    .select('id')
    .eq('team_id', membership.team_id)
    .eq('level_id', levelId)
    .single()

  if (!purchase) {
    return { success: true, data: { purchased: false } }
  }

  // If purchased, get the hint text
  const adminDb = createAdminClient()
  const { data: level } = await adminDb
    .from('challenge_levels')
    .select('hint_text')
    .eq('id', levelId)
    .single()

  return { success: true, data: { purchased: true, hint_text: level?.hint_text || '' } }
}

// ============================================================
// ADMIN: Adjust team balance (coins or points)
// ============================================================

export async function adminAdjustBalance(input: unknown): Promise<ActionResult<{ new_balance: number }>> {
  const parsed = adjustBalanceSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  // Verify admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!roleData || roleData.role !== 'admin') {
    return { success: false, error: 'Unauthorized', code: 'FORBIDDEN' }
  }

  const adminDb = createAdminClient()

  // Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['draft', 'ready', 'live', 'paused'])
    .limit(1)
    .single()
  if (!event) return { success: false, error: 'No active event' }

  const { team_id, currency, delta, reason } = parsed.data

  if (currency === 'coins') {
    // Check balance won't go negative
    if (delta < 0) {
      const { data: currentBalance } = await adminDb.rpc('get_coin_balance', {
        p_team_id: team_id,
        p_event_id: event.id,
      })
      if ((currentBalance || 0) + delta < 0) {
        return { success: false, error: 'This would result in a negative balance', code: 'NEGATIVE_BALANCE' }
      }
    }

    await adminDb.from('coin_ledger').insert({
      event_id: event.id,
      team_id,
      delta_coins: delta,
      transaction_type: 'adjustment',
      reason,
      actor_user_id: user.id,
    })

    const { data: newBalance } = await adminDb.rpc('get_coin_balance', {
      p_team_id: team_id,
      p_event_id: event.id,
    })

    // Audit log
    await adminDb.from('admin_audit_log').insert({
      actor_user_id: user.id,
      action: 'adjust_coins',
      target_type: 'team',
      target_id: team_id,
      reason,
      metadata: { delta, new_balance: newBalance },
    })

    return { success: true, data: { new_balance: newBalance || 0 } }
  } else {
    // Points adjustment
    await adminDb.from('score_ledger').insert({
      event_id: event.id,
      team_id,
      delta_points: delta,
      transaction_type: 'adjustment',
      reason,
      actor_user_id: user.id,
    })

    const { data: newTotal } = await adminDb.rpc('get_score_total', {
      p_team_id: team_id,
      p_event_id: event.id,
    })

    // Audit log
    await adminDb.from('admin_audit_log').insert({
      actor_user_id: user.id,
      action: 'adjust_points',
      target_type: 'team',
      target_id: team_id,
      reason,
      metadata: { delta, new_total: newTotal },
    })

    return { success: true, data: { new_balance: newTotal || 0 } }
  }
}

// ============================================================
// ADMIN: Get all team balances
// ============================================================

export async function adminGetAllBalances(): Promise<ActionResult<Array<{
  team_id: string
  team_name: string
  coin_balance: number
  score_total: number
}>>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()
  if (!roleData || roleData.role !== 'admin') {
    return { success: false, error: 'Unauthorized' }
  }

  const adminDb = createAdminClient()

  const { data: teams } = await adminDb
    .from('teams')
    .select('id, name, status')
    .eq('status', 'active')

  if (!teams) return { success: true, data: [] }

  // Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id')
    .in('status', ['draft', 'ready', 'live', 'paused'])
    .limit(1)
    .single()

  if (!event) return { success: true, data: teams.map(t => ({
    team_id: t.id,
    team_name: t.name,
    coin_balance: 0,
    score_total: 0,
  }))}

  const results = await Promise.all(
    teams.map(async (team) => {
      const [coinBalance, scoreTotal] = await Promise.all([
        adminDb.rpc('get_coin_balance', { p_team_id: team.id, p_event_id: event.id }),
        adminDb.rpc('get_score_total', { p_team_id: team.id, p_event_id: event.id }),
      ])
      return {
        team_id: team.id,
        team_name: team.name,
        coin_balance: coinBalance.data || 0,
        score_total: scoreTotal.data || 0,
      }
    })
  )

  return { success: true, data: results }
}
