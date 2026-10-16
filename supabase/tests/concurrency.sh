#!/usr/bin/env bash
# Eight simultaneous Firewall purchases (limit 3, enough coins for all): exactly 3 may succeed.
set -euo pipefail
DB=$1
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
TEAM=$($P -c "SELECT id FROM teams WHERE name = 'Bravo'")
$P -c "INSERT INTO coin_ledger (event_id, team_id, delta_coins, transaction_type, reason) VALUES (game_event(), '$TEAM', 1000, 'adjustment', 'race test')" >/dev/null
for i in $(seq 1 8); do
  $P -c "SELECT game_purchase('$TEAM', '00000000-0000-0000-0000-00000000000b', 'firewall', 'normal', 'race-$i')->>'ok'" &
done | sort | uniq -c > /tmp/race.$$ ; wait
OK=$(awk '$2 == "true" {print $1}' /tmp/race.$$); rm -f /tmp/race.$$
COUNT=$($P -c "SELECT count(*) FROM game_purchases WHERE team_id = '$TEAM' AND catalog_id = 'firewall' AND market = 'normal'")
if [ "${OK:-0}" = 3 ] && [ "$COUNT" = 3 ]; then echo "PASS  8 parallel purchases: exactly 3 sold (limit 3)"; else echo "FAIL  parallel purchases: $OK succeeded, $COUNT recorded"; exit 1; fi

# Ten simultaneous wrong answers on a level with 7 of 8 attempts used: the counter stops at 8.
LVL=$($P -c "SELECT level_id FROM game_level_row(game_event(), 1, 5)")
$P -c "INSERT INTO submissions (event_id, team_id, challenge_id, level_id, submitted_by, answer_hash, result, created_at)
  SELECT game_event(), '$TEAM', challenge_id, '$LVL', '00000000-0000-0000-0000-00000000000b', 'x', 'incorrect', now() - interval '1 minute' FROM challenge_levels, generate_series(1, 7) WHERE id = '$LVL'" >/dev/null
for i in $(seq 1 10); do
  $P -c "SELECT game_submit('$TEAM', '00000000-0000-0000-0000-00000000000b', 1, 5, 'wrong $i')" >/dev/null &
done; wait
USED=$($P -c "SELECT count(*) FROM submissions WHERE team_id = '$TEAM' AND level_id = '$LVL' AND result = 'incorrect'")
if [ "$USED" = 8 ]; then echo "PASS  10 parallel wrong answers: attempts stop at 8"; else echo "FAIL  parallel wrong answers: $USED attempts recorded"; exit 1; fi
