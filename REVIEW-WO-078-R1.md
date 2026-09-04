# REVIEW-WO-078-R1 — Sophies topp tio

**BOUNCE.** Five reproducible defects in *completed* phase-1/2 code sit on §3's must-be-flawless
list — headline: a schema-valid model response can turn an unmatched answer into a confident
scoring hit. The build's own 58 tests pass and the architecture is genuinely good; these are gaps
between the happy paths the tests cover and the refusal/revocation/race paths they don't.

Reviewed commit: **`6a616055d5846848cf90d46597f91417562efd90`** (branch `build/wo-078`, PR #1, draft).

> **Read this first, Erik — two operational notes, not code findings.**
> 1. **The builder was still running while I reviewed, in the same worktree.** It has since
>    committed past the sha I was given (HEAD is now `975e092`). I therefore reviewed in an
>    isolated clone: running `npm ci` in its worktree would have destroyed its `node_modules`
>    mid-run. A reviewer and a builder sharing one directory is an accident waiting to happen.
> 2. **R1 was dispatched against a deliberately-draft commit.** WORK_ORDER §8 *tells* the builder
>    to open a draft PR after phase 2; the PR body says "Not review-eligible until marked ready";
>    §9 says a PR whose e2e does not run is not review-eligible. Consider dispatching the loop on
>    "ready for review" rather than on push. **I did not park the round on this**, because the
>    findings below are defects in delivered phase-1/2 work and stand on their own evidence — and
>    with the party on Saturday, they are more useful to the builder now than after a policy
>    decision. Overrule me if you disagree.

## Preflight capability probe (mandatory)

| Probe | Result |
|---|---|
| `powershell -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'` | **PASS** — `5.1.26100.9168` |
| `powershell -NoProfile -Command "Test-Path 'C:\Users\erika\_coach\scripts\run-codex.ps1'"` | **PASS** — `True` |

Both passed; the cross-model gate ran for real. (My first probe attempt returned a parser error
from my own double-quoting — the outer shell expanded `$PSVersionTable`. Not a denial.)

## Independent clean run (fresh clone at the reviewed sha, not the builder's tree)

| §5 command | Result |
|---|---|
| `npm ci` | **PASS** |
| `npm run typecheck` | **PASS** — 3 tsc projects, strict |
| `npm test` | **PASS** — **58 / 58**, 6 files |
| `npm run build` | **FAIL** (exit 1) — `Cannot find module '<root>\scripts\build.mjs'` |
| `npm run e2e` | **FAIL** (exit 1) — same |
| live grader round | **NOT-RUN** — no key in a clean checkout (`.dev.vars` correctly gitignored) |

The two failures are **not** findings: `scripts/build.mjs`, `e2e/`, `public/`, `src/client/` were
still untracked phase 3–6 work at this sha. Expected for a phase-2 draft.

## Findings — all repro'd by me in the clean checkout

**1 · `grader-duplicate-team-rows-false-hit` — BOUNCE.** `src/worker/grader.ts:53-72,175-176`.
The JSON schema puts no uniqueness constraint on `team`, the parser enforces none, and
`gradeAnswers` resolves rows with last-write-wins `byTeam.set()`. A contradictory-but-schema-valid
response is therefore partly trusted. **Repro (green):** grade `{team:1,text:"Atlantis"}` with
`callModel` returning `{results:[{team:1,row:null,…},{team:1,row:1,…}]}` → the answer comes back
`rowIndex:0`, `needsReview:false`, `failed:false`, and is awarded row 1's points. This is §3's
"a grader that scores an unmatched answer as a hit", exactly. **Fix:** any team with duplicate,
missing or extra rows → `needsReview: true`.

**2 · `release-undone-by-offline-reconnect` — BOUNCE.** `src/shared/game.ts:168-177`,
`src/worker/game-do.ts:283-292`. `release` frees the slot, but the `released` signal is pushed
only to *live* sockets — an offline phone never clears the team it remembers. **Repro (green):**
A claims Lag 3 → goes offline → Erik releases Lag 3 (`kicked` is delivered to nobody) → A
reconnects with `hello{deviceId:A, team:3}` → slot is free → the claim is accepted and A is back
on Lag 3. Erik's runbook (§G) relies on exactly this control when a phone dies. §3: "an admin
control that silently does nothing" + reconnect identity. **Fix:** persist a revocation
(tombstone or per-slot generation) that survives the phone's absence.

**3 · `one-device-many-slots` — BOUNCE.** `src/shared/game.ts:155-166`; `game-do.ts:283-292`.
`claim` enforces "one device per slot" but not "one slot per device", and `kick()` matches on
`deviceId` only, ignoring the team. **Repro (green):** device A claims Lag 3, then Lag 5 → it
holds both; a second phone is refused `Lag 3 är redan taget` for a team nobody is playing. Codex's
extension, which I confirmed by reading: releasing Lag 1 then sends `released` to that device's
*Lag 2* socket while the server still has Lag 2 claimed to it — a phone on the tiles and a server
that says it has a team. **Fix:** move the device atomically on re-claim (or refuse), and match
team in `kick()`.

**4 · `autolock-discarded-on-refusal` — BOUNCE.** `src/shared/game.ts:86-88,99-105,179-182` vs
`src/worker/game-do.ts:268-281`. `autoLock()` can flip `open → locked`, but `refuse()` always
reports `changed:false` (and for the empty-answer path returns `prev`, discarding the lock
outright), and `apply()` only adopts/persists/broadcasts when `changed` is true. **Repro (green):**
a whitespace-only answer 1 s past the deadline → `error.code:"empty"`, `changed:false`,
`state.phase:"open"`. Same for an admin `pause` arriving late. `{type:"ping"}` (`game-do.ts:129-131`)
also re-sends state without running the reducer. Credit where due: the *non-empty* answer path
deliberately preserves the lock (`game.ts:187-192`, commented), so **no answer is ever accepted
late** — the exposure is the lock not landing at zero when the alarm is delayed, which Cloudflare
documents as possible. **Fix:** carry the auto-lock out of every refusal.

**5 · `fast-subgrade-ends-global-grading` — BOUNCE.** `src/shared/game.ts:204-206,298-323`.
Manual entry while `phase:"grading"` launches a second `GradeRequest`, and *any* `gradeResult` for
the current question sets `gradeStatus:"done"` and flips `grading → reveal`. **Repro (green):**
lock → "Rätta" (Lag 1 in flight) → Erik types Lag 2's answer by hand → that one-answer grade is an
exact pre-pass hit needing no model call, returns instantly, and jumps the whole game to `reveal`
with Lag 1 still ungraded and `gradeStatus:"done"`. Standings shown in that window are wrong until
the real result lands underneath. This is the runbook's own "if a phone dies, type its answer by
hand" path. **Fix:** count outstanding grade requests, or generation-stamp them.

**6 · `lobby-leaks-next-question` — known-issue** (→ `KNOWN-ISSUES-WO-078.md`).
`src/shared/view.ts:28-56`. `base()` builds the `question` object whenever one exists, including
during `lobby`. Row names are correctly masked; the question text is not. **Repro (green):** a
player view in the opening lobby already carries *"Vilka är EU:s tio folkrikaste länder efter
folkmängd, enligt Eurostat den 1 januari 2025?"* — every question is on the phones before Erik
asks it. Not on §3's list, so not a bounce, but it is a fairness hole in a quiz and the fix is one
conditional.

## Decision-ledger audit

Within authority. Nothing irreversible, no taste calls, no scope changes, no `main`, no deploy, no
merge — draft PR only, per §8. Documented §B-level deviations, all defensible: grader timeout 8 s
× 2 attempts rather than a flat 20 s (`grader.ts:39`, fits §2.5's budget); an added `/health`
returning booleans only; `QUESTION_SECONDS` / `ANTHROPIC_BASE_URL` test overrides left unset in
`wrangler.jsonc`; an added `backToReveal` command. None of these needed to park.

## Checked and found sound (absence of findings ≠ absence of checking)

- **Preflight probes** — both pass; the gate genuinely ran.
- **Secrets.** No `sk-ant-` or literal token anywhere in the committed tree; `.dev.vars` /
  `.dev.vars.*` ignored with `!.dev.vars.example` kept; nothing secret in `wrangler.jsonc`;
  `/health` returns booleans; `tokenOk()` uses `crypto.subtle.timingSafeEqual` behind a length
  check (`game-do.ts:367-374`); no error echoes a token.
- **Answers after lock.** `autoLock` runs at the top of *every* `reduce`, before the event — a late
  or lost alarm cannot let an answer in. Verified by repro, not just by reading.
- **Points & leaderboard.** `pointsForRank` (1–10 → rank, else 0); `standings` competition ranking
  (`1 + teams with strictly more points`) — ties share a position; `winners` handles a tie. I
  specifically checked the `"<qi>:<team>"` key scheme for a question-1/question-10 prefix
  collision: **not present** (`"10:3".startsWith("1:")` is false; `totals()` splits on `:`).
- **Grader, apart from finding 1.** Pre-pass is exact-normalised-match only and returns `ambiguous`
  (→ model) rather than guessing when a variant maps to two rows; model rows are bounds-checked;
  null → confident miss; missing team → `needsReview`; malformed JSON, non-`end_turn`, no key, and
  call failure all route to `flagAll` and never award points.
- **Manual-grade precedence.** `grade` skips manual grades; `gradeResult` won't overwrite one; a
  changed answer text invalidates a stale grade.
- **Persist-before-broadcast** (`game-do.ts:270-278`); DO restart mid-question reloads slots,
  answers and clock (passing test); mid-grading death resumes via a 500 ms alarm.
- **Clock control.** Pause stores remaining and clears the alarm; resume re-derives the deadline;
  extend is correct both running and paused; a locked question cannot be resurrected by
  `resume`/`extend`; an early alarm re-arms (`game-do.ts:164-167`).
- **Admin auth & completeness.** Every admin command passes `tokenOk` before `toEvent`; unknown
  commands error explicitly; refusals are sent *and* followed by a resync — no silent no-ops.
- **Data contract.** `buildQuiz` refuses missing slugs and any `verdict` outside
  `verified`/`corrected` (`bank.ts:81-95`), per §C.

**NOT-RUN — these block a MERGE verdict until closed, they are not waivers:**
1. `npm run build` / `npm run e2e` — rerun at the ready sha. Pass: exit 0, and the build's secret
   scan finds no `ANTHROPIC`/`ADMIN_TOKEN` string in `dist/`.
2. Live grader round on `test/fixtures/answers.json` with the real model. Pass: expected ranks
   match. Needs Erik's key in `.dev.vars`.
3. User-seat proof (9 contexts, 3 questions, artboard screenshots) — not possible without the UI.

## Cross-model gate

Codex (effort `high`) ran and **agrees — it independently called MERGE-BLOCK**, and found
findings 1, 2, 3 and 5, which I had missed or under-weighted; I verified each with my own repro
rather than taking its word. Two disagreements, both minor and both resolved by evidence: it
reported no known-issue material, but missed the lobby question leak (finding 6, repro'd); and it
did not run any test (it said so plainly), so every repro above is mine. Report:
`CODEX-REVIEW-WO-078-R1.md`.

## Fix list for round 2 — fix THIS list only

1. Grader: duplicate / missing / extra team rows in a model response → `needsReview`, never a hit.
2. Release must survive an offline phone's reconnect (persisted revocation).
3. One slot per device: atomically move or refuse a second claim; `kick()` must match team too.
4. Auto-lock must survive every refusal path (including empty answers); `{type:"ping"}` should run
   the reducer.
5. Grading must not end until all outstanding grade requests for the question settle.
6. File finding 6 in `KNOWN-ISSUES-WO-078.md` with repro + severity (or fix it — it is one line).

§4 non-goals remain binding. Do not widen scope; new observations go to
`KNOWN-ISSUES-WO-078.md`, not into this list.

<!-- pr-loop-verdict
{
  "recommendation": "BOUNCE",
  "commit": "6a616055d5846848cf90d46597f91417562efd90",
  "round": 1,
  "evidenceGate": {
    "satisfied": true,
    "evidence": "gradeAnswers() with a schema-valid duplicate-team model response ({results:[{team:1,row:null},{team:1,row:1}]}) returns rowIndex:0, needsReview:false, failed:false for answer 'Atlantis' -> unmatched answer scored as a confident hit; repro test green in a clean checkout at this sha, REVIEW-WO-078-R1.md finding 1"
  },
  "findings": [
    { "key": "grader-duplicate-team-rows-false-hit",
      "severity": "bounce",
      "summary": "The grader's JSON schema and parser allow several result rows for the same team; byTeam.set() keeps the last one, so a contradictory model response can turn an unmatched answer into a confident scoring hit instead of flagging it for review.",
      "evidence": "callModel returning {results:[{team:1,row:null,reason:'utanfor'},{team:1,row:1,reason:'traff'}]} for answer 'Atlantis' -> rowIndex:0, needsReview:false, failed:false; repro green in clean checkout",
      "file": "src/worker/grader.ts:175" },
    { "key": "release-undone-by-offline-reconnect",
      "severity": "bounce",
      "summary": "Admin 'release' only pushes the released signal to live sockets, so a phone that is offline when its slot is released walks straight back onto the same team on its next ordinary reconnect. This is the control Erik's runbook uses when a phone dies.",
      "evidence": "claim(team 3, device A) -> release(team 3) with no live socket (kicked delivered to nobody) -> claim(team 3, device A) again is ACCEPTED, slots[3] back to device A; repro green in clean checkout",
      "file": "src/shared/game.ts:168" },
    { "key": "one-device-many-slots",
      "severity": "bounce",
      "summary": "claim enforces one device per slot but not one slot per device, so a single deviceId can hold several teams; kick() then matches deviceId without team, so releasing one team detaches that device's socket for a different team while the server still has that team claimed.",
      "evidence": "device A claims team 3 then team 5 -> both slots held by A, second phone refused 'Lag 3 ar redan taget' for a team nobody plays; repro green in clean checkout",
      "file": "src/shared/game.ts:155" },
    { "key": "autolock-discarded-on-refusal",
      "severity": "bounce",
      "summary": "autoLock() can flip open->locked inside reduce(), but every refuse() path reports changed:false (the empty-answer path returns prev outright), and apply() only persists/broadcasts when changed is true, so an expiry noticed during a refused event is thrown away and the lock does not land at zero when the DO alarm is delayed.",
      "evidence": "whitespace-only answer 1 s past deadlineAt -> error.code 'empty', changed:false, state.phase still 'open'; admin pause 5 s late -> changed:false so apply() keeps 'open'; repros green in clean checkout",
      "file": "src/shared/game.ts:86" },
    { "key": "fast-subgrade-ends-global-grading",
      "severity": "bounce",
      "summary": "A manual answer typed while grading is in flight launches a second one-answer grade request, and any gradeResult for the current question sets gradeStatus done and moves grading->reveal, so a pre-pass-only sub-grade can jump the whole game to the reveal with other teams still ungraded and standings temporarily wrong.",
      "evidence": "lock -> grade (team 1 in flight) -> admin manualAnswer team 2 -> gradeResult for team 2 only -> phase 'reveal', gradeStatus '0':'done', grades['0:1'] undefined; repro green in clean checkout",
      "file": "src/shared/game.ts:314" },
    { "key": "lobby-leaks-next-question",
      "severity": "known-issue",
      "summary": "The player state view includes the upcoming question's title, host question and definition during the lobby phase, before Erik starts it. Row names are correctly masked but the question text is not, so a guest inspecting the websocket payload sees each question early. One-conditional fix; not on the WO-078 section 3 must-be-flawless list.",
      "evidence": "playerView() on the initial lobby state returns question.question = 'Vilka ar EU:s tio folkrikaste lander efter folkmangd, enligt Eurostat den 1 januari 2025?' while rows are all masked to null; repro green in clean checkout",
      "file": "src/shared/view.ts:28" }
  ],
  "designLayerFindings": [],
  "convergence": { "converged": false, "newSmallItems": 0 },
  "crossModel": { "ran": true, "model": "codex", "agrees": true,
                  "reportPath": "CODEX-REVIEW-WO-078-R1.md" }
}
-->
