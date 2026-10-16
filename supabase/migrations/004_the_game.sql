-- ============================================================
-- THE GAME — Migration 004
-- Game rules on top of THE HUNT schema: team-name logins, the power-up catalogue,
-- inventories, skips, effects, sabotage, admin mail and market switches.
--
-- Every function below is SECURITY DEFINER and callable only by the service role:
-- the Next.js server actions resolve the caller's team from the Supabase session and
-- pass it in. Nothing here trusts a team id coming from the browser.
--
-- Mapping to THE HUNT tables:
--   case N            = challenges.display_order N of the live event
--   case fragment     = challenges.final_fragment (fragment_order = case order)
--   level N           = challenge_levels.level_number N (answer_mode 'game')
--   Powerful Hint     = challenge_levels.hint_text
--   score / coins     = score_ledger / coin_ledger (unchanged)
-- ============================================================

-- ---------------------------------------------------------------- teams
-- Team names are logins: unique regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_lower_key ON teams (lower(name));

-- ---------------------------------------------------------------- catalogue
CREATE TABLE IF NOT EXISTS game_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normal_price INT NOT NULL CHECK (normal_price >= 0),
  black_price INT NOT NULL CHECK (black_price >= 0),
  available_normal BOOLEAN NOT NULL DEFAULT true,
  available_black BOOLEAN NOT NULL DEFAULT true,
  limit_normal INT NOT NULL DEFAULT 0,
  limit_black INT NOT NULL DEFAULT 0,
  contains TEXT[] NOT NULL DEFAULT '{}',
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES game_catalog(id),
  market TEXT NOT NULL CHECK (market IN ('normal', 'black')),
  purchase_key TEXT NOT NULL,
  price INT NOT NULL,
  coin_ledger_id UUID REFERENCES coin_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, purchase_key)
);

CREATE TABLE IF NOT EXISTS game_inventory (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES game_catalog(id),
  qty INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (team_id, catalog_id)
);

-- ---------------------------------------------------------------- progress extras
CREATE TABLE IF NOT EXISTS game_level_skips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  level_id UUID NOT NULL REFERENCES challenge_levels(id),
  via TEXT NOT NULL CHECK (via IN ('skip_token', 'master_key')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, level_id)
);

CREATE TABLE IF NOT EXISTS game_team_state (
  team_id UUID PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  intro_seen BOOLEAN NOT NULL DEFAULT false,
  phone_unlocked_at TIMESTAMPTZ,
  phone_failed_attempts INT NOT NULL DEFAULT 0,
  hints_revealed UUID[] NOT NULL DEFAULT '{}',
  overclock_armed BOOLEAN NOT NULL DEFAULT false,
  master_key_case INT,
  glitch_until TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  freeze_until TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  frozen_ms BIGINT NOT NULL DEFAULT 0,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_sabotage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('glitch', 'freeze')),
  from_team UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  to_team UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('hit', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin mail and system notices. to_team NULL = every team.
CREATE TABLE IF NOT EXISTS game_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  to_team UUID REFERENCES teams(id) ON DELETE CASCADE,
  to_label TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT 'THE GAME',
  category TEXT NOT NULL DEFAULT 'general',
  kind TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  client_key TEXT UNIQUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_messages_event_idx ON game_messages (event_id, created_at);

-- Market switches history (the admin activity feed and the teams' market mail).
CREATE TABLE IF NOT EXISTS game_market_log (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('normal-closed', 'normal-reopened', 'black-activated', 'black-deactivated')),
  actor_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the service role touches these tables (all reads go through server actions).
ALTER TABLE game_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_level_skips ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_team_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sabotage ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_market_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helpers
-- ============================================================

CREATE OR REPLACE FUNCTION game_event() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM events WHERE status IN ('live', 'ready', 'paused')
  ORDER BY (status = 'live') DESC, created_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION game_key(p_case INT, p_level INT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('case-%s/level-%s', lpad(p_case::text, 2, '0'), lpad(p_level::text, 2, '0'))
$$;

-- Same normalisation as the client: uppercase letters and digits only; numbers ignore leading zeros.
CREATE OR REPLACE FUNCTION game_normalise(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g') $$;

CREATE OR REPLACE FUNCTION game_answer_matches(p_given TEXT, p_answer TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT game_normalise(p_given) <> '' AND (
    game_normalise(p_given) = game_normalise(p_answer)
    OR (game_normalise(p_answer) ~ '^[0-9]+$' AND regexp_replace(game_normalise(p_given), '^0+(?=[0-9])', '') = regexp_replace(game_normalise(p_answer), '^0+(?=[0-9])', ''))
  )
$$;

CREATE OR REPLACE FUNCTION game_level_row(p_event UUID, p_case INT, p_level INT)
RETURNS TABLE (challenge_id UUID, level_id UUID, answer TEXT, hint_text TEXT, points INT, coins INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, l.id, l.answer, l.hint_text, l.points_reward, l.coins_reward
  FROM challenges c JOIN challenge_levels l ON l.challenge_id = c.id
  WHERE c.event_id = p_event AND c.display_order = p_case AND l.level_number = p_level
    AND c.status = 'published' AND l.status = 'published'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION game_case_solved(p_team UUID, p_event UUID, p_case INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) > 0 AND bool_and(
    EXISTS (SELECT 1 FROM level_solves s WHERE s.team_id = p_team AND s.level_id = l.id)
    OR EXISTS (SELECT 1 FROM game_level_skips k WHERE k.team_id = p_team AND k.level_id = l.id))
  FROM challenges c JOIN challenge_levels l ON l.challenge_id = c.id
  WHERE c.event_id = p_event AND c.display_order = p_case AND c.status = 'published' AND l.status = 'published'
$$;

CREATE OR REPLACE FUNCTION game_ensure_state(p_team UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO game_team_state (team_id) VALUES (p_team) ON CONFLICT (team_id) DO NOTHING
$$;

-- Serialises everything a team does that touches coins or inventory.
CREATE OR REPLACE FUNCTION game_lock_team(p_team UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM teams WHERE id = p_team FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'team not found'; END IF;
  PERFORM game_ensure_state(p_team);
  UPDATE game_team_state SET last_activity = now() WHERE team_id = p_team;
END $$;

CREATE OR REPLACE FUNCTION game_take_item(p_team UUID, p_item TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE game_inventory SET qty = qty - 1 WHERE team_id = p_team AND catalog_id = p_item AND qty > 0;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION game_notify(p_event UUID, p_team UUID, p_subject TEXT, p_body TEXT, p_category TEXT DEFAULT 'warning', p_sender TEXT DEFAULT 'SYSTEM')
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO game_messages (event_id, to_team, to_label, sender, category, kind, subject, body)
  VALUES (p_event, p_team, (SELECT name FROM teams WHERE id = p_team), p_sender, p_category, 'system', p_subject, p_body)
$$;

-- ============================================================
-- Teams
-- ============================================================

-- Called right after the server action created the auth user for a new team.
CREATE OR REPLACE FUNCTION game_create_team(p_user UUID, p_name TEXT, p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team UUID; v_event UUID := game_event(); v_coins INT;
BEGIN
  INSERT INTO teams (name, team_code) VALUES (p_name, p_code) RETURNING id INTO v_team;
  INSERT INTO team_members (team_id, user_id) VALUES (v_team, p_user);
  INSERT INTO game_team_state (team_id) VALUES (v_team);
  IF v_event IS NOT NULL THEN
    SELECT starting_coins INTO v_coins FROM events WHERE id = v_event;
    IF v_coins > 0 THEN
      INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason, idempotency_key)
      VALUES (v_event, v_team, v_coins, 'starting_balance', 'Opening allocation', 'start_' || v_team);
    END IF;
  END IF;
  RETURN jsonb_build_object('team_id', v_team);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('error', 'name_taken');
END $$;

-- ============================================================
-- Levels
-- ============================================================

CREATE OR REPLACE FUNCTION game_submit(p_team UUID, p_user UUID, p_case INT, p_level INT, p_answer TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event UUID := game_event();
  r RECORD;
  v_sub UUID;
  v_correct BOOLEAN;
  v_was_solved BOOLEAN;
  v_already BOOLEAN;
  v_new BOOLEAN;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('error', 'no_event'); END IF;
  SELECT * INTO r FROM game_level_row(v_event, p_case, p_level);
  IF r.level_id IS NULL THEN RETURN jsonb_build_object('error', 'unknown_level'); END IF;
  PERFORM game_lock_team(p_team);

  -- light rate limit: one attempt per level per second
  IF EXISTS (SELECT 1 FROM submissions WHERE team_id = p_team AND level_id = r.level_id AND created_at > now() - interval '1 second') THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  v_correct := game_answer_matches(p_answer, r.answer);
  INSERT INTO submissions (event_id, team_id, challenge_id, level_id, submitted_by, answer_hash, result)
  VALUES (v_event, p_team, r.challenge_id, r.level_id, p_user, encode(digest(game_normalise(p_answer), 'sha256'), 'hex'),
          CASE WHEN v_correct THEN 'correct'::submission_result ELSE 'incorrect'::submission_result END)
  RETURNING id INTO v_sub;

  IF NOT v_correct THEN
    RETURN jsonb_build_object('correct', false, 'awarded', 0, 'scoreAwarded', 0, 'alreadyCompleted', is_level_solved(p_team, r.level_id), 'caseSolved', false);
  END IF;

  v_already := is_level_solved(p_team, r.level_id);
  v_was_solved := game_case_solved(p_team, v_event, p_case);
  v_new := award_solve(v_event, p_team, r.challenge_id, r.level_id, v_sub, r.points, r.coins, p_team || '_' || r.level_id);
  RETURN jsonb_build_object(
    'correct', true,
    'awarded', CASE WHEN v_new THEN r.coins ELSE 0 END,
    'scoreAwarded', CASE WHEN v_new THEN r.points ELSE 0 END,
    'alreadyCompleted', v_already,
    'caseSolved', v_new AND NOT v_was_solved AND game_case_solved(p_team, v_event, p_case));
END $$;

-- ============================================================
-- Market
-- ============================================================

CREATE OR REPLACE FUNCTION game_market_status(p_event UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e RECORD; v_black BOOLEAN;
BEGIN
  SELECT market_open, settings INTO e FROM events WHERE id = p_event;
  IF NOT FOUND THEN RETURN jsonb_build_object('normal', 'closed', 'black', 'locked'); END IF;
  v_black := coalesce((e.settings->>'black_market_active')::boolean, false)
    AND (e.settings->>'black_market_until' IS NULL OR (e.settings->>'black_market_until')::timestamptz > now());
  RETURN jsonb_build_object('normal', CASE WHEN e.market_open THEN 'open' ELSE 'closed' END,
                            'black', CASE WHEN v_black THEN 'active' ELSE 'locked' END);
END $$;

CREATE OR REPLACE FUNCTION game_purchase(p_team UUID, p_user UUID, p_item TEXT, p_market TEXT, p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event UUID := game_event();
  c RECORD;
  v_price INT; v_limit INT; v_bought INT; v_balance INT; v_ledger UUID; g TEXT;
  v_status JSONB;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'market-closed', 'message', 'No live event.'); END IF;
  PERFORM game_lock_team(p_team);
  IF EXISTS (SELECT 1 FROM game_purchases WHERE team_id = p_team AND purchase_key = p_key) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate', 'message', 'This purchase has already been processed.');
  END IF;
  SELECT * INTO c FROM game_catalog WHERE id = p_item;
  IF NOT FOUND OR (p_market = 'normal' AND NOT c.available_normal) OR (p_market = 'black' AND NOT c.available_black) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown-item', 'message', CASE WHEN p_market = 'normal' THEN 'That item is not sold here.' ELSE 'The dealer does not sell that.' END);
  END IF;
  v_status := game_market_status(v_event);
  IF (p_market = 'normal' AND v_status->>'normal' <> 'open') OR (p_market = 'black' AND v_status->>'black' <> 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'market-closed', 'message', CASE WHEN p_market = 'normal' THEN 'The market is closed. All transactions are suspended.' ELSE 'The Black Market is closed.' END);
  END IF;
  v_price := CASE WHEN p_market = 'normal' THEN c.normal_price ELSE c.black_price END;
  v_limit := CASE WHEN p_market = 'normal' THEN c.limit_normal ELSE c.limit_black END;
  SELECT count(*) INTO v_bought FROM game_purchases WHERE team_id = p_team AND catalog_id = p_item AND market = p_market AND event_id = v_event;
  IF v_bought >= v_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold-out', 'message', CASE WHEN p_market = 'normal' THEN 'Out of stock.' ELSE 'Sold out. The dealer has nothing more of this.' END);
  END IF;
  v_balance := get_coin_balance(p_team, v_event);
  IF v_balance < v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient-funds', 'message', format('Insufficient funds — %s coins required, %s available.', v_price, v_balance));
  END IF;

  INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason, actor_user_id, idempotency_key)
  VALUES (v_event, p_team, -v_price, 'market_purchase',
          c.name || ' purchased' || CASE WHEN p_market = 'normal' THEN ' (Market)' ELSE ' (Black Market)' END, p_user, 'buy_' || p_team || '_' || p_key)
  RETURNING id INTO v_ledger;
  INSERT INTO game_purchases (event_id, team_id, catalog_id, market, purchase_key, price, coin_ledger_id)
  VALUES (v_event, p_team, p_item, p_market, p_key, v_price, v_ledger);
  -- a bundle unpacks into its contents
  FOREACH g IN ARRAY (CASE WHEN cardinality(c.contains) > 0 THEN c.contains ELSE ARRAY[c.id] END) LOOP
    INSERT INTO game_inventory (team_id, catalog_id, qty) VALUES (p_team, g, 1)
    ON CONFLICT (team_id, catalog_id) DO UPDATE SET qty = game_inventory.qty + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'balance', v_balance - v_price);
END $$;

-- ============================================================
-- Power-ups
-- ============================================================

CREATE OR REPLACE FUNCTION game_use_skip(p_team UUID, p_case INT, p_level INT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); r RECORD; v_was BOOLEAN;
BEGIN
  SELECT * INTO r FROM game_level_row(v_event, p_case, p_level);
  IF r.level_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown level.'); END IF;
  PERFORM game_lock_team(p_team);
  IF is_level_solved(p_team, r.level_id) OR EXISTS (SELECT 1 FROM game_level_skips WHERE team_id = p_team AND level_id = r.level_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This level is already cleared.');
  END IF;
  IF NOT game_take_item(p_team, 'skip_token') THEN RETURN jsonb_build_object('ok', false, 'message', 'You have no Skip Token.'); END IF;
  v_was := game_case_solved(p_team, v_event, p_case);
  INSERT INTO game_level_skips (event_id, team_id, challenge_id, level_id, via) VALUES (v_event, p_team, r.challenge_id, r.level_id, 'skip_token');
  RETURN jsonb_build_object('ok', true, 'message', 'Level skipped. No solve points awarded.',
                            'caseSolved', NOT v_was AND game_case_solved(p_team, v_event, p_case));
END $$;

CREATE OR REPLACE FUNCTION game_use_master_key(p_team UUID, p_case INT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_challenge UUID;
BEGIN
  SELECT id INTO v_challenge FROM challenges WHERE event_id = v_event AND display_order = p_case AND status = 'published';
  IF v_challenge IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown case.'); END IF;
  PERFORM game_lock_team(p_team);
  IF (SELECT master_key_case FROM game_team_state WHERE team_id = p_team) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Your team has already used its Master Key.');
  END IF;
  IF game_case_solved(p_team, v_event, p_case) THEN RETURN jsonb_build_object('ok', false, 'message', 'That case is already completed.'); END IF;
  IF NOT game_take_item(p_team, 'master_key') THEN RETURN jsonb_build_object('ok', false, 'message', 'You have no Master Key.'); END IF;
  INSERT INTO game_level_skips (event_id, team_id, challenge_id, level_id, via)
  SELECT v_event, p_team, v_challenge, l.id, 'master_key' FROM challenge_levels l
  WHERE l.challenge_id = v_challenge AND l.status = 'published'
    AND NOT is_level_solved(p_team, l.id)
  ON CONFLICT (team_id, level_id) DO NOTHING;
  UPDATE game_team_state SET master_key_case = p_case WHERE team_id = p_team;
  RETURN jsonb_build_object('ok', true, 'caseSolved', true, 'message', format('Case %s opened. Fragment revealed.', lpad(p_case::text, 2, '0')));
END $$;

CREATE OR REPLACE FUNCTION game_use_hint(p_team UUID, p_case INT, p_level INT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); r RECORD;
BEGIN
  SELECT * INTO r FROM game_level_row(v_event, p_case, p_level);
  IF r.level_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown level.'); END IF;
  PERFORM game_lock_team(p_team);
  IF (SELECT r.level_id = ANY (hints_revealed) FROM game_team_state WHERE team_id = p_team) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The hint for this level is already revealed.');
  END IF;
  IF NOT game_take_item(p_team, 'powerful_hint') THEN RETURN jsonb_build_object('ok', false, 'message', 'You have no Powerful Hint.'); END IF;
  UPDATE game_team_state SET hints_revealed = array_append(hints_revealed, r.level_id) WHERE team_id = p_team;
  RETURN jsonb_build_object('ok', true, 'message', 'Hint revealed.', 'hint', coalesce(r.hint_text, 'Study the format of the evidence: it names the method.'));
END $$;

CREATE OR REPLACE FUNCTION game_arm_overclock(p_team UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM game_lock_team(p_team);
  IF (SELECT overclock_armed FROM game_team_state WHERE team_id = p_team) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Overclock is already armed.');
  END IF;
  IF NOT game_take_item(p_team, 'overclock') THEN RETURN jsonb_build_object('ok', false, 'message', 'You have no Overclock.'); END IF;
  UPDATE game_team_state SET overclock_armed = true WHERE team_id = p_team;
  RETURN jsonb_build_object('ok', true, 'message', 'Overclock armed for your next mini-game.');
END $$;

-- Mini-game payouts (e.g. surprise events) go through here: doubled once while Overclock is armed.
CREATE OR REPLACE FUNCTION game_minigame_reward(p_team UUID, p_amount INT, p_source TEXT, p_label TEXT DEFAULT 'Mini-game reward') RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_armed BOOLEAN; v_amount INT;
BEGIN
  PERFORM game_lock_team(p_team);
  IF EXISTS (SELECT 1 FROM coin_ledger WHERE idempotency_key = 'mg_' || p_team || '_' || p_source) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
  END IF;
  SELECT overclock_armed INTO v_armed FROM game_team_state WHERE team_id = p_team;
  v_amount := CASE WHEN v_armed THEN p_amount * 2 ELSE p_amount END;
  INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason, idempotency_key)
  VALUES (v_event, p_team, v_amount, 'surprise_reward', p_label || CASE WHEN v_armed THEN ' · Overclock ×2' ELSE '' END, 'mg_' || p_team || '_' || p_source);
  IF v_armed THEN UPDATE game_team_state SET overclock_armed = false WHERE team_id = p_team; END IF;
  RETURN jsonb_build_object('ok', true, 'amount', v_amount);
END $$;

CREATE OR REPLACE FUNCTION game_launch_sabotage(p_team UUID, p_kind TEXT, p_target UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event UUID := game_event();
  v_item TEXT := CASE p_kind WHEN 'glitch' THEN 'glitch_attack' WHEN 'freeze' THEN 'freeze' END;
  v_label TEXT := CASE p_kind WHEN 'glitch' THEN 'Glitch Attack' ELSE 'Freeze' END;
  v_from TEXT; v_to TEXT; v_blocked BOOLEAN; v_until TIMESTAMPTZ; v_cur TIMESTAMPTZ;
BEGIN
  IF v_item IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Unknown attack.'); END IF;
  IF p_target IS NULL OR p_target = p_team THEN RETURN jsonb_build_object('ok', false, 'message', 'Choose a rival team.'); END IF;
  SELECT name INTO v_to FROM teams WHERE id = p_target AND status = 'active';
  IF v_to IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Choose a rival team.'); END IF;
  SELECT name INTO v_from FROM teams WHERE id = p_team;
  -- lock both teams in a fixed order (no deadlocks between two attackers)
  IF p_team < p_target THEN PERFORM game_lock_team(p_team); PERFORM game_lock_team(p_target);
  ELSE PERFORM game_lock_team(p_target); PERFORM game_lock_team(p_team); END IF;
  IF NOT game_take_item(p_team, v_item) THEN RETURN jsonb_build_object('ok', false, 'message', format('You have no %s.', v_label)); END IF;

  v_blocked := game_take_item(p_target, 'firewall');
  IF NOT v_blocked THEN
    v_until := now() + interval '60 seconds';
    IF p_kind = 'glitch' THEN
      UPDATE game_team_state SET glitch_until = greatest(glitch_until, v_until) WHERE team_id = p_target;
    ELSE
      SELECT greatest(now(), freeze_until) INTO v_cur FROM game_team_state WHERE team_id = p_target;
      UPDATE game_team_state SET freeze_until = greatest(freeze_until, v_until),
        frozen_ms = frozen_ms + greatest(0, (extract(epoch FROM (v_until - v_cur)) * 1000)::bigint)
      WHERE team_id = p_target;
    END IF;
  END IF;
  INSERT INTO game_sabotage (event_id, kind, from_team, to_team, outcome) VALUES (v_event, p_kind, p_team, p_target, CASE WHEN v_blocked THEN 'blocked' ELSE 'hit' END);

  PERFORM game_notify(v_event, p_target,
    CASE WHEN v_blocked THEN 'Firewall blocked a ' || v_label ELSE v_label || ' hit your team' END,
    CASE WHEN v_blocked THEN format('%s launched a %s at you. Your Firewall absorbed it and is now used up.', v_from, v_label)
         WHEN p_kind = 'glitch' THEN format('%s glitched your interface for 60 seconds. You can still solve and submit normally.', v_from)
         ELSE format('%s froze your progress timer for 60 seconds. Your dashboard and clues stay usable.', v_from) END);
  PERFORM game_notify(v_event, p_team,
    CASE WHEN v_blocked THEN format('%s blocked by %s', v_label, v_to) ELSE format('%s landed on %s', v_label, v_to) END,
    CASE WHEN v_blocked THEN format('%s had a Firewall up. Your %s was absorbed.', v_to, v_label) ELSE format('Your %s hit %s for 60 seconds.', v_label, v_to) END);
  RETURN jsonb_build_object('ok', true, 'blocked', v_blocked,
    'message', CASE WHEN v_blocked THEN format('%s was blocked by %s''s Firewall.', v_label, v_to) ELSE format('%s sent to %s.', v_label, v_to) END);
END $$;

-- ============================================================
-- Phone
-- ============================================================

-- The full code is the solved fragments in case order. Only fragments a team earned are ever returned.
CREATE OR REPLACE FUNCTION game_verify_phone(p_team UUID, p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_code TEXT;
BEGIN
  PERFORM game_lock_team(p_team);
  SELECT string_agg(coalesce(final_fragment, ''), '' ORDER BY coalesce(fragment_order, display_order)) INTO v_code
  FROM challenges WHERE event_id = v_event AND status = 'published';
  IF v_code IS NULL OR v_code = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong'); END IF;
  IF char_length(coalesce(p_code, '')) <> char_length(v_code) THEN RETURN jsonb_build_object('ok', false, 'reason', 'incomplete'); END IF;
  IF p_code = v_code THEN
    UPDATE game_team_state SET phone_unlocked_at = coalesce(phone_unlocked_at, now()) WHERE team_id = p_team;
    RETURN jsonb_build_object('ok', true);
  END IF;
  UPDATE game_team_state SET phone_failed_attempts = phone_failed_attempts + 1 WHERE team_id = p_team;
  RETURN jsonb_build_object('ok', false, 'reason', 'wrong');
END $$;

-- ============================================================
-- State (what the team's browser mirrors)
-- ============================================================

CREATE OR REPLACE FUNCTION game_state(p_team UUID, p_since TIMESTAMPTZ DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); t RECORD; s RECORD;
BEGIN
  PERFORM game_ensure_state(p_team);
  SELECT id, name, created_at INTO t FROM teams WHERE id = p_team;
  SELECT * INTO s FROM game_team_state WHERE team_id = p_team;
  RETURN jsonb_build_object(
    'now', now(),
    'team', jsonb_build_object('id', t.id, 'name', t.name, 'createdAt', t.created_at),
    'balance', coalesce(get_coin_balance(p_team, v_event), 0),
    'score', coalesce(get_score_total(p_team, v_event), 0),
    'transactions', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'amount', abs(delta_coins), 'kind', CASE WHEN delta_coins >= 0 THEN 'earn' ELSE 'spend' END,
        'label', coalesce(reason, transaction_type::text), 'sourceId', coalesce(idempotency_key, id::text), 'type', transaction_type, 'at', created_at) ORDER BY created_at DESC)
      FROM (SELECT * FROM coin_ledger WHERE team_id = p_team AND event_id = v_event AND transaction_type <> 'starting_balance' ORDER BY created_at DESC LIMIT 60) x), '[]'),
    'completed', coalesce((SELECT jsonb_object_agg(game_key(c.display_order, l.level_number), ls.solved_at)
      FROM level_solves ls JOIN challenge_levels l ON l.id = ls.level_id JOIN challenges c ON c.id = l.challenge_id
      WHERE ls.team_id = p_team AND c.event_id = v_event), '{}'),
    'skipped', coalesce((SELECT jsonb_object_agg(game_key(c.display_order, l.level_number), k.created_at)
      FROM game_level_skips k JOIN challenge_levels l ON l.id = k.level_id JOIN challenges c ON c.id = l.challenge_id
      WHERE k.team_id = p_team AND c.event_id = v_event), '{}'),
    'purchases', coalesce((SELECT jsonb_object_agg(k, n) FROM (
        SELECT CASE WHEN market = 'normal' THEN 'store_' || catalog_id ELSE catalog_id END AS k, count(*) AS n
        FROM game_purchases WHERE team_id = p_team AND event_id = v_event GROUP BY 1) p), '{}'),
    'inventory', coalesce((SELECT jsonb_object_agg(catalog_id, qty) FROM game_inventory WHERE team_id = p_team AND qty > 0), '{}'),
    'hints', coalesce((SELECT jsonb_object_agg(game_key(c.display_order, l.level_number), coalesce(l.hint_text, ''))
      FROM challenge_levels l JOIN challenges c ON c.id = l.challenge_id WHERE l.id = ANY (s.hints_revealed)), '{}'),
    'fragments', coalesce((SELECT jsonb_object_agg(c.display_order::text, coalesce(c.final_fragment, ''))
      FROM challenges c WHERE c.event_id = v_event AND c.status = 'published' AND game_case_solved(p_team, v_event, c.display_order)), '{}'),
    'effects', jsonb_build_object('overclockArmed', s.overclock_armed, 'masterKeyUsedOn', s.master_key_case,
      'glitchUntil', (extract(epoch FROM s.glitch_until) * 1000)::bigint, 'freezeUntil', (extract(epoch FROM s.freeze_until) * 1000)::bigint, 'frozenMs', s.frozen_ms),
    'introSeen', s.intro_seen,
    'phone', jsonb_build_object('unlocked', s.phone_unlocked_at IS NOT NULL, 'unlockedAt', s.phone_unlocked_at, 'failedAttempts', s.phone_failed_attempts),
    'market', game_market_status(v_event),
    'marketLog', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'type', kind, 'at', created_at) ORDER BY id)
      FROM (SELECT * FROM game_market_log WHERE event_id = v_event ORDER BY id DESC LIMIT 50) m), '[]'),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'subject', subject, 'body', body, 'category', category, 'from', sender, 'at', created_at) ORDER BY created_at)
      FROM game_messages WHERE event_id = v_event AND (to_team = p_team OR (to_team IS NULL AND created_at >= t.created_at))
        AND (p_since IS NULL OR created_at > p_since)), '[]'),
    'rivals', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM teams WHERE status = 'active' AND id <> p_team), '[]')
  );
END $$;

CREATE OR REPLACE FUNCTION game_set_intro_seen(p_team UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO game_team_state (team_id, intro_seen) VALUES (p_team, true)
  ON CONFLICT (team_id) DO UPDATE SET intro_seen = true
$$;

-- ============================================================
-- Admin
-- ============================================================

CREATE OR REPLACE FUNCTION game_admin_teams() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'createdAt', t.created_at, 'status', t.status,
    'coins', coalesce(get_coin_balance(t.id, game_event()), 0),
    'lastActivity', coalesce(s.last_activity, t.created_at),
    'phoneUnlocked', s.phone_unlocked_at IS NOT NULL,
    'completed', coalesce((SELECT jsonb_object_agg(game_key(c.display_order, l.level_number), ls.solved_at)
      FROM level_solves ls JOIN challenge_levels l ON l.id = ls.level_id JOIN challenges c ON c.id = l.challenge_id
      WHERE ls.team_id = t.id AND c.event_id = game_event()), '{}'),
    'skipped', coalesce((SELECT jsonb_object_agg(game_key(c.display_order, l.level_number), k.created_at)
      FROM game_level_skips k JOIN challenge_levels l ON l.id = k.level_id JOIN challenges c ON c.id = l.challenge_id
      WHERE k.team_id = t.id AND c.event_id = game_event()), '{}'),
    'inventory', coalesce((SELECT jsonb_object_agg(catalog_id, qty) FROM game_inventory WHERE team_id = t.id AND qty > 0), '{}'),
    'fragments', coalesce((SELECT jsonb_agg(coalesce(c.final_fragment, '') ORDER BY c.display_order) FROM challenges c
      WHERE c.event_id = game_event() AND c.status = 'published' AND game_case_solved(t.id, game_event(), c.display_order)), '[]')
  ) ORDER BY t.created_at), '[]')
  FROM teams t LEFT JOIN game_team_state s ON s.team_id = t.id
$$;

CREATE OR REPLACE FUNCTION game_admin_set_market(p_user UUID, p_action TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_status JSONB; v_kind TEXT;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'No live event.'); END IF;
  PERFORM 1 FROM events WHERE id = v_event FOR UPDATE;
  v_status := game_market_status(v_event);
  IF p_action = 'shutdown' AND v_status->>'normal' = 'open' THEN
    UPDATE events SET market_open = false WHERE id = v_event; v_kind := 'normal-closed';
  ELSIF p_action = 'reopen' AND v_status->>'normal' = 'closed' THEN
    UPDATE events SET market_open = true WHERE id = v_event; v_kind := 'normal-reopened';
  ELSIF p_action = 'activate' AND v_status->>'black' = 'locked' THEN
    UPDATE events SET settings = (settings - 'black_market_until') || '{"black_market_active": true}' WHERE id = v_event; v_kind := 'black-activated';
  ELSIF p_action = 'deactivate' AND v_status->>'black' = 'active' THEN
    UPDATE events SET settings = settings || '{"black_market_active": false}' WHERE id = v_event; v_kind := 'black-deactivated';
  ELSE
    RETURN jsonb_build_object('ok', false, 'market', v_status);
  END IF;
  INSERT INTO game_market_log (event_id, kind, actor_user_id) VALUES (v_event, v_kind, p_user);
  INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (p_user, 'market_' || p_action, 'event', v_event, '{}');
  RETURN jsonb_build_object('ok', true, 'market', game_market_status(v_event));
END $$;

CREATE OR REPLACE FUNCTION game_admin_send(p_user UUID, p_key TEXT, p_to UUID[], p_subject TEXT, p_body TEXT, p_kind TEXT, p_category TEXT, p_sender TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event UUID := game_event(); v_team UUID; v_n INT := 0;
BEGIN
  IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'No live event.'); END IF;
  IF EXISTS (SELECT 1 FROM game_messages WHERE client_key = p_key OR client_key LIKE p_key || ':%') THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF p_to IS NULL OR cardinality(p_to) = 0 THEN
    INSERT INTO game_messages (event_id, to_team, to_label, sender, category, kind, subject, body, client_key, created_by)
    VALUES (v_event, NULL, 'All teams', p_sender, p_category, p_kind, p_subject, p_body, p_key, p_user);
    v_n := 1;
  ELSE
    FOREACH v_team IN ARRAY p_to LOOP
      INSERT INTO game_messages (event_id, to_team, to_label, sender, category, kind, subject, body, client_key, created_by)
      SELECT v_event, id, name, p_sender, p_category, p_kind, p_subject, p_body, p_key || ':' || id, p_user FROM teams WHERE id = v_team;
      v_n := v_n + 1;
    END LOOP;
  END IF;
  INSERT INTO admin_audit_log (actor_user_id, action, target_type, metadata)
  VALUES (p_user, 'send_mail', 'team', jsonb_build_object('subject', p_subject, 'recipients', v_n));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION game_admin_sent() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(m ORDER BY m->>'at' DESC), '[]') FROM (
    SELECT jsonb_build_object('id', split_part(client_key, ':', 1), 'subject', min(subject), 'body', min(body), 'type', min(kind),
      'at', min(created_at), 'toLabel', string_agg(to_label, ', ' ORDER BY to_label),
      'to', CASE WHEN bool_or(to_team IS NULL) THEN to_jsonb('all'::text) ELSE jsonb_agg(to_team) END) AS m
    FROM game_messages WHERE event_id = game_event() AND kind <> 'system' AND client_key IS NOT NULL
    GROUP BY split_part(client_key, ':', 1) LIMIT 300) x
$$;

-- ============================================================
-- Access: service role only
-- ============================================================
DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'game\_%' LOOP
    -- Supabase grants anon/authenticated EXECUTE on new functions by default: take it back
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- tell the Supabase API (PostgREST) about the new functions right away
NOTIFY pgrst, 'reload schema';
