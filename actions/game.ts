'use server'

// THE GAME — server actions. The browser game (game/) calls these when it is built with
// NEXT_PUBLIC_GAME_BACKEND=supabase. Every action works out WHO is calling from the
// Supabase session cookie; no team id or price from the browser is trusted. All game
// rules run inside the SQL functions of supabase/migrations/004_the_game.sql.
//
// Teams log in with a team name + password. Each team is one Supabase auth user whose
// e-mail is internal (`<uuid>@TEAM_LOGIN_DOMAIN`) and never shown or mailed.

import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateTeamCode } from '@/lib/constants'

type Ok<T> = { ok: true; value: T }
type Err = { ok: false; error: string; code?: string }
export type GameResult<T = null> = Ok<T> | Err

export interface TeamIdentity { teamId: string; teamName: string; createdAt: number }

const TEAM_NAME_MIN = 3
const TEAM_NAME_MAX = 24
const PASSWORD_MIN = 6
const LOGIN_DOMAIN = process.env.TEAM_LOGIN_DOMAIN || 'teams.thegame.invalid'

const fail = (error: string, code?: string): Err => ({ ok: false, error, code })
const cleanName = (raw: string) => String(raw ?? '').trim().replace(/\s+/g, ' ')

function validateTeamName(n: string): string | null {
  if (!n) return 'Enter a team name.'
  if (n.length < TEAM_NAME_MIN) return `Team names need at least ${TEAM_NAME_MIN} characters.`
  if (n.length > TEAM_NAME_MAX) return `Team names can be at most ${TEAM_NAME_MAX} characters.`
  if (!/^[\p{L}\p{N} ._\-']+$/u.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores.'
  return null
}

/** Exact, case-insensitive name match for PostgREST `ilike` (escape its wildcards). */
const ilikeExact = (n: string) => n.replace(/[\\%_]/g, (c) => `\\${c}`)

async function findTeamByName(name: string) {
  const db = createAdminClient()
  const { data } = await db.from('teams').select('id, name, created_at, status').ilike('name', ilikeExact(name)).limit(1).maybeSingle()
  return data
}

async function caller(): Promise<{ userId: string; teamId: string | null; isAdmin: boolean } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const db = createAdminClient()
  const [{ data: member }, { data: role }] = await Promise.all([
    db.from('team_members').select('team_id').eq('user_id', user.id).maybeSingle(),
    db.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
  ])
  return { userId: user.id, teamId: member?.team_id ?? null, isAdmin: role?.role === 'admin' }
}

async function requireTeam() {
  const c = await caller()
  if (!c) return fail('Your session has ended. Log in again.', 'NO_SESSION')
  if (!c.teamId) return fail('This account is not a team.', 'NO_TEAM')
  return { ok: true as const, userId: c.userId, teamId: c.teamId }
}

async function requireAdmin() {
  const c = await caller()
  if (!c) return fail('Your session has ended. Log in again.', 'NO_SESSION')
  if (!c.isAdmin) return fail('Admins only.', 'FORBIDDEN')
  return { ok: true as const, userId: c.userId }
}

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<GameResult<T>> {
  const { data, error } = await createAdminClient().rpc(fn, args)
  if (error) {
    console.error(`[game] ${fn}:`, error.message)
    return fail('The server could not complete that. Try again.')
  }
  return { ok: true, value: data as T }
}

const identity = (t: { id: string; name: string; created_at: string }): TeamIdentity =>
  ({ teamId: t.id, teamName: t.name, createdAt: new Date(t.created_at).getTime() })

// ---------------------------------------------------------------- auth

export async function gameRegisterTeam(input: { name: string; password: string }): Promise<GameResult<TeamIdentity>> {
  const name = cleanName(input?.name)
  const password = String(input?.password ?? '')
  const bad = validateTeamName(name)
  if (bad) return fail(bad)
  if (password.length < PASSWORD_MIN) return fail(`Passwords need at least ${PASSWORD_MIN} characters.`)
  if (await findTeamByName(name)) return fail('That team name is taken. Choose another, or log in.')

  const db = createAdminClient()
  const email = `${randomUUID()}@${LOGIN_DOMAIN}`
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name, kind: 'team' },
  })
  if (error || !created.user) {
    console.error('[game] create team user:', error?.message)
    return fail('Could not create the team. Try again.')
  }
  const made = await rpc<{ team_id?: string; error?: string }>('game_create_team', { p_user: created.user.id, p_name: name, p_code: generateTeamCode() })
  if (!made.ok || made.value.error || !made.value.team_id) {
    await db.auth.admin.deleteUser(created.user.id)
    return fail(made.ok && made.value.error === 'name_taken' ? 'That team name is taken. Choose another, or log in.' : 'Could not create the team. Try again.')
  }
  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  if (signInError) return fail('Team created, but signing in failed. Try logging in.')
  const team = await db.from('teams').select('id, name, created_at').eq('id', made.value.team_id).single()
  return { ok: true, value: identity(team.data!) }
}

export async function gameLoginTeam(input: { name: string; password: string }): Promise<GameResult<TeamIdentity>> {
  const generic = fail('Team name or password is incorrect.')
  const name = cleanName(input?.name)
  const password = String(input?.password ?? '')
  if (!name || !password) return generic
  const team = await findTeamByName(name)
  if (!team || team.status !== 'active') return generic
  const db = createAdminClient()
  const { data: member } = await db.from('team_members').select('user_id').eq('team_id', team.id).order('joined_at').limit(1).maybeSingle()
  if (!member) return generic
  const { data: user } = await db.auth.admin.getUserById(member.user_id)
  if (!user?.user?.email) return generic
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: user.user.email, password })
  if (error) return generic
  return { ok: true, value: identity(team) }
}

export async function gameLoginAdmin(input: { email: string; password: string }): Promise<GameResult<true>> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: String(input?.email ?? '').trim(), password: String(input?.password ?? '') })
  if (error) return fail('Incorrect admin e-mail or password.')
  const c = await caller()
  if (!c?.isAdmin) {
    await supabase.auth.signOut()
    return fail('This account is not an admin.')
  }
  return { ok: true, value: true }
}

export async function gameLogout(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

/** Who this browser is signed in as (restores a session after a reload or on a new tab). */
export async function gameSession(): Promise<GameResult<{ team: TeamIdentity | null; admin: boolean }>> {
  const c = await caller()
  if (!c) return { ok: true, value: { team: null, admin: false } }
  let team: TeamIdentity | null = null
  if (c.teamId) {
    const { data } = await createAdminClient().from('teams').select('id, name, created_at').eq('id', c.teamId).single()
    if (data) team = identity(data)
  }
  return { ok: true, value: { team, admin: c.isAdmin } }
}

// ---------------------------------------------------------------- team game

export async function gameState(since?: string | null) {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_state', { p_team: t.teamId, p_since: since ?? null })
}

export async function gameSubmit(input: { caseId: number; level: number; answer: string }) {
  const t = await requireTeam(); if (!t.ok) return t
  const answer = String(input?.answer ?? '').slice(0, 200)
  return rpc('game_submit', { p_team: t.teamId, p_user: t.userId, p_case: Number(input?.caseId), p_level: Number(input?.level), p_answer: answer })
}

export async function gamePurchase(input: { catalogId: string; market: 'normal' | 'black'; purchaseKey: string }) {
  const t = await requireTeam(); if (!t.ok) return t
  const market = input?.market === 'normal' ? 'normal' : 'black'
  const key = String(input?.purchaseKey ?? '').slice(0, 100)
  if (!key) return fail('Missing purchase id.')
  return rpc('game_purchase', { p_team: t.teamId, p_user: t.userId, p_item: String(input?.catalogId ?? ''), p_market: market, p_key: key })
}

export async function gameUseSkipToken(input: { caseId: number; level: number }) {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_use_skip', { p_team: t.teamId, p_case: Number(input?.caseId), p_level: Number(input?.level) })
}

export async function gameUseMasterKey(input: { caseId: number }) {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_use_master_key', { p_team: t.teamId, p_case: Number(input?.caseId) })
}

export async function gameUsePowerfulHint(input: { caseId: number; level: number }) {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_use_hint', { p_team: t.teamId, p_case: Number(input?.caseId), p_level: Number(input?.level) })
}

export async function gameArmOverclock() {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_arm_overclock', { p_team: t.teamId })
}

export async function gameLaunchSabotage(input: { kind: 'glitch' | 'freeze'; targetId: string }) {
  const t = await requireTeam(); if (!t.ok) return t
  const kind = input?.kind === 'freeze' ? 'freeze' : 'glitch'
  return rpc('game_launch_sabotage', { p_team: t.teamId, p_kind: kind, p_target: String(input?.targetId ?? '') || null })
}

export async function gameVerifyPhone(input: { code: string }) {
  const t = await requireTeam(); if (!t.ok) return t
  const code = String(input?.code ?? '')
  if (!/^\d{1,20}$/.test(code)) return { ok: true as const, value: { ok: false, reason: 'incomplete' } }
  return rpc('game_verify_phone', { p_team: t.teamId, p_code: code })
}

export async function gameSetIntroSeen() {
  const t = await requireTeam(); if (!t.ok) return t
  return rpc('game_set_intro_seen', { p_team: t.teamId })
}

// ---------------------------------------------------------------- admin

export async function gameAdminTeams() {
  const a = await requireAdmin(); if (!a.ok) return a
  return rpc<unknown[]>('game_admin_teams', {})
}

export async function gameAdminMarket(action?: 'shutdown' | 'reopen' | 'activate' | 'deactivate') {
  const a = await requireAdmin(); if (!a.ok) return a
  if (!action) {
    const db = createAdminClient()
    const { data: event } = await db.rpc('game_event')
    if (!event) return fail('No live event.')
    const [status, log] = await Promise.all([
      db.rpc('game_market_status', { p_event: event }),
      db.from('game_market_log').select('id, kind, created_at').eq('event_id', event).order('id', { ascending: true }).limit(200),
    ])
    return { ok: true as const, value: { market: status.data, log: (log.data ?? []).map((r) => ({ id: String(r.id), type: r.kind, at: r.created_at })) } }
  }
  if (!['shutdown', 'reopen', 'activate', 'deactivate'].includes(action)) return fail('Unknown action.')
  return rpc('game_admin_set_market', { p_user: a.userId, p_action: action })
}

const MAIL_TYPES: Record<string, { category: string; sender: string }> = {
  general: { category: 'general', sender: 'THE GAME' },
  deadDrop: { category: 'deadDrop', sender: 'UNKNOWN SOURCE' },
  warning: { category: 'warning', sender: 'THE GAME' },
  market: { category: 'market', sender: 'MARKET' },
  system: { category: 'system', sender: 'SYSTEM' },
}

export async function gameAdminSend(input: { draftId: string; to: 'all' | string[]; subject: string; body: string; type: string }) {
  const a = await requireAdmin(); if (!a.ok) return a
  const subject = String(input?.subject ?? '').trim()
  const body = String(input?.body ?? '').trim()
  const type = MAIL_TYPES[input?.type] ? input.type : 'general'
  if (input?.to !== 'all' && (!Array.isArray(input?.to) || input.to.length === 0)) return fail('Choose at least one team.')
  if (!subject || subject.length > 120) return fail('Write a subject of at most 120 characters.')
  if (!body || body.length > 4000) return fail('Write a message of at most 4000 characters.')
  return rpc('game_admin_send', {
    p_user: a.userId, p_key: String(input.draftId).slice(0, 80), p_to: input.to === 'all' ? null : input.to,
    p_subject: subject, p_body: body, p_kind: type, p_category: MAIL_TYPES[type].category, p_sender: MAIL_TYPES[type].sender,
  })
}

export async function gameAdminSent() {
  const a = await requireAdmin(); if (!a.ok) return a
  return rpc<unknown[]>('game_admin_sent', {})
}
