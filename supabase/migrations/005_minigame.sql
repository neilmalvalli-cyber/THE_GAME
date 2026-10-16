-- ============================================================
-- THE GAME — Migration 005: Surprise mini-games (the payout Overclock doubles)
-- Uses THE HUNT's surprise_events / surprise_submissions tables. Run after 004.
-- ============================================================

-- The live mini-game, if any (one at a time).
CREATE OR REPLACE FUNCTION game_minigame_current(p_event UUID) RETURNS surprise_events
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM surprise_events
  WHERE event_id = p_event AND status = 'live' AND configuration->>'kind' = 'game_minigame'
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY starts_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION game_minigame_launch(p_user UUID, p_question TEXT, p_answer TEXT, p_coins INT, p_minutes INT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_id UUID;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'No live event.'); END IF;
  IF coalesce(trim(p_question), '') = '' OR game_normalise(p_answer) = '' THEN RETURN jsonb_build_object('ok', false, 'message', 'Write a question and an answer.'); END IF;
  IF p_coins < 1 OR p_coins > 1000 THEN RETURN jsonb_build_object('ok', false, 'message', 'Reward must be 1–1000 coins.'); END IF;
  IF p_minutes < 1 OR p_minutes > 120 THEN RETURN jsonb_build_object('ok', false, 'message', 'Time limit must be 1–120 minutes.'); END IF;
  -- one live mini-game at a time
  UPDATE surprise_events SET status = 'ended', ends_at = least(coalesce(ends_at, now()), now())
  WHERE event_id = v_event AND status = 'live' AND configuration->>'kind' = 'game_minigame';
  INSERT INTO surprise_events (event_id, title, description, event_type, status, question_text, question_answer, question_answer_mode,
                               starts_at, ends_at, duration_seconds, coins_reward, configuration, created_by)
  VALUES (v_event, 'Surprise mini-game', NULL, 'bonus_question', 'live', trim(p_question), p_answer, 'game',
          now(), now() + make_interval(mins => p_minutes), p_minutes * 60, p_coins, '{"kind": "game_minigame"}', p_user)
  RETURNING id INTO v_id;
  INSERT INTO game_messages (event_id, to_team, to_label, sender, category, kind, subject, body)
  VALUES (v_event, NULL, 'All teams', 'THE GAME', 'warning', 'system', 'SURPRISE MINI-GAME',
          format('A surprise mini-game is live for %s minutes. First correct answer pays %s coins (double with an armed Overclock). Look for the banner.', p_minutes, p_coins));
  INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'minigame_launch', 'surprise_event', v_id, jsonb_build_object('coins', p_coins, 'minutes', p_minutes));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION game_minigame_end(p_user UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  UPDATE surprise_events SET status = 'ended', ends_at = least(coalesce(ends_at, now()), now())
  WHERE event_id = game_event() AND status = 'live' AND configuration->>'kind' = 'game_minigame';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END $$;

CREATE OR REPLACE FUNCTION game_minigame_answer(p_team UUID, p_user UUID, p_answer TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); m surprise_events; r JSONB;
BEGIN
  m := game_minigame_current(v_event);
  IF m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'The mini-game has ended.'); END IF;
  PERFORM game_lock_team(p_team);
  IF EXISTS (SELECT 1 FROM surprise_submissions WHERE team_id = p_team AND surprise_event_id = m.id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Your team already solved this one.');
  END IF;
  IF NOT game_answer_matches(p_answer, m.question_answer) THEN
    RETURN jsonb_build_object('ok', false, 'wrong', true, 'message', 'Not quite. Try again.');
  END IF;
  INSERT INTO surprise_submissions (surprise_event_id, team_id, submitted_by, answer_hash, result)
  VALUES (m.id, p_team, p_user, encode(digest(game_normalise(p_answer), 'sha256'), 'hex'), 'correct');
  r := game_minigame_reward(p_team, m.coins_reward, 'minigame_' || m.id, 'Surprise mini-game');
  RETURN jsonb_build_object('ok', true, 'coins', r->'amount',
    'message', format('Correct! +%s coins%s.', r->>'amount', CASE WHEN (r->>'amount')::int > m.coins_reward THEN ' (Overclock ×2)' ELSE '' END));
END $$;

-- What a team sees: the live mini-game (never its answer) and whether it is solved.
CREATE OR REPLACE FUNCTION game_minigame_for(p_team UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m surprise_events;
BEGIN
  m := game_minigame_current(game_event());
  IF m.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', m.id, 'question', m.question_text, 'coins', m.coins_reward,
    'endsAt', (extract(epoch FROM m.ends_at) * 1000)::bigint,
    'solved', EXISTS (SELECT 1 FROM surprise_submissions WHERE team_id = p_team AND surprise_event_id = m.id),
    'solvedBy', (SELECT count(*) FROM surprise_submissions WHERE surprise_event_id = m.id));
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'game\_minigame%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- tell the Supabase API (PostgREST) about the new functions right away
NOTIFY pgrst, 'reload schema';
