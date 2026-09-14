# This repo runs under the vault contract

Erik's `_coach` vault is the system this repo's work is judged by, even though the vault
lives somewhere else on disk. A session or a dispatched build here obeys both of these:

- **The contract:** `C:\Users\erika\_coach\agents.md`. Read it first, every session.
- **The build standard:** `C:\Users\erika\_coach\meta\build-queue\BUILD-STANDARD.md`.
  It is how Erik judges a build. Read it before you start one, not after.

Both paths are absolute because they are outside this checkout. If your tools cannot reach
them, say so and stop rather than building without them.

## Repo-only rules

Read `CLAUDE.local.md` in this repo if it is there. It holds the rules that belong to this
codebase alone, and it wins on anything specific to this repo.

## Learnings go back through the vault, not into it

Never write to the vault from here. What you learned, what broke, what should change goes
into the pull request body and the heartbeat file; a coach session folds it into the vault.
A direct write from a project repo is how the vault ends up with two answers to one question.
