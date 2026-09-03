# WO-078 — build heartbeat

**Branch:** `build/wo-078` · **Worktree:** `C:\Users\erika\projects\sophie-quiz\.claude\worktrees\wo-078`
**Stamped by the loop at dispatch:** 2026-09-03T14:51:02.979Z
**Phase:** 6 — clean-install chain green (npm ci, typecheck, 65 tests, 13 e2e, build, proof) at 18:05; DEPLOYED to https://sophie-quiz.erik-aarup.workers.dev (18:09, second attempt after a transient API reset), secrets set, /health ok, deployed smoke with admin + 3 phones OK (18:12). Remaining: final commit + push, PR body, mark ready.
**Last touch:** 2026-09-03 18:12 +02:00 (clock read)
Earlier: fourth e2e run in progress (17:55). Run 3: 10/11 passed; the failure exposed two real bugs, both fixed: the admin lobby screen never refreshed the team grid (blank statuses), and an idle phone's text pings did not refresh presence when the DO was awake (would read "offline" after 8 s). New DO test covers the second; 65 unit+DO tests green.
**Last touch:** 2026-09-03 17:55 +02:00 (clock read)
Earlier: third e2e run in progress. Run 2: 5 passed, 4 failed → fixed: taken tiles stay tappable so the server's "redan taget" refusal shows (§2.1), admin status rule offline > svar > väntar/ledig, reconnect scenario uses a client drop hook + offline emulation, strict-mode selector. Live grader round with the real model PASSED (8/8 sample answers). Phases 3–5 committed (975e092) and pushed; artboards rendered to proof/artboards.
**Last touch:** 2026-09-03 17:51 +02:00 (clock read; the two previous touches were written as 17:56 and 18:05 from memory and were wrong — real times were about 17:44 and 17:49)
**Draft PR:** https://github.com/ErikAarup/sophie-quiz/pull/1 (opened after phase 2)

> Reset at dispatch so this file can never show the PREVIOUS work order's status
> (WO-019 §2.6). Everything below this line is written by WO-078
> and by nothing else. If it still reads like this well past dispatch, the builder never
> got going — that is a real signal, not a stale file.

## Goal (restated at every phase boundary)

Build the phone app for the top-ten quiz at Sophie's 25th on Saturday 5 Sept 2026: eight
teams (Lag 1–8) claim a slot, see the question and a shared 150-second clock, type one
answer, a model matches it against the list, Erik reveals the list row by row from his
phone, and a leaderboard shows between questions. Cloudflare Workers + Durable Objects only.

## §2 Acceptance criteria (verbatim)

1. **Join.** A guest opens the app's URL on a phone (scanned from a QR code the repo provides as a printable page), sees eight big tiles Lag 1 to Lag 8, taps one, and is in. A second phone tapping the same tile is refused with "Lag 3 är redan taget" and can pick another. Erik can release any slot from admin; the released phone is sent back to the tiles with a message.
2. **Question.** When Erik taps "Starta fråga N" on admin, every joined phone shows the question text and a 150-second countdown within two seconds of each other. The countdown is server-authoritative: phones display the same remaining time (±1 s) even after a page reload, and answers lock on the server at zero regardless of what any phone shows.
3. **Pause and control.** Erik can pause and resume the countdown, add 30 seconds, or lock the answers early. Every phone follows within two seconds. A paused clock stays paused across an admin page reload.
4. **Answer.** A team types one free-text answer and taps send. The phone shows "Svar skickat" and the text; the team may change it any number of times until lock; the last text before lock is the one graded. An answer sent after lock is refused with a message. Admin shows, per team, "svar" / "väntar" / "offline" live.
5. **Grade.** On "Rätta", every submitted answer is matched to a row of the question's 15-row list or to "utanför listan": misspellings, casing, diacritics, Swedish/English names and obvious synonyms match ("tjeckien", "Czechia", "Czech Republic" all match Tjeckien). Points = matched rank for ranks 1–10; ranks 11–15 and no match score 0 but the position 11–15 is still shown. Grading completes within 20 seconds; if the model is unavailable, exact-match grading applies and the rest are flagged "ogranskad" for Erik. Erik can tap any team's row on admin and set the rank by hand (0–15), before or after the reveal; the leaderboard follows.
6. **Reveal.** Erik taps "Visa nästa rad" up to ten times; phones show rows 1..n revealed and the rest hidden. The moment a team's matched row is revealed, its phone highlights "Ert svar: Portugal — plats 10 — 10 poäng". After row 10, rows 11–15 appear as "nära skott". "Visa alla" reveals everything at once.
7. **Standings.** "Visa ställningen" shows the cumulative leaderboard on every phone, the team's own row highlighted; ties share a position. "Nästa fråga" moves everyone on. After question 10, a final standings screen names the winner.
8. **Manual entry.** For any team, at any point of a question, Erik can type that team's answer on admin; it is graded and shown like any other.
9. **Resilience.** A phone that loses connection or is reloaded comes back to exactly the state the game is in, still as its team, with its answer intact. Killing and restarting the worker loses nothing: the whole game state is persisted. Admin shows "offline" for a team within 10 seconds of its socket dropping.
10. **Erik's runbook.** `SPELLEDNING.md` (Swedish) tells Erik, step by step, what to do Friday (set secrets, choose lists, deploy, smoke test with two phones, print QR) and Saturday (open admin, what each button does, what to do if a phone dies, how to reset a question, how to reset the whole game). Every command in it has been run by the builder.

## Progress log

- 2026-09-03 16:51 — Builder started. Read dispatch + WORK_ORDER.md. Phase 0: orientation.
- 2026-09-03 16:58 — Orientation done: wrangler whoami OK (deploy is on); ANTHROPIC_API_KEY present in shared `.dev.vars` (copied to worktree, ADMIN_TOKEN generated locally, gitignored); bank = 100 lists; `design/claude-design/` has no export yet (building from §E + reference sketches).
- 2026-09-03 17:28 — Phase 2 committed (6a61605): 10 DO integration tests green (58 tests total). Branch pushed; draft PR #1 opened.
- 2026-09-03 17:33 — Phase 3/4: ws.ts (reconnect + watchdog + clock offset), dom.ts, styles.css, index/admin/qr.html, player.ts (7 screens), admin.ts (5 screens + team sheet + confirm sheets), scripts/build.mjs (esbuild + wrangler dry run + secret scan).
- 2026-09-03 17:12 — Phase 1 committed (a8a1e19): 3 tsc projects clean, 48 unit tests green.
- 2026-09-03 17:19 — Phase 2: src/worker/{index,game-do,grader}.ts written; first DO test run failed because the workers pool loads the real `.dev.vars` (token mismatch) — fixed by reading the token from the runtime env and pointing the grader at a dead port in tests. Re-running.
- 2026-09-03 17:05 — Phase 1 in progress: package.json/tsconfigs/wrangler.jsonc, data (bank snapshot, quiz.json with ten verified placeholders, aliases.json), src/shared (types, game reducer, scoring, normalize, format, view), unit tests written. Running `npm install` (first attempt hit a workers-types peer conflict; bumped to 5.x).
