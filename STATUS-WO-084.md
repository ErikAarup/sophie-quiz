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
