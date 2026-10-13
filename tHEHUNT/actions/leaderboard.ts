'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/types/database'

export interface LeaderboardEntry {
  rank: number
  team_id: string
  team_name: string
  score: number
  coins: number
  solves_count: number
  last_solve_at: string | null
}

export interface GraphTimelinePoint {
  time: string
  score: number
}

export interface TeamTimelineSeries {
  team_id: string
  team_name: string
  color: string
  points: GraphTimelinePoint[]
}

export interface LeaderboardResult {
  locked: boolean
  is_admin: boolean
  event_name: string
  teams: LeaderboardEntry[]
  timeline?: TeamTimelineSeries[]
}

export async function getLeaderboard(): Promise<ActionResult<LeaderboardResult>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const adminDb = createAdminClient()

  // 1. Get active event
  const { data: event } = await adminDb
    .from('events')
    .select('id, name, settings')
    .in('status', ['draft', 'ready', 'live', 'paused', 'ended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!event) {
    return { success: false, error: 'No active event found' }
  }

  // 2. Check admin status
  let isAdmin = false
  if (user) {
    const { data: roleData } = await adminDb
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()
    isAdmin = roleData?.role === 'admin'
  }

  // 3. Check scoreboard lock
  const settings = (event.settings as Record<string, any>) || {}
  const isLocked = Boolean(settings.scoreboard_locked)

  // If locked and not admin, return locked view
  if (isLocked && !isAdmin) {
    return {
      success: true,
      data: {
        locked: true,
        is_admin: false,
        event_name: event.name,
        teams: [],
      },
    }
  }

  // 4. Fetch all active teams
  const { data: teams } = await adminDb
    .from('teams')
    .select('id, name')
    .eq('status', 'active')

  if (!teams || teams.length === 0) {
    return {
      success: true,
      data: {
        locked: isLocked,
        is_admin: isAdmin,
        event_name: event.name,
        teams: [],
      },
    }
  }

  // 5. Gather scores, coins, and solves for each team
  const entries: Omit<LeaderboardEntry, 'rank'>[] = await Promise.all(
    teams.map(async (t) => {
      // Score total
      const { data: score } = await adminDb.rpc('get_score_total', {
        p_team_id: t.id,
        p_event_id: event.id,
      })

      // Coins balance
      const { data: coins } = await adminDb.rpc('get_coin_balance', {
        p_team_id: t.id,
        p_event_id: event.id,
      })

      // Solves list + last solve time
      const { data: solves } = await adminDb
        .from('level_solves')
        .select('solved_at')
        .eq('team_id', t.id)
        .order('solved_at', { ascending: false })

      const lastSolveAt = solves && solves.length > 0 ? solves[0].solved_at : null

      return {
        team_id: t.id,
        team_name: t.name,
        score: score || 0,
        coins: coins || 0,
        solves_count: solves?.length || 0,
        last_solve_at: lastSolveAt,
      }
    })
  )

  // 6. CTFd Tie-Breaker Sorting:
  // - Higher points first
  // - If tied: earlier last solve timestamp wins!
  entries.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    if (a.last_solve_at && b.last_solve_at) {
      return new Date(a.last_solve_at).getTime() - new Date(b.last_solve_at).getTime()
    }
    if (a.last_solve_at) return -1
    if (b.last_solve_at) return 1
    return 0
  })

  // Assign ranks
  const rankedTeams: LeaderboardEntry[] = entries.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }))

  // 7. Calculate CTFd cumulative score-over-time timeline graph for top teams
  const topTeams = rankedTeams.slice(0, 10)
  const topTeamIds = topTeams.map((t) => t.team_id)

  const { data: scoreLedgerEntries } = topTeamIds.length > 0
    ? await adminDb
        .from('score_ledger')
        .select('team_id, delta_points, created_at')
        .eq('event_id', event.id)
        .in('team_id', topTeamIds)
        .order('created_at', { ascending: true })
    : { data: [] }

  const colors = [
    '#10b981', // emerald
    '#06b6d4', // cyan
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#3b82f6', // blue
    '#ef4444', // red
    '#14b8a6', // teal
    '#f97316', // orange
    '#a855f7', // violet
  ]

  const timeline: TeamTimelineSeries[] = topTeams.map((team, idx) => {
    const teamEntries = (scoreLedgerEntries || []).filter((e) => e.team_id === team.team_id)
    let cumulative = 0
    const points: GraphTimelinePoint[] = []

    if (teamEntries.length > 0) {
      const firstTime = new Date(new Date(teamEntries[0].created_at).getTime() - 60000).toISOString()
      points.push({ time: firstTime, score: 0 })
    } else {
      points.push({ time: new Date().toISOString(), score: team.score })
    }

    teamEntries.forEach((entry) => {
      cumulative += Number(entry.delta_points) || 0
      points.push({ time: entry.created_at, score: cumulative })
    })

    // Add trailing point for current time
    if (points.length > 1) {
      points.push({ time: new Date().toISOString(), score: cumulative })
    }

    return {
      team_id: team.team_id,
      team_name: team.team_name,
      color: colors[idx % colors.length],
      points,
    }
  })

  return {
    success: true,
    data: {
      locked: isLocked,
      is_admin: isAdmin,
      event_name: event.name,
      teams: rankedTeams,
      timeline,
    },
  }
}

export async function adminToggleScoreboardLock(locked: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const adminDb = createAdminClient()
  const { data: roleData } = await adminDb
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!roleData || roleData.role !== 'admin') {
    return { success: false, error: 'Unauthorized' }
  }

  const { data: event } = await adminDb
    .from('events')
    .select('id, settings')
    .in('status', ['draft', 'ready', 'live', 'paused'])
    .limit(1)
    .single()

  if (!event) return { success: false, error: 'No active event' }

  const settings = (event.settings as Record<string, any>) || {}
  settings.scoreboard_locked = locked

  const { error } = await adminDb
    .from('events')
    .update({ settings })
    .eq('id', event.id)

  if (error) return { success: false, error: error.message }

  await adminDb.from('admin_audit_log').insert({
    actor_user_id: user.id,
    action: 'toggle_scoreboard_lock',
    target_type: 'event',
    target_id: event.id,
    metadata: { scoreboard_locked: locked },
  })

  return { success: true }
}
