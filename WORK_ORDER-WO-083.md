# WO-083 — Party hardening for Sofie's quiz (the pre-mortem's fixes and runbook lines)

> **Erik's plain-language headline (restated in the PR body):**
> This hardens the app that already exists for Saturday and writes the missing runbook lines.
> It adds no feature, changes no rule of the game, touches no list data, and never deploys.
> **What this will NOT do:** anything not named in §A and §B below — adjacent, obvious and
> tempting all count as out. The lists are another branch's job; the deploy is Erik's.
>
> Written 2026-09-04 in the pre-mortem session with Erik, from the joined risk register
> `_coach/research/2026-09-04-sophie-quiz-pre-mortem/risk-register.md` (readers: the room,
> the stack). Base: `main` at `7c44b80` (WO-078 merged 18:02). The party is **Saturday
> 5 September 2026**. A finished PR tonight beats a perfect one later: if an item in §A
> cannot be done cleanly in the time it deserves, log it in `KNOWN-ISSUES-WO-083.md` with the
> reason and ship the rest.

## 1. Goal — from Erik's verbatim idea

> My next thing I want to focus on is the importance of no bugs and that we don't end up in a
> state where it is not working of some reason.

Eight teams on one phone each, Erik with the mic and the admin page on his phone, ~40 guests
who have been drinking, 45 minutes, no screen. The one hard requirement: nothing lags or
breaks in the room, and nothing fails silently. Two readers walked the evening and the
stack; this order carries the fixes that are worth a redeploy tonight, and the runbook lines
for everything that is not code.

## 2. Acceptance criteria — user's seat

1. **Erik cannot deploy a broken list set.** With a misspelled slug, an unverified list, a
   list with fewer than 10 rows, or a list whose top count is not exactly 10 (a tie at rank
   10) in `data/quiz.json`, `npm run deploy` stops **before** wrangler runs, with a message
   naming the list and the reason. With good data it deploys exactly as before.
2. **`npm test` passes whatever ten lists are in `data/quiz.json`, in any order.** The
   fixtures build their own quiz by slug from `data/bank.json`; no test depends on
   `quiz.json[0]`.
3. **On the reveal screen "Nästa fråga" is refused**, with a Swedish message shown as a
   toast, until every top row has been revealed. From the standings screen it works as
   today. The two reset links are no longer adjacent to "Nästa fråga" on the reveal and
   standings screens, and "Nollställ spelet" requires Erik to **type** the confirm word into
   the sheet before the red button works. "Nollställ frågan" keeps its two-tap sheet.
4. **A full question with eight model-graded answers does not fail on the token cap**, and
   whenever any answer of the current question is "ogranskad", the reveal screen offers
   **Rätta igen**, which re-grades only the ungraded answers (the reducer already allows a
   re-grade from reveal).
5. **When Erik sets a place by hand he sees the row name next to each place** (0–15), not
   numbers only.
6. **Typing in a team sheet survives state updates:** while the open sheet's kind and team
   are unchanged, the text he typed and the keyboard focus stay through any number of
   broadcasts; the sheet's labels may refresh.
7. **A phone that wakes with a dead socket reconnects within about a second, not eleven:**
   on `visibilitychange` / `pageshow` / `online`, if the last liveness signal is older than
   two ping intervals, the client drops the socket and reconnects immediately instead of
   pinging into the void.
8. **Copy in the room is right:** the admin reveal hint says the first press shows place 1
   and the list is read from the top; the player lobby counts the question about to start
   the same way admin does ("Fråga N av 10 · väntar"); the admin question screen shows the
   full host question under the title; and the name reads **Sofie** everywhere a guest or
   Erik sees it (`public/index.html`, `public/admin.html`, `public/qr.html` ×2,
   `src/client/player.ts` ×2; the repo name, slugs and `GAME_NAME` stay).
9. **`SPELLEDNING.md` carries every block in §B**, in place, in Swedish, and
   `KNOWN-ISSUES-WO-078.md` no longer claims the bank's verifier rejects rank-10 ties (it
   does not; the data test now does).

Restate these at every phase boundary.

## 3. Good-enough bar

- **Always bounces:** any change to the rules of the game or the scoring; a regression in an
  existing unit, DO or e2e test; a data gate that lets bad data through or stops good data;
  any deploy, secret or tail command run by the builder; any edit under `data/`; a silent
  failure of any kind.
- **KNOWN-ISSUES material:** exact wording, pixel positions, the look of the typed-confirm
  sheet, behaviour beyond 8 teams / 10 questions / 9 clients.
- **Out of scope for findings:** anything not named in §A/§B; restyling; performance
  beyond the party's shape; the list content.

## 4. Non-goals — "What this will NOT do"

- No new features: no past-question view, no more than one phone per team, no socket
  shedding for curious guests, no offline mode, no font bundling.
- No change to 150 s, eight teams, ten questions, the points, the reveal order, the confirm
  word's value.
- **No edits under `data/`.** `data/quiz.json`, `data/aliases.json` and `data/bank.json`
  belong to branch `lists/friday-2026-09-04` (the list session). Tests read them; nothing
  here writes them.
- **No deploy, ever.** No `wrangler deploy`, `wrangler secret`, `wrangler tail`, no call to
  the deployed Worker. Erik deploys from the root checkout after the merge. `npm run build`
  (a wrangler dry run) is fine. Never print or copy `.dev.vars`.
- **No merging.** The pull request waits for Erik.
- Erik acknowledged the headline line above in the session (4 Sept, ~18:30).

## 5. Verification commands + user-seat proof

The worktree is fresh: run `npm ci` first (Playwright browsers are already installed under
`%LOCALAPPDATA%\ms-playwright`). Then, all clean, real output in the PR body:

```
npm run typecheck
npm test
npm run build
```

**Machine fact, 4 Sept 18:52 (read this before running anything else):** Windows Smart App
Control on this PC blocks the unsigned `workerd.exe` **bundled inside wrangler**
(`node_modules/wrangler/node_modules/@cloudflare/workerd-windows-64`, v1.20260831.1) with
"An Application Control policy has blocked this file". The older top-level copy that
`@cloudflare/vitest-pool-workers` uses (v1.20260815.1) still runs, so **`npm test` (unit +
DO projects) works — verified 16/16 on the DO project at 18:51.** What is blocked is
everything that spawns `wrangler dev`: `npm run e2e`, `npm run proof`, `npm run dev`. Try
each once; if it fails with that policy error (or `spawn UNKNOWN` from miniflare), record
the exact error in the PR body under a heading "Blocked by Smart App Control" and move on.
Do not try to work around it by changing wrangler, miniflare or workerd versions or
overrides — that is a different change with its own risk, and Erik may lift the policy
while you work. **Never delete, skip, `.skip`, or reconfigure a
test to get past this**, and never change `package.json`'s `test` script — the DO project must
still run for Erik once the policy is off. Erik may turn the policy off while you work; if
`workerd` starts, run the full set (`npm test`, `npm run e2e`) and attach the real output.
`wrangler deploy --dry-run` inside `npm run build` does not need workerd; if it does fail on
this machine, say so rather than guessing.

Because of this, **AC1's deploy wiring runs the unit project only**: `predeploy` (or
equivalent) = `vitest run --project unit`, where the data test lives. The unit project must
never spawn workerd.

Data-gate proof (AC1/AC2): show the new data test **failing** on a deliberately broken copy
of `quiz.json` (a wrong slug, and separately a tie-at-10 list such as
`best-selling-video-games-all-time`) via whatever override you add for that purpose (an env
var pointing at a temp file is fine), and **passing** on the real files; show that
`npm run deploy` exits before wrangler on the broken copy (dry: it must not reach
`wrangler deploy` — prove it without deploying, e.g. by the exit code and the message).

User-seat proof: a Playwright run through the **real admin UI** that (a) is refused
"Nästa fråga" mid-reveal with the message visible, then succeeds after the last row;
(b) types the confirm word and resets the game; (c) types in a team sheet while another phone
reconnects, and the text survives. Screenshots at 390×844 of: the reveal screen with the new
control layout, the typed-confirm sheet, the override control with names, the admin question
screen with the definition, and the player lobby counter. Attach to the PR body.

**If the harness is blocked (see above), the proof you owe instead is:** unit tests for every
reducer change (A3, A6's re-grade path, A9's decision logic if it is factored into a pure
function), the rendered admin and player pages opened statically where possible (the client
bundle with a stubbed state is acceptable for screenshots of A4, A7, A10), and a plain
walkthrough in the PR body of what Erik will see on each changed screen. Say plainly which
proofs are missing and why; the reviewer and Erik's Saturday-morning rehearsal on the
deployed app carry the rest.

## 6. Decision ledger contract

Per template: take the recommended option on in-build decisions and keep going; irreversible
actions, taste calls and changes to the goal park for Erik. Ledger lines in the PR body with
rewind commits.

## 7. KNOWN-ISSUES-WO-083.md

Repo file, as usual. Findings below the bounce bar land there with repro + severity. Items
from §A you had to leave out land there too, with the reason.

## 8. Phase protocol

Branch `build/wo-083`, worktree `.claude/worktrees/wo-083` (already cut from `main` at
`7c44b80`), `STATUS-WO-083.md` heartbeat (mtime = liveness, touch it at least every 15 min),
goal + acceptance criteria restated at phase boundaries. Never touch `main`. Batch code
changes: one push per finished piece of work.

## 9. Review contract

Canonical automatic review per `_coach/meta/build-queue/REVIEW-PROMPT-TEMPLATE.md`: fresh
session, independent user-seat re-run, severity judged against §3. Erik's verdict merges.

## 10. Dispatch pins

Builder opus/xhigh (standing default). Reviewer opus/high.

---

## A. The fix list (with the readers' evidence, at `7c44b80`)

Ordered by what it protects. All are small; none changes a rule.

| # | Fix | Evidence | AC |
|---|---|---|---|
| A1 | **Data gate.** Add a unit test (`test/unit/data.test.ts` or similar) that builds the real quiz from `data/quiz.json` + `data/bank.json` + `data/aliases.json` through the same `buildQuiz` the DO uses, and asserts per list: slug exists, verdict `verified`/`corrected`, ≥ 10 rows, **top count exactly 10**, and that every alias key names a row in its list. Make `npm run deploy` run the suite first (`predeploy` is the simplest honest wiring) so a bad file can never reach wrangler. | `buildQuiz` throws in the DO **constructor** (`src/worker/game-do.ts:55`, `src/worker/bank.ts:84-94`), so a bad slug 500s every `/ws` after deploy while `/health` (`src/worker/index.ts:30-31`) still says ok; `scripts/build.mjs:42` is a dry run and never constructs the DO. Three verified lists in the bank tie at rank 10 (`tallest-buildings-sweden`, `olympic-medals-by-swedish-sport`, `best-selling-video-games-all-time`, top count 11/11/12) though `KNOWN-ISSUES-WO-078.md:22` says the verifier rejects them. | 1, 9 |
| A2 | **Fixtures by slug.** Every test that today assumes `quiz.json[0]` is `most-populous-eu-countries` builds its quiz from `data/bank.json` by slug instead. | `test/unit/game.test.ts:19-21`, `grader.test.ts:5`, `normalize.test.ts:23`, `view.test.ts:6,61,68,123`, `test/do/game.test.ts:205-228`. | 2 |
| A3 | **"Nästa fråga" refused mid-reveal.** In the reducer's `next`, refuse from `reveal` while `revealed < topCount` with a Swedish message (e.g. "Visa hela listan först."). Unit test + the e2e in §5. | `src/shared/game.ts:454` accepts `next` from `reveal` at `revealed = 0`; there is no way back across a question (`:479` only resets the current index). | 3 |
| A4 | **Reset links away from the primary button; typed confirm for the game reset.** On the reveal and standings screens, take the two `smallLinks` out of the `.bottom` stack that holds "Nästa fråga" and put them where a thumb aiming at the primary button cannot land (top of the screen, or behind a "Mer…" disclosure — your call, ledger it). Keep both resets reachable from every screen (WO-078 R4 decision). In the confirm sheet for `what: 'game'`, add a text input; the red button stays disabled until the input equals `CONFIRM_WORD` (case-insensitive is fine). | `src/client/admin.ts:404-422` (links 8 px under "Nästa fråga"), `:699-713` (the sheet supplies `CONFIRM_WORD` itself), `src/shared/types.ts:147`. | 3 |
| A5 | **`max_tokens` 1024 → 4096** in the grader call. No other change to the call. | `src/worker/grader.ts:98`; `:105-107` throws on any `stop_reason !== 'end_turn'`, `:174-177` then flags every pending answer. Opus 5 thinks by default and thinking counts against the cap. | 4 |
| A6 | **"Rätta igen" on the reveal screen** when any answer of the current question is `needsReview`; it re-grades only the ungraded answers. | The reducer allows a re-grade from `reveal` (`src/shared/game.ts:348` refuses only open/lobby/final); the UI never offers it (`src/client/admin.ts:381-457`). | 4 |
| A7 | **Row names in the override control.** Each place 1–15 shows its row name (rank 0 = "utanför listan"); a list instead of the grid is fine if it reads better on 390 px. | `src/client/admin.ts:622-640`; names only in a `title` attribute (`:631`), invisible on touch. | 5 |
| A8 | **Sheet keeps typed text and focus.** When a state message arrives and the open sheet's `kind` and `team` are unchanged, do not rebuild the input (refresh labels only); never reset an input that has focus. | `render()` calls `renderSheet()` on every message (`src/client/admin.ts:135`); rebuild resets the field to the stored answer (`:594`); the DO broadcasts on every change, socket close, error and hello (`src/worker/game-do.ts:168,177,222,305`). | 6 |
| A9 | **Fast reconnect on wake.** In `kick()`, if `Date.now() - lastAlive > 2 × PING_EVERY_MS`, drop the socket and reconnect at once instead of pinging. | `src/client/ws.ts:36-40` (hooks), `:69-73` (`kick` pings when it still believes it is online), `:144-152` (8 s watchdog). | 7 |
| A10 | **Copy.** (a) admin reveal hint: first press = place 1, read from the top (`src/client/admin.ts:444`, contradicts `SPELLEDNING.md:30`); (b) player lobby counter = admin's convention (`src/client/player.ts:171-174` vs `src/client/admin.ts:249`; `KNOWN-ISSUES-WO-078.md:17`); (c) admin question screen shows `question.question` under the title (`src/client/admin.ts:323`; guests see it at `player.ts:368-369`); (d) Sophie → Sofie in the six user-facing strings listed in AC8. | — | 8 |

## B. Runbook edits — `SPELLEDNING.md` (paste-ready, Swedish)

Fold these in at the places named. Keep the runbook's voice. Where a line below replaces an
existing one, replace it; do not leave both.

**B1. New first step of §2, before 2.1:**

```
### 2.0 Först av allt

Kör i repots rot (`C:\Users\erika\projects\sophie-quiz`):

    npx wrangler whoami
    npm ci

`npm ci` hämtar verktygen (några minuter, kräver nät). Utan det säger varje kommando nedan
"is not recognized". `whoami` ska visa ditt Cloudflare-konto; annars är inloggningen borta.
```

**B2. After 2.1 (nycklarna), new check:**

```
Snabbkontroll utan nyckel: öppna https://sophie-quiz.erik-aarup.workers.dev/health i
telefonen. Båda flaggorna (`adminTokenSet`, `graderKeySet`) ska vara `true`. Byt **inte**
`ADMIN_TOKEN` i kväll: bokmärket i telefonen slutar fungera och den sparade nyckeln i
telefonen är då fel.
```

**B3. Into 2.2 (välj de tio listorna), after step 3 about aliases:**

```
Lägg in de självklara kortformerna för dina egna listor: `USA`/`United States`,
`Storbritannien`/`UK`/`England`/`Great Britain`, `Nederländerna`/`Holland`, samt engelska
namn på allt som har ett. Modellen klarar dem oftast ändå, men det som står i
`aliases.json` rättas utan modellen och kan aldrig bli fel.

Välj helst listor med 15 rader (då finns "nära skott" på plats 11–15) och undvik listor med
delad tionde plats — `npm test` vägrar dem numera och pekar ut vilken.
```

**B4. Replace the end of 2.2 step 4 (`npm test` faller om…):**

```
`npm test` faller om en slug saknas, en lista inte är verifierad, en lista har färre än tio
rader eller en delad tionde plats. `npm run deploy` kör samma test först och vägrar deploya
om det faller — så en trasig lista kan inte längre nå festen.
```

**B5. Into 2.4 (deploya), directly after the deploy command:**

```
**Kontroll efter deployen (30 sekunder, hoppa inte över den):** öppna adminlänken. Pillen ska
bli grön och säga **Admin**. Tryck **Starta fråga 1** — frågan och 2:30 ska synas — och sedan
**Nollställ spelet**. Blir pillen aldrig grön är det nästan alltid `data/quiz.json`, inte
nätet: kör `npm test`, felmeddelandet pekar ut raden. Sidorna laddar som vanligt även när det
är fel på listorna — därför är det här testet det enda som visar det.

Har telefoner redan haft sidan öppen före deployen räcker det att de laddar om sidan;
de får den nya versionen direkt.
```

**B6. New block in §2 (own section):**

```
### 2.8 Skriv ut de tio listorna

Skriv ut alla tio listor med alla 15 rader, i frågeordning. De är tre saker på en gång:
din fusklapp när du ska sätta en plats för hand, underlaget om någon vill se en lista
efteråt, och halva plan B.
```

**B7. Into §3 "Innan gästerna kommer", as new points:**

```
4. Säg i micken innan fråga 1, två saker:
   - "Stäng av wifi på telefonen och kör på mobildata." (Barens wifi kan ha en inloggningssida
     som stoppar appen.)
   - "Bara EN telefon per lag skannar. Resten lägger undan telefonen."
   Skriv lagnumret för hand på varje bords QR-blad (`/qr` skriver ut samma kod).
5. Förklara poängen högt, och en gång till efter fråga 1: **plats 10 ger 10 poäng, plats 1 ger
   1 poäng.** Det svåra svaret är värt mest. Alla tror tvärtom första gången.
6. Inga deployer efter att gästerna kommit. Måste du ändå: tryck **Nollställ spelet** direkt
   efteråt, annars pekar en pågående fråga på fel lista.
```

**B8. Into §3 "Per fråga", a note under steg 2:**

```
Vid 0:30: läs raden under rutnätet högt — "X av 8 har svarat" — och ropa upp lagen som står
kvar på **väntar**. Ett svar som försvann i en dålig uppkoppling syns bara så här.
```

**B9. Into §3 "Per fråga", replacing the end of steg 6:**

```
Rättningen tar 3–5 sekunder normalt, upp till 20 om modellen strular. Prata under tiden —
tryck inte igen. Står något lag på **ogranskad** betyder det att modellen inte svarade
(upptagen, eller fel på nyckeln): tryck **Rätta igen** en gång, annars sätt platsen för hand
— listan på papper är din fusklapp. Skrev du in ett svar för hand efter låsningen rättas det
direkt av sig självt; vänta fem sekunder innan du trycker **Rätta**, annars säger den
"Rättning pågår".
```

**B10. Into §3 "Per fråga", under steg 7:**

```
**Nästa fråga** går inte att trycka förrän hela listan är visad — appen säger ifrån. Den går
inte att ångra: frågan är slut och listan kan inte visas igen. Raden med **Nollställ** rör du
inte alls när gästerna väl är på plats; "Nollställ spelet" kräver att du skriver ordet.
```

**B11. New rows in the troubleshooting table:**

```
| En telefon säger "används av en annan telefon" | Vanligt om gästen först öppnade länken inne i Instagram/Snapchat och sedan i Safari. Tryck på laget → **Släpp** → de väljer om. |
| Alla telefoner säger **Återansluter…**, även din | Direkt efter en deploy: fel i `data/quiz.json` — kör `npm test`, rätta, deploya om. Mitt i kvällen: nätet. Säg "mobildata, inte wifi". Pappersbladen om det inte släpper. |
| Ett lag säger att deras svar försvann | Skriv in det för hand (tryck på laget). Sista svaret före låsningen gäller, och ditt handskrivna svar rättas som alla andra. |
```

**B12. Last line of the evening, in §3:**

```
När slutresultatet visas: **ta en skärmdump direkt**, och lägg sedan ifrån dig telefonen.
"Nollställ spelet" är den enda knappen kvar på den skärmen.
```

Also amend the existing "ogranskad" row(s) at `SPELLEDNING.md:114,177` so they no longer say
it means the key alone (B9 is the truth), and correct `SPELLEDNING.md:30` if A10(a) makes
the screen and the runbook agree the other way round — they must agree, and the app reveals
place 1 first.

## C. Notes for the builder

- The e2e harness starts its own `wrangler dev` on 8788 from `e2e/wrangler.e2e.jsonc` with a
  mock model; it never loads the real `.dev.vars`. Use it for the §5 proof.
- The list branch may land in `data/` while you work; you never touch those files, so there
  is nothing to rebase for. If a test of yours needs a specific list, take it from
  `data/bank.json` by slug.
- Keep the diff small and reviewable. The reviewer reads at 20:00 on a Friday for a party
  the next day: every line you did not need is a line they must still read.
