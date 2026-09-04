# WO-084 — Team count on the night, serialised admin commands, safe token cache

> **Erik's plain-language headline (restated in the PR body):**
> The host can set how many teams play, on his phone, before the first question. Two small
> holes the exploratory testers found are closed. Nothing else changes.
> **What this will NOT do:** anything not in §2 — no team names, no changing the count after
> the game has started, no other feature.
>
> Written 2026-09-04 in the pre-mortem session. Erik's words: "Rasmus (Sofie's boyfriend)
> says they will decide how many teams tomorrow. Would it be complicated to build in a feature
> in the admin page for removing/adding teams?" Base: `main` after WO-083 was integrated (the
> sha is in the dispatch message). The party is **Saturday 5 September 2026**; a finished PR
> tonight beats a perfect one later. If an item cannot be done cleanly, log it in
> `KNOWN-ISSUES-WO-084.md` with the reason and ship the rest.

## 1. Goal

Eight teams was a guess. Tomorrow the hosts decide at the venue. The admin page gets an
"Antal lag" setting, usable only before the game starts, and everything that assumes eight
follows it. Two findings from tonight's exploratory tests are fixed in the same order: a
double tap on "Rätta" can be accepted twice when every answer is an exact list hit, and a
wrong admin link overwrites the good token cached on the phone.

## 2. Acceptance criteria — user's seat

1. **Antal lag.** On the admin lobby of question 1, before any team has claimed a slot and
   before any answer or grade exists, Erik sees "Antal lag: 8" with − and + (range 2–12).
   Tapping changes it immediately on every connected phone. Outside those conditions the
   control is hidden or disabled with the reason ("Släpp lagen först" when slots are held;
   "Går inte att ändra när spelet startat" once question 1 has been started), and the
   underlying command is refused with a Swedish message if sent anyway.
2. **Everything follows the count.** Player tiles show exactly that many teams; a claim for a
   team above the count is refused; the admin grid, the answers list, the reveal, the
   standings and the final show only those teams; ties and positions are computed over them.
   `TEAM_COUNT` (8) stays as the default only; a grep for other hard-coded eights in `src/`
   turns up nothing that still assumes eight.
3. **"Nollställ spelet" keeps the count.** Erik sets 6, resets the game before guests, and
   the tiles still show 6. `migrateState` gives an existing deployed state the default 8.
4. **Admin commands run one at a time.** Two "grade" commands arriving back-to-back on one
   socket, in a question where every answer is an exact pre-pass hit (no model call), result
   in one grade and one refusal "Rättning pågår – …". A DO test reproduces the race the
   explorer found (`adminCommand()` awaits `tokenOk()` before the reducer's busy check) and
   proves it closed; the fix serialises admin command handling in the Durable Object (a promise
   chain or equivalent), never by removing the token check.
5. **A wrong link cannot poison the cached token.** The admin client caches `?t=` only after
   the server has accepted the admin hello; a visit with a wrong `?t=` shows "Fel adminlänk"
   and leaves the previously cached good token in place, so a later plain `/admin` still
   works. e2e: good token → wrong-token URL → plain `/admin` → pill reads "Admin".
6. **Runbook.** `SPELLEDNING.md` §3 "Innan gästerna kommer" gains one line: set "Antal lag"
   before "Nollställ spelet" if the number is not eight; the troubleshooting table gains the
   "Fel adminlänk" recovery (open the bookmark with the full `?t=` link once).

Restate these at every phase boundary.

## 3. Good-enough bar

- **Always bounces:** wrong points or standings at any team count; a claim accepted above
  the count; a count change accepted after the game started or while a slot is held; the
  double-grade race still reproducible; a regression in any existing unit, DO or e2e test;
  any edit under `data/`; any deploy.
- **KNOWN-ISSUES material:** wording, the stepper's look, behaviour above 12 teams.
- **Out of scope for findings:** anything not in §2.

## 4. Non-goals

- No team names, no per-team colours, no changing the count after question 1 has started
  (Erik resets the game if he must), no count above 12 or below 2.
- No edits under `data/`. No deploy, no `wrangler secret`/`tail`, no call to the deployed
  Worker. Never print or copy `.dev.vars`. No merging.

## 5. Verification commands + user-seat proof

The worktree is fresh: `npm ci` first. Then, all clean, real output in the PR body:

```
npm run typecheck
npm test
npm run e2e
npm run build
```

User-seat proof: a Playwright run through the real admin UI that sets 6 teams, sees six tiles
on a phone, plays one question with six teams to the standings, resets the game and still sees
six tiles; plus the two regression e2e's (AC4 via DO test, AC5 via e2e). Screenshots at
390×844 of the admin lobby with the stepper, the player tiles at 6, and the standings at 6.
Attach to the PR body.

## 6–9. Ledger, KNOWN-ISSUES-WO-084.md, phase protocol, review

As WO-083: recommended option and keep going; irreversible or taste calls park; ledger lines
with rewind commits; `STATUS-WO-084.md` heartbeat; branch `build/wo-084`, never `main`; one
push per finished piece of work; open the PR against `main` with the headline line first.
Review is done by an independent session in a different model right after the PR opens; Erik's
verdict merges.

## A. Pointers (at the integrated main)

- `src/shared/types.ts` — `TEAM_COUNT`, `isTeam()`.
- `src/shared/game.ts` — `initialState`, `migrateState`, `claim`, `resetGame`, the admin
  command union; add `setTeamCount`.
- `src/shared/view.ts`, `src/shared/scoring.ts` — anything iterating 1..8.
- `src/client/player.ts` — the tiles; `src/client/admin.ts` — lobby, grid, answers, standings,
  final, `readToken()` (AC5).
- `src/worker/game-do.ts` — `adminCommand()` / `webSocketMessage` (AC4).
- `e2e/helpers.ts` — join helpers assume eight; parameterise rather than duplicate.
- Explorer evidence: `_coach/research/2026-09-04-sophie-quiz-pre-mortem/explore-b-admin.md`
  §1 (the race, with the spec that reproduces it under `.claude/worktrees/explore-b/e2e/explore/double-tap.spec.ts`).
