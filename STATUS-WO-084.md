# STATUS-WO-084

Heartbeat (mtime = liveness).

- 2026-09-04 19:54 — builder started. Read WO-084, WO-083 §A, sources.
- 2026-09-04 20:02 — orientation done. Plan set:
  - `TEAMS` (1..8) renamed `ALL_TEAMS` (1..12) + `teamsUpTo(count)` so the compiler flags
    every site that assumed eight; `GameState.teamCount`; `setTeamCount` command.
  - AC4: serialise `apply()`'s reduce+persist+broadcast on a promise chain in the DO; the
    grader call stays outside the lock so "Rättning pågår" still comes back immediately.
  - AC5: `readToken()` stops writing localStorage; the admin client caches only after the
    server's first admin state arrives.
- Acceptance criteria (restated): 1 Antal lag stepper 2–12 on the q1 lobby, live, refused with
  a Swedish reason otherwise · 2 everything follows the count · 3 reset keeps it, migrate gives
  8 · 4 admin commands serialised, exact-hit double grade → one ok + one busy · 5 wrong `?t=`
  cannot poison the cache · 6 SPELLEDNING §3 + troubleshooting lines.
- 2026-09-04 20:11 — phase 1 committed (17bec85): count in the state, serialised DO, admin
  stepper, safe token cache. `npm run typecheck` clean, `npm test` 103/103 before the new tests.
- 2026-09-04 20:11 — phase 2: unit tests (9 new) + DO tests (5 new) green. AC4's DO test shows
  one ok + one refusal where it used to be two oks; the refusal is `busy` or `done` depending on
  microseconds (no model call to wait for) — noted in the ledger, both are correct refusals.
- Next: e2e (AC5 token cache, AC4 through a real socket, the six-team user-seat run + shots),
  SPELLEDNING §3 lines, then the PR.
- 2026-09-04 20:20 — phase 3 done. Full verification green: typecheck clean, `npm test`
  118/118 (was 103), `npm run e2e` 23/23 (was 19), `npm run build` clean. Seven 390×844
  screenshots under `proof/wo-084/`. SPELLEDNING §3 + troubleshooting lines written (AC6).
  e2e/env.ts and e2e/wrangler.e2e.jsonc reverted; regenerated proof/wo-083 shots reverted.
- Remaining: commit, push, open the PR against build/wo-083.
