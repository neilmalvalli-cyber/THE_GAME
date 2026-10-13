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
