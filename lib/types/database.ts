// ============================================================
// THE HUNT — Database Types
// These mirror the Supabase schema exactly
// ============================================================

// Enums
export type UserRole = 'participant' | 'admin' | 'observer'
export type TeamStatus = 'active' | 'disqualified' | 'archived'
export type EventStatus = 'draft' | 'ready' | 'live' | 'paused' | 'ended'
export type ChallengeStatus = 'draft' | 'published' | 'paused' | 'archived'
export type LevelStatus = 'draft' | 'published' | 'paused'
export type SubmissionResult = 'correct' | 'incorrect' | 'rate_limited' | 'invalid'
export type ScoreTxType = 'solve' | 'bonus' | 'adjustment' | 'penalty' | 'surprise_reward'
export type CoinTxType = 'starting_balance' | 'reward' | 'purchase' | 'hint' | 'adjustment' | 'refund' | 'penalty' | 'surprise_reward' | 'market_purchase'
export type PowerupStatus = 'available' | 'active' | 'consumed' | 'expired'
export type SurpriseStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled'

// Table types
export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface UserRoleRecord {
  user_id: string
  role: UserRole
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  team_code: string
  status: TeamStatus
  max_members: number
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  joined_at: string
}

export interface GameEvent {
  id: string
  name: string
  description: string | null
  status: EventStatus
  starts_at: string | null
  ends_at: string | null
  starting_coins: number
  market_open: boolean
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Challenge {
  id: string
  event_id: string
  title: string
  description: string | null
  category: string | null
  display_order: number
  status: ChallengeStatus
  final_fragment: string | null
  fragment_order: number | null
  created_at: string
  updated_at: string
}

export interface ChallengeLevel {
  id: string
  challenge_id: string
  level_number: number
  title: string
  prompt: string
  answer: string // ONLY visible to admin/service role
  answer_mode: string
  hint_text: string | null
  hint_cost: number
  points_reward: number
  coins_reward: number
  status: LevelStatus
  release_at: string | null
  deadline_at: string | null
  max_attempts: number | null
  attachments: unknown[]
  created_at: string
  updated_at: string
}

// Safe version without answer field (for participant views)
export type PublicChallengeLevel = Omit<ChallengeLevel, 'answer'>

export interface Submission {
  id: string
  event_id: string
  team_id: string
  challenge_id: string
  level_id: string
  submitted_by: string
  answer_hash: string
  result: SubmissionResult
  idempotency_key: string | null
  created_at: string
}

export interface LevelSolve {
  id: string
  event_id: string
  team_id: string
  challenge_id: string
  level_id: string
  submission_id: string
  solved_at: string
}

export interface ScoreLedgerEntry {
  id: string
  event_id: string
  team_id: string
  delta_points: number
  transaction_type: ScoreTxType
  reference_id: string | null
  reason: string | null
  actor_user_id: string | null
  idempotency_key: string | null
  created_at: string
}

export interface CoinLedgerEntry {
  id: string
  event_id: string
  team_id: string
  delta_coins: number
  transaction_type: CoinTxType
  reference_id: string | null
  reason: string | null
  actor_user_id: string | null
  idempotency_key: string | null
  created_at: string
}

export interface Powerup {
  id: string
  event_id: string
  name: string
  description: string | null
  effect_type: string
  price_coins: number
  duration_seconds: number | null
  max_uses_per_team: number | null
  is_enabled: boolean
  configuration: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TeamPowerup {
  id: string
  team_id: string
  powerup_id: string
  status: PowerupStatus
  purchased_at: string
  activated_at: string | null
  expires_at: string | null
  purchase_ledger_id: string | null
}

export interface SurpriseEvent {
  id: string
  event_id: string
  title: string
  description: string | null
  event_type: string
  status: SurpriseStatus
  question_text: string | null
  question_answer: string | null
  question_answer_mode: string
  starts_at: string | null
  ends_at: string | null
  duration_seconds: number | null
  points_reward: number
  coins_reward: number
  configuration: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface BlackMarketItem {
  id: string
  event_id: string
  name: string
  description: string | null
  price_coins: number
  stock_quantity: number | null
  per_team_limit: number
  is_enabled: boolean
  available_from: string | null
  available_until: string | null
  effect_description: string | null
  created_at: string
  updated_at: string
}

export interface Purchase {
  id: string
  team_id: string
  item_id: string
  price_coins: number
  status: string
  idempotency_key: string | null
  coin_ledger_id: string | null
  created_at: string
}

export interface HintPurchase {
  id: string
  team_id: string
  level_id: string
  coin_ledger_id: string | null
  created_at: string
}

export interface AdminAuditLogEntry {
  id: string
  actor_user_id: string
  action: string
  target_type: string | null
  target_id: string | null
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// Computed types
export interface TeamScore {
  team_id: string
  event_id: string
  total_points: number
  last_score_at: string | null
}

export interface TeamBalance {
  team_id: string
  event_id: string
  coin_balance: number
  last_tx_at: string | null
}

export interface LeaderboardEntry {
  team_id: string
  team_name: string
  total_points: number
  levels_solved: number
  last_solve_at: string | null
  rank: number
}

export interface ChallengeProgress {
  challenge_id: string
  challenge_title: string
  challenge_status: ChallengeStatus
  display_order: number
  total_levels: number
  solved_levels: number
  is_complete: boolean
  id?: string
  title?: string
  category?: string | null
  description?: string | null
  progress_percentage?: number
  final_fragment?: string | null
  fragment_length?: number
  fragment_order?: number | null
}

// Action response types
export interface ActionResult<T = null> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

export interface SubmitAnswerResult {
  correct: boolean
  already_solved?: boolean
  points_earned?: number
  coins_earned?: number
  next_level_id?: string | null
  attempts_remaining?: number | null
}

export interface PurchaseResult {
  purchased: boolean
  new_balance: number
}
