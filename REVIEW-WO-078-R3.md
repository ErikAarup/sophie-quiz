# REVIEW-WO-078-R3 — Sophies topp tio

**BOUNCE — one finding, one fix, and it is small.** All six items on the R2 fix list are
genuinely fixed and the full §5 chain is green in a clean clone. But grade requests still have
no identity, so `Nästa fråga` tapped while a hand-typed answer is being graded **discards that
grade** — and if the Worker restarts in that window the points are gone for good and no admin
control can put them back.

Reviewed commit: **`be468fbbb15c2cfba04c223cd49073f4d9c9d87b`** (branch `build/wo-078`, PR #1).

> **Erik — read this before the word "bounce" lands wrong.** This round is a big step forward,
> not a repeat. Rounds 1 and 2 bounced on the same five defects because the builder was still
> mid-build and had never been handed the list. This round it was, and it acted: `da1f6db` is
> titled "R1 review fixes" and rewrites exactly the two files that had gone untouched for two
> rounds. **All five old keys are closed**, each with a regression test at unit *and* DO/e2e
> level — which also closes the real gap R2 named, that the old suite passed 65 tests and 13
> e2e scenarios *with* the defects present. Five bounce findings became one. That is the loop
> converging, and the R2 policy question (dispatch on "ready for review" rather than on push)
> resolved itself in practice, so I have **not** re-parked it.
>
> **The one remaining defect is worth the round.** I had this report drafted as a MERGE, with
> the reset-question variant filed as a known-issue on reachability grounds. The cross-model
> gate then found a second route through the same root cause that I had missed — one that runs
> straight through a flow your own runbook tells you to use — and I reproduced it myself before
> accepting it. That is exactly what the gate is for, and it is why "evidence wins" is the rule.

## Preflight capability probe (mandatory, run before any review work)

| Probe | Result |
|---|---|
| `powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"` | **PASS** — `5.1.26100.9168` |
| `powershell -NoProfile -Command "Test-Path 'C:\Users\erika\_coach\scripts\run-codex.ps1'"` | **PASS** — `True` |

Both passed, so the gate ran for real. Note for the next reviewer: run these through the
**Bash** tool with single quotes. Through the PowerShell tool the outer shell expands
`$PSVersionTable` into the command text and it dies on a parser error — mine did, once.

## Independent clean run

Reviewed in a **fresh clone at the reviewed sha**, not the builder's tree: `npm ci` in the
worktree would destroy the `node_modules` the builder and the gate are using. R1 and R2 did
the same.

| §5 command | Result |
|---|---|
| `npm ci` | **PASS** |
| `npm run typecheck` | **PASS** — 3 tsc projects, strict |
| `npm test` | **PASS** — **77 / 77**, 7 files (65 at R2; +12 regression tests) |
| `npm run build` | **PASS** — secret scan clean |
| `npm run e2e` | **PASS** — **14 / 14** (13 at R2; the new one is the offline-release scenario) |
| user-seat proof (`npm run proof`) | **PASS** — full 3-question game, 9 contexts, 8 screens captured |
| live grader round | **NOT-RUN** — yours to close, see below |

All fourteen §5-named scenarios ran under their own names, including double-claim refusal,
release/re-claim, **release while the phone is offline**, answer-after-lock refusal, server lock
at zero with a 30 s-wrong client clock, pause across admin reload, +30 s, manual entry, override,
reveal row by row, reconnect with answer intact, worker restart, and grader fallback.

## Fix-list verification (R2's six items are the scope)

My repros are in `test/unit/r3-verify.test.ts` in my clone — **30 tests, all green**, i.e. every
R2 defect now behaves correctly. Command:
`npx vitest run --project unit test/unit/r3-verify.test.ts`.

| # | R2 item | Verdict | Evidence at `be468fb` |
|---|---|---|---|
| 1 | Grader: duplicate / missing / extra rows → `needsReview`, never a hit | **FIXED** | `grader.ts:184-194` validates the response set: duplicate → `flagAll` (`:191`), extra team → `flagAll` (`:190`), missing → `needsReview` (`:198-201`), out-of-range row → `needsReview` (`:208-211`). R2's headline repro (`{results:[{team:1,row:null},{team:1,row:1}]}` for "Atlantis") now returns `rowIndex:null, needsReview:true, failed:true`. |
| 2 | Auto-lock survives every refusal; `{type:"ping"}` runs the reducer | **FIXED** | `autoLock()` runs at the top of `reduce()` and its `changed` flows through `done()`, which `refuse()` now calls — `game.ts:170,177-188`. The empty-answer path is `refuse('empty', …)`, not `return prev` — `:244`. `{type:'ping'}` → `tick` → the reducer — `game-do.ts:135-140`. Whitespace answer, late pause and a refused `revealNext` all land the lock. |
| 3 | Grading must not end until every outstanding request settles | **FIXED for the route R2 found; the accounting is still incomplete** | `gradePending` — `game.ts:341,365-373`; R2's repro (manual answer while the batch is in flight) now holds at `phase:'grading'` until both settle, and a second `Rätta` is refused `busy` with a message (`:326`). But the counter is a bare scalar keyed on the question *index*, which is finding 1 below. |
| 4 | Release survives an offline phone's reconnect | **FIXED** | `claimGen[team]`, persisted, bumped on release and reset — `game.ts:229,472`; an `auto` re-claim must present the matching token — `:197-203`. The phone stores it and returns it in `hello` — `player.ts:52-62,77,91`. Also covered end-to-end (`e2e/join.spec.ts:56`). |
| 5 | One slot per device; `kick()` matches team | **FIXED** | `claim` moves the device off any other slot it holds and bumps that slot's generation — `game.ts:206-215`; `kick()` matches `(deviceId, team)` — `game-do.ts:305`. Device A claiming Lag 3 then Lag 5 holds only Lag 5, and Lag 3 is offered to a real second phone. |
| 6 | Fix **or** file `lobby-leaks-next-question` | **FIXED (in code)** | `view.ts:33` masks the whole question object for players while `phase === 'lobby'`: `question` is `null`, `rows` is `[]`, before question 1 and between questions; admin still sees it (`:155`). Visible in the user seat — `proof/screens/2-lobby.png` shows the team name and nothing about the list. |

## Findings

**1 · `grade-request-has-no-identity` — BOUNCE.** `src/shared/game.ts:41,138-148,347-375,428-445`;
`src/worker/game-do.ts:57-65`. A `gradeResult` is matched to work in progress by *question index*
alone — never by the request that asked for it — while `next` and `clearQuestion` zero
`gradePending` unilaterally. Two routes, one root cause, one fix.

*Route A — the one that costs points (found by the cross-model gate, reproduced by me).*
`SPELLEDNING.md:158-166` tells you that you can type or correct a team's answer from the team
sheet "även efter att ställningen visats". Do that during the standings and a model call goes
out (`game.ts:252-256`). Tap **Nästa fråga** before it returns — the button is never disabled
(`admin.ts` sets `disabled` only on pause/extend/lock/grade, `:325-328`) — and `next` is
accepted, sets `gradePending` to 0 and moves on. That team's points for the finished question
are missing from every leaderboard until the request happens to land. **If the DO is evicted in
that window, they are gone permanently:** the constructor only re-grades when
`phase === 'grading' || gradePending > 0` (`game-do.ts:57`), and both are now false. And you
cannot repair it by hand — `override` is refused outright in the lobby and otherwise addresses
only the *current* question (`game.ts:381,384`), so a past question's grade is unreachable from
admin. That is §3's "wrong points arithmetic or wrong leaderboard order", plus §2.9's "killing
and restarting the worker loses nothing".
Repro, green in my clone (`test/unit/r3-probe3.test.ts`, 3 tests):
`npx vitest run --project unit test/unit/r3-probe3.test.ts` — standings with Lag 1 graded →
admin types Lag 1 a new answer (`gradePending:1`, old grade correctly invalidated) → `next`
accepted → `questionIndex:1`, `gradePending:0`, `grades['0:1']` undefined, Lag 1's standings
points 0; restart condition evaluates false; `override` cannot reach `0:1`.

*Route B — the same hole via `Nollställ frågan` (found independently by me and the gate).*
`resetQuestion` zeroes the counter while a call is in flight but keeps the same question index,
so if you reset a question mid-grading and replay it, the *first* request's late result
decrements the *second* request's counter: the game jumps to `phase:'reveal'`,
`gradeStatus:'done'`, nobody graded. Repro in `test/unit/r3-probe2.test.ts`. This one needs you
to beat the model's response window (3.4 s in the live proof, 16 s worst case) and it self-heals
when the real batch lands — on its own I had it as a known-issue. It shares Route A's fix.
A harmless third symptom of the same cause: a stale result stamps `gradeStatus` `done`/`failed`
on a question that was just reset; the label is unused in the lobby and the next real `Rätta`
clears it.

**The fix is small.** Put an id or epoch on `GradeRequest`, echo it back in `gradeResult`, and
ignore any result whose id is not outstanding — then `next`/`resetQuestion` can drop requests
safely because a dropped id can no longer settle anything. Separately, either refuse `next`
while `gradePending > 0` (with a message — never silently) or let the DO finish the request
before advancing, so Route A cannot lose the grade at all.

**2 · `stale-claim-token-refused-with-the-wrong-reason` — known-issue.** `game.ts:200-202`,
`view.ts:111`. A phone holding `sq.team` in `localStorage` without a matching `sq.token` — one
that claimed under a build from before `claimGen` existed, or that lost the one key — has its
automatic re-claim refused and is told *"Erik släppte Lag 3. Välj lag igen."* when you did no
such thing. Recovery is one tap, and the runbook already has you run **Nollställ spelet** before
guests arrive (`SPELLEDNING.md:138`), which is the right cure. Copy nit; the gate found the same
thing independently. → `KNOWN-ISSUES-WO-078.md`.

**3 · `regression-tests-miss-two-routing-details` — known-issue** (the gate's; I checked it and
it holds). `test/unit/game.test.ts:376-407`, `test/do/game.test.ts:88-94`. The new auto-lock test
drives the reducer's `tick` directly but never sends a JSON `{type:"ping"}` through the DO, and
the DO move test reuses a single socket whose attachment has already moved to the new team, so it
does not actually assert that `kick()` spares a second socket of the same device on a different
team. Both implementations read correctly and I traced them by hand — this is test-coverage debt,
not a demonstrated failure. → `KNOWN-ISSUES-WO-078.md`.

## Decision-ledger audit

**Within authority.** Nothing irreversible, no taste calls, no scope changes. `main` is untouched
(`origin/main` is still at `d6ebdba`, the pre-build commit); PR #1 is **OPEN, not merged**, base
`main`, head `build/wo-078`, marked ready rather than draft — which is §8's own instruction after
phase 6. The deploy to `sophie-quiz.erik-aarup.workers.dev` is pre-authorised by §F.1 and asked
for by §5. New this round and all defensible: `workers_dev: true` + `preview_urls: false` in
`wrangler.jsonc` (fewer public surfaces — good instinct), the admin failure toast firing once per
question rather than on every state update, and `pointer-events: none` on toasts so a notice can
never swallow one of your taps. R2's documented §B deviations (8 s × 2 grader timeout, `/health`,
`backToReveal`, `config.ts`) still stand and still need no parking. Nothing here needed your
sign-off.

## Checked and found sound (absence of findings ≠ absence of checking)

- **Preflight probes** — both pass; the gate genuinely ran.
- **Full §5 chain, run by me** in a clean clone at the reviewed sha: `npm ci`, typecheck, 77 tests,
  build + secret scan, 14 e2e, plus the proof run.
- **A regression test per fix-list item**, which is what R2 actually asked for. Unit: the
  `R1 review fixes` block in `test/unit/game.test.ts`, three grader-validation cases in
  `test/unit/grader.test.ts`, the mask and claim-token cases in `test/unit/view.test.ts`. DO level:
  reconnect-by-token, offline-release, one-slot-per-device in `test/do/game.test.ts`. E2E: the new
  `join.spec.ts:56`.
- **My own 35-test suite** (`r3-verify`, `r3-probe2`, `r3-probe3`): every R2 repro replayed and
  asserted correct, plus probes for regressions in the changed paths — manual override still beats
  the model before and after the reveal; a changed answer invalidates its stale grade and is
  re-graded; a released team keeps its answer and the next phone sees it; a late result for a
  *previous* question cannot disturb the current one; the move-kick hits only the socket bound to
  the team that was given up; and the everyday route R2 bounced on (manual answer while `Rätta` is
  in flight) is genuinely closed.
- **User seat.** The proof game plays start to finish. I looked at the screens: dark ground,
  `#d8ff3d` accent, Bebas numerals, Swedish throughout, no emoji; the lobby now shows the team name
  and nothing else; the reveal masks rows 7–15 with Swedish number formatting (`83,6 milj`); admin
  shows the countdown, per-team `svar` / `väntar` / `offline`, and every control §2 promises.
- **The runbook's other promises match the code.** `SPELLEDNING.md:172-174` sends you down the
  dead-phone paths — type the answer by hand, or release the slot — which are exactly what R1 and
  R2 bounced on; both are now backed by passing tests, and line 165's "deras svar och poäng finns
  kvar" is true (answers key on the team, not the phone). The one promise that is *not* kept is
  line 158-166's "even after the standings are shown", which is finding 1.
- **Secrets.** `git grep` over the committed tree at this sha finds no real key: only
  `.dev.vars.example` placeholders, the runbook's `sk-ant-…` illustration and the e2e's own
  `e2e-admin-token`. Build secret scan clean; no `ANTHROPIC` / `ADMIN_TOKEN` in the client bundle.
- **No client-side scoring**; both clients render `st.standings` from the server.
- I re-verified R1's and R2's "sound" lists still hold: points arithmetic, competition ranking with
  shared tie positions, persist-before-broadcast, manual-grade precedence, the constant-time admin
  token check, and the DO's recovery when it dies while `phase === 'grading'`.

**NOT-RUN — a to-do, not a waiver:**
1. **Live grader round.** `npm run grader:live` with `ANTHROPIC_API_KEY` in `.dev.vars`; pass =
   every expected rank in `test/fixtures/answers.json` matched. I did not run it: it is a real paid
   call on your key, which your standing rule says I ask about first. The builder's own run is in
   `proof/live-grader.txt` — 8/8, `usedModel=true`, 3.4 s, timestamped 18:27 local, i.e. *after*
   the pre-pass-echo fix — but that is its claim, not my verification. Close it Friday as part of
   the runbook's §2.5 smoke test.

## Cross-model gate

**Codex (effort `high`) ran and agrees — it independently called MERGE-BLOCK**, from a cold read,
and reached all six fix-list verdicts identically to mine. It earned its keep twice this round:
it found **Route A of finding 1, which I had missed**, and it executed its own reducer repro for
it; and it independently found the mixed-version claim-token issue. I reproduced both of its
merge-blocking claims myself before accepting either — the executed repros above are mine.
Its limits, which it states plainly: it ran `npm test` and `npm run typecheck` but no `npm ci`,
no build, no e2e, no proof, no live model, no deployed smoke test.
**One disagreement, resolved on evidence:** I had Route B (reset-question) as a known-issue on
reachability and Codex called it merge-blocking. Its Route A carries the §3 evidence on a
documented flow, and both share one root cause and one fix, so I have merged them into a single
bounce finding rather than split the fix. Report: `CODEX-REVIEW-WO-078-R3.md`.

## Fix list for round 4 — fix THIS list only

Short list. Everything from R2 is closed; do not re-open it.

1. **Give grade requests an identity.** Put an id/epoch on `GradeRequest`, echo it back on
   `gradeResult`, and ignore any result whose id is no longer outstanding, so a stale result can
   never settle or discard a later request. This closes both routes and the stale-`gradeStatus`
   label with them.
2. **`Nästa fråga` must not silently drop outstanding grading work.** Either refuse `next` while
   `gradePending > 0` with a message on admin (never silently), or let the request finish before
   advancing. Whichever you choose, a Worker restart in that window must not lose the grade —
   `game-do.ts:57`'s recovery condition has to cover it.
3. **File findings 2 and 3 in `KNOWN-ISSUES-WO-078.md`** with repro and severity.

Add a regression test per item, including one that asserts a stale `gradeResult` cannot move the
counter, and one that covers the restart path. §4 non-goals remain binding; new observations go to
`KNOWN-ISSUES-WO-078.md`, not into this list.

<!-- pr-loop-verdict
{
  "recommendation": "BOUNCE",
  "commit": "be468fbbb15c2cfba04c223cd49073f4d9c9d87b",
  "round": 3,
  "evidenceGate": {
    "satisfied": true,
    "evidence": "npx vitest run --project unit test/unit/r3-probe3.test.ts -> 3/3 green in a clean clone at be468fb, documenting the defect: from standings with Lag 1 graded, an admin-typed answer for Lag 1 launches a grade request (gradePending:1, old grade invalidated), and 'next' is then accepted with no guard -> questionIndex:1, gradePending:0, grades['0:1'] undefined, Lag 1's standings points 0. The DO restart condition (phase==='grading' || gradePending>0) evaluates false, so the request is never re-submitted, and override cannot address a past question (refused 'phase' in lobby; targets the current question otherwise). Second route in test/unit/r3-probe2.test.ts: resetQuestion mid-grade then a replay -> the first request's late result settles the second's counter -> phase 'reveal', gradeStatus 'done', nobody graded. Separately verified GREEN: all six R2 fix-list items (test/unit/r3-verify.test.ts, 30/30), npm test 77/77, typecheck, npm run build, npm run e2e 14/14, npm run proof."
  },
  "findings": [
    { "key": "grade-request-has-no-identity",
      "severity": "bounce",
      "summary": "Grade results are matched to outstanding work by question index alone, never by the request that asked for them, while 'next' and clearQuestion() zero the gradePending counter unilaterally. Route A: tapping 'Nasta fraga' while an admin-typed answer is being graded (a flow SPELLEDNING.md:158-166 explicitly offers, on a button that is never disabled) discards that grade - the team's points for the finished question vanish from every leaderboard until the request happens to land, permanently if the Durable Object is evicted first, because the DO's restart recovery only fires when phase==='grading' or gradePending>0 and neither now holds. It cannot be repaired by hand either: override is refused in the lobby and otherwise addresses only the current question, so a past question's grade is unreachable from admin. Route B: resetQuestion mid-grading keeps the same question index, so the first request's late result settles a later request's counter and the game jumps to the reveal with nobody graded (self-heals in seconds; not merge-blocking alone). Both share one root cause and one fix: an id/epoch on GradeRequest echoed back in gradeResult, plus a guard so 'next' cannot silently drop outstanding work. NOTE FOR THE EARLY-PARK GUARD: this is NOT R2's 'fast-subgrade-ends-global-grading', which is closed and verified closed - it is a new, adjacent defect in the same accounting, hence a new key.",
      "evidence": "npx vitest run --project unit test/unit/r3-probe3.test.ts -> 3/3 green: standings with Lag 1 graded -> admin answer for Lag 1 (gradePending:1) -> next accepted -> questionIndex:1, gradePending:0, grades['0:1'] undefined, Lag 1 standings points 0; restart condition false; override refused 'phase' in lobby and writes '1:1' once question 2 starts. Route B: npx vitest run --project unit test/unit/r3-probe2.test.ts -> stale result after resetQuestion+replay gives phase 'reveal', gradeStatus 'done', grades['0:1'] and grades['0:2'] undefined. Cross-model gate reproduced both independently.",
      "file": "src/shared/game.ts:428" },
    { "key": "stale-claim-token-refused-with-the-wrong-reason",
      "severity": "known-issue",
      "summary": "A phone that has sq.team in localStorage but no matching sq.token - one that claimed under a build from before claimGen existed, or that lost that single key - has its automatic re-claim refused and is shown 'Erik slappte Lag 3. Valj lag igen.' when no release happened. The slot may still be held by that same deviceId. Recovery is one tap on the tile, and the runbook already has Erik run 'Nollstall spelet' before guests arrive, which cures it entirely. Wrong-reason copy on a deployment edge, not a state defect. Found independently by the reviewer and the cross-model gate.",
      "evidence": "src/shared/game.ts:200-202 refuses an auto claim when event.token !== state.claimGen[team]; migrateState (game.ts:102-115) gives a slot persisted without claimGen generation 0 while the phone sends token:null, so null !== 0 refuses; the refusal message at :201 names a release that did not happen.",
      "file": "src/shared/game.ts:200" },
    { "key": "regression-tests-miss-two-routing-details",
      "severity": "known-issue",
      "summary": "Test-coverage debt in this round's new regression tests, not a product failure - both implementations were traced by hand and read correctly. The auto-lock test drives the reducer's 'tick' event directly and never sends a JSON {type:'ping'} through the Durable Object, so the DO's ping-to-tick wiring is untested. The DO one-slot-per-device test reuses a single socket whose attachment has already been moved to the new team before kick() runs, so it never asserts the actual guarantee - that with two sockets sharing one deviceId, only the socket whose attachment matches the kicked team receives 'released'. Raised by the cross-model gate, verified by the reviewer.",
      "evidence": "test/unit/game.test.ts:376-407 and test/do/game.test.ts:88-94 read against src/worker/game-do.ts:135-139 and :295-310; no test sends a JSON ping through the DO, and no test opens two sockets with the same deviceId on different teams.",
      "file": "test/do/game.test.ts:88" }
  ],
  "designLayerFindings": [],
  "convergence": { "converged": true, "newSmallItems": 1 },
  "crossModel": { "ran": true, "model": "codex", "agrees": true,
                  "reportPath": "CODEX-REVIEW-WO-078-R3.md" }
}
-->
