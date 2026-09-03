# STATUS — WO-078 (sophie-quiz)

> Heartbeat file. **File mtime = liveness**, never task state. The PR-loop watcher reads
> this file's mtime: older than the stall threshold while the queue record says `running`
> means the build is stalled, and the loop repairs or parks it.
>
> Touch it at every phase boundary **and at least every ~15 minutes during any
> long operation** (WO-014 §2.7) — a phase that outlives the stall threshold looks exactly
> like a crash from the outside, and on 2026-08-17 that parked a live builder.
>
> Per-work-order filename (WO-014 §2.6): a shared repo-root `STATUS.md` is what made every
> parallel build hand-resolve the same merge conflict.

- **phase:** not started
- **state:** queued
- **last update:** (set by the build agent — read the clock, never state a time from memory)
- **blocker:** none

## Acceptance criteria

Restated verbatim from `WORK_ORDER.md` §2 at every phase boundary — the goal-drift counter.

## Decision ledger

| # | Decision | Why | Commit |
|---|---|---|---|

## Parked for Erik (needs-erik)

_none_

## Phase log
