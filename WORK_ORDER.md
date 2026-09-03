# WO-078 — Sophies topp tio: the quiz app for Saturday 5 Sept

> Created 2026-08-13 from the loop-design decisions
> (`research/2026-08-13-pr-loop-design-decisions.md`). Two artifacts per order, as in
> WO-001: a THIN queue record in `meta/build-queue/` (dispatch state only) and the
> FULL order in the target repo as `WORK_ORDER.md` (the build agent reads it from its
> worktree). This template is the FULL order. Sections marked (design-phase) are
> authored with Erik in the design session — never invented by the builder or reviewer.

## 1. Goal — from Erik's verbatim idea (design-phase)

The mission in Erik's own words (grill-against-verbatim: questions and scope trace to
his original capture, not to config knobs). One paragraph. If the operating model is
foggy, run /wayfinder BEFORE this order exists.

## 2. Acceptance criteria — user's seat (design-phase)

3–8 plain-language criteria typed to the WORK TYPE (build/product · change · research —
a research order has no `npm run actions` to prove; type the criteria accordingly).
"The user can do X." Restated by the builder at every phase boundary (goal-drift
counter). These are the fixed target for builder walkthrough, review, and Erik's
verdict alike.

## 3. Good-enough bar (design-phase — MANDATORY)

Severity calibration is Erik's, not the models'. 2–4 sentences:

- **Must be flawless:** <the classes of defect that always bounce — e.g. wrong
  answers in the core computation, silent failures, anything irreversible>
- **KNOWN-ISSUES material:** <latent/edge findings that get logged, not bounced —
  e.g. twice-a-year clock edges, cosmetic output, performance>
- **Out of scope:** <what the reviewer must not even raise as findings>

The reviewer APPLIES this bar; it never invents its own. An autonomous bounce
additionally requires the evidence gate (failing test / concrete repro).

**Research-lane default (Erik's call, WO-072, 2026-09-03):** for a research/analysis
deliverable, a citation that overstates what its source actually says is KNOWN-ISSUES
material, not a bounce, as long as the correction leaves the conclusion or recommendation
Erik would act on unchanged. It bounces only when the correction would flip that conclusion
or recommendation. This is the default when an order's own §3 is silent on citation
fidelity — an order may still override it explicitly.

## 4. Non-goals — "What this will NOT do" (design-phase — Erik signs off, MANDATORY)

What this order must NOT build, even if adjacent and tempting. Future work orders by
name where known. **Added 2026-08-13 (WO-001 post-mortem):** the headline non-goals
are ALSO restated at the TOP of the order in Erik's plain language ("this will tell
you when to book — it will never book for you"), and Erik explicitly acknowledges
that line in the design session before dispatch. WO-001 shipped exactly its written
scope, but Erik's mental picture (autonomous booker) never collided with the scope
(calculator) until PR review — the sign-off line is what would have caught it. The
PR body restates the same line up front.

## 5. Verification commands + user-seat proof

Both are REQUIRED for background dispatch (background-readiness bar): the exact
commands that must pass in a clean run, AND a concrete user-seat proof the builder
runs itself before opening the PR, attaching evidence (output/transcript/screenshot)
to the PR body. No proof attached = PR not review-eligible.

## 6. Decision ledger contract

The builder takes the recommended option on in-build decisions and KEEPS GOING —
except: irreversible actions (money, outbound, anything leaving the machine),
taste/identity calls, and changes to the goal itself, which stop the loop and park
for Erik. Every taken decision gets a ledger line in the PR body: what was decided,
why, at which commit (= the rewind point). Rewind = re-dispatch from that commit with
the answer swapped.

## 7. KNOWN-ISSUES-<WO-ID>.md

The build carries its own `KNOWN-ISSUES-<WO-ID>.md` in the repo root. Review findings
below the bounce bar land there (finding, repro, severity, date) so they are reachable
when troubleshooting. The builder moves an entry out only when actually fixing it.

**Per work order since WO-014 (§2.6).** A single shared `KNOWN-ISSUES.md` is one of the
three files every parallel build collided in at merge on 2026-08-17. Records written
before that still name the shared file and keep working — the loop resolves whichever of
the two exists (`scripts/pr-loop/lib/surfaces.mjs`).

## 8. Phase protocol

Phase-style commits on `build/wo-078`, `STATUS-<WO-ID>.md` heartbeat (file mtime =
liveness, never task state), goal + acceptance-criteria restatement at each phase
boundary. Never touch `main`, never merge. Push to the feature branch + PR open/update is
pre-authorized; everything else that leaves the machine is not.

**Heartbeat discipline (WO-014 §2.7, canonical since 2026-08-18):** touch the heartbeat at
every phase boundary **and at least every ~`loop.heartbeatIntervalMinutes` (currently 15)
minutes during any long operation** — a long verification run, a proof run, a single long
turn. Phase boundaries alone are not a heartbeat when one phase can outlive the stall
threshold: on 2026-08-17 a live builder went 48 minutes inside one turn without a touch and
the loop parked it as dead. `validateConfig` refuses a heartbeat interval that is not
strictly below the stall threshold, so a builder that obeys this literally can never be
read as stalled.

**One push per finished piece of work.** A push landing while a review is in flight
discards that review's verdict and costs a full round. Docs-only pushes are cheap since
WO-014 (the loop re-stamps the standing verdict rather than re-reviewing), but a push that
touches any code line is always a new round — so batch code changes.

## 9. Review contract

On PR open/update the canonical review job runs (`meta/build-queue/
REVIEW-PROMPT-TEMPLATE.md`): fresh session, cross-model gate, user-seat proof re-run
independently, severity judged against §3. Since WO-004 this is **automatic** — the
watcher fires it within one poll interval, and the builder never dispatches, authors or
frames its own review. Bounce rounds are fix-list-scoped and evidence-gated; the round
cap, the bonus round and the early-park threshold are config knobs in
`meta/build-queue/loop-config.json` (currently 5 + 1 bonus, park on a finding surviving
2 consecutive rounds), then park for Erik with history. Erik's verdict merges — always.

## 10. Dispatch pins

Model/effort (default opus/xhigh for autonomous builds, Erik 2026-08-12), canonical
dispatch recipe per the step-3 strategy doc (worktree, --bg, dontAsk + broad utility
allowlist, prompt via file).

---

> Scaffolded by `scripts/pr-loop/new-project.mjs` on 2026-09-03T14:43:05.382Z for repo `sophie-quiz`.
> The queue record `meta/build-queue/state/WO-078.json` is `queued` with
> `approved: false`. **Nothing is dispatched until that flag is true** — fill the
> (design-phase) sections with Erik first, then flip it.
