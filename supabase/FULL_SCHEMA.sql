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


-- ============================================================
-- THE HUNT — Row Level Security Policies
-- Migration 002: RLS Policies
-- ============================================================

-- Enable RLS on ALL tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE level_solves ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE powerups ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_powerups ENABLE ROW LEVEL SECURITY;
ALTER TABLE surprise_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE surprise_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE black_market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hint_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get current user's team_id
CREATE OR REPLACE FUNCTION get_my_team_id()
RETURNS UUID AS $$
  SELECT team_id FROM team_members
  WHERE user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PROFILES
-- ============================================================

CREATE POLICY "profiles_select_own_or_admin" ON profiles
  FOR SELECT USING (id = auth.uid() OR is_admin());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- USER ROLES
-- ============================================================

CREATE POLICY "roles_select_own_or_admin" ON user_roles
  FOR SELECT USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "roles_insert_admin" ON user_roles
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "roles_update_admin" ON user_roles
  FOR UPDATE USING (is_admin());

-- Allow self-insert on signup (default participant role)
CREATE POLICY "roles_insert_self_participant" ON user_roles
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND role = 'participant'
  );

-- ============================================================
-- TEAMS
-- ============================================================

CREATE POLICY "teams_select_own_or_admin" ON teams
  FOR SELECT USING (
    id = get_my_team_id()
    OR is_admin()
  );

-- Allow reading team by code for joining
CREATE POLICY "teams_select_by_code" ON teams
  FOR SELECT USING (true);
  -- Note: We'll restrict what columns are returned in queries, 
  -- but teams table has no secret data. Code is needed for joining.

CREATE POLICY "teams_insert_admin" ON teams
  FOR INSERT WITH CHECK (is_admin());

-- Allow team creation during registration
CREATE POLICY "teams_insert_participant" ON teams
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "teams_update_admin" ON teams
  FOR UPDATE USING (is_admin());

-- ============================================================
-- TEAM MEMBERS
-- ============================================================

CREATE POLICY "members_select_own_team_or_admin" ON team_members
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

CREATE POLICY "members_insert_self" ON team_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "members_delete_admin" ON team_members
  FOR DELETE USING (is_admin());

-- ============================================================
-- EVENTS
-- ============================================================

-- Everyone can read event status (needed for game state)
CREATE POLICY "events_select_all" ON events
  FOR SELECT USING (true);

CREATE POLICY "events_insert_admin" ON events
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "events_update_admin" ON events
  FOR UPDATE USING (is_admin());

-- ============================================================
-- CHALLENGES
-- ============================================================

-- Participants only see published challenges
CREATE POLICY "challenges_select_published" ON challenges
  FOR SELECT USING (
    status = 'published'
    OR is_admin()
  );

CREATE POLICY "challenges_insert_admin" ON challenges
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "challenges_update_admin" ON challenges
  FOR UPDATE USING (is_admin());

-- ============================================================
-- CHALLENGE LEVELS
-- ============================================================

-- CRITICAL: Participants can see published levels but NOT the answer column
-- We handle this by creating a view for participant access

-- Admin can see everything
CREATE POLICY "levels_select_admin" ON challenge_levels
  FOR SELECT USING (is_admin());

-- Participants see published levels (answer excluded via view, NOT via RLS column filtering)
-- RLS doesn't support column-level filtering, so we use a view + function
CREATE POLICY "levels_select_published" ON challenge_levels
  FOR SELECT USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_levels.challenge_id
      AND c.status = 'published'
    )
  );

CREATE POLICY "levels_insert_admin" ON challenge_levels
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "levels_update_admin" ON challenge_levels
  FOR UPDATE USING (is_admin());

-- ============================================================
-- SUBMISSIONS
-- ============================================================

-- Team sees own submissions, admin sees all
CREATE POLICY "submissions_select_own_or_admin" ON submissions
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Only via server function
CREATE POLICY "submissions_insert_authenticated" ON submissions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- LEVEL SOLVES
-- ============================================================

CREATE POLICY "solves_select_own_or_admin" ON level_solves
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Only via server function
CREATE POLICY "solves_insert_authenticated" ON level_solves
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- SCORE LEDGER
-- ============================================================

-- Team sees own scores
CREATE POLICY "score_select_own_or_admin" ON score_ledger
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- NO insert policy for participants — only server functions with service role
-- We add a policy that only allows insert via service role (no anon/authenticated)
-- Actually, we'll handle inserts ONLY through service role client

-- ============================================================
-- COIN LEDGER
-- ============================================================

CREATE POLICY "coins_select_own_or_admin" ON coin_ledger
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Inserts ONLY through service role

-- ============================================================
-- POWERUPS
-- ============================================================

-- Participants see enabled powerups
CREATE POLICY "powerups_select_enabled_or_admin" ON powerups
  FOR SELECT USING (
    is_enabled = true
    OR is_admin()
  );

CREATE POLICY "powerups_insert_admin" ON powerups
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "powerups_update_admin" ON powerups
  FOR UPDATE USING (is_admin());

-- ============================================================
-- TEAM POWERUPS
-- ============================================================

CREATE POLICY "team_powerups_select_own_or_admin" ON team_powerups
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Inserts through service role only

-- ============================================================
-- SURPRISE EVENTS
-- ============================================================

-- Participants see live/ended surprise events
CREATE POLICY "surprise_select_visible_or_admin" ON surprise_events
  FOR SELECT USING (
    status IN ('live', 'ended')
    OR is_admin()
  );

CREATE POLICY "surprise_insert_admin" ON surprise_events
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "surprise_update_admin" ON surprise_events
  FOR UPDATE USING (is_admin());

-- ============================================================
-- SURPRISE SUBMISSIONS
-- ============================================================

CREATE POLICY "surprise_subs_select_own_or_admin" ON surprise_submissions
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

CREATE POLICY "surprise_subs_insert_authenticated" ON surprise_submissions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- BLACK MARKET ITEMS
-- ============================================================

-- Participants see enabled items only when market is open
CREATE POLICY "market_items_select" ON black_market_items
  FOR SELECT USING (
    (is_enabled = true AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = black_market_items.event_id
      AND e.market_open = true
    ))
    OR is_admin()
  );

CREATE POLICY "market_items_insert_admin" ON black_market_items
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "market_items_update_admin" ON black_market_items
  FOR UPDATE USING (is_admin());

-- ============================================================
-- PURCHASES
-- ============================================================

CREATE POLICY "purchases_select_own_or_admin" ON purchases
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Inserts through service role only

-- ============================================================
-- HINT PURCHASES
-- ============================================================

CREATE POLICY "hint_purchases_select_own_or_admin" ON hint_purchases
  FOR SELECT USING (
    team_id = get_my_team_id()
    OR is_admin()
  );

-- Inserts through service role only

-- ============================================================
-- ADMIN AUDIT LOG
-- ============================================================

-- Admin only
CREATE POLICY "audit_select_admin" ON admin_audit_log
  FOR SELECT USING (is_admin());

-- Inserts through service role only

-- ============================================================
-- SAFE VIEW: Challenge levels WITHOUT answer (for participants)
-- ============================================================

CREATE VIEW public_challenge_levels AS
SELECT
  id,
  challenge_id,
  level_number,
  title,
  prompt,
  -- answer is EXCLUDED
  answer_mode,
  hint_text, -- Will only show if hint is purchased (handled in app logic)
  hint_cost,
  points_reward,
  coins_reward,
  status,
  release_at,
  deadline_at,
  max_attempts,
  attachments,
  created_at,
  updated_at
FROM challenge_levels;

-- Grant read access on the view
GRANT SELECT ON public_challenge_levels TO authenticated;


-- ============================================================
-- THE HUNT — Database Functions
-- Migration 003: Server-side functions for trusted operations
-- ============================================================

-- ============================================================
-- FUNCTION: Get team's coin balance
-- ============================================================

CREATE OR REPLACE FUNCTION get_coin_balance(p_team_id UUID, p_event_id UUID)
RETURNS INT AS $$
  SELECT COALESCE(SUM(delta_coins), 0)::INT
  FROM coin_ledger
  WHERE team_id = p_team_id AND event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Get team's score total
-- ============================================================

CREATE OR REPLACE FUNCTION get_score_total(p_team_id UUID, p_event_id UUID)
RETURNS INT AS $$
  SELECT COALESCE(SUM(delta_points), 0)::INT
  FROM score_ledger
  WHERE team_id = p_team_id AND event_id = p_event_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Check if prerequisite level is solved
-- ============================================================

CREATE OR REPLACE FUNCTION is_level_unlocked(
  p_team_id UUID,
  p_challenge_id UUID,
  p_level_number INT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Level 1 is always unlocked
  IF p_level_number <= 1 THEN
    RETURN true;
  END IF;

  -- Check if previous level is solved
  RETURN EXISTS (
    SELECT 1
    FROM level_solves ls
    JOIN challenge_levels cl ON cl.id = ls.level_id
    WHERE ls.team_id = p_team_id
    AND cl.challenge_id = p_challenge_id
    AND cl.level_number = p_level_number - 1
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Count team's attempts on a level
-- ============================================================

CREATE OR REPLACE FUNCTION get_attempt_count(p_team_id UUID, p_level_id UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::INT
  FROM submissions
  WHERE team_id = p_team_id AND level_id = p_level_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Check if team already solved a level
-- ============================================================

CREATE OR REPLACE FUNCTION is_level_solved(p_team_id UUID, p_level_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM level_solves
    WHERE team_id = p_team_id AND level_id = p_level_id
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Get time since last submission (rate limiting)
-- ============================================================

CREATE OR REPLACE FUNCTION seconds_since_last_submission(p_team_id UUID, p_level_id UUID)
RETURNS NUMERIC AS $$
  SELECT EXTRACT(EPOCH FROM (now() - MAX(created_at)))
  FROM submissions
  WHERE team_id = p_team_id AND level_id = p_level_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Get team's challenge progress
-- ============================================================

CREATE OR REPLACE FUNCTION get_team_challenge_progress(
  p_team_id UUID,
  p_event_id UUID
)
RETURNS TABLE (
  challenge_id UUID,
  challenge_title TEXT,
  challenge_status challenge_status,
  display_order INT,
  total_levels BIGINT,
  solved_levels BIGINT,
  is_complete BOOLEAN
) AS $$
  SELECT
    c.id AS challenge_id,
    c.title AS challenge_title,
    c.status AS challenge_status,
    c.display_order,
    COUNT(cl.id) AS total_levels,
    COUNT(ls.id) AS solved_levels,
    COUNT(cl.id) = COUNT(ls.id) AND COUNT(cl.id) > 0 AS is_complete
  FROM challenges c
  LEFT JOIN challenge_levels cl ON cl.challenge_id = c.id AND cl.status = 'published'
  LEFT JOIN level_solves ls ON ls.level_id = cl.id AND ls.team_id = p_team_id
  WHERE c.event_id = p_event_id
  AND c.status = 'published'
  GROUP BY c.id, c.title, c.status, c.display_order
  ORDER BY c.display_order;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Get leaderboard
-- ============================================================

CREATE OR REPLACE FUNCTION get_leaderboard(p_event_id UUID)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  total_points BIGINT,
  levels_solved BIGINT,
  last_solve_at TIMESTAMPTZ,
  rank BIGINT
) AS $$
  SELECT
    t.id AS team_id,
    t.name AS team_name,
    COALESCE(SUM(sl.delta_points), 0) AS total_points,
    COUNT(DISTINCT ls.id) AS levels_solved,
    MAX(ls.solved_at) AS last_solve_at,
    RANK() OVER (
      ORDER BY COALESCE(SUM(sl.delta_points), 0) DESC,
      MAX(ls.solved_at) ASC NULLS LAST
    ) AS rank
  FROM teams t
  LEFT JOIN score_ledger sl ON sl.team_id = t.id AND sl.event_id = p_event_id
  LEFT JOIN level_solves ls ON ls.team_id = t.id AND ls.event_id = p_event_id
  WHERE t.status = 'active'
  GROUP BY t.id, t.name
  ORDER BY total_points DESC, last_solve_at ASC NULLS LAST;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Award solve (atomic transaction)
-- Called by service role from server actions
-- ============================================================

CREATE OR REPLACE FUNCTION award_solve(
  p_event_id UUID,
  p_team_id UUID,
  p_challenge_id UUID,
  p_level_id UUID,
  p_submission_id UUID,
  p_points_reward INT,
  p_coins_reward INT,
  p_idempotency_key TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_solve_exists BOOLEAN;
BEGIN
  -- Check if already solved (idempotent)
  SELECT EXISTS (
    SELECT 1 FROM level_solves
    WHERE team_id = p_team_id AND level_id = p_level_id
  ) INTO v_solve_exists;

  IF v_solve_exists THEN
    RETURN false; -- Already solved, no double award
  END IF;

  -- Insert solve record
  INSERT INTO level_solves (event_id, team_id, challenge_id, level_id, submission_id)
  VALUES (p_event_id, p_team_id, p_challenge_id, p_level_id, p_submission_id);

  -- Award points
  IF p_points_reward > 0 THEN
    INSERT INTO score_ledger (event_id, team_id, delta_points, transaction_type, reference_id, reason, idempotency_key)
    VALUES (
      p_event_id, p_team_id, p_points_reward, 'solve',
      p_submission_id, 'Level solve reward',
      'score_solve_' || p_idempotency_key
    );
  END IF;

  -- Award coins
  IF p_coins_reward > 0 THEN
    INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reference_id, reason, idempotency_key)
    VALUES (
      p_event_id, p_team_id, p_coins_reward, 'reward',
      p_submission_id, 'Level solve coin reward',
      'coins_solve_' || p_idempotency_key
    );
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Purchase hint (atomic)
-- ============================================================

CREATE OR REPLACE FUNCTION purchase_hint(
  p_event_id UUID,
  p_team_id UUID,
  p_level_id UUID,
  p_cost INT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_balance INT;
  v_already_purchased BOOLEAN;
  v_ledger_id UUID;
BEGIN
  -- Check if already purchased
  SELECT EXISTS (
    SELECT 1 FROM hint_purchases
    WHERE team_id = p_team_id AND level_id = p_level_id
  ) INTO v_already_purchased;

  IF v_already_purchased THEN
    RETURN true; -- Already have it, idempotent
  END IF;

  -- Check balance
  SELECT COALESCE(SUM(delta_coins), 0) INTO v_balance
  FROM coin_ledger
  WHERE team_id = p_team_id AND event_id = p_event_id;

  IF v_balance < p_cost THEN
    RETURN false; -- Insufficient funds
  END IF;

  -- Debit coins
  INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reference_id, reason)
  VALUES (p_event_id, p_team_id, -p_cost, 'hint', p_level_id, 'Hint purchase')
  RETURNING id INTO v_ledger_id;

  -- Record purchase
  INSERT INTO hint_purchases (team_id, level_id, coin_ledger_id)
  VALUES (p_team_id, p_level_id, v_ledger_id);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FUNCTION: Auto-create profile + role on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'participant')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
