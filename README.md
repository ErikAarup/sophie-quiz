# Sophies topp tio: the quiz app for Saturday 5 Sept

The phone app for the top-ten quiz at Sophie's 25th (WO-078). Eight teams (Lag 1–8) claim a
slot on their phones, see the question and a shared 150-second clock, type one answer, a model
matches it against the list, Erik reveals the list row by row from his phone, and a leaderboard
shows between questions. Swedish UI. Cloudflare Workers + one Durable Object; nothing else.

**Erik's runbook (Swedish): [`SPELLEDNING.md`](SPELLEDNING.md).** Contract: `WORK_ORDER.md`.
Sub-bar findings: `KNOWN-ISSUES-WO-078.md`. Build heartbeat: `STATUS-WO-078.md`.

## Layout

| Path | What |
|---|---|
| `src/shared/` | Types, the pure game state machine (`game.ts`), scoring, normalisation + alias pre-pass, per-role views. No I/O; fully unit-tested. |
| `src/worker/` | Worker entry (`index.ts`), the `Game` Durable Object (`game-do.ts`: hibernating WebSockets, storage alarm that locks at zero, persistence before broadcast), the grader (`grader.ts`), quiz loader (`bank.ts`). |
| `src/client/` | Vanilla TypeScript for the player page (`player.ts`), admin page (`admin.ts`), QR page (`qr.ts`); reconnecting socket with clock offset (`ws.ts`). |
| `public/` | The three HTML shells and `styles.css` (tokens from `design/reference`). Built into `dist/public` and served as static assets. |
| `data/` | `bank.json` (snapshot of the vault bank via `npm run sync-bank`), `quiz.json` (the ten slugs + duration), `aliases.json` (extra spellings the pre-pass accepts). |
| `test/unit`, `test/do`, `test/live` | Vitest: pure modules (Node), the DO inside workerd (workers pool), one real model call (needs a key). |
| `e2e/` | Playwright: its own `wrangler dev` on port 8788 with a mock Anthropic server, 13 named scenarios + the recorded three-question proof game. |
| `design/` | Brief, reference sketches and the Claude Design export folder. |
| `proof/` | Screenshots as built vs artboards, live grader output (written by `npm run proof`, `scripts/proof-artboards.mjs`, `npm run grader:live`). |

## Commands

```
npm ci
npm run typecheck      # tsc --noEmit, strict, three projects (worker / client / node)
npm test               # vitest: unit + Durable Object integration (workerd)
npm run e2e            # playwright: 8 player contexts + 1 admin, mock model, worker restart
npm run build          # client bundles + worker dry run; fails if a secret string is in dist/
npm run dev            # build client + wrangler dev on http://127.0.0.1:8787 (uses .dev.vars)
npm run deploy         # build + wrangler deploy
npm run proof          # the recorded three-question game + canvas screenshots → proof/
npm run grader:live    # one real grading round on test/fixtures/answers.json (needs ANTHROPIC_API_KEY)
npm run sync-bank      # copy the vault bank into data/bank.json
```

Secrets: `ANTHROPIC_API_KEY` and `ADMIN_TOKEN` in `.dev.vars` locally (gitignored; see
`.dev.vars.example`), pushed to Cloudflare with `npx wrangler secret bulk .dev.vars`. The admin
page is `/admin?t=<ADMIN_TOKEN>`; every admin message carries the token and the DO checks it.

## Fork this for your own quiz

This was built for one specific party, so a few things are named for that. Everything under
`WORK_ORDER.md`, `STATUS-WO-078.md`, `KNOWN-ISSUES-WO-078.md`, `SPELLEDNING.md` and the
`REVIEW-*`/`CODEX-REVIEW-*` files is build/review history from that project — safe to ignore or
delete. The app itself is generic.

To run your own evening:

1. **Swap the questions.** `data/quiz.json` lists the ten slugs to run, in order, plus
   `durationSeconds`. Each slug must exist in `data/bank.json` — an array of lists, each with a
   `slug_en`, Swedish title/definition/host question, a `source_url`, and up to 15 ranked `items`
   (`rank`, `name_sv`, `value`, `unit`). Copy an existing entry as a template; `npm test` checks
   that every slug in `quiz.json` resolves.
2. **Set your own secrets.** Copy `.dev.vars.example` to `.dev.vars` and fill in
   `ANTHROPIC_API_KEY` (used to grade free-text answers) and `ADMIN_TOKEN` (anything you like —
   it's just a shared secret checked on every admin action, not meant to withstand a real
   attacker). Push them with `npx wrangler secret bulk .dev.vars` before deploying.
3. **Deploy under your own Cloudflare account.** `wrangler.jsonc` names the Worker `sophie-quiz`
   and defaults to `<name>.<your-account>.workers.dev` — rename `name` if you want a different
   URL, then `npm run deploy`.
4. **Optional: your own printed cheat sheet.** `npm run festpaket` (`scripts/festpaket.mjs`)
   generates a PDF with the question order, answer sheets and your admin link, built from
   whatever's currently in `data/quiz.json`/`data/bank.json`/`.dev.vars`.

## How it fits together

- The DO is the single source of truth. Every client action is one JSON message; every change is
  persisted to DO storage and then broadcast as the **full** state to every socket (players get a
  view with hidden rows masked and their own result only once the row is revealed).
- The clock is the server's: `deadlineAt` + a storage alarm. Phones render
  `deadlineAt - (Date.now() + offset)` with `offset` taken from every state message. Any event
  arriving after the deadline locks first, so a late alarm can never let an answer in.
- Grading: normalise + exact match against row names and `data/aliases.json`; only the remainder
  goes to `claude-opus-5` (structured output, effort low, 8 s timeout, one retry). If the model
  fails, those answers are flagged "ogranskad" and Erik sets the rank by hand; the game never
  waits on the model.
