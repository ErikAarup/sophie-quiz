# REVIEW-WO-078-R2 — Sophies topp tio

**BOUNCE.** All five R1 bounce findings are still present, byte-for-byte: `src/shared/game.ts` and
`src/worker/grader.ts` are **unchanged since the sha R1 bounced**. I re-reproduced all five myself
in a clean checkout. Everything else about the build is in good shape — the full §5 chain is green
and a three-question game plays start to finish.

Reviewed commit: **`61c4aae61f1f7a2df42c4258a10adc481ecdbf2d`** (branch `build/wo-078`, PR #1).

> **Read this first, Erik — the round-2 result is a dispatch-timing artefact, not a builder that
> ignored you.** R1's report file was written at **17:56**; `61c4aae` was committed at **17:59** as
> "phase 6: e2e suite green". `git diff 6a61605 61c4aae -- src/` touches only `client/*`,
> `view.ts` (admin status rule), `config.ts` and a 6-line presence fix — **none of the fix-list
> files**. The same is true at the builder's current HEAD (`3a4c585`, 18:13). The builder was
> executing its own phases 3→6 and never consumed the R1 fix list.
>
> **Consequence you should know about:** these five keys have now survived two consecutive rounds,
> which is what the early-park guard matches on. It will park the loop — mechanically correct, but
> for the wrong reason. The builder has not yet had one round in which it was given the list and
> asked to fix it. I'd give it that round rather than treating this as a converged failure.
> This is the same policy point R1 raised (dispatch on "ready for review", not on push); like R1, I
> have **not** parked the round on it, so the fix list actually reaches the builder before Saturday.
> `designLayerFindings` is empty deliberately — the bounce stands on its own evidence either way.
> Overrule me if you'd rather stop the loop and decide the policy first.

## Preflight capability probe (mandatory)

| Probe | Result |
|---|---|
| `powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"` | **PASS** — `5.1.26100.9168` |
| `powershell -NoProfile -Command "Test-Path 'C:\Users\erika\_coach\scripts\run-codex.ps1'"` | **PASS** — `True` |

Both passed; the cross-model gate ran for real. (My first launch died on `2>&1 | Out-String` — PS 5.1
turns a native tool's stderr line into a terminating `NativeCommandError`. My own quoting bug, not a
denial; relaunched without the redirect and it ran.)

## Independent clean run

Reviewed in a **fresh clone at the reviewed sha**, not the builder's tree — the builder was still
writing in the worktree while I reviewed (files touched 18:09; it has since committed `3a4c585`).
`npm ci` in its directory would have destroyed its `node_modules` mid-run. R1 hit the same thing.

| §5 command | Result |
|---|---|
| `npm ci` | **PASS** |
| `npm run typecheck` | **PASS** — 3 tsc projects, strict |
| `npm test` | **PASS** — **65 / 65**, 7 files |
| `npm run build` | **PASS** — secret scan clean |
| `npm run e2e` | **PASS** — **13 / 13** |
| user-seat proof (`--project proof`) | **PASS** — full 3-question game, 8 canvas screens captured |
| live grader round | **NOT-RUN** — see below |

R1's NOT-RUN items 1 and 3 are now **closed**. All thirteen §5-named scenarios ran under their own
names, including double-claim refusal, release/re-claim, answer-after-lock refusal, server lock at
zero with a 30 s-wrong client clock, pause across admin reload, +30 s, manual entry, override,
reveal row by row, reconnect with answer intact, worker restart, and grader fallback.

## Fix-list verification (R1's list is the scope)

| # | R1 item | Verdict | Evidence at `61c4aae` |
|---|---|---|---|
| 1 | Duplicate/missing/extra grader rows → `needsReview` | **NOT FIXED** | `grader.ts` unchanged since `6a61605`. `byTeam.set()` is last-write-wins, no uniqueness check — `src/worker/grader.ts:175-176`. |
| 2 | Release survives an offline phone's reconnect | **NOT FIXED** | No revocation in state — `src/shared/game.ts:168-177`; `helloPlayer` re-claims the remembered team — `src/worker/game-do.ts:191`. |
| 3 | One slot per device; `kick()` matches team | **NOT FIXED** | `claim` checks only the target slot — `src/shared/game.ts:155-166`; `kick()` matches `deviceId` only — `src/worker/game-do.ts:287-293`. |
| 4 | Auto-lock survives every refusal; `ping` runs the reducer | **NOT FIXED** | `refuse()` forces `changed:false` — `src/shared/game.ts:86-88`; the empty-answer path still returns `prev` — `:182`. Raw `ping` still bypasses the reducer — `game-do.ts:92-99`. |
| 5 | Grading ends only when all requests settle | **NOT FIXED** | No outstanding-request counter; any current-question result flips `grading → reveal` — `src/shared/game.ts:314-320`. |
| 6 | Lobby leak fixed **or** filed | **NOT FIXED, NOT FILED** | `base()` still populates the question during `lobby` — `src/shared/view.ts:45-56`; `KNOWN-ISSUES-WO-078.md` has 8 entries, none this one. |

## Findings

My repros are in `test/unit/r2-repro.test.ts` in my clone — **6 tests, all green**, i.e. every
defect still fires. Command: `npx vitest run --project unit test/unit/r2-repro.test.ts`.

**1 · `grader-duplicate-team-rows-false-hit` — BOUNCE.** `src/worker/grader.ts:175-176`.
`gradeAnswers` with `callModel` → `{results:[{team:1,row:null},{team:1,row:1}]}` for answer
`"Atlantis"` returns `rowIndex:0`, `needsReview:false`, `failed:false` — an unmatched answer scored
as a confident hit and awarded row 1's points. §3's worst defect, verbatim.

**2 · `release-undone-by-offline-reconnect` — BOUNCE.** `src/shared/game.ts:168-177`,
`src/worker/game-do.ts:191`. claim(Lag 3, device A) → A offline → release(Lag 3) (`kicked` reaches
nobody) → A reconnects → the auto-claim is **accepted**, A is back on Lag 3. This is the exact
dead-phone recovery path `SPELLEDNING.md` §3 tells Erik to use. §3: "an admin control that silently
does nothing".

**3 · `one-device-many-slots` — BOUNCE.** `src/shared/game.ts:155-166`, `game-do.ts:287-293`.
Device A claims Lag 3 then Lag 5 → holds both; a real second phone is refused
`"Lag 3 är redan taget"` for a team nobody is playing. `kick()` ignores the team, so releasing one
sends that device's *other* socket to the tiles while the server still has that team claimed —
a phone on the tiles and a server that disagrees.

**4 · `autolock-discarded-on-refusal` — BOUNCE.** `src/shared/game.ts:86-88,182`.
A whitespace-only answer 1 s past the deadline → `error.code:"empty"`, `changed:false`,
`phase:"open"`: the auto-lock computed at the top of `reduce()` is thrown away, so `apply()` never
persists or broadcasts it. A late admin `pause` behaves the same. Credit where due: a *non-empty*
late answer deliberately carries the lock (`game.ts:187-192`), so **no answer is ever accepted
late** — the exposure is the lock not landing at zero when the DO alarm is delayed.

**5 · `fast-subgrade-ends-global-grading` — BOUNCE.** `src/shared/game.ts:204-206,314-320`.
Lock → "Rätta" (Lag 1 in flight) → Erik types Lag 2's answer by hand → that pre-pass-only grade
returns first and flips the whole game to `phase:"reveal"`, `gradeStatus:"done"`, with Lag 1's grade
`undefined`. Standings are wrong for that window. Again the runbook's own dead-phone path.

**6 · `lobby-leaks-next-question` — known-issue** (→ `KNOWN-ISSUES-WO-078.md`).
`src/shared/view.ts:45-56`. `playerView()` in the opening lobby already carries
*"Vilka är EU:s tio folkrikaste länder efter folkmängd…"*. Rows are correctly masked; the question
text is not. Not on §3's list, so not a bounce — but it is a fairness hole in a quiz, and the fix is
one conditional.

**7 · `review-dispatched-before-builder-consumed-fixlist` — parked-for-Erik.** Policy, not code.
See the note at the top: rounds 1 and 2 were both dispatched against mid-build commits, so the
bounce loop is measuring phases, not fixes. Only you can decide whether the loop should dispatch on
"ready for review".

## Decision-ledger audit

**Within authority.** Nothing irreversible, no taste calls, no scope changes, no `main`, no merge.
Documented §B deviations are all defensible: grader timeout 8 s × 2 attempts rather than a flat 20 s
(`grader.ts:39`, fits §2.5's budget), an added `/health` returning booleans only, an added
`backToReveal` command, `config.ts` extracted because workerd only allows handlers/classes as named
exports of the entry module. None needed to park. One thing for you, not a finding: the builder
**deployed** at `3a4c585` — §F.1 pre-authorises that, and §5 asks for it, so it is in bounds.

## Checked and found sound (absence of findings ≠ absence of checking)

- **Preflight probes** — both pass; the gate genuinely ran.
- **Full §5 chain** — `npm ci`, typecheck, 65 tests, build, 13 e2e, all green in a clean clone at
  the reviewed sha, run by me.
- **User seat** — the `proof` project plays a full three-question game with eight teams and Erik and
  captures all eight canvas screens. I looked at them: dark ground, the `#d8ff3d` accent, Bebas
  numerals, Swedish throughout, no emoji. Reveal shows rows 1–6 with the rest masked and Swedish
  number formatting (`83,6 milj` — §C's own example). The flow genuinely completes as its user.
- **Secrets.** No `sk-ant-` in the committed tree beyond `.dev.vars.example`, the runbook's
  placeholder and the scanner's own literal; build's secret scan clean; no `ANTHROPIC`/`ADMIN_TOKEN`
  in the client bundle.
- **No client-side scoring.** Both clients render `st.standings` from the server; nothing computes
  points or order locally.
- **Presence fix (new in this sha) is correct** — a raw `ping` now refreshes `lastSeen`
  (`game-do.ts:92-99`), and admin status gives `offline` precedence for a claimed team
  (`view.ts:121-131`). Covered by a new DO test.
- **Runbook** (`SPELLEDNING.md`) is present, in Swedish, and covers Friday (keys, lists, deploy,
  smoke test, QR, plan B) and Saturday (per-question buttons, overrides, failure modes) per §G.
- I re-verified R1's "sound" list still holds: points arithmetic, competition ranking with shared
  tie positions, persist-before-broadcast, manual-grade precedence, admin token constant-time check.

**NOT-RUN — blocks the verdict until closed, not a waiver:**
1. **Live grader round.** `npm run grader:live` with `ANTHROPIC_API_KEY` in `.dev.vars`; pass =
   expected ranks in `test/fixtures/answers.json` match. I did not run it: the key lives in the
   builder's worktree and a real paid call is yours to authorise, not mine. The builder reports 8/8.

## Cross-model gate

**Codex (effort `high`) ran and agrees — it independently called MERGE-BLOCK**, reaching the same six
items from a cold read, before seeing my repros. Two notes: it adds that *extra* team rows are
silently ignored too (same fix), and that while the alarm is late an admin JSON ping keeps returning
the stale `open` phase. It ran no test suite, typecheck, build or e2e and says so plainly — so every
executed repro above is mine. **No substantive disagreement.** Report: `CODEX-REVIEW-WO-078-R2.md`.

## Fix list for round 3 — fix THIS list only

Unchanged from R1, because none of it landed. In defect-severity order:

1. Grader: duplicate, missing **or extra** team rows in a model response → `needsReview`, never a hit.
2. Auto-lock must survive every refusal path, including the empty-answer path that returns `prev`;
   `{type:"ping"}` should run the reducer.
3. Grading must not end until all outstanding grade requests for the question settle.
4. Release must survive an offline phone's reconnect (persisted revocation/tombstone).
5. One slot per device: atomically move or refuse a second claim; `kick()` must match team too.
6. Fix or file `lobby-leaks-next-question` in `KNOWN-ISSUES-WO-078.md` with repro + severity.

Add a regression test per item — the existing 65 tests and 13 e2e scenarios all pass *with* these
defects present, which is the real gap. §4 non-goals remain binding; new observations go to
`KNOWN-ISSUES-WO-078.md`, not into this list.

<!-- pr-loop-verdict
{
  "recommendation": "BOUNCE",
  "commit": "61c4aae61f1f7a2df42c4258a10adc481ecdbf2d",
  "round": 2,
  "evidenceGate": {
    "satisfied": true,
    "evidence": "npx vitest run --project unit test/unit/r2-repro.test.ts -> 6/6 green in a clean clone at 61c4aae, i.e. all five R1 defects still fire. Headline: gradeAnswers() with a schema-valid duplicate-team model response ({results:[{team:1,row:null},{team:1,row:1}]}) for answer 'Atlantis' returns rowIndex:0, needsReview:false, failed:false -> unmatched answer scored as a confident hit. git diff 6a61605 61c4aae -- src/shared/game.ts src/worker/grader.ts is EMPTY: neither fix-list file was touched."
  },
  "findings": [
    { "key": "grader-duplicate-team-rows-false-hit",
      "severity": "bounce",
      "summary": "The grader's JSON schema and parser allow several result rows for the same team; byTeam.set() keeps the last one, so a contradictory model response turns an unmatched answer into a confident scoring hit instead of flagging it for review. Extra rows for teams that were not asked about are silently ignored as well. Unchanged since round 1 - grader.ts was never touched.",
      "evidence": "callModel returning {results:[{team:1,row:null,reason:'utanfor'},{team:1,row:1,reason:'traff'}]} for answer 'Atlantis' -> rowIndex:0, needsReview:false, failed:false; repro green in a clean clone at 61c4aae (test/unit/r2-repro.test.ts)",
      "file": "src/worker/grader.ts:175" },
    { "key": "autolock-discarded-on-refusal",
      "severity": "bounce",
      "summary": "autoLock() can flip open->locked inside reduce(), but every refuse() path reports changed:false and the empty-answer path returns prev outright, and apply() only persists/broadcasts when changed is true. An expiry noticed during a refused event is therefore thrown away, so the lock does not land at zero when the DO alarm is delayed. A raw 'ping' also re-sends state without running the reducer. Unchanged since round 1.",
      "evidence": "whitespace-only answer 1 s past deadlineAt -> error.code 'empty', changed:false, state.phase still 'open'; late admin pause -> changed:false; both repros green in a clean clone at 61c4aae (test/unit/r2-repro.test.ts)",
      "file": "src/shared/game.ts:86" },
    { "key": "fast-subgrade-ends-global-grading",
      "severity": "bounce",
      "summary": "A manual answer typed while grading is in flight launches a second one-answer grade request, and any gradeResult for the current question sets gradeStatus done and moves grading->reveal. A pre-pass-only sub-grade therefore jumps the whole game to the reveal with other teams still ungraded and standings temporarily wrong. This is the runbook's own 'if a phone dies, type its answer by hand' path. Unchanged since round 1.",
      "evidence": "lock -> grade (team 1 in flight) -> admin manualAnswer team 2 -> gradeResult for team 2 only -> phase 'reveal', gradeStatus['0'] 'done', grades['0:1'] undefined; repro green in a clean clone at 61c4aae (test/unit/r2-repro.test.ts)",
      "file": "src/shared/game.ts:314" },
    { "key": "release-undone-by-offline-reconnect",
      "severity": "bounce",
      "summary": "Admin 'release' only pushes the released signal to live sockets, so a phone that is offline when its slot is released walks straight back onto the same team on its next ordinary reconnect, because helloPlayer auto-claims the remembered team. This is the control Erik's runbook uses when a phone dies. Unchanged since round 1.",
      "evidence": "claim(team 3, device A) -> release(team 3) with no live socket (kicked delivered to nobody) -> claim(team 3, device A) again is ACCEPTED, slots[3] back to device A; repro green in a clean clone at 61c4aae (test/unit/r2-repro.test.ts)",
      "file": "src/shared/game.ts:168" },
    { "key": "one-device-many-slots",
      "severity": "bounce",
      "summary": "claim enforces one device per slot but not one slot per device, so a single deviceId can hold several teams; kick() then matches deviceId without team, so releasing one team detaches that device's socket for a different team while the server still has that team claimed. Unchanged since round 1.",
      "evidence": "device A claims team 3 then team 5 -> both slots held by A, a second phone is refused 'Lag 3 ar redan taget' for a team nobody plays; repro green in a clean clone at 61c4aae (test/unit/r2-repro.test.ts)",
      "file": "src/shared/game.ts:155" },
    { "key": "lobby-leaks-next-question",
      "severity": "known-issue",
      "summary": "The player state view includes the upcoming question's title, host question and definition during the lobby phase, before Erik starts it. Row names are correctly masked but the question text is not, so a guest inspecting the websocket payload sees each question early. One-conditional fix; not on the WO-078 section 3 must-be-flawless list. Round 1 asked for it to be fixed OR filed in KNOWN-ISSUES-WO-078.md; neither happened.",
      "evidence": "playerView() on the initial lobby state returns question.question = 'Vilka ar EU:s tio folkrikaste lander efter folkmangd, enligt Eurostat den 1 januari 2025?' while rows are all masked to null; KNOWN-ISSUES-WO-078.md has 8 entries, none of them this one",
      "file": "src/shared/view.ts:45" },
    { "key": "review-dispatched-before-builder-consumed-fixlist",
      "severity": "parked-for-erik",
      "summary": "Process, not code. Rounds 1 and 2 were both dispatched against mid-build commits: R1's report was written 17:56, the R2 sha 61c4aae was committed 17:59 as 'phase 6', and git diff 6a61605..61c4aae -- src/ touches none of the fix-list files (same at the builder's later HEAD 3a4c585). The builder was executing its own phases 3-6 and never consumed the R1 fix list, so the five repeated keys measure dispatch timing rather than a builder that tried and failed. The early-park guard will nevertheless see the same five keys twice. Erik decides whether the loop should dispatch on 'ready for review' rather than on push; R1 raised the same point and also declined to park on it.",
      "evidence": "git log: R1 report file mtime 2026-09-03 17:56, commit 61c4aae authored 17:59:22, 3a4c585 authored 18:13:17; git diff 6a61605 61c4aae -- src/shared/game.ts src/worker/grader.ts is empty, and git diff 61c4aae 3a4c585 -- src/ is empty",
      "file": "WORK_ORDER.md:191" }
  ],
  "designLayerFindings": [],
  "convergence": { "converged": false, "newSmallItems": 0 },
  "crossModel": { "ran": true, "model": "codex", "agrees": true,
                  "reportPath": "CODEX-REVIEW-WO-078-R2.md" }
}
-->
