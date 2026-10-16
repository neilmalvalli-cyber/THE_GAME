---
title: "THE GAME — Adding Cases 2 to 5"
subtitle: "Implementation guide for a coding agent (Codex)"
---

# 1. What this document is

This guide is for a coding agent working in the **THE_GAME** repository (`https://github.com/neilmalvalli-cyber/THE_GAME`, branch `main`). It explains how to add four new investigation cases to the game. **Case 1 ("The Fractured Truth") is already finished. Use it as the reference implementation.**

**Where the four cases go.** The 3D desk is built for exactly **six case folders**. Cases 2–6 currently hold placeholder content (Morse code, Caesar cipher and similar). Each of the four new cases **replaces one of those placeholders**:

| New case | Slot | Replaces |
|---|---|---|
| New case A | Case 2 | "The Encrypted Trail" |
| New case B | Case 3 | "The Ghost File" |
| New case C | Case 4 | placeholder Case 4 |
| New case D | Case 5 | placeholder Case 5 |

Case 6 stays a placeholder unless you are told otherwise.

Do **not** add a 7th or later case. That would need new 3D folder layouts and a new phone-code split; see section 9.

The human will give you the content of each case: titles, story text, evidence, answers and hints. Your job is to put that content into the data files, keep the answers secret, and verify everything. **The case pages, attempt counting, scoring, admin tools and database rules already exist and do not need new code.**

## Paste this prompt into Codex together with this PDF

> Read the attached guide "THE GAME — Adding Cases 2 to 5" and follow it exactly. Implement the case brief(s) I give you below as Case N (replacing the placeholder in that slot). Use Case 1 in `game/data/cases.ts` as the reference. Put answers, hints and debriefs ONLY in `game/data/secrets.ts`. Do not change Case 1, the 3D scenes, the SQL migrations or the server code unless the guide says so. Use the content exactly as written; do not invent clues, evidence or answers — ask me if something is missing. When done, run every check in section 7 and report the results in the format of section 8.
>
> CASE BRIEF: (paste the filled template from section 10 here)

# 2. Non-negotiable rules

1. **Answers never reach the browser.** Answers, Powerful Hints and debriefs go **only** in `game/data/secrets.ts`.
   - Never put them in `cases.ts`, in components, in placeholders, in hidden inputs, in comments shown on screen, or in `public/`.
   - In the event build (`NEXT_PUBLIC_GAME_BACKEND=supabase`), `secrets.ts` is swapped for `secrets.stub.ts`, and the answers live only in the Supabase database.
2. **Do not touch Case 1** (`id: 1`) or its secrets.
3. **Do not fabricate content.** If the brief leaves something out, ask the human. That includes:
   - an evidence file, image, video, link or table;
   - an answer;
   - a hint.

   If an optional video URL is unknown, leave `url: ''`; the page then hides it.
4. **Do not reveal physical locations or coordinates** that teams are supposed to discover in the real world. Organizer-only notes stay out of the repository's player-facing text.
5. **No sequential unlocking.** Every level of a case is open from the start. Levels are independent.
6. **No secrets in git.** Never commit any of these:
   - `.env*` files with real keys;
   - `supabase/seed/the_game_seed.sql`, which is git-ignored because it contains the answers;
   - any Supabase key or password.
7. **Keep it data-driven.** Do not create a standalone app or new pages per case. A case is data in two files.

# 3. Where things live

| File | What it holds | Visible to players? |
|---|---|---|
| `game/data/cases.ts` | Case and level content: titles, story sections, tables, links, answer format, attempts, score, coins, success text | Yes (public) |
| `game/data/secrets.ts` | `ANSWERS`, `HINTS` (Powerful Hints), `DEBRIEFS`, `UNLOCK_CODE` (phone code) | **No** (server/database only) |
| `game/data/secrets.stub.ts` | Empty stand-in used by the event build | — |
| `public/evidence/...` | Images or files for `evidenceAssets` (create the folder if needed) | Yes (anyone can download) |
| `scripts/generate-seed.mjs` | `npm run seed`: turns cases.ts + secrets.ts + market.ts into the database seed SQL | — |
| `supabase/migrations/004–006` | Database tables and rules (attempt limits, answer formats, admin controls). **Already done; do not edit.** | — |
| `game/pages/LevelPage.tsx`, `DeskPages.tsx` | Renders any case from the data. No changes needed. | — |

**Anything in `public/` is downloadable by anyone.** Never put the answer in an evidence file's name or contents unless the puzzle is meant to be solved from it.

# 4. The data format

## 4.1 A case (`CaseDef` in `game/data/cases.ts`)

```ts
{
  id: 2,                                   // slot 2–5; keep the id of the placeholder you replace
  title: 'The Case Title',                 // printed on the 3D folder cover — keep it short (≤ 28 chars)
  classification: 'RESTRICTED',            // optional label on the case overview
  closedLines: ['ALL FOUR INVESTIGATIONS VERIFIED', 'THE TRUTH HAS BEEN RECOVERED', 'CASE STATUS: COMPLETED'],
                                           // optional: lines on the CASE FILE CLOSED screen
  levels: [ /* 4 or 5 LevelDef objects, numbered 1..n */ ],
}
```

**Number of levels.** Use **4 or 5** per case. The desk has photo layouts for 4 and 5 (`LAYOUTS` in `game/scenes/desk/engine/scene/PolaroidEvidence.js`). Any other count needs a new layout entry there; add one only if the brief requires it.

**Case completion.** A case is complete when **all** its levels are completed, in any order. Skip Tokens and Master Keys count towards completion.

## 4.2 A level (`LevelDef`)

```ts
{
  number: 1,                                // 1..n, unique within the case
  title: 'Level Title',
  difficulty: 'Easy',                       // 'Easy' | 'Medium' | 'Hard'
  reward: 100,                              // coins paid once on completion
  score: 100,                               // leaderboard points paid once on completion
  maxAttempts: 8,                           // wrong answers before the level locks (omit = unlimited)
  classification: 'FIELD INVESTIGATION',    // label in the level header
  description: 'One or two sentences shown on the typed report inside the 3D folder.',
  briefing: 'One-line objective (fallback text).',
  evidence: '',                             // legacy field: keep '' when you use sections
  sections: [ /* rich page content, see 4.3 */ ],
  question: 'What is the name of …?',       // optional question above the answer box
  answerType: 'text',                       // see 4.4
  placeholder: 'ENTER KEYWORD',
  submitLabel: 'SUBMIT FINAL ANSWER',
  formatHint: 'Example format: …',          // optional; must NOT give the answer away
  successLines: ['EVIDENCE VERIFIED', 'LEVEL 01 — COMPLETED'],
}
```

## 4.3 Page sections (`LevelSection`)

A level page is a list of sections. Each one can use any of these fields:

| Field | Renders as |
|---|---|
| `heading` | Section title |
| `body: string[]` | Paragraphs |
| `document: string[]` | A "classified document" box (quoted clue, intelligence report) |
| `list: string[]`, `ordered: true` | Bullet or numbered list |
| `code: string` | A monospaced line (system status, log line) |
| `tone: 'warning' \| 'note'` | Red warning box or grey note box |
| `table: { title, subtitle, columns, rows }` | Evidence table (rows are arrays of strings) |
| `link: { label, url }` | External evidence button that opens in a new tab (e.g. a Google Drive folder) |
| `video: { title, url }` | Embedded video player for a **direct video file URL** (e.g. `/evidence/case-02/clip.mp4` or a direct .mp4 link). `url: ''` hides it. A YouTube or Drive *page* link will not play: use a `link` section for those. |

For a full example of every section type, see Case 1 levels 3 (table + warning), 4 (Drive link) and 5 (video + witness cards) in `cases.ts`.

## 4.4 Answer types and how answers are checked

| `answerType` | Player sees | Answer format in `secrets.ts` | Accepted |
|---|---|---|---|
| `'text'` (default) | One text box | `'cv raman'` | Case, spaces and punctuation ignored: `C.V. Raman`, `cv raman` and `CVRAMAN` all match |
| `'numeric'` | Number box | `'2'` | As text, plus leading zeros ignored (`02` = `2`) |
| `'choice'` | Radio buttons from `choices: ['A','B',…]` | `'B'` | The chosen option |
| `'fields'` | Several boxes, `fields: [{key,label,placeholder}, …]`, submitted together as **one** attempt | `'part1\|part2\|part3'`, the same number of parts as fields | Every part must match (each normalised as text). A time part may omit "UTC". |
| `'witness'` | Witness cards from `choices: ['1','2','3','4']` | `'2'` | `2`, `witness 2`, `Witness 02` |

**Important:**

- **One answer per level.** Alternative spellings are not supported unless the normalisation above covers them. If the brief lists several accepted answers that normalisation does not cover, ask the human which one to use.
- **No other answer types.** If a brief needs something new (for example "any of these three words"), stop and ask. Do not improvise. It would need matching changes in both:
  - `game/services/levels.ts` (mock build), and
  - a new SQL migration (`game_answer_ok`).

## 4.5 Secrets (`game/data/secrets.ts`)

Keys are `'<case>-<level>'`. **Replace the placeholder entries for the slot you fill. Never leave old placeholder answers behind.**

```ts
export const ANSWERS = {
  // Case 2 — NEW TITLE
  '2-1': 'answer one',
  '2-2': 'answer two',
  '2-3': '42',
  '2-4': 'account|v2|10:15:00 UTC',   // 'fields' level: parts in the same order as `fields`
  '2-5': '3',                         // only if the case has 5 levels
};
export const HINTS = {
  '2-1': 'A Powerful Hint teaches the METHOD, never the answer.',
  // one per level
};
export const DEBRIEFS = {
  '2-4': 'Shown to the team ONLY after they solve level 2-4 (e.g. a verification summary).',
};
```

- **Hints** are bought with coins (Powerful Hint power-up). Use the hint text from the brief. If the brief has none, ask the human. Never write a hint that contains the answer.
- **`UNLOCK_CODE`** and `CASE_FRAGMENT_LENGTH` (the phone code digits each solved case pays out) **do not change**.

## 4.6 Score and coins

- Use the values in the brief.
- If the brief gives none, follow Case 1's scale: Easy 100, Medium 150, Hard 200–250 for both score and coins.
- Points and coins are paid **once** per level per team. Wrong answers cost nothing except an attempt.

# 5. Step by step for one case

1. Read the brief. List every level with its answer type, answer, attempts and any links, tables or videos.
2. In `game/data/cases.ts`, replace the placeholder object for that slot. Keep the `id`. Write the levels with the exact brief text in `sections`.
3. In `game/data/secrets.ts`, replace that slot's `ANSWERS` and `HINTS`, and add any `DEBRIEFS`.
4. Put evidence images or files under `public/evidence/case-0N/` and list them in `evidenceAssets`. Do this only if the brief supplies the files.
5. Run `npm run seed`. It must print `6 cases, N levels` with no "Cannot write the seed" errors. It checks that:
   - every level has an answer;
   - every `fields` answer has the right number of parts.
6. Run the checks in section 7 and fix anything that fails.
7. Commit with a clear message, for example `Case 2: <title> — <n> levels`, and push to `main`. **Do not commit `supabase/seed/the_game_seed.sql`.**

# 6. Putting new cases live (the human does this; include it in your report)

1. On the host PC: `git pull`.
2. Run `npm run seed`. This writes `supabase/seed/the_game_seed.sql` from the local `secrets.ts`.
3. In the Supabase dashboard, open **SQL Editor**, paste the whole seed file and run it. This is safe to re-run: it updates the cases in place and keeps teams' progress.
4. Restart the server: `npm run lan`.

**No new migration is needed for new cases.** Migrations 004, 005 and 006 must already have been run once.

**Changing a level that teams have already played** (for example its answer) does not reset their attempts. Use the Admin page instead: **Teams → team → Reset attempts / Reopen / Mark completed**.

# 7. Checks to run before you finish

| # | Command / action | Expected |
|---|---|---|
| 1 | `npx tsc --noEmit` | No errors |
| 2 | `npm run seed` | `Wrote …: 6 cases, N levels …`, no problems listed |
| 3 | `npm run test:sql` (needs a local Postgres; set `PGHOST`/`PGPORT`/`PGUSER`) | All PASS, including the 2 concurrency checks |
| 4 | `npm run dev` (mock mode from `.env.development`), then `npm run test:e2e` | All checks pass (see 7.1) |
| 5 | Manual: open `/team/case/N` | The new title is on the folder; the overview lists every level as NOT STARTED with "8 / 8" attempts |
| 6 | Manual: each level page | Content matches the brief word for word; links open; no answer visible anywhere |
| 7 | Manual: wrong answer | "INCORRECT ANSWER — 7 ATTEMPTS REMAINING"; after 8 wrong answers the level shows ATTEMPTS EXHAUSTED and the other levels are unaffected |
| 8 | Manual: solve every level in a random order | CASE FILE CLOSED screen; a phone-code digit is awarded |
| 9 | Search the production build for answers: `NEXT_PUBLIC_GAME_BACKEND=supabase npx next build`, then `grep -ri "<an answer>" .next/static` | No matches |

## 7.1 Tests that know the case layout (update them if you change level counts)

| Where | What it assumes |
|---|---|
| `scripts/e2e.mjs`, check "Six cases (Case 1 has five levels, the rest four)" | Level counts `'5,4,4,4,4,4'` and 25 routes. Update both to the new counts. |
| `supabase/tests/game_test.sql`, sections "answers", "skip token", "master key" | Use **Case 2**, assuming 4 levels; "last level solves the case" submits 2-3 then 2-4. If Case 2 gets 5 levels, also submit 2-5 before checking `caseSolved`. Answers are read from the database (`pg_temp.ans`), so new answers need no test change. |
| `supabase/tests/game_test.sql`, check "correct answer (any case/spacing/punctuation)" | Submits `' ' \|\| lower(answer) \|\| '! '` for level 2-2, so 2-2 must be a `text`/`numeric` answer. If 2-2 becomes `fields` or `witness`, point this check at another plain-text level. |
| `scripts/e2e.mjs` "Case 06 is SOLVED exactly when its fourth level completes" | Case 6. Unaffected while Case 6 stays as is. |
| `scripts/e2e-supabase.mjs`, `scripts/e2e-case1.mjs` | Case 1 only. Unaffected. |

**Never weaken or delete a test to make it pass.** Update the expectations to the new layout and explain why in the commit message.

# 8. Report format (what to send back)

1. **Cases added:** slot, title, levels (number, title, answer type, attempts, score/coins).
2. **Files changed.**
3. **Content questions:** anything missing from the brief that you did not invent.
4. **Check results:** each item of section 7 with PASS/FAIL and counts.
5. **Go-live steps for the organizers** (section 6), including which seed to run.
6. **Organizer-only notes:** physical locations, QR codes and coordinates. These belong in the report, never on the site.

# 9. Out of scope unless explicitly requested

- **More than six cases.** This needs all of the following:
  - new 3D folder positions (`game/scenes/desk/engine/config.js`);
  - a new phone-code split (`CASE_FRAGMENT_LENGTH` must still add up to the length of `UNLOCK_CODE`);
  - UI and test updates.
- **Changes to scoring rules, power-ups, markets, the phone, the admin page or SQL migrations.**
- **Changing Case 1.**

# 10. Case brief template (the human fills one per case)

```
CASE SLOT: 2 | 3 | 4 | 5
CASE TITLE (≤ 28 characters):
CLASSIFICATION (optional, e.g. RESTRICTED):
CASE CLOSED LINES (optional, up to 3):
NUMBER OF LEVELS: 4 | 5

--- LEVEL n ---
TITLE:
DIFFICULTY: Easy | Medium | Hard
SCORE / COINS:
MAX WRONG ATTEMPTS (default 8):
CLASSIFICATION LABEL (optional):
SHORT DESCRIPTION (1–2 sentences, shown inside the 3D folder):
PAGE CONTENT (exact text; mark headings, documents, tables, warnings, links, videos):
QUESTION (optional):
ANSWER TYPE: text | numeric | choice | fields | witness
  (fields → list each field label + placeholder in order)
  (choice / witness → list the options)
ANSWER (server-only):
POWERFUL HINT (method, not the answer):
DEBRIEF AFTER SOLVING (optional):
SUCCESS LINES (2 lines, e.g. "EVIDENCE VERIFIED" / "LEVEL 0n — COMPLETED"):
PLACEHOLDER / BUTTON TEXT (optional):
ORGANIZER-ONLY NOTES (locations, QR codes — never shown on the site):
```
