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
