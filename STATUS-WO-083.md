# WO-083 — build heartbeat

**Branch:** `build/wo-083` · **Worktree:** `C:\Users\erika\projects\sophie-quiz\.claude\worktrees\wo-083`
**Stamped by the loop at dispatch:** 2026-09-04T17:01:39.127Z
**Phase:** P3 in progress (client changes written, e2e running) — 2026-09-04 19:27 local

> Reset at dispatch so this file can never show the PREVIOUS work order's status
> (WO-019 §2.6). Everything below this line is written by WO-083
> and by nothing else. If it still reads like this well past dispatch, the builder never
> got going — that is a real signal, not a stale file.

## §2 Acceptance criteria (restated verbatim — goal-drift counter)

1. **Erik cannot deploy a broken list set.** With a misspelled slug, an unverified list, a
   list with fewer than 10 rows, or a list whose top count is not exactly 10 (a tie at rank
   10) in `data/quiz.json`, `npm run deploy` stops **before** wrangler runs, with a message
   naming the list and the reason. With good data it deploys exactly as before.
2. **`npm test` passes whatever ten lists are in `data/quiz.json`, in any order.** The
   fixtures build their own quiz by slug from `data/bank.json`; no test depends on
   `quiz.json[0]`.
3. **On the reveal screen "Nästa fråga" is refused**, with a Swedish message shown as a
   toast, until every top row has been revealed. From the standings screen it works as
   today. The two reset links are no longer adjacent to "Nästa fråga" on the reveal and
   standings screens, and "Nollställ spelet" requires Erik to **type** the confirm word into
   the sheet before the red button works. "Nollställ frågan" keeps its two-tap sheet.
4. **A full question with eight model-graded answers does not fail on the token cap**, and
   whenever any answer of the current question is "ogranskad", the reveal screen offers
   **Rätta igen**, which re-grades only the ungraded answers (the reducer already allows a
   re-grade from reveal).
5. **When Erik sets a place by hand he sees the row name next to each place** (0–15), not
   numbers only.
6. **Typing in a team sheet survives state updates:** while the open sheet's kind and team
   are unchanged, the text he typed and the keyboard focus stay through any number of
   broadcasts; the sheet's labels may refresh.
7. **A phone that wakes with a dead socket reconnects within about a second, not eleven:**
   on `visibilitychange` / `pageshow` / `online`, if the last liveness signal is older than
   two ping intervals, the client drops the socket and reconnects immediately instead of
   pinging into the void.
8. **Copy in the room is right:** the admin reveal hint says the first press shows place 1
   and the list is read from the top; the player lobby counts the question about to start
   the same way admin does ("Fråga N av 10 · väntar"); the admin question screen shows the
   full host question under the title; and the name reads **Sofie** everywhere a guest or
   Erik sees it (`public/index.html`, `public/admin.html`, `public/qr.html` ×2,
   `src/client/player.ts` ×2; the repo name, slugs and `GAME_NAME` stay).
9. **`SPELLEDNING.md` carries every block in §B**, in place, in Swedish, and
   `KNOWN-ISSUES-WO-078.md` no longer claims the bank's verifier rejects rank-10 ties (it
   does not; the data test now does).

## Progress log

- **2026-09-04 19:02 local** — P0 orientation. Worktree clean at `f9d77c7`, branch
  `build/wo-083`. `node_modules` was missing; `npm ci` started in the background. Reading
  the source (`src/shared/game.ts`, `src/client/admin.ts`, `src/client/ws.ts`,
  `src/worker/bank.ts`, `src/worker/grader.ts`) while it installs. No code changes yet.
- **2026-09-04 19:07 local** — P0 done. `npm ci` finished (exit 0). Whole §A surface read.
  Plan: P1 data gate + fixtures (A1, A2, `predeploy`), P2 reducer (A3, A6 re-grade path),
  P3 client (A4, A5, A7, A8, A9, A10), P4 runbook §B + KNOWN-ISSUES-WO-078, P5 verification
  + proofs, P6 push + PR. Still no code changes.
- **2026-09-04 19:15 local** — P1 done (A1 data gate, A2 fixtures by slug, `predeploy`).
  `buildQuiz` now takes its three data files as an option (default = the bundled ones, so the
  DO is unchanged); `test/unit/data.test.ts` is the gate; `test/unit/helpers.ts` builds the
  fixture quiz by slug from `data/bank.json` with its own alias table; the DO test takes every
  answer and expectation from question 1 by rank. Green: unit 73/73, DO 16/16. Gate proved
  failing on both broken copies, and `npm run deploy` exits 1 in `predeploy` — `build.mjs` and
  `wrangler` never run. Committing, then P2 (reducer: A3, A6).
- **2026-09-04 19:27 local** — P2 done and committed with P3's code in progress. Reducer: `next`
  refused from `reveal` below `topCount` ("Visa hela listan först."), `grade` from reveal/standings
  re-grades only the still-ungraded answers, `max_tokens` 1024 → 4096. Client: A4 (resets behind
  "Mer…" on reveal + standings, typed confirm for the game reset), A5 (row names per place),
  A6 ("Rätta igen"), A7 (sheet keeps text + focus: the sheet is updated, not rebuilt), A9 (fast
  reconnect on wake), A10 (all four copy fixes). `npm run typecheck` clean, `npm run build` clean
  (wrangler's workerd runs — Smart App Control really is off). First `npm run e2e`: 12 passed,
  2 failed — one was an old assertion of the *wrong* lobby counter (AC8 changes it), one was my
  own new spec double-toggling "Mer…". Both fixed; re-running the whole suite now. Next: §B runbook.
