# KNOWN-ISSUES — WO-078 (sophie-quiz)

> Repo standard since 2026-08-13. Review findings **below** the bounce bar land here
> instead of costing a bounce round: latent edges, cosmetic output, performance,
> twice-a-year clock cases. They stay reachable when troubleshooting.
>
> The bar itself is per work order (`WORK_ORDER.md` §3) — severity is Erik's call, not
> the reviewing model's temperament. An entry leaves this file only when actually fixed.
>
> Per-work-order filename (WO-014 §2.6), same reasoning as the heartbeat: parallel builds
> writing one shared list is a guaranteed merge conflict.

| Date | Finding | Repro | Severity | Source |
|---|---|---|---|---|
| 2026-09-03 | A phone whose browser blocks `localStorage` (private/incognito mode, some "block all cookies" settings) gets a fresh device id on every reload, so after a reload it is sent back to the tiles and its team reads "används av en annan telefon". Erik releases the slot and the phone rejoins; the team's answer is untouched (it belongs to the team, not the phone). | Open `/` in an incognito tab, claim a team, reload. | Low — one tap on admin; normal browsers keep identity. | builder |
| 2026-09-03 | Fonts come from Google Fonts. With no route to fonts.googleapis.com the pages fall back to Arial Narrow / Impact and Segoe UI / Arial (usable, less pretty). Not bundled: the bar's wifi will reach Google if it reaches Cloudflare. | Block fonts.googleapis.com, load `/`. | Cosmetic. | builder |
| 2026-09-03 | Player lobby label counts questions **done** ("Fråga 0 av 10" before the first question, per the Lobby artboard) while the admin lobby counts the question **about to start** ("Fråga 1 av 10 · väntar"). Faithful to the sketches, but a guest could read "Fråga 4 av 10" while Erik says "fråga fem". | Reach the lobby between questions. | Cosmetic / copy. | builder |
| 2026-09-03 | The reveal screen is taller than 844 px on a 390-px phone once all 15 rows are visible; it scrolls, with the result card sticky at the bottom. The artboard shows only rows 1–10 and no scrolling. | Reveal all rows on a 390×844 viewport. | Cosmetic deviation from the canvas. | builder |
| 2026-09-03 | Test harness: Chromium's offline emulation does not close an already-open loopback WebSocket, so the e2e "reconnect mid-question" scenario drops the socket through a small client hook (`window.__sophie.drop()`) and uses offline emulation only to block the reconnects. A real silent network drop is covered by the client watchdog (8 s without a pong → close → reconnect) and by the worker-restart scenario, not by a dedicated e2e. | — | Test-coverage note, no product effect. | builder |
| 2026-09-03 | Windows: `wrangler dev` holds `dist/public` open, so the build overwrites files in place instead of deleting the directory; a removed asset file would linger until the next clean checkout. | Delete an entry from `public/` and rebuild while `wrangler dev` runs. | Dev-only. | builder |
| 2026-09-03 | The worker bundle is ~940 KB (190 KB gzipped) because the whole `@anthropic-ai/sdk` is bundled; well under the limit, cold start unaffected in practice (one DO, warm all evening). A hand-written `fetch` call would cut it to a few KB if it ever matters. | `npm run build`, look at `dist/worker/index.js`. | None now. | builder |
| 2026-09-03 | Behaviour beyond the party's shape is untested: more than 8 teams, more than 10 questions, lists with fewer than 10 rows (refused at startup), more than ~9 simultaneous clients. Ties at rank 10/11 in a list make the "top" 11 rows long (reveal counter shows e.g. 0/11); the bank's verifier rejects such lists, so `quiz.json` should not contain one. | — | Out of scope per §3. | builder |
