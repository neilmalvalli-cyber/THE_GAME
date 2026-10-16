-- ============================================================
-- THE GAME — Migration 006: answer formats, per-level attempt limits, admin level controls
-- Run after 004 and 005. Safe to run again.
--
--   challenge_levels.answer_mode  'game' (default) | 'fields' (a|b|c, all must match) | 'witness'
--   challenge_levels.max_attempts wrong answers allowed before the level locks (NULL = unlimited)
--   challenge_levels.attachments  {"debrief": "..."} shown to a team only after it solves the level
--
-- Attempts are counted from submissions (result 'incorrect'). An admin reset marks them
-- 'invalid' (history kept). Every submission locks the team row first, so parallel
-- requests are processed one at a time and can never exceed the limit.
-- ============================================================

CREATE OR REPLACE FUNCTION game_answer_ok(p_given TEXT, p_answer TEXT, p_mode TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE g TEXT[]; e TEXT[]; i INT; a TEXT; b TEXT;
BEGIN
  IF p_mode = 'fields' THEN
    g := string_to_array(coalesce(p_given, ''), '|');
    e := string_to_array(coalesce(p_answer, ''), '|');
    IF cardinality(g) <> cardinality(e) THEN RETURN false; END IF;
    FOR i IN 1 .. cardinality(e) LOOP
      a := game_normalise(g[i]); b := game_normalise(e[i]);
      IF e[i] ~ '\d{1,2}:\d{2}' THEN a := regexp_replace(a, 'UTC$', ''); b := regexp_replace(b, 'UTC$', ''); END IF;
      IF a = '' OR a <> b THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF p_mode = 'witness' THEN
    a := regexp_replace(regexp_replace(game_normalise(p_given), '^WITNESS', ''), '^0+(?=[0-9])', '');
    b := regexp_replace(regexp_replace(game_normalise(p_answer), '^WITNESS', ''), '^0+(?=[0-9])', '');
    RETURN a <> '' AND a = b;
  END IF;
  RETURN game_answer_matches(p_given, p_answer);
END $$;

CREATE OR REPLACE FUNCTION game_level_attempts(p_team UUID, p_level UUID) RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM submissions WHERE team_id = p_team AND level_id = p_level AND result = 'incorrect'
$$;

CREATE OR REPLACE FUNCTION game_submit(p_team UUID, p_user UUID, p_case INT, p_level INT, p_answer TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event UUID := game_event();
  r RECORD; l RECORD;
  v_sub UUID; v_correct BOOLEAN; v_was_solved BOOLEAN; v_already BOOLEAN; v_new BOOLEAN; v_used INT; v_left INT;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('error', 'no_event'); END IF;
  SELECT * INTO r FROM game_level_row(v_event, p_case, p_level);
  IF r.level_id IS NULL THEN RETURN jsonb_build_object('error', 'unknown_level'); END IF;
  SELECT answer_mode, max_attempts INTO l FROM challenge_levels WHERE id = r.level_id;
  PERFORM game_lock_team(p_team);

  v_already := is_level_solved(p_team, r.level_id);
  v_used := game_level_attempts(p_team, r.level_id);
  v_left := CASE WHEN l.max_attempts IS NULL THEN NULL ELSE greatest(0, l.max_attempts - v_used) END;

  -- locked: limit reached and not solved → refuse without touching the counter
  IF NOT v_already AND l.max_attempts IS NOT NULL AND v_used >= l.max_attempts THEN
    RETURN jsonb_build_object('correct', false, 'awarded', 0, 'scoreAwarded', 0, 'alreadyCompleted', false, 'caseSolved', false, 'attemptsRemaining', 0, 'locked', true);
  END IF;
  -- light rate limit: one attempt per level per second
  IF EXISTS (SELECT 1 FROM submissions WHERE team_id = p_team AND level_id = r.level_id AND created_at > now() - interval '1 second') THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  v_correct := game_answer_ok(p_answer, r.answer, coalesce(l.answer_mode, 'game'));

  -- a solved level never consumes attempts (and pays nothing again)
  IF v_already THEN
    RETURN jsonb_build_object('correct', v_correct, 'awarded', 0, 'scoreAwarded', 0, 'alreadyCompleted', true, 'caseSolved', false, 'attemptsRemaining', v_left, 'locked', false);
  END IF;

  INSERT INTO submissions (event_id, team_id, challenge_id, level_id, submitted_by, answer_hash, result)
  VALUES (v_event, p_team, r.challenge_id, r.level_id, p_user, encode(digest(game_normalise(p_answer), 'sha256'), 'hex'),
          CASE WHEN v_correct THEN 'correct'::submission_result ELSE 'incorrect'::submission_result END)
  RETURNING id INTO v_sub;

  IF NOT v_correct THEN
    v_left := CASE WHEN l.max_attempts IS NULL THEN NULL ELSE greatest(0, l.max_attempts - v_used - 1) END;
    RETURN jsonb_build_object('correct', false, 'awarded', 0, 'scoreAwarded', 0, 'alreadyCompleted', false, 'caseSolved', false,
                              'attemptsRemaining', v_left, 'locked', v_left = 0);
  END IF;

  v_was_solved := game_case_solved(p_team, v_event, p_case);
  v_new := award_solve(v_event, p_team, r.challenge_id, r.level_id, v_sub, r.points, r.coins, p_team || '_' || r.level_id);
  RETURN jsonb_build_object(
    'correct', true,
    'awarded', CASE WHEN v_new THEN r.coins ELSE 0 END,
    'scoreAwarded', CASE WHEN v_new THEN r.points ELSE 0 END,
    'alreadyCompleted', false,
    'caseSolved', v_new AND NOT v_was_solved AND game_case_solved(p_team, v_event, p_case),
    'attemptsRemaining', v_left, 'locked', false);
END $$;

-- What a team sees per level: wrong attempts used, the limit, and (once solved) the debrief.
CREATE OR REPLACE FUNCTION game_case_progress(p_team UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(game_key(c.display_order, l.level_number), jsonb_strip_nulls(jsonb_build_object(
    'used', game_level_attempts(p_team, l.id),
    'max', l.max_attempts,
    'debrief', CASE WHEN is_level_solved(p_team, l.id) THEN l.attachments->>'debrief' END))), '{}')
  FROM challenges c JOIN challenge_levels l ON l.challenge_id = c.id
  WHERE c.event_id = game_event() AND c.status = 'published' AND l.status = 'published'
    AND (l.max_attempts IS NOT NULL OR l.attachments ? 'debrief' OR game_level_attempts(p_team, l.id) > 0)
$$;

-- Admin: attempts used per team and level (levels with a limit).
CREATE OR REPLACE FUNCTION game_admin_attempts() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_object_agg(team_id, levels), '{}') FROM (
    SELECT s.team_id, jsonb_object_agg(game_key(c.display_order, l.level_number), s.n) AS levels
    FROM (SELECT team_id, level_id, count(*)::int AS n FROM submissions WHERE result = 'incorrect' GROUP BY 1, 2) s
    JOIN challenge_levels l ON l.id = s.level_id JOIN challenges c ON c.id = l.challenge_id
    WHERE c.event_id = game_event()
    GROUP BY s.team_id) x
$$;

-- Admin: reset a level's attempts, mark it completed, or reopen it.
CREATE OR REPLACE FUNCTION game_admin_level(p_user UUID, p_team UUID, p_case INT, p_level INT, p_action TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); r RECORD; v_sub UUID; v_n INT := 0;
BEGIN
  SELECT * INTO r FROM game_level_row(v_event, p_case, p_level);
  IF r.level_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown level.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team) THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown team.'); END IF;
  PERFORM game_lock_team(p_team);

  IF p_action = 'reset' THEN
    UPDATE submissions SET result = 'invalid' WHERE team_id = p_team AND level_id = r.level_id AND result = 'incorrect';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_action = 'complete' THEN
    IF is_level_solved(p_team, r.level_id) THEN RETURN jsonb_build_object('ok', false, 'message', 'Already completed.'); END IF;
    INSERT INTO submissions (event_id, team_id, challenge_id, level_id, submitted_by, answer_hash, result)
    VALUES (v_event, p_team, r.challenge_id, r.level_id, p_user, 'admin', 'correct') RETURNING id INTO v_sub;
    PERFORM award_solve(v_event, p_team, r.challenge_id, r.level_id, v_sub, r.points, r.coins, p_team || '_' || r.level_id || '_admin_' || v_sub);
    v_n := 1;
  ELSIF p_action = 'reopen' THEN
    IF is_level_solved(p_team, r.level_id) THEN
      DELETE FROM level_solves WHERE team_id = p_team AND level_id = r.level_id;
      -- take back what the solve paid
      INSERT INTO score_ledger (event_id, team_id, delta_points, transaction_type, reason, actor_user_id)
      VALUES (v_event, p_team, -r.points, 'adjustment', format('Level reopened by admin (case %s, level %s)', p_case, p_level), p_user);
      INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason, actor_user_id)
      VALUES (v_event, p_team, -r.coins, 'adjustment', format('Level reopened by admin (case %s, level %s)', p_case, p_level), p_user);
      v_n := 1;
    END IF;
    DELETE FROM game_level_skips WHERE team_id = p_team AND level_id = r.level_id;
    UPDATE submissions SET result = 'invalid' WHERE team_id = p_team AND level_id = r.level_id AND result = 'incorrect';
  ELSE
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown action.');
  END IF;

  INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'level_' || p_action, 'team', p_team, jsonb_build_object('case', p_case, 'level', p_level, 'rows', v_n));
  RETURN jsonb_build_object('ok', true);
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('game_answer_ok', 'game_level_attempts', 'game_submit', 'game_case_progress', 'game_admin_attempts', 'game_admin_level') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- tell the Supabase API (PostgREST) about the new functions right away
NOTIFY pgrst, 'reload schema';
