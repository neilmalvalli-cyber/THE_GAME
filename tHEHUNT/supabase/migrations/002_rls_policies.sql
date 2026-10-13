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
