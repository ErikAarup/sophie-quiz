MERGE-BLOCK: commit `6a616055d5846848cf90d46597f91417562efd90` has reproducible lock-at-zero, identity/release, grading-race, and malformed-grader-output failures in the §3 must-be-flawless paths.

## Findings

### MERGE-BLOCKING — Expiry can be observed and then discarded, leaving the authoritative phase `open` after zero

**Locations:** `src/shared/game.ts:86-87`, `src/shared/game.ts:136-152`, `src/shared/game.ts:179-192`, `src/shared/game.ts:223-257`; `src/worker/game-do.ts:129-131`, `src/worker/game-do.ts:268-279`.

`autoLock()` mutates the cloned state and sets the local `changed` flag, but every later `refuse(...)` creates a fresh outcome with `changed: false`. Some refusals even return `prev`. `Game.apply()` consequently neither installs nor persists the auto-locked state. JSON `ping` bypasses the reducer altogether and sends the old state. This matters because Durable Object alarms are not exact timers: Cloudflare documents that they can be delayed during maintenance/failover ([Alarms API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#alarms)).

**Concrete repro / failing-test description:**

1. Start a question at `T0`, giving it deadline `D`.
2. Arrange for the scheduled alarm not to have been delivered yet at `D + 1` (a supported delayed-alarm condition).
3. At `D + 1`, send either an admin `pause` command or a player answer containing only whitespace. For `pause`, `autoLock` makes the outcome state locked, but the phase refusal returns `changed: false`; for whitespace, the `empty` refusal returns `prev`, whose phase is still `open`.
4. `Game.apply()` leaves `this.state` and storage as `open`. The admin error path then calls `sendState()` from that old state. Repeated `{type:"ping"}` messages also return `phase:"open"` without running `autoLock`.

Expected: expiry is persisted/broadcast as `locked` even when the triggering command is refused. Actual: phones can continue receiving `phase:"open"` after zero until the delayed alarm arrives. A reducer regression test for the whitespace case should expect `error.code === "empty"`, `state.phase === "locked"`, and `changed === true`; it currently gets `phase === "open"` and `changed === false`. This directly violates the “lock at zero” bar, and the stale phase can legally last well beyond two seconds during an alarm delay.

### MERGE-BLOCKING — Releasing an offline phone is not durable; its normal reconnect silently reclaims the released team

**Locations:** `src/shared/game.ts:155-176`; `src/worker/game-do.ts:176-195`, `src/worker/game-do.ts:277-291`.

The only revocation signal is pushed to currently enumerated sockets. There is no persisted revocation generation/tombstone. `helloPlayer()` treats the team remembered by the phone as a fresh claim whenever the slot is free.

**Concrete repro / failing-test description:**

1. Device `device-aaaaaaaa` claims Lag 3 and then disconnects, leaving the persisted slot claim as designed.
2. Admin sends `{type:"release", team:3, token:...}`. The state is persisted with slot 3 free, but there is no live socket to receive `released` and clear its remembered team.
3. The same phone reconnects normally with `{type:"hello", role:"player", deviceId:"device-aaaaaaaa", team:3}`.
4. `helloPlayer()` calls `claim`; because slot 3 is free, the reducer accepts it and the phone lands straight back on Lag 3.

Expected: the released phone returns to team selection on reconnect. Actual: the release is undone by the target phone's ordinary reconnect. The same repro applies after `resetGame` for a phone that was offline during the reset. This violates the flawless admin-control and reconnect-identity requirements.

### MERGE-BLOCKING — One device can own multiple slots, and releasing one slot kicks sockets actively bound to other teams

**Locations:** `src/shared/game.ts:155-165`; `src/worker/game-do.ts:214-239`, `src/worker/game-do.ts:277-291`; `src/shared/view.ts:96-101`.

Claims enforce only “one device per slot”, not “one slot per device”. `kick()` then matches only `deviceId`, not the released team, so this permitted state makes it detach unrelated team sockets while leaving their server slots claimed.

**Concrete repro / failing-test description:**

1. Open two tabs on one phone; both use the same local-storage device ID `device-bbbbbbbb`.
2. Tab A claims Lag 1 and tab B claims Lag 2. Both claims succeed, and both slots persist the same device ID.
3. Admin releases Lag 1.
4. `kick("device-bbbbbbbb", ...)` clears `att.team` and sends `released` to both tabs, including tab B. Slot 2 nevertheless remains claimed by `device-bbbbbbbb` in authoritative state.

Expected: either the second claim is refused/atomically moves the device, or releasing Lag 1 affects only Lag 1. Actual: the Lag 2 phone is sent to the tiles while the server still has Lag 2 claimed to that phone. This is a concrete wrong-team/state-divergence path.

### MERGE-BLOCKING — A fast per-team re-grade can end global grading while the original batch is still running

**Locations:** `src/shared/game.ts:179-207`, `src/shared/game.ts:275-321`; `src/worker/game-do.ts:268-301`.

Manual entry during `phase:"grading"` launches another `GradeRequest`. Every `gradeResult` for the current question unconditionally marks the question done and changes `grading` to `reveal`; there is no request generation or outstanding-work count. The race is real in Durable Objects because non-storage I/O such as the grader's model `fetch` permits other events to interleave ([Cloudflare concurrency guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/#avoid-race-conditions-with-non-storage-io)).

**Concrete repro / failing-test description:**

1. Lock a question with an unresolved answer from Lag 1.
2. Send admin `grade`; hold the mock Anthropic response so the original batch remains in flight and state is `grading`.
3. While it is in flight, send `manualAnswer` for Lag 2 with a deterministic exact match. Because the phase is not open and Lag 2 has no grade, the reducer launches a one-answer grade.
4. That pre-pass-only grade completes immediately. Its `gradeResult` sets `gradeStatus` to `done` and phase to `reveal`, even though Lag 1's original request is still outstanding.
5. Admin can now `revealAll` and `standings`. Lag 1's eventual points are absent, so the displayed totals/order can be wrong for the full model latency. The original result later changes them underneath the reveal/standings screen.

Expected: the game remains in `grading` until all grading work for the question is settled, or a newer request supersedes the older one coherently. Actual: any sub-result completes the global phase. This violates the flawless points/leaderboard requirement.

### MERGE-BLOCKING — A schema-valid duplicate model result can turn an unmatched answer into a confident hit

**Locations:** `src/worker/grader.ts:53-72`, `src/worker/grader.ts:113-131`, `src/worker/grader.ts:175-195`.

The structured schema does not require exactly one unique entry per requested team, the parser does not enforce it, and `gradeAnswers()` resolves duplicates with last-write-wins `Map.set`. A contradictory/malformed response is therefore partially trusted instead of being sent to review.

**Concrete repro / failing-test description:**

1. Grade pending answer `{team:1, text:"Atlantis"}` against a question whose row 1 is not Atlantis.
2. Have `callModel` return the schema-valid payload `{results:[{team:1,row:null,reason:"utanför"},{team:1,row:1,reason:"träff"}]}`. The real structured-output schema also permits this array.
3. The second entry overwrites the first in `byTeam`; row 1 passes bounds checking.
4. The returned row for Lag 1 has `rowIndex:0`, `needsReview:false`, and is subsequently awarded row 1's points.

Expected: duplicate, missing, extra, or contradictory team rows make that team (preferably the whole response) `needsReview`. Actual: an unmatched answer becomes a confident hit. This directly violates the grader's must-never-false-hit bar.

No additional `KNOWN-ISSUE` or `PARKED-FOR-ERIK` finding is warranted from this phase-2 diff; the items above are code defects with concrete §3 repros, not product-policy questions or later-phase omissions.

## Checked and found sound

- A non-empty team answer processed at or after `deadlineAt` runs `autoLock` first, is refused, and preserves the lock; explicit early lock also blocks later team answers. Locked questions cannot be resurrected by `resume` or `extend`.
- Pause stores remaining server time, clears the deadline/alarm, and resume derives a new deadline. Extension arithmetic for both running and paused clocks is correct.
- Normal successful transitions are assigned and persisted before alarm effects, broadcasts, acknowledgements, or grader execution. Stored state is loaded on construction, and the nominal persisted-`grading` recovery path re-runs grading.
- Answer keys are exactly `"<questionIndex>:<team>"`. `clearQuestion()` uses a colon-terminated prefix, so question 1 does not collide with question 10.
- `pointsForRank()` implements the specified 1–10 points / 11–15 zero rule. Totals parse the team component used by all internal keys; standings sort by total then stable team number; competition positions and tied winners are correct.
- A changed answer invalidates its stale nonmatching grade. `gradeResult` ignores rows whose `gradedText` no longer matches and does not overwrite a manual override. Overrides validate integer ranks 0–15 and recompute points from the selected row.
- Deterministic grading normalizes case, diacritics, punctuation, and aliases, and treats colliding aliases as ambiguous rather than as a hit. Model row numbers are converted from 1-based row ordinal to 0-based index correctly; null means a confident miss; missing teams and out-of-bounds rows become `needsReview`; call/parse failures flag unresolved answers rather than awarding points; non-`end_turn` responses are rejected.
- The socket attachment's normal happy path—claim, same-device reconnect, conflict refusal, and online release—keeps the expected team. The failures above are the uncovered revocation and one-device/multi-slot cases.
- Every declared admin command maps through `toEvent()`. Unknown commands and reducer refusals send explicit errors to admin; no listed command is simply dropped.
- No committed `.dev.vars` or credential-like key file exists. `.dev.vars` is ignored while `.dev.vars.example` contains placeholders only. The Worker reads secrets from bindings, `/health` returns booleans only, token comparison is timing-safe, and reviewed error responses/log calls do not echo either secret.

## Disagreement with a passing review

I would disagree with a pass. The happy-path tests prove an on-time alarm, a paused restart, unique-device claims, online release, and single-flight grading; they do not exercise the exact sequences above. In particular, the passing late-answer test uses a non-empty answer (the one refusal path that deliberately preserves auto-lock), and the restart test pauses the clock first, so neither test establishes the stronger guarantees claimed by §3.

Per the review instruction, I did not run tests or dependency/build commands in the builder's live worktree. The repros above are the tests I would add/run in a clean checkout.
