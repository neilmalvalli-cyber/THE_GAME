-- Rule tests for migration 004. Run with supabase/tests/run.sh (plain Postgres 15+).
-- Each block raises an exception on the first broken rule.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.ok(cond BOOLEAN, what TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; RAISE NOTICE 'PASS  %', what; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ans(p_case INT, p_level INT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT answer FROM game_level_row(game_event(), p_case, p_level) $$;

-- two teams, A and B
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000000a', 'a@test'), ('00000000-0000-0000-0000-00000000000b', 'b@test'), ('00000000-0000-0000-0000-00000000000c', 'c@test');
CREATE TEMP TABLE t AS SELECT
  (game_create_team('00000000-0000-0000-0000-00000000000a', 'Alpha Crew', 'AAAAAA')->>'team_id')::uuid AS a,
  (game_create_team('00000000-0000-0000-0000-00000000000b', 'Bravo', 'BBBBBB')->>'team_id')::uuid AS b;
SELECT pg_temp.ok(game_create_team('00000000-0000-0000-0000-00000000000c', 'ALPHA CREW', 'CCCCCC')->>'error' = 'name_taken', 'team names are unique regardless of case');
SELECT pg_temp.ok((SELECT get_coin_balance(a, game_event()) = 100 AND get_coin_balance(b, game_event()) = 100 FROM t), 'new teams start with 100 coins');

-- answers
SELECT pg_temp.ok((SELECT game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 1, 'nope')->>'correct' FROM t) = 'false', 'wrong answer rejected');
SELECT pg_temp.ok((SELECT (game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 2, ' ' || lower(pg_temp.ans(1, 2)) || '! ')->>'awarded')::int FROM t) > 0, 'correct answer (any case/spacing/punctuation) pays coins');
SELECT pg_temp.ok((SELECT get_score_total(a, game_event()) FROM t) = 150, 'score from the level''s points');
SELECT pg_temp.ok((SELECT game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 2, pg_temp.ans(1, 2)) FROM t)->>'error' = 'rate_limited', 'rapid repeat is rate limited');
UPDATE submissions SET created_at = created_at - interval '5 seconds';
SELECT pg_temp.ok((SELECT (r->>'awarded')::int = 0 AND (r->>'alreadyCompleted')::boolean FROM t, game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 2, pg_temp.ans(1, 2)) r), 'a level pays once');

-- markets
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'firewall', 'black', 'k0') FROM t)->>'reason' = 'market-closed', 'Black Market locked: no sale');
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'master_key', 'normal', 'k1') FROM t)->>'reason' = 'unknown-item', 'Master Key is not sold in the Normal Market');
SELECT pg_temp.ok((SELECT (game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'skip_token', 'normal', 'k2')->>'balance')::int FROM t) = 100 + 100 - 60, 'Normal Market charges the list price');
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'skip_token', 'normal', 'k2') FROM t)->>'reason' = 'duplicate', 'one purchase id charges once');
SELECT pg_temp.ok((SELECT game_purchase(b, '00000000-0000-0000-0000-00000000000b', 'skip_token', 'normal', 'k3')->>'ok' FROM t) = 'true', 'second team buys');
SELECT pg_temp.ok((SELECT game_purchase(b, '00000000-0000-0000-0000-00000000000b', 'skip_token', 'normal', 'k4') FROM t)->>'reason' = 'insufficient-funds', 'overdraft refused');
SELECT pg_temp.ok((game_admin_set_market('00000000-0000-0000-0000-00000000000a', 'activate')->>'ok')::boolean, 'admin activates the Black Market');
SELECT pg_temp.ok((game_admin_set_market('00000000-0000-0000-0000-00000000000a', 'activate')->>'ok')::boolean = false, 'activating twice changes nothing');
INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason) SELECT game_event(), a, 1000, 'adjustment', 'test' FROM t;
SELECT pg_temp.ok((SELECT b0 - (game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'firewall', 'black', 'k5')->>'balance')::int FROM t, get_coin_balance(a, game_event()) b0) = 22, 'Black Market discount price');
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'blackout_bundle', 'black', 'k6')->>'ok' FROM t) = 'true', 'bundle sold');
SELECT pg_temp.ok((SELECT qty FROM game_inventory, t WHERE team_id = a AND catalog_id = 'glitch_attack') = 1
  AND (SELECT qty FROM game_inventory, t WHERE team_id = a AND catalog_id = 'firewall') = 2, 'bundle unpacks into a Glitch Attack and a Firewall');
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'blackout_bundle', 'black', 'k7') FROM t)->>'reason' = 'sold-out', 'per-team limit');
SELECT pg_temp.ok((game_admin_set_market('00000000-0000-0000-0000-00000000000a', 'shutdown')->>'ok')::boolean, 'admin shuts the Normal Market');
SELECT pg_temp.ok((SELECT game_purchase(a, '00000000-0000-0000-0000-00000000000a', 'overclock', 'normal', 'k8') FROM t)->>'reason' = 'market-closed', 'Normal Market shut down: no sale');
SELECT game_admin_set_market('00000000-0000-0000-0000-00000000000a', 'reopen');

-- skip token: no score, counts toward the case
SELECT pg_temp.ok((SELECT game_use_skip(a, 1, 2) FROM t)->>'message' = 'This level is already cleared.', 'cannot skip a solved level');
CREATE TEMP TABLE s1 AS SELECT get_score_total(a, game_event()) AS v FROM t;
SELECT pg_temp.ok((SELECT (game_use_skip(a, 1, 1)->>'ok')::boolean FROM t), 'Skip Token used');
SELECT pg_temp.ok((SELECT get_score_total(a, game_event()) FROM t) = (SELECT v FROM s1) AND (SELECT game_state(a)->'skipped' ? 'case-01/level-01' FROM t), 'Skip Token: level cleared, no score');
SELECT pg_temp.ok((SELECT game_use_skip(a, 1, 3) FROM t)->>'message' = 'You have no Skip Token.', 'Skip Token is consumed');
UPDATE submissions SET created_at = created_at - interval '5 seconds';
SELECT game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 3, pg_temp.ans(1, 3)) FROM t;
SELECT pg_temp.ok((SELECT (game_submit(a, '00000000-0000-0000-0000-00000000000a', 1, 4, pg_temp.ans(1, 4))->>'caseSolved')::boolean FROM t), 'last level solves the case (skips count)');
SELECT pg_temp.ok((SELECT game_state(a)->'fragments' ? '1' AND NOT (game_state(a)->'fragments' ? '2') FROM t), 'state carries only earned fragments');

-- master key
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT a, 'master_key', 2 FROM t;
SELECT pg_temp.ok((SELECT game_use_master_key(a, 1) FROM t)->>'message' = 'That case is already completed.', 'Master Key refuses a completed case');
DELETE FROM s1; INSERT INTO s1 SELECT get_score_total(a, game_event()) FROM t;
SELECT pg_temp.ok((SELECT (game_use_master_key(a, 2)->>'ok')::boolean FROM t), 'Master Key used');
SELECT pg_temp.ok((SELECT get_score_total(a, game_event()) FROM t) = (SELECT v FROM s1) AND (SELECT game_case_solved(a, game_event(), 2) FROM t), 'Master Key completes a case without score');
SELECT pg_temp.ok((SELECT game_use_master_key(a, 3) FROM t)->>'message' = 'Your team has already used its Master Key.', 'Master Key: once per team');

-- powerful hint
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT a, 'powerful_hint', 1 FROM t;
SELECT pg_temp.ok((SELECT length(game_use_hint(a, 3, 1)->>'hint') FROM t) > 10, 'Powerful Hint returns the level''s hint');
SELECT pg_temp.ok((SELECT game_state(a)->'hints' ? 'case-03/level-01' FROM t), 'revealed hint stays in the team state');
SELECT pg_temp.ok((SELECT game_use_hint(a, 3, 1) FROM t)->>'message' = 'The hint for this level is already revealed.', 'a hint is revealed once');

-- overclock
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT a, 'overclock', 1 FROM t;
SELECT game_arm_overclock(a) FROM t;
SELECT pg_temp.ok((SELECT (game_minigame_reward(a, 20, 'mg1')->>'amount')::int FROM t) = 40, 'Overclock doubles the next mini-game');
SELECT pg_temp.ok((SELECT (game_minigame_reward(a, 20, 'mg2')->>'amount')::int FROM t) = 20, 'Overclock is spent after one mini-game');

-- sabotage
SELECT pg_temp.ok((SELECT game_launch_sabotage(a, 'glitch', a) FROM t)->>'message' = 'Choose a rival team.', 'cannot attack yourself');
SELECT pg_temp.ok((SELECT (game_launch_sabotage(a, 'glitch', b)->>'blocked')::boolean = false FROM t), 'Glitch Attack launched');
SELECT pg_temp.ok((SELECT glitch_until > now() + interval '50 seconds' FROM game_team_state, t WHERE team_id = b), 'Glitch Attack lands for 60 s');
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT b, 'firewall', 1 FROM t ON CONFLICT (team_id, catalog_id) DO UPDATE SET qty = 1;
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT a, 'freeze', 2 FROM t;
SELECT pg_temp.ok((SELECT (game_launch_sabotage(a, 'freeze', b)->>'blocked')::boolean FROM t), 'Freeze meets a Firewall');
SELECT pg_temp.ok((SELECT qty FROM game_inventory, t WHERE team_id = b AND catalog_id = 'firewall') = 0
  AND (SELECT freeze_until < now() FROM game_team_state, t WHERE team_id = b), 'Firewall blocks the attack and is used up');
SELECT pg_temp.ok((SELECT (game_launch_sabotage(a, 'freeze', b)->>'blocked')::boolean = false FROM t), 'Freeze lands without a Firewall');
SELECT pg_temp.ok((SELECT frozen_ms BETWEEN 59000 AND 61000 FROM game_team_state, t WHERE team_id = b), 'Freeze records 60 s of frozen time');
SELECT pg_temp.ok((SELECT count(*) FROM game_messages, t WHERE to_team = b AND kind = 'system') = 3
  AND (SELECT count(*) FROM t, jsonb_array_elements(game_state(t.b)->'messages')) >= 3, 'both teams are told; the target sees it in its state');

-- phone
SELECT pg_temp.ok((SELECT game_verify_phone(a, '1') FROM t)->>'reason' = 'incomplete'
  AND (SELECT game_verify_phone(a, repeat('1', (SELECT length(string_agg(final_fragment, '')) FROM challenges WHERE event_id = game_event()))) FROM t)->>'reason' = 'wrong', 'wrong / short codes refused');
SELECT pg_temp.ok((SELECT (game_verify_phone(a, (SELECT string_agg(final_fragment, '' ORDER BY fragment_order) FROM challenges WHERE event_id = game_event()))->>'ok')::boolean FROM t), 'the right code is accepted');
SELECT pg_temp.ok((SELECT (game_state(a)->'phone'->>'unlocked')::boolean FROM t), 'the right code unlocks the phone');

-- admin views + mail
SELECT pg_temp.ok(jsonb_array_length(game_admin_teams()) = 2, 'admin sees every team');
SELECT game_admin_send('00000000-0000-0000-0000-00000000000a', 'adm-1', NULL, 'Hello', 'Body', 'general', 'general', 'THE GAME');
SELECT game_admin_send('00000000-0000-0000-0000-00000000000a', 'adm-1', NULL, 'Hello', 'Body', 'general', 'general', 'THE GAME');
SELECT game_admin_send('00000000-0000-0000-0000-00000000000a', 'adm-2', (SELECT ARRAY[b] FROM t), 'Just B', 'Body', 'warning', 'warning', 'THE GAME');
SELECT pg_temp.ok(jsonb_array_length(game_admin_sent()) = 2, 'admin mail: one message per draft id');
SELECT pg_temp.ok((SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(game_state(a)->'messages') m WHERE m->>'subject' = 'Just B')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(game_state(b)->'messages') m WHERE m->>'subject' = 'Just B') FROM t), 'targeted mail reaches only its team');

-- access
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'game_purchase(uuid, uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'game_state(uuid, timestamptz)', 'EXECUTE'), 'browsers cannot call game functions directly');

-- surprise mini-game (005)
SELECT pg_temp.ok((game_minigame_launch('00000000-0000-0000-0000-00000000000a', 'Six times seven?', '42', 20, 5)->>'ok')::boolean, 'admin launches a mini-game');
SELECT pg_temp.ok((SELECT game_minigame_for(a) ? 'question' AND NOT (game_minigame_for(a) ? 'answer') FROM t), 'teams see the question, never the answer');
SELECT pg_temp.ok((SELECT game_minigame_answer(a, '00000000-0000-0000-0000-00000000000a', '41')->>'wrong' FROM t) = 'true', 'mini-game: wrong answer refused');
INSERT INTO game_inventory (team_id, catalog_id, qty) SELECT a, 'overclock', 1 FROM t ON CONFLICT (team_id, catalog_id) DO UPDATE SET qty = game_inventory.qty + 1;
SELECT game_arm_overclock(a) FROM t;
SELECT pg_temp.ok((SELECT (game_minigame_answer(a, '00000000-0000-0000-0000-00000000000a', '42')->>'coins')::int FROM t) = 40, 'mini-game pays double with Overclock armed');
SELECT pg_temp.ok((SELECT (game_minigame_answer(b, '00000000-0000-0000-0000-00000000000b', '42')->>'coins')::int FROM t) = 20, 'mini-game pays normally without Overclock');
SELECT pg_temp.ok((SELECT game_minigame_answer(a, '00000000-0000-0000-0000-00000000000a', '42')->>'ok' FROM t) = 'false', 'one payout per team');
SELECT game_minigame_end('00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok((SELECT game_minigame_for(a) IS NULL FROM t), 'ended mini-game disappears');
