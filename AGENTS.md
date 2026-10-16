<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## THE GAME — project notes for coding agents

- Adding or replacing case content (cases 2–7; two people work in parallel, each edits only their own case blocks): follow `docs/ADDING_CASES.md` (same content as `docs/THE_GAME_Adding_Cases_Guide.pdf`). Case 1 in `game/data/cases.ts` is the reference.
- Answers, hints and debriefs live ONLY in `game/data/secrets.ts` (replaced by `secrets.stub.ts` in the Supabase build). Never put them in client code, `public/`, or commit `supabase/seed/the_game_seed.sql` or any `.env` with keys.
- `npm run dev` runs in mock mode (`.env.development`); checks: `npx tsc --noEmit`, `npm run seed`, `npm run test:e2e`, `npm run test:sql` (needs local Postgres).
