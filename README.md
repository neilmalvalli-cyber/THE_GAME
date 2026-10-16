# THE GAME

A 3D investigation game: six case files on a detective's desk, a Normal Market and a Black Market selling power-ups, rival sabotage, and a locked phone whose code is assembled from the solved cases. Built on the **THE HUNT** backend (Next.js 16 + Supabase).

## Layout

| Path | What it is |
| --- | --- |
| `game/` | The game client (React, three.js, GSAP, zustand). Mounted at every route by `app/[[...slug]]`. |
| `game/data/cases.ts` | **Public case content** — titles, briefings, evidence, scores, coin rewards. |
| `game/data/secrets.ts` | **Answers, Powerful Hints and the phone code.** Never shipped to browsers in Supabase builds. |
| `game/data/market.ts` | Power-up catalogue (prices, Black Market prices, limits). |
| `game/services/backend.ts` | The seam between the UI and the server (mock or Supabase). |
| `actions/game.ts` | Server actions the game calls (auth, answers, purchases, power-ups, sabotage, admin). |
| `supabase/migrations/004_the_game.sql` | Game tables + atomic SQL functions (all rules run here). |
| `actions/*.ts`, `app/(admin)/ops` | THE HUNT's original server actions and ops console (`/ops`, admins only). |

## Setting the real puzzle (the only content left to fill in)

1. **Cases** — edit `game/data/cases.ts` (titles, level titles, briefings, evidence, rewards). Evidence images go in `public/` and are listed in `evidenceAssets`.
2. **Answers, hints and the phone code** — edit `game/data/secrets.ts`. `CASE_FRAGMENT_LENGTH` in `cases.ts` says how many digits each solved case reveals; they must add up to the code's length.
3. Run `npm run seed` → writes `supabase/seed/the_game_seed.sql` (git-ignored: it contains the answers). Run it in the Supabase SQL editor. Re-running it updates content without touching team progress.

## Deploy

1. Supabase SQL editor, in order: `supabase/FULL_SCHEMA.sql`, `supabase/migrations/004_the_game.sql`, `supabase/migrations/005_minigame.sql`, then your generated `supabase/seed/the_game_seed.sql`.
2. Set `ADMIN_PASSWORD` in `.env.local` (server-only). The Admin Login asks for this password only;
   the first correct login creates the admin account in Supabase automatically.
3. Copy `.env.example` to `.env.local` (or set them in Vercel) with your project's URL and keys, `NEXT_PUBLIC_GAME_BACKEND=supabase`.
4. `npm install && npm run build && npm start` (or deploy to Vercel).

Teams register with a **team name + password** (unique, case-insensitive). The admin signs in on the same screen with the admin password and gets the Admin dashboard (`/admin`) plus THE HUNT ops console (`/ops`).

## Develop

```bash
npm install
npm run dev            # mock backend by default (.env.development) — no Supabase needed
npm run typecheck
npm run test:sql       # rule tests on any Postgres 15+ (PGHOST/PGPORT/PGUSER)
npm run test:e2e       # browser journey, mock backend (BASE_URL=http://localhost:3000)
npm run test:e2e:supabase  # browser journey against a real Supabase backend
```

## How the backend enforces the game

Every action goes through `actions/game.ts`, which finds the caller's team from the Supabase session cookie and calls one SQL function. The functions lock the team row, so double clicks and parallel requests cannot double-spend (tested with 8 simultaneous purchases). Browsers cannot call the functions directly (EXECUTE is revoked from `anon`/`authenticated`); game tables have RLS on with no policies.

- **Answers** are checked on the server (`game_submit`): normalised like the client, 1 attempt per second per level, coins and score paid once.
- **Fragments** of the phone code are returned only for cases a team has solved; the code is verified on the server.
- **Markets**: the admin switches them (`game_admin_set_market`); prices, stock limits and market state are enforced on every purchase.
- **Power-ups**: Skip Token, Master Key (once per team, unsolved cases only), Powerful Hint, Overclock (doubles the next mini-game payout via `game_minigame_reward`), Firewall, Glitch Attack and Freeze (60 s, resolved atomically; a Firewall blocks one attack).
- **Surprise mini-games**: the admin launches one from Market Operations (question, answer, coins, time limit); each team's first correct answer pays, doubled once by an armed Overclock.
- **Mail**: admin messages and sabotage notices are stored in `game_messages`; teams pick them up on their next sync (every 4 s and on focus).
