# WO-078 — Sophies topp tio: the quiz app for the party on Saturday 5 Sept 2026

> **Erik's plain-language headline (sign-off line, restated in the PR body):**
> This builds the phone app that eight teams and Erik use during the top-ten quiz at
> Sophie's 25th on Saturday 5 September 2026: teams claim a slot, see the question and a
> shared 150-second clock, type one answer, a model matches it against the list, Erik
> reveals the list row by row from his phone, and a leaderboard shows between questions.
> **What this will NOT do:** pick or research the ten lists (Erik's separate phase), let
> teams type their own names, double any question's points, show anything on a big screen
> (there is none), or touch the vault beyond reading the bank file. No Firebase, no
> Vercel: Cloudflare only.
>
> Written in a planning session with Erik on 2026-09-03 (Claude, interactive). Erik is
> producing the visual design in Claude Design (claude.ai/design) from the brief in
> `design/brief.md`; its export lands in `design/claude-design/` when ready. Until then the
> reference sketches in `design/reference/*.dc.html` and §E are the spec. **The build does
> not wait for the export**: if `design/claude-design/` exists at the start of the UI phase,
> lift values from it; if it lands mid-build, note it in the ledger and fold it in before the
> PR is marked ready; if it never lands, ship from §E.
> **`approved: false` — this is a proposal. Erik's go in Build plans is what starts it.**
>
> **Hard deadline: the app must be deployable and smoke-tested by Friday 4 Sept 18:00.**
> The party is Saturday. Paper answer sheets exist as plan B (`_coach/current/sophie-quiz/design.md`),
> so a late PR is survivable; a PR that looks done but is not is the one failure that is not.

## 1. Goal — from Erik's verbatim idea

Erik's own words, planning session 2026-09-03:

> I want to do the top ten quiz, only one answer per team, and it will be, like, ten
> questions. Pretty simple. [...] The Quiz will be in Swedish. [...] My idea is that it will
> be a QR code that the participants will scan to get into the app where we will log the
> answers. So it is eight teams, and each team will have one, like, connected to it. And
> then I will present, like, the questions, and then we will use LLM to determine if they
> were correct or not. So, basically, they will write like, a country if it is top ten
> countries, and then we will just use an LLM classifier to say if it was correct or not.
> So it is not about misspelling. So my thought is something like this. A start page where
> you pick what team you are representing, then, of course, there also needs to be an admin
> view for me. But all other participants pick a start team, so there will be, like, eight
> different phones. Then I will ask the question. The question will show up in the app as
> well, and this is when I, like, press button done in the admin page, then they have some
> time to answer. I think we should use, like, a timer. And after that, I will present the
> alternatives. like, number one, number two, number three, all the way. And then it would
> be cool if they got to know what number they were on. [...] And then there will be some
> kind of leaderboard in between the questions. and then it just moves on to the next
> question when I press that one. [...] The utmost importance is that there is no bug. You
> said no, like, lags or problems when we are at the party. So we need to think about how to
> design it. So only one from each team is logged in. And what happen if somebody takes
> control over the incorrect one and such and such. But all of that, I believe should be in
> your hands.

Rulings Erik gave in the same session (question box, 2026-09-03):

- Hosting: **Cloudflare Workers + Durable Objects.** Design: canvas first, then build in code
  from it. Look: **game show, dark, one neon accent, big numbers.** Admin: **Erik's phone.**
- Teams: **fixed names Lag 1 to Lag 8**, no typing.
- Timer: **150 seconds, the same countdown on every phone, Erik can pause it.**
- Scoring extras: **show each team its position after the reveal; Erik can override any
  grade from admin.** Question 10 does NOT count double (not selected).
- Fallback: **Erik can enter a team's answer by hand from admin.**
- API key: Erik provides an Anthropic key later, as a host secret; no model or PR ever
  sees it.

## 2. Acceptance criteria — user's seat

Build/product order. Each criterion is something Erik or a guest can do and see.

1. **Join.** A guest opens the app's URL on a phone (scanned from a QR code the repo
   provides as a printable page), sees eight big tiles Lag 1 to Lag 8, taps one, and is in.
   A second phone tapping the same tile is refused with "Lag 3 är redan taget" and can pick
   another. Erik can release any slot from admin; the released phone is sent back to the
   tiles with a message.
2. **Question.** When Erik taps "Starta fråga N" on admin, every joined phone shows the
   question text and a 150-second countdown within two seconds of each other. The countdown
   is server-authoritative: phones display the same remaining time (±1 s) even after a page
   reload, and answers lock on the server at zero regardless of what any phone shows.
3. **Pause and control.** Erik can pause and resume the countdown, add 30 seconds, or lock
   the answers early. Every phone follows within two seconds. A paused clock stays paused
   across an admin page reload.
4. **Answer.** A team types one free-text answer and taps send. The phone shows "Svar
   skickat" and the text; the team may change it any number of times until lock; the last
   text before lock is the one graded. An answer sent after lock is refused with a message.
   Admin shows, per team, "svar" / "väntar" / "offline" live.
5. **Grade.** On "Rätta", every submitted answer is matched to a row of the question's
   15-row list or to "utanför listan": misspellings, casing, diacritics, Swedish/English
   names and obvious synonyms match ("tjeckien", "Czechia", "Czech Republic" all match
   Tjeckien). Points = matched rank for ranks 1–10; ranks 11–15 and no match score 0 but
   the position 11–15 is still shown. Grading completes within 20 seconds; if the model is
   unavailable, exact-match grading applies and the rest are flagged "ogranskad" for Erik.
   Erik can tap any team's row on admin and set the rank by hand (0–15), before or after
   the reveal; the leaderboard follows.
6. **Reveal.** Erik taps "Visa nästa rad" up to ten times; phones show rows 1..n revealed
   and the rest hidden. The moment a team's matched row is revealed, its phone highlights
   "Ert svar: Portugal — plats 10 — 10 poäng". After row 10, rows 11–15 appear as "nära
   skott". "Visa alla" reveals everything at once.
7. **Standings.** "Visa ställningen" shows the cumulative leaderboard on every phone, the
   team's own row highlighted; ties share a position. "Nästa fråga" moves everyone on.
   After question 10, a final standings screen names the winner.
8. **Manual entry.** For any team, at any point of a question, Erik can type that team's
   answer on admin; it is graded and shown like any other.
9. **Resilience.** A phone that loses connection or is reloaded comes back to exactly the
   state the game is in, still as its team, with its answer intact. Killing and restarting
   the worker loses nothing: the whole game state is persisted. Admin shows "offline" for a
   team within 10 seconds of its socket dropping.
10. **Erik's runbook.** `SPELLEDNING.md` (Swedish) tells Erik, step by step, what to do
    Friday (set secrets, choose lists, deploy, smoke test with two phones, print QR) and
    Saturday (open admin, what each button does, what to do if a phone dies, how to reset
    a question, how to reset the whole game). Every command in it has been run by the
    builder.

## 3. Good-enough bar

- **Must be flawless:** any phone showing a different game state than the server for more
  than two seconds; a lost or mis-attributed answer; answers accepted after lock or a lock
  that does not happen at zero; wrong points arithmetic or wrong leaderboard order; a
  reconnecting phone landing on the wrong team or losing its answer; an admin control that
  silently does nothing; any path that puts the API key or the admin token in a bundle, a
  log, a PR or the vault; a grader that scores an unmatched answer as a hit.
- **KNOWN-ISSUES material:** cosmetic deviations from the design canvas; animation
  smoothness; font fallback on old Android; behaviour with more than eight teams or more
  than ten questions; performance beyond nine simultaneous clients; the grader's judgment
  on genuinely ambiguous answers (Erik overrides those by design).
- **Out of scope for findings:** the content of the lists (the bank is Erik's, verified
  separately); taste on colour, type or copy beyond "matches the canvas"; anything under §4.

## 4. Non-goals — "What this will NOT do"

- Does not choose, research or verify the ten lists. `data/quiz.json` ships with ten
  placeholder slugs from the bank so the app is fully testable; Erik swaps them Friday.
- No team-typed names, no per-player accounts, no double points, no bonus rounds, no
  På spåret format, no spectator or big-screen view, no sound.
- No Firebase, Vercel, Railway or laptop hosting. No framework migration if the first
  choice works.
- Does not write to the vault. Reads one file: `C:\Users\erika\_coach\current\sophie-quiz\top-ten-bank.json`
  (via `npm run sync-bank`, which snapshots it into `data/bank.json`).
- Does not create the Cloudflare account, run `wrangler login`, or create the API key —
  those are Erik's hands (§F). If they are missing when the build reaches deploy, the PR
  says so in its first line and the local proof stands in.
- **No merging, ever.** The pull request waits for Erik on GitHub.
- Erik acknowledges the headline line above at approval (Build plans card).

## 5. Verification commands + user-seat proof

All must pass in a clean checkout, real output in the PR body:

```
npm ci
npm run typecheck          # tsc --noEmit, strict
npm test                   # vitest: state machine, scoring, grader parsing + fallback, DO integration (workers pool / miniflare)
npm run e2e                # playwright against `wrangler dev`: 8 player contexts + 1 admin through 3 full questions
npm run build              # client bundle + worker; asserts no ANTHROPIC or ADMIN_TOKEN string in dist/
```

The e2e run must cover, and the PR must list by name: double-claim refusal; release and
re-claim; answer change before lock; answer refused after lock; server lock at zero with a
client whose clock is 30 s wrong; pause across admin reload; +30 s; manual entry; override;
reveal row by row with highlight timing; reconnect mid-question with answer intact; worker
restart mid-question with state intact; grader fallback when the model call fails.

**User-seat proof (attached to the PR body):** a recorded Playwright trace or screen video of
one full three-question game with nine browser contexts, plus screenshots of each of the
eight canvas screens as built, side by side with the artboard. If `ANTHROPIC_API_KEY` is
present in `.dev.vars` at build time, one live grading round with the real model on the
sample answers in `test/fixtures/answers.json` (expected ranks included) is part of the
proof; if it is absent, the PR says "live grader unproven — needs Erik's key" in its first
paragraph.

If `wrangler whoami` succeeds in the build environment, the builder deploys to
`<name>.workers.dev` and includes the URL and a phone screenshot; otherwise the exact
deploy commands are in `SPELLEDNING.md` and the PR's first paragraph says deploy is pending
Erik's login.

## 6. Decision ledger contract

Per template: the builder takes the recommended option on in-build decisions and keeps
going; irreversible actions, taste calls and changes to the goal park for Erik. Ledger
lines in the PR body with rewind commits. Deviations from the architecture in §B are
allowed with a ledger line saying why; deviations from the rules in §A are not.

## 7. KNOWN-ISSUES-WO-078.md

Repo file, as usual. Findings below the bounce bar land there with repro + severity.

## 8. Phase protocol

Branch `build/wo-078`, worktree `.claude/worktrees/wo-078`, `STATUS-WO-078.md`
heartbeat (mtime = liveness, touched at least every 15 minutes), goal + acceptance criteria
restated at phase boundaries. Never touch `main`. Suggested phases: (1) scaffold + state
machine + tests; (2) Durable Object + WebSocket transport + persistence; (3) player UI from
the canvas; (4) admin UI from the canvas; (5) grader + fallback; (6) e2e + runbook + proof.
Open the PR after phase 2 as a draft so the loop sees liveness; mark ready after phase 6.

## 9. Review contract

Canonical automatic review per `REVIEW-PROMPT-TEMPLATE.md`: fresh session, cross-model
gate, independent user-seat re-run, severity judged against §3. The reviewer runs the e2e
suite itself; a PR whose e2e does not run in the reviewer's checkout is not review-eligible.
Erik's verdict merges — always.

## 10. Dispatch pins

Builder fable/xhigh (standing default), reviewer per `loop-config.json`.

---

## A. Rules of the game (fixed — from Erik)

- 8 teams, fixed names **Lag 1 … Lag 8**. One phone per team. 10 questions.
- Each question is one top-ten list from the bank. The phone shows `host_question_sv`
  and `definition_sv`; Erik reads them aloud (there is a microphone, no screen).
- One free-text answer per team per question. 150 s shared countdown. Erik can pause,
  resume, add 30 s, lock early. Lock at zero is automatic.
- Points = rank of the matched row if 1–10; rank 11–15 = 0 points but shown as "plats N";
  no match = 0. No doubling. Cumulative leaderboard; ties share a position.
- Erik can override any grade (0–15) and enter any team's answer by hand.
- Reveal is Erik's show: row by row from 1 to 10, then 11–15 as near misses.
- Everything guests see is in Swedish. Code, comments and docs for the builder in English;
  `SPELLEDNING.md` in Swedish.

## B. Architecture (recommended; deviate with a ledger line)

- **One Cloudflare Worker (TypeScript)** with Workers Static Assets serving `public/`
  (player page `/`, admin page `/admin`, QR page `/qr`), and **one Durable Object class
  `Game`**, one instance (`idFromName("sophie-2026")`), SQLite-backed storage, **WebSocket
  Hibernation API** for all clients. The DO is the single source of truth; clients never
  compute state, they render what the DO sends.
- **Wire protocol:** JSON messages. Server → client: one message type `state` carrying the
  full public state (phase, question index, list header, `deadlineAt` epoch ms,
  `pausedRemainingMs`, `serverNow`, revealed row count, my team's answer + grade,
  standings). Full state on every change and on connect; no deltas, so a dropped message
  never matters. Client → server: `claim`, `answer`, `ping`; admin additionally `start`,
  `pause`, `resume`, `extend`, `lock`, `grade`, `revealNext`, `revealAll`, `standings`,
  `next`, `release`, `manualAnswer`, `override`, `resetQuestion`, `resetGame` (the last two
  need a confirm token from the UI). Every admin message carries the admin token.
- **Time:** the DO stores `deadlineAt`; clients render `deadlineAt - (Date.now() + offset)`
  where `offset = serverNow - Date.now()` from the last state message. A DO **alarm** at
  `deadlineAt` performs the lock; pausing clears the alarm and stores remaining ms.
- **Identity:** player page generates a random `deviceId` (localStorage) on first open;
  `claim {team, deviceId}` binds the slot; the DO refuses a different `deviceId` for a bound
  slot; `release` clears the binding and tells that device to go back to the tiles. The
  admin page is `/admin?t=<ADMIN_TOKEN>`; the token is a Worker secret, never in the bundle.
- **Persistence:** every state transition is written to DO storage before it is broadcast;
  on DO restart, state is loaded from storage; answers keyed `(questionIndex, team)`.
- **Client:** vanilla TypeScript, no framework, one small bundle each for player and admin
  (esbuild or Vite). Reconnect with backoff (0.5 s → 5 s), full resync on open,
  "Återansluter…" pill while closed. Fonts from Google Fonts with system fallbacks; the
  page must be usable with fonts blocked.
- **Grader:** see §D. Runs inside the DO on `grade`; result stored; admin override stored
  on top and marked `manual`.
- **Data:** `data/bank.json` (snapshot of the vault bank, `npm run sync-bank`) and
  `data/quiz.json` = `{ "questions": ["<slug_en>", ... 10 slugs], "durationSeconds": 150 }`.
  Both are bundled into the worker at build time. Changing the ten lists is an edit to
  `quiz.json` plus `npm run deploy`; no code change.
- **Secrets:** `ANTHROPIC_API_KEY`, `ADMIN_TOKEN` via `wrangler secret put`; locally in
  `.dev.vars` (gitignored). `.dev.vars.example` committed.

## C. Data contract

`data/bank.json` is the vault file verbatim: `{ generated_on, count, lists: [ { no,
slug_en, category, title_sv, definition_sv, host_question_sv, source_name, source_url,
as_of, verdict, items: [ { rank, name_sv, value, unit } × 15 ] } ] , rejected, duplicates }`.
Use `slug_en` as the stable id, `host_question_sv` as the question, `title_sv` as the
reveal heading, `definition_sv` as the small print, `items[].name_sv` as the row label and
`value` + `unit` as the row's right-hand value (format large numbers Swedish-style, e.g.
83,6 milj for 83 577 100 invånare, or show the raw value if no sensible abbreviation).
Only `verdict` in `verified` or `corrected` lists may be used as placeholders in `quiz.json`.

## D. Grader specification

- One model call per question, all eight answers at once, after lock. Input: the list's 15
  rows (rank, name_sv) and the answers `{team, text}`. Output via structured outputs
  (`output_config.format`, JSON schema): `[{ team, rank: 1–15 | null, reason }]`.
- Model `claude-opus-5`, `output_config.effort: "low"`, `max_tokens` 1024, adaptive
  thinking default, timeout 20 s, one retry on 429/5xx/network. Use `@anthropic-ai/sdk`
  (it runs on Workers with `fetch`). Include the server-side refusal fallback
  (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) and check
  `stop_reason` before reading content.
- **Deterministic pre-pass first:** normalise (lowercase, trim, strip diacritics and
  punctuation) and exact-match against `name_sv` and a small alias table in
  `data/aliases.json` (English names, common short forms — the builder seeds it for the
  ten placeholder lists and Erik's chosen lists get the same treatment Friday via the
  runbook). Exact hits are final without the model; only the remainder goes to the model,
  which sees the pre-pass results for consistency.
- **Rules given to the model:** a match means the same entity as one row, in any spelling,
  language or common alias; a different entity that is merely similar is not a match; when
  two rows are plausible, choose none and say why; never invent rows.
- **Fallback:** if the call fails twice or returns unparsable output, the unresolved answers
  are stored as `unmatched, needsReview: true`; admin shows them flagged "ogranskad" for
  Erik to set by hand; the game never blocks on the model.
- Cost is irrelevant at this scale (ten calls). Correctness and latency are what matter.

## E. Design brief

Precedence: `design/claude-design/` (Erik's Claude Design export: standalone HTML or the
handoff bundle) if present, else `design/reference/*.dc.html`. Both share these values;
where the export differs, the export wins:

- Background `#0a0b10` with the radial glow `#1a1f33` at the top; surfaces `#12141d`
  and `#171a26`; borders `#1f2333` and `#2a2f44`; text `#f2f3f7`, secondary `#c9cddb`,
  muted `#8a90a6`; **accent `#d8ff3d`**; danger `#ff6b8a` on `#2a1420`.
- Type: **Bebas Neue** for numbers and headings, **IBM Plex Sans** 400/500/600 for text.
  Sizes as in the artboards (countdown 64 px on player, 88 px on admin; team name in the
  lobby 140 px; leaderboard points 30 px).
- Eight screens: Main (Välj lag), Lobby, Question, Locked, Reveal, Leaderboard, Admin
  (question open), AdminReveal. Phones 390 × 844 in the canvas; the real app is fluid
  from 360 px up, primary buttons 56 px tall, tap targets never under 44 px.
- No emoji, no fake status bar, no decorative gradients beyond the one glow. Motion: one
  reveal transition (row slides in, team box lights up); nothing else animates.

## F. Erik's hands (before or during the build — not the builder's)

1. ~~Create a Cloudflare account and run `npx wrangler login`~~ **Already in place (checked 3 Sept 16:50):** a Cloudflare account exists ("Erik.aarup@live.se's Account", id 3230330a438cc5c59b377e1834847e76) and `CLOUDFLARE_API_TOKEN` is a user-level Windows environment variable, so `npx wrangler whoami` succeeds in any shell under Erik's account, the builder's included. Do not run `wrangler login`; it refuses while the token is set. If `wrangler deploy` reports a missing scope (Workers Scripts, Durable Objects, Workers Assets), the PR's first paragraph names it and Erik widens the token at dash.cloudflare.com/3230330a438cc5c59b377e1834847e76/api-tokens.
2. Create an Anthropic API key at console.anthropic.com with a spend cap, and write it as
   `ANTHROPIC_API_KEY=...` into `.dev.vars` in the repo root (gitignored). The builder or
   the runbook pushes it to Cloudflare with `wrangler secret put`.
3. Approve this order in Build plans.
4. Friday: pick the ten lists (separate session) → `data/quiz.json` → `npm run deploy` →
   smoke test with two phones per `SPELLEDNING.md` → print `/qr`.

## G. Party-day runbook (what `SPELLEDNING.md` must cover)

Before guests arrive: open `/admin?t=…` on the phone, keep the screen awake, check the
"Ansluten" pill, run "Nollställ spelet". During: start question → read aloud → watch the
team grid → pause if the room needs it → lock at zero → "Rätta" → read the list row by row
with "Visa nästa rad" → "Visa ställningen" → "Nästa fråga". If a phone dies: type its
answer by hand or release the slot and let a new phone claim it. If the model stalls:
grade the flagged rows by hand. If everything dies: the paper sheets.
