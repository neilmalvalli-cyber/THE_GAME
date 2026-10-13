-- ============================================================
-- THE HUNT — Database Schema
-- Migration 001: Initial Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "moddatetime";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('participant', 'admin', 'observer');
CREATE TYPE team_status AS ENUM ('active', 'disqualified', 'archived');
CREATE TYPE event_status AS ENUM ('draft', 'ready', 'live', 'paused', 'ended');
CREATE TYPE challenge_status AS ENUM ('draft', 'published', 'paused', 'archived');
CREATE TYPE level_status AS ENUM ('draft', 'published', 'paused');
CREATE TYPE submission_result AS ENUM ('correct', 'incorrect', 'rate_limited', 'invalid');
CREATE TYPE score_tx_type AS ENUM ('solve', 'bonus', 'adjustment', 'penalty', 'surprise_reward');
CREATE TYPE coin_tx_type AS ENUM ('starting_balance', 'reward', 'purchase', 'hint', 'adjustment', 'refund', 'penalty', 'surprise_reward', 'market_purchase');
CREATE TYPE powerup_status AS ENUM ('available', 'active', 'consumed', 'expired');
CREATE TYPE surprise_status AS ENUM ('draft', 'scheduled', 'live', 'ended', 'cancelled');

-- ============================================================
-- 1. PROFILES
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 2. USER ROLES
-- ============================================================

CREATE TABLE user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'participant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER user_roles_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 3. TEAMS
-- ============================================================

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  team_code TEXT NOT NULL UNIQUE,
  status team_status NOT NULL DEFAULT 'active',
  max_members INT NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_status ON teams(status);
CREATE INDEX idx_teams_team_code ON teams(team_code);

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 4. TEAM MEMBERS
-- ============================================================

CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id),
  UNIQUE(user_id) -- One team per user
);

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);

-- ============================================================
-- 5. EVENTS
-- ============================================================

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status event_status NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  starting_coins INT NOT NULL DEFAULT 100,
  market_open BOOLEAN NOT NULL DEFAULT false,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 6. CHALLENGES
-- ============================================================

CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  display_order INT NOT NULL DEFAULT 0,
  status challenge_status NOT NULL DEFAULT 'draft',
  -- Fragment: the 2-digit piece revealed on challenge completion
  final_fragment TEXT,
  fragment_order INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_challenges_event ON challenges(event_id);
CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_order ON challenges(event_id, display_order);

CREATE TRIGGER challenges_updated_at
  BEFORE UPDATE ON challenges
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 7. CHALLENGE LEVELS
-- ============================================================

CREATE TABLE challenge_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  level_number INT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  -- Answer: ONLY accessible via service role / server functions
  answer TEXT NOT NULL,
  -- Normalisation: 'exact', 'case_insensitive', 'trimmed_case_insensitive'
  answer_mode TEXT NOT NULL DEFAULT 'trimmed_case_insensitive',
  hint_text TEXT,
  hint_cost INT NOT NULL DEFAULT 0,
  points_reward INT NOT NULL DEFAULT 100,
  coins_reward INT NOT NULL DEFAULT 10,
  status level_status NOT NULL DEFAULT 'draft',
  release_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  max_attempts INT, -- NULL = unlimited
  -- Optional: attached files, links, location hints
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(challenge_id, level_number)
);

CREATE INDEX idx_levels_challenge ON challenge_levels(challenge_id);
CREATE INDEX idx_levels_status ON challenge_levels(status);

CREATE TRIGGER challenge_levels_updated_at
  BEFORE UPDATE ON challenge_levels
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 8. SUBMISSIONS
-- ============================================================

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  level_id UUID NOT NULL REFERENCES challenge_levels(id),
  submitted_by UUID NOT NULL REFERENCES auth.users(id),
  -- Store a fingerprint, not the raw answer (for auditing)
  answer_hash TEXT NOT NULL,
  result submission_result NOT NULL,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_submissions_team ON submissions(team_id);
CREATE INDEX idx_submissions_level ON submissions(level_id);
CREATE INDEX idx_submissions_team_level ON submissions(team_id, level_id);
CREATE INDEX idx_submissions_created ON submissions(created_at DESC);
CREATE UNIQUE INDEX idx_submissions_idempotency ON submissions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 9. LEVEL SOLVES
-- ============================================================

CREATE TABLE level_solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  level_id UUID NOT NULL REFERENCES challenge_levels(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, level_id) -- Cannot solve same level twice
);

CREATE INDEX idx_solves_team ON level_solves(team_id);
CREATE INDEX idx_solves_challenge ON level_solves(challenge_id);
CREATE INDEX idx_solves_team_challenge ON level_solves(team_id, challenge_id);

-- ============================================================
-- 10. SCORE LEDGER (append-only)
-- ============================================================

CREATE TABLE score_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  delta_points INT NOT NULL,
  transaction_type score_tx_type NOT NULL,
  reference_id UUID, -- Links to solve, surprise event, etc.
  reason TEXT,
  actor_user_id UUID REFERENCES auth.users(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_score_team ON score_ledger(team_id);
CREATE INDEX idx_score_event_team ON score_ledger(event_id, team_id);
CREATE UNIQUE INDEX idx_score_idempotency ON score_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 11. COIN LEDGER (append-only)
-- ============================================================

CREATE TABLE coin_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  delta_coins INT NOT NULL,
  transaction_type coin_tx_type NOT NULL,
  reference_id UUID,
  reason TEXT,
  actor_user_id UUID REFERENCES auth.users(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_coins_team ON coin_ledger(team_id);
CREATE INDEX idx_coins_event_team ON coin_ledger(event_id, team_id);
CREATE UNIQUE INDEX idx_coins_idempotency ON coin_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 12. POWERUPS
-- ============================================================

CREATE TABLE powerups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  description TEXT,
  effect_type TEXT NOT NULL, -- 'extra_hint', 'time_freeze', 'double_coins', etc.
  price_coins INT NOT NULL DEFAULT 0,
  duration_seconds INT, -- NULL = instant/permanent
  max_uses_per_team INT, -- NULL = unlimited
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  configuration JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_powerups_event ON powerups(event_id);

CREATE TRIGGER powerups_updated_at
  BEFORE UPDATE ON powerups
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 13. TEAM POWERUPS (inventory)
-- ============================================================

CREATE TABLE team_powerups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  powerup_id UUID NOT NULL REFERENCES powerups(id),
  status powerup_status NOT NULL DEFAULT 'available',
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  purchase_ledger_id UUID REFERENCES coin_ledger(id)
);

CREATE INDEX idx_team_powerups_team ON team_powerups(team_id);
CREATE INDEX idx_team_powerups_status ON team_powerups(team_id, status);

-- ============================================================
-- 14. SURPRISE EVENTS
-- ============================================================

CREATE TABLE surprise_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'bonus_question', -- 'bonus_question', 'timed_task', 'market_flash'
  status surprise_status NOT NULL DEFAULT 'draft',
  -- For bonus questions
  question_text TEXT,
  question_answer TEXT,
  question_answer_mode TEXT NOT NULL DEFAULT 'trimmed_case_insensitive',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  duration_seconds INT,
  points_reward INT NOT NULL DEFAULT 0,
  coins_reward INT NOT NULL DEFAULT 0,
  configuration JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_surprise_event ON surprise_events(event_id);
CREATE INDEX idx_surprise_status ON surprise_events(status);

CREATE TRIGGER surprise_events_updated_at
  BEFORE UPDATE ON surprise_events
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 15. SURPRISE EVENT SUBMISSIONS
-- ============================================================

CREATE TABLE surprise_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surprise_event_id UUID NOT NULL REFERENCES surprise_events(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  submitted_by UUID NOT NULL REFERENCES auth.users(id),
  answer_hash TEXT NOT NULL,
  result submission_result NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, surprise_event_id) -- One solve per team per surprise event
);

-- ============================================================
-- 16. BLACK MARKET ITEMS
-- ============================================================

CREATE TABLE black_market_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  description TEXT,
  price_coins INT NOT NULL,
  stock_quantity INT, -- NULL = unlimited
  per_team_limit INT NOT NULL DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  effect_description TEXT, -- What the buyer gets
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_market_items_event ON black_market_items(event_id);

CREATE TRIGGER black_market_items_updated_at
  BEFORE UPDATE ON black_market_items
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ============================================================
-- 17. PURCHASES (Black Market)
-- ============================================================

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  item_id UUID NOT NULL REFERENCES black_market_items(id),
  price_coins INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  idempotency_key TEXT UNIQUE,
  coin_ledger_id UUID REFERENCES coin_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_team ON purchases(team_id);
CREATE INDEX idx_purchases_item ON purchases(item_id);
CREATE INDEX idx_purchases_team_item ON purchases(team_id, item_id);

-- ============================================================
-- 18. HINT PURCHASES (track which hints were bought)
-- ============================================================

CREATE TABLE hint_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  level_id UUID NOT NULL REFERENCES challenge_levels(id),
  coin_ledger_id UUID REFERENCES coin_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, level_id) -- Can only buy hint once per level
);

-- ============================================================
-- 19. ADMIN AUDIT LOG (append-only)
-- ============================================================

CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT, -- 'team', 'challenge', 'event', 'surprise_event', etc.
  target_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor ON admin_audit_log(actor_user_id);
CREATE INDEX idx_audit_action ON admin_audit_log(action);
CREATE INDEX idx_audit_created ON admin_audit_log(created_at DESC);

-- ============================================================
-- VIEWS: Computed balances
-- ============================================================

-- Team score totals
CREATE VIEW team_scores AS
SELECT
  team_id,
  event_id,
  COALESCE(SUM(delta_points), 0) AS total_points,
  MAX(created_at) AS last_score_at
FROM score_ledger
GROUP BY team_id, event_id;

-- Team coin balances
CREATE VIEW team_balances AS
SELECT
  team_id,
  event_id,
  COALESCE(SUM(delta_coins), 0) AS coin_balance,
  MAX(created_at) AS last_tx_at
FROM coin_ledger
GROUP BY team_id, event_id;

-- Leaderboard view
CREATE VIEW leaderboard AS
SELECT
  t.id AS team_id,
  t.name AS team_name,
  t.status,
  ts.event_id,
  COALESCE(ts.total_points, 0) AS total_points,
  ts.last_score_at,
  (SELECT COUNT(*) FROM level_solves ls WHERE ls.team_id = t.id) AS levels_solved,
  RANK() OVER (
    PARTITION BY ts.event_id
    ORDER BY COALESCE(ts.total_points, 0) DESC, ts.last_score_at ASC
  ) AS rank
FROM teams t
LEFT JOIN team_scores ts ON t.id = ts.team_id
WHERE t.status = 'active';
