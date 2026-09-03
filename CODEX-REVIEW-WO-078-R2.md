MERGE-BLOCK — Five Round-1 merge blockers remain reproducible at `61c4aae`; the grader can still turn a structurally invalid response into a scoring hit.

> **WO §3 bar used for severity:** “Must be flawless: any phone showing a different game state than the server for more than two seconds; a lost or mis-attributed answer; answers accepted after lock or a lock that does not happen at zero; wrong points arithmetic or wrong leaderboard order; a reconnecting phone landing on the wrong team or losing its answer; an admin control that silently does nothing; any path that puts the API key or the admin token in a bundle, a log, a PR or the vault; a grader that scores an unmatched answer as a hit.”

## Fix-list verification

| # | Verdict | Evidence at `61c4aae` |
|---|---|---|
| 1. Duplicate/missing/extra grader rows | **PARTIALLY FIXED** | Missing requested teams are flagged (`src/worker/grader.ts:177-183`), but duplicate rows are last-write-wins and extras are ignored (`:175-176`); the remaining requested row can become a confident hit (`:185-197`). `grader.ts` is unchanged from the bounced SHA. |
| 2. Persist release across offline reconnect | **NOT FIXED** | `release` only clears the slot and emits an ephemeral kick (`src/shared/game.ts:168-176`); persisted `GameState` has no revocation/generation (`src/shared/types.ts:70-83`). `helloPlayer` simply claims the remembered team again (`src/worker/game-do.ts:180-199`). |
| 3. One slot/device; team-specific kick | **NOT FIXED** | `claim` checks only the target slot (`src/shared/game.ts:155-165`). `kick` receives no team and clears every matching device socket with any non-null team (`src/worker/game-do.ts:281,287-295`). |
| 4. Auto-lock on refusals and JSON ping | **NOT FIXED** | `autoLock` mutates the clone, but `refuse` forces `changed:false`; several branches return `prev` or an ignored clone (`src/shared/game.ts:86-88,136-152,156-160,179-182,223-225`). `{type:"ping"}` only sends state (`src/worker/game-do.ts:133-135`). |
| 5. Wait for all grade requests | **NOT FIXED** | A manual answer can launch a one-answer request (`src/shared/game.ts:201-206`), while any current-question result sets `done` and exits `grading` (`:298-321`). There is no request id/count in `GameState`. |
| 6. Lobby question leak fixed or filed | **NOT FIXED** | Player `base()` still includes the next question during `lobby` (`src/shared/view.ts:28-56`), and `KNOWN-ISSUES-WO-078.md:14-22` contains eight unrelated entries, not this repro. |

## Findings (ranked)

1. **merge-blocking — duplicate/extra model rows can score an unmatched answer.** `src/worker/grader.ts:175-197`. Direct repro: one-row list `Portugal`; answer `{team:1,text:"Atlantis"}`; model output `[{team:1,row:null},{team:1,row:1}]`. Actual output was `{rowIndex:0,needsReview:false}`, `failed:false`. An extra-team row is likewise silently ignored, so a response with the wrong cardinality can still award its requested-team hit. This is the §3 worst defect verbatim.

2. **merge-blocking — deadline auto-lock is still discarded on refusal, and admin ping cannot repair it.** `src/shared/game.ts:86-88,136-152,179-182`; `src/worker/game-do.ts:133-135,272-283`. Direct repro: start with `deadlineAt=1000`, then reduce whitespace answer at `now=1001`. Actual: `error.code="empty"`, `changed:false`, `phase="open"`. `apply()` therefore neither adopts nor broadcasts the locked clone. If the alarm is delayed, each JSON admin ping keeps returning the stale open phase; phones can remain on the open UI past zero until another reducer event/alarm. (A non-empty late answer is correctly refused and carries the lock; `game.ts:187-192`.)

3. **merge-blocking — releasing an offline phone is undone by its normal reconnect.** `src/shared/game.ts:168-176`; `src/worker/game-do.ts:180-199,281-295`; `src/client/player.ts:45-53,68,85-89`. Concrete sequence: device A claims Lag 3, disconnects, Erik releases Lag 3, then A reconnects with locally remembered `{deviceId:A,team:3}` before another phone claims it. Direct reducer result: no error and Lag 3 is re-created for A. No persisted tombstone distinguishes reconnect from a new claim, so Erik's release silently fails in the exact dead-phone recovery path.

4. **merge-blocking — one device can own two slots, and releasing one detaches the other.** `src/shared/game.ts:155-176`; `src/worker/game-do.ts:218-243,281-295`. Direct sequence `claim(A,3)`, `claim(A,5)` leaves both slots owned by A. `release(3)` emits `{team:3,deviceId:A}` while slot 5 remains owned; team-blind `kick(A)` clears A's socket attachment even if it is currently Lag 5. Exact wrong state: server reserves Lag 5 for A while A's phone is sent to team selection, blocking another guest and risking team/answer attribution.

5. **merge-blocking — a fast sub-grade still ends global grading early.** `src/shared/game.ts:201-206,275-321`; `src/worker/game-do.ts:298-305`. Direct sequence: Lag 1's full grade is outstanding; during `grading`, Erik enters exact-hit `Portugal` for Lag 2; that one-answer result returns first. Actual state becomes `phase:"reveal"`, `gradeStatus:"done"`, with Lag 1's grade absent. Reveal/standings can therefore expose wrong points until the first request settles.

6. **known-issue — next question text remains visible in the lobby payload and was not filed.** `src/shared/view.ts:28-56`; `KNOWN-ISSUES-WO-078.md:14-22`. Repro: call `playerView(initialState, quiz, now, ...)`; `phase` is `lobby` but `question.question`, title, definition and source are populated. Hidden row names remain masked. This is a fairness issue, not on §3's blocking list.

No item requires an Erik product ruling; there are no **parked-for-erik** findings.

## Checked and found sound

- Review was pinned with `git show`/`git diff` to the requested SHA despite the branch having advanced. The later committed HEAD did not change the relevant product sources, and `game.ts`/`grader.ts` at `61c4aae` are byte-for-byte unchanged from the bounced SHA. New uncommitted builder edits to `game.ts`/`types.ts` appeared after my repro and were neither touched nor reviewed.
- Points are rank 1–10, otherwise zero; standings sort by total then team number and use competition ranking for ties (`src/shared/scoring.ts:3-37`). Reveal masking and player isolation hide row names until reveal and never include other teams' answers (`src/shared/view.ts:21-25,31-37,96-113`).
- Valid transitions persist before broadcast; alarms are set/cleared before effects (`src/worker/game-do.ts:272-283`). Admin commands require constant-time token verification (`:245-267,371-377`). Static committed-tree inspection found no real API key/admin secret; only documented placeholders/test credentials. The build script contains a value/prefix/client-name secret scan (`scripts/build.mjs:46-83`).
- Presence uses hibernation auto-response timestamps and refreshes `lastSeen` for an awake raw ping (`src/worker/game-do.ts:89-98,308-317`); admin status correctly gives `offline` precedence for a claimed disconnected team (`src/shared/view.ts:116-148`).

## Checks not run

I ran no full test suite, typecheck, build, live-model test, or Playwright e2e. The checkout had advanced beyond the review SHA and build/e2e write artifacts, contrary to the instruction to modify only this report. I did run a no-file inline Node execution of the reducer/grader reproductions above, plus read-only committed-tree diffs and secret searches. I did not run `npm ci` or `npm install`.

Reviewed commit: **`61c4aae61f1f7a2df42c4258a10adc481ecdbf2d`**.
