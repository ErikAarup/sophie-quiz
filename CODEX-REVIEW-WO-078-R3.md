**MERGE-BLOCK** — the new `gradePending` count fixes the original same-question race, but it has no request/epoch identity: an old pre-reset result can complete a new grading run, and `next` can discard an outstanding manual re-grade.

Reviewed commit: `be468fbbb15c2cfba04c223cd49073f4d9c9d87b` (`build/wo-078`). Severity is judged against `WORK_ORDER.md` §3 and the round-3 scope only.

## 2. Round-3 fix-list verdicts

| # | Fix-list item | Verdict | Evidence |
|---|---|---|---|
| 1 | Duplicate, missing, or extra model team rows become review, never a hit | **fixed** | Pending/pre-pass teams are separated, unexpected and duplicate pending teams route the whole unresolved batch through `flagAll`, missing teams become `needsReview`, and row ordinals are bounded: `src/worker/grader.ts:179-215`. Regression coverage is at `test/unit/grader.test.ts:73-120`. Ignoring an echoed pre-pass team at `grader.ts:188-193` is sound: that answer was already resolved deterministically and the echo cannot change its grade. |
| 2 | Auto-lock survives every refusal; JSON ping runs the reducer | **fixed** | `autoLock()` runs before dispatch and `refuse()` returns through `done()`, preserving `changed` and alarm deletion: `src/shared/game.ts:125-131,165-188`. Empty/late answers consequently see locked state at `game.ts:235-244`; `tick` shares the alarm path at `:318-321`; JSON `{type:"ping"}` calls it at `src/worker/game-do.ts:135-139`. Unit regression: `test/unit/game.test.ts:387-407`. |
| 3 | Grading waits for all outstanding requests for the question | **partly fixed** | The nominal batch + manual-subgrade race is counted correctly at `src/shared/game.ts:249-256,324-375` and tested at `test/unit/game.test.ts:409-443`. However, the count is only a scalar tied to the current numeric `questionIndex`. `clearQuestion()` zeroes it (`game.ts:138-148`), `resetQuestion` reuses the same index (`:448-460`), and `next` also zeroes it while accepting from reveal/standings (`:428-445`). Results carry only `questionIndex`, not a request/epoch id (`:41,347-375`). Both remaining failures are reproduced below. |
| 4 | Offline release persists across reconnect | **fixed** | Release bumps the persisted per-team generation at `src/shared/game.ts:223-230`; automatic reconnect must return the stored generation at `:197-203`; reset invalidates all generations at `:464-473`. The token round-trip is in `src/client/player.ts:45-62,76-98`, the DO handshake in `src/worker/game-do.ts:185-207`, and the player view in `src/shared/view.ts:99-117`. Unit, DO, and browser regressions exist at `test/unit/game.test.ts:349-374`, `test/do/game.test.ts:58-85`, and `e2e/join.spec.ts:56-72`. |
| 5 | One slot per device; kick matches team | **fixed** | Claim atomically clears every other slot held by the device before assigning the target at `src/shared/game.ts:193-220`; target conflicts are refused before that move. The DO passes and matches both device and team at `src/worker/game-do.ts:289-310`. Regression coverage is at `test/unit/game.test.ts:376-385` and `test/do/game.test.ts:88-94`. |
| 6 | Fix or file the lobby question leak | **fixed** | Player projections suppress both question and row shape in lobby while admin retains them: `src/shared/view.ts:28-59`. Regression: `test/unit/view.test.ts:87-97`. No known-issues entry is required because the leak is no longer present. |

## 3. Findings

### merge-blocking — a pre-reset result can finish the replacement grading run

**Files:** `src/shared/game.ts:41,138-148,347-375,448-460`; `src/worker/game-do.ts:280-320`.

The counter distinguishes neither individual requests nor successive runs of the same question. I executed this no-file reducer repro against the reviewed sources:

1. Start question 1, submit `"gammalt svar"`, lock, and send `grade`; its request remains outstanding (`gradePending = 1`).
2. While the model call is waiting, confirm `resetQuestion`. This clears the counter and returns to the lobby but keeps `questionIndex = 0`.
3. Start question 1 again, submit the different text `"nytt svar"`, lock, and send the new `grade`; the replacement request is now the sole counted request (`phase = "grading"`, `gradePending = 1`).
4. Deliver the old request's result first. Its `gradedText` does not match the replacement answer, so no grade is installed, but `rqi === qi` is enough to decrement the replacement counter.

Actual output from the executed repro changed from `{phase:"grading", gradePending:1, grade:null}` to `{phase:"reveal", gradePending:0, gradeStatus:"done", grade:null}`. The real replacement request is still outstanding, yet Erik can reveal and show standings without that team's points. This is the same §3 wrong-points/leaderboard failure item 3 was meant to close, reached through the explicitly in-scope reset path. A per-run epoch/request id (or cancellation identity that stale results cannot consume) is required; a question-index scalar is insufficient.

### merge-blocking — `next` accepts and forgets an outstanding manual re-grade

**Files:** `src/shared/game.ts:249-256,347-375,428-445`; `src/worker/game-do.ts:53-65,313-320`; `src/client/admin.ts:381-456,459-500`.

This second no-file reducer repro also ran against the reviewed sources:

1. Finish question 1 and enter standings with Lag 1 graded.
2. From the standings team sheet, change Lag 1's answer to text requiring the model. The reducer deletes the old grade, emits a new grade request, and reports `gradePending = 1` while remaining in `standings`.
3. Tap the enabled `Nästa fråga` before the model returns.

Actual output: `next` is accepted, advances to question 2's lobby, forcibly changes `gradePending` from 1 to 0, and leaves Lag 1's question-1 grade absent. Every leaderboard is therefore missing those points until the old request happens to return. If the DO is evicted in that interval, recovery sees `phase:"lobby"` and `gradePending:0`, so `game-do.ts:57-65` does not resubmit it and the points are lost permanently. This violates both the item-3 promise that grading does not end with work outstanding and §3's flawless points/leaderboard and persisted-state requirements.

### known-issue — mixed-version reconnects need an unnecessary extra claim tap

**Files:** `src/shared/game.ts:101-114,193-203`; `src/worker/game-do.ts:185-207`; `src/client/player.ts:45-62,76-98`.

A slot persisted by the pre-round-3 build has no `claimGen`, and that browser has `sq.team` but no `sq.token`. Migration gives the occupied slot generation 0; after the new bundle reloads, its automatic hello sends `token:null`, which is rejected even when the slot is still owned by the same `deviceId`. The phone is sent to the tiles while the authoritative slot remains occupied; because tiles exclude slots held by the same device, tapping the old team rejoins immediately. This does not undermine the new release tombstone, and it is not merge-blocking for the planned Saturday session because it requires a browser claim made with the pre-fix bundle, but it is a deployment/reconnect edge worth recording.

### known-issue — two routing details lack direct regression assertions

**Files:** `test/unit/game.test.ts:376-407`; `test/do/game.test.ts:88-94`; `src/worker/game-do.ts:135-139,295-310`.

The added auto-lock test calls the reducer's `tick` directly but does not send a JSON `{type:"ping"}` through the DO. The added DO move test reuses one socket, whose attachment has already changed to the new team before `kick()` runs; it therefore does not assert that, with two sockets sharing a device id, only the socket whose attachment matches the kicked team receives `released`. The implementations read correctly, so this is test-coverage debt rather than a demonstrated product failure.

There are no parked-for-Erik findings. The primary round-2 fix list was right about all six defects; I disagree only with treating item 3 as fully closed by a counter without request-generation identity or transition guards.

## 4. Checked and found sound

- `npm test` passed: 7 files, 77/77 unit + Durable Object tests. The runner emitted sandbox-related Wrangler log/export-analysis warnings, but exited 0 and all tests passed.
- `npm run typecheck` passed all three no-emit TypeScript projects.
- I executed no-file reducer probes for the original concurrent batch/manual-result order (covered by the suite), the reset/re-grade stale-result order, and the outstanding manual-grade/`next` order. Only the latter two fail.
- Grader structural validation now rejects duplicate and truly extra pending-team rows, flags missing and out-of-range rows, and never lets a model echo overwrite a deterministic pre-pass hit (`src/worker/grader.ts:145-215`).
- Auto-lock state and alarm clearing survive reducer refusals, and the DO's JSON admin heartbeat enters that reducer path (`src/shared/game.ts:165-188`; `src/worker/game-do.ts:135-139`).
- Normal reconnect, offline release, explicit re-claim, reset invalidation, one-device movement, and team-specific kicking are internally consistent for current-version clients (`src/shared/game.ts:191-232,464-473`; `src/worker/game-do.ts:185-207,226-251,289-310`).
- Lobby masking hides the upcoming question from player payloads without hiding it from admin (`src/shared/view.ts:28-59`).
- The admin failure notice is limited to once per question and cannot intercept taps (`src/client/admin.ts:447-453`; `public/styles.css:630-645`).
- Read-only tracked-tree searches found no credential value in client/public sources. The only `sk-ant-` occurrences are placeholders/documentation and the build scanner's own literal; I did not read `.dev.vars`.
- `git status --short` was clean after the executable checks, before creating this report.

## 5. What I did not run

- I did **not** run `npm ci` or modify dependencies.
- I did **not** run `npm run build`; it rewrites `dist/`, and the instruction permits changing only this report. Consequently I did not independently execute the bundle secret scanner.
- I did **not** run Playwright e2e or proof recording; those commands rebuild client assets and write reports/screenshots/videos. I read their new regression cases instead.
- I did **not** run the paid live-model grader, deploy, smoke-test the deployed URL, or exercise real Cloudflare alarm timing.
