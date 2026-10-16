#!/usr/bin/env bash
# Rebuilds a scratch database and runs the game rule tests.
#   PGHOST/PGPORT/PGUSER select the server (any Postgres 15+); the database "thegame_test" is recreated.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=thegame_test
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$P -d $DB -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null
$P -d $DB -f supabase/tests/supabase_stub.sql >/dev/null
$P -d $DB -f supabase/FULL_SCHEMA.sql >/dev/null 2>&1
$P -d $DB -f supabase/migrations/004_the_game.sql >/dev/null
$P -d $DB -f supabase/migrations/005_minigame.sql >/dev/null
node --no-warnings scripts/generate-seed.mjs >/dev/null
$P -d $DB -f supabase/seed/the_game_seed.sql >/dev/null
$P -d $DB -f supabase/tests/game_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
bash supabase/tests/concurrency.sh "$DB"
