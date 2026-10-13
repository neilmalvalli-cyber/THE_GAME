'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loginSchema, registerSchema, createTeamSchema, joinTeamSchema } from '@/lib/validators/auth'
import { generateTeamCode } from '@/lib/constants'
import { redirect } from 'next/navigation'
import type { ActionResult, Team } from '@/lib/types/database'

export async function login(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // If email confirmation is holding up login, auto-confirm and retry
    if (error.message.toLowerCase().includes('email not confirmed')) {
      const adminDb = createAdminClient()
      const { data: users } = await adminDb.auth.admin.listUsers()
      const existing = users?.users.find((u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase())
      if (existing) {
        await adminDb.auth.admin.updateUserById(existing.id, { email_confirm: true })
        const retry = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        })
        if (!retry.error) return { success: true }
      }
    }
    return { success: false, error: error.message }
  }

  return { success: true }
}

export async function register(input: unknown): Promise<ActionResult> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const email = parsed.data.email.trim().toLowerCase()
  const password = parsed.data.password
  const displayName = parsed.data.display_name.trim()

  const adminDb = createAdminClient()

  // 1. Create pre-confirmed user directly with admin client (no confirmation email needed!)
  const { data: created, error: createError } = await adminDb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
    },
  })

  if (createError) {
    if (createError.message.toLowerCase().includes('already registered') || createError.message.toLowerCase().includes('already exists')) {
      return { success: false, error: 'An account with this email already exists. Please log in.' }
    }
    return { success: false, error: createError.message }
  }

  const user = created.user
  if (!user) {
    return { success: false, error: 'Failed to create user account' }
  }

  // 2. Set up profile and participant role
  await adminDb.from('profiles').upsert({
    id: user.id,
    display_name: displayName,
  })
  await adminDb.from('user_roles').upsert({
    user_id: user.id,
    role: 'participant',
  })

  // 3. Immediately sign in on the user's browser session so they can enter dashboard immediately
  const supabase = await createClient()
  await supabase.auth.signInWithPassword({
    email,
    password,
  })

  return { success: true }
}

export async function logout(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function createTeam(input: unknown): Promise<ActionResult<Team>> {
  const parsed = createTeamSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Check if user is already on a team
  const { data: existing } = await supabase
    .from('team_members')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return { success: false, error: 'You are already on a team' }
  }

  const adminDb = createAdminClient()

  // Generate a unique team code
  let teamCode = generateTeamCode()
  let attempts = 0
  while (attempts < 10) {
    const { data: codeExists } = await adminDb
      .from('teams')
      .select('id')
      .eq('team_code', teamCode)
      .single()

    if (!codeExists) break
    teamCode = generateTeamCode()
    attempts++
  }

  // Create team
  const { data: team, error: teamError } = await adminDb
    .from('teams')
    .insert({
      name: parsed.data.team_name,
      team_code: teamCode,
    })
    .select()
    .single()

  if (teamError || !team) {
    console.error('Team creation error:', teamError)
    return { success: false, error: 'Failed to create team' }
  }

  // Add user as team member
  const { error: memberError } = await adminDb
    .from('team_members')
    .insert({
      team_id: team.id,
      user_id: user.id,
    })

  if (memberError) {
    console.error('Team member error:', memberError)
    return { success: false, error: 'Failed to join team' }
  }

  // Award starting coins if there's an active event
  const { data: activeEvent } = await adminDb
    .from('events')
    .select('id, starting_coins')
    .in('status', ['draft', 'ready', 'live'])
    .limit(1)
    .single()

  if (activeEvent && activeEvent.starting_coins > 0) {
    await adminDb.from('coin_ledger').insert({
      event_id: activeEvent.id,
      team_id: team.id,
      delta_coins: activeEvent.starting_coins,
      transaction_type: 'starting_balance',
      reason: 'Starting balance on team creation',
    })
  }

  return { success: true, data: team as Team }
}

export async function joinTeam(input: unknown): Promise<ActionResult> {
  const parsed = joinTeamSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  // Check if user is already on a team
  const { data: existing } = await supabase
    .from('team_members')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return { success: false, error: 'You are already on a team' }
  }

  const adminDb = createAdminClient()

  // Find team by code
  const { data: team } = await adminDb
    .from('teams')
    .select('id, status, max_members')
    .eq('team_code', parsed.data.team_code.toUpperCase().trim())
    .single()

  if (!team) {
    return { success: false, error: 'Invalid team code' }
  }

  if (team.status !== 'active') {
    return { success: false, error: 'This team is not accepting members' }
  }

  // Check team member count
  const { count } = await adminDb
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', team.id)

  if (count && count >= team.max_members) {
    return { success: false, error: 'This team is full' }
  }

  // Add user to team
  const { error: memberError } = await adminDb
    .from('team_members')
    .insert({
      team_id: team.id,
      user_id: user.id,
    })

  if (memberError) {
    if (memberError.code === '23505') {
      return { success: false, error: 'You are already on a team' }
    }
    console.error('Join team error:', memberError)
    return { success: false, error: 'Failed to join team' }
  }

  return { success: true }
}

export async function getMyTeam(): Promise<ActionResult<Team & { members: Array<{ user_id: string; display_name: string }> }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { success: false, error: 'Not on a team', code: 'NO_TEAM' }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', membership.team_id)
    .single()

  if (!team) {
    return { success: false, error: 'Team not found' }
  }

  const adminDb = createAdminClient()
  const { data: members } = await adminDb
    .from('team_members')
    .select('user_id, profiles(display_name)')
    .eq('team_id', team.id)

  const memberList = (members || []).map((m: any) => ({
    user_id: m.user_id,
    display_name: m.profiles?.display_name || 'Unknown',
  }))

  return { success: true, data: { ...team, members: memberList } as any }
}

export async function getMyRole(): Promise<ActionResult<{ role: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  return { success: true, data: { role: roleData?.role || 'participant' } }
}
