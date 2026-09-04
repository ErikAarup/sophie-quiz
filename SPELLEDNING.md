# Spelledning — Sofies topp tio

Det här är din lathund, Erik. Fredag: gör appen redo. Lördag: kör kvällen. Allt du behöver
trycka på står här; koden bakom står i `README.md` och `WORK_ORDER.md`.

**Adresser (deployat av byggaren 3 september; `npm run deploy` lägger upp en ny version på samma adress):**

| Vad | Adress |
|---|---|
| Gästernas sida (den QR-koden pekar på) | https://sophie-quiz.erik-aarup.workers.dev/ |
| Din adminsida | `https://sophie-quiz.erik-aarup.workers.dev/admin?t=<ADMIN_TOKEN>` |
| QR-sidan att skriva ut | https://sophie-quiz.erik-aarup.workers.dev/qr |

`<ADMIN_TOKEN>` är raden `ADMIN_TOKEN=…` i `.dev.vars` i repots rot. Den filen är hemlig och
ligger inte i git. Spara adminlänken som bokmärke i telefonen, då slipper du skriva in den.

---

## 1. Så funkar spelet (30 sekunder)

- Åtta lag, **Lag 1–Lag 8**, en telefon per lag. Gästerna skannar QR-koden och trycker på sitt
  lag. En upptagen ruta är nedtonad med "TAGET".
- Du trycker **Starta fråga N**. Alla telefoner visar frågan och samma klocka: **1:30**.
  Du läser frågan högt i micken.
- Varje lag skriver **ett** svar och trycker Skicka. De kan ändra sig tills klockan är på 0:00
  (eller tills du trycker **Lås svaren nu**). Sista texten gäller.
- **Rätta och börja avslöja**: modellen matchar varje svar mot listans 15 rader (stavning,
  engelska namn och synonymer räknas). Poäng = platsen på listan om den är 1–10. Plats 11–15
  syns som "nära skott" men ger 0. Utanför listan ger 0.
- Du läser listan högt uppifrån med **Visa nästa rad**, tio gånger. När ett lags rad kommer
  lyser deras telefon upp: "Ert svar: Portugal · plats 10 · 10 poäng".
- **Visa ställningen** → alla ser tabellen. **Nästa fråga** → vidare. Efter fråga 10 visas
  slutresultatet och vinnaren.
- Du kan alltid: pausa, lägga på 30 s, låsa tidigt, skriva ett lags svar för hand, ändra vilken
  plats som helst för hand (0–15), släppa ett lags plats så en ny telefon kan ta den.

---

## 2. Fredag — gör appen redo

Alla kommandon körs i PowerShell i repots rot: `C:\Users\erika\projects\sophie-quiz`.

### 2.0 Först av allt

Kör i repots rot (`C:\Users\erika\projects\sophie-quiz`):

    npx wrangler whoami
    npm ci

`npm ci` hämtar verktygen (några minuter, kräver nät). Utan det säger varje kommando nedan
"is not recognized". `whoami` ska visa ditt Cloudflare-konto; annars är inloggningen borta.

### 2.1 Nycklarna

1. Kontrollera att `.dev.vars` finns och har två rader:
   ```
   ANTHROPIC_API_KEY=sk-ant-…
   ADMIN_TOKEN=<en lång slumpad sträng>
   ```
   Saknas `ADMIN_TOKEN`: hitta på en lång sträng (30+ tecken, bokstäver och siffror) och lägg
   till raden. Byggaren la in en åt dig 3 september.
2. Skicka båda till Cloudflare (körs mot Workern `sophie-quiz`):
   ```
   npx wrangler secret bulk .dev.vars
   ```
   Kontroll: `npx wrangler secret list` ska visa `ANTHROPIC_API_KEY` och `ADMIN_TOKEN`
   (värdena visas aldrig). Kör `npx wrangler whoami` om något klagar på inloggning.

Snabbkontroll utan nyckel: öppna https://sophie-quiz.erik-aarup.workers.dev/health i
telefonen. Båda flaggorna (`adminTokenSet`, `graderKeySet`) ska vara `true`. Byt **inte**
`ADMIN_TOKEN` i kväll: bokmärket i telefonen slutar fungera och den sparade nyckeln i
telefonen är då fel.

### 2.2 Välj de tio listorna

1. Om banken i valvet har ändrats sedan sist: `npm run sync-bank` (kopierar
   `_coach/current/sophie-quiz/top-ten-bank.json` till `data/bank.json`).
2. Öppna `data/quiz.json` och skriv in tio `slug_en` i den ordning frågorna ska ställas.
   Bara listor med `verdict` `verified` eller `corrected` går att använda; annat vägrar appen
   starta. Slugarna hittar du i `data/bank.json` (fältet `slug_en`).
3. Lägg till stavningar i `data/aliases.json` för dina listor, t.ex. engelska namn och
   kortformer (`"Tyskland": ["Germany"]`). Allt som står där rättas utan modellen. Det som
   inte står där skickas till modellen — den klarar stavfel och synonymer, men det som står
   här är garanterat.

   Lägg in de självklara kortformerna för dina egna listor: `USA`/`United States`,
   `Storbritannien`/`UK`/`England`/`Great Britain`, `Nederländerna`/`Holland`, samt engelska
   namn på allt som har ett. Modellen klarar dem oftast ändå, men det som står i
   `aliases.json` rättas utan modellen och kan aldrig bli fel.

   Välj helst listor med 15 rader (då finns "nära skott" på plats 11–15) och undvik listor med
   delad tionde plats — `npm test` vägrar dem numera och pekar ut vilken.
4. Kontroll att allt hänger ihop:
   ```
   npm run typecheck
   npm test
   ```
   `npm test` faller om en slug saknas, en lista inte är verifierad, en lista har färre än tio
   rader eller en delad tionde plats. `npm run deploy` kör samma test först och vägrar deploya
   om det faller — så en trasig lista kan inte längre nå festen.

### 2.3 (Frivilligt) Provkör lokalt

```
npm run dev
```
Öppna `http://127.0.0.1:8787/` i två flikar och `http://127.0.0.1:8787/admin?t=<ADMIN_TOKEN>`
i en tredje. Lokalt använder appen `.dev.vars` direkt. Avsluta med Ctrl+C.

### 2.4 Deploya

```
npm run deploy
```

Skriptet kör först datakontrollen av `data/quiz.json` (faller den är det listorna, se 2.2, och
ingenting laddas upp), bygger telefonsidorna, kontrollerar att ingen nyckel hamnat i bygget,
och laddar upp Workern. Sista raderna visar adressen:
`https://sophie-quiz.erik-aarup.workers.dev`. Tar det
över en minut eller klagar på "malformed response" från API:et: kör kommandot en gång till
(det hände byggaren en gång; andra försöket gick igenom).

**Kontroll efter deployen (30 sekunder, hoppa inte över den):** öppna adminlänken. Pillen ska
bli grön och säga **Admin**. Tryck **Starta fråga 1** — frågan och 1:30 ska synas — och sedan
**Nollställ spelet**. Blir pillen aldrig grön är det nästan alltid `data/quiz.json`, inte
nätet: kör `npm test`, felmeddelandet pekar ut raden. Sidorna laddar som vanligt även när det
är fel på listorna — därför är det här testet det enda som visar det.

Har telefoner redan haft sidan öppen före deployen räcker det att de laddar om sidan;
de får den nya versionen direkt.

Om deployen klagar på rättigheter ("scope"): din API-token i Windows (`CLOUDFLARE_API_TOKEN`)
saknar behörighet — ge den *Workers Scripts: Edit* på
https://dash.cloudflare.com/3230330a438cc5c59b377e1834847e76/api-tokens och kör igen.

### 2.5 Rök-test med två telefoner (10 minuter)

1. Öppna adminlänken på din telefon. Pillen uppe till vänster ska säga **Admin** (grön).
   Säger den "Återansluter…" i mer än några sekunder: kolla mobildata/wifi.
2. Tryck **Nollställ spelet** → skriv **NOLLSTÄLL** i rutan (knappen är grå tills ordet står
   rätt) → **Ja, nollställ hela spelet**.
3. Ta två andra telefoner, skanna QR-sidan (eller skriv adressen). Välj Lag 1 på den ena
   och Lag 2 på den andra. Prova att välja Lag 1 på den andra också: den ska säga
   "Lag 1 är redan taget".
4. Admin: **Starta fråga 1**. Båda telefonerna ska visa frågan och 1:30 samtidigt.
5. Skriv ett svar på Lag 1 (t.ex. rätt svar från listan) och ett fel svar på Lag 2. Ändra
   Lag 1:s svar en gång. Admin ska visa **svar** på båda.
6. Admin: **Pausa**, ladda om adminsidan — klockan ska stå still på samma tid. **Fortsätt**.
   **+30 s**. **Lås svaren nu**. Telefonerna ska visa "Tiden är ute".
7. Admin: **Rätta och börja avslöja**. Inom några sekunder står en siffra vid varje lag.
   Om det står **ogranskad** på ett lag: tryck **Rätta igen** en gång; står det kvar, tryck på
   raden och välj plats för hand. (Det betyder att modellen inte svarade — upptagen, eller fel
   på nyckeln. Fortsätter det: kontrollera `ANTHROPIC_API_KEY` i 2.1.)
8. Tryck **Visa nästa rad** tills listan är slut. Lag 1:s telefon ska lysa upp när dess rad
   kommer. **Visa ställningen**. **Nästa fråga**.
9. Stäng en av telefonernas webbläsare helt och öppna adressen igen: den ska komma tillbaka
   som samma lag, på samma skärm.
10. Admin: **Nollställ spelet** igen så att lördagen börjar tomt.

### 2.6 Skriv ut QR-koden

Öppna `https://…/qr` på datorn och skriv ut (Ctrl+P). Skriv ut några exemplar, ett per bord.
Vill du koda en annan adress: lägg till `?u=https://…` efter `/qr`.

### 2.7 Plan B

Pappersblad enligt `_coach/current/sophie-quiz/design.md`. Skriv ut dem oavsett.

### 2.8 Skriv ut de tio listorna

Skriv ut alla tio listor med alla 15 rader, i frågeordning. De är tre saker på en gång:
din fusklapp när du ska sätta en plats för hand, underlaget om någon vill se en lista
efteråt, och halva plan B.

---

## 3. Lördag — kvällen

### Innan gästerna kommer

1. Öppna adminlänken på din telefon. Sätt skärmen på "släcks aldrig" (iPhone: Inställningar →
   Bildskärm → Autolås → Aldrig). Ladda telefonen.
2. **Är ni inte åtta lag?** Ställ in antalet först, innan du nollställer: rutan **Antal lag** på
   lobbyskärmen, − och + (2–12). Alla telefoner byter antal rutor direkt. Det går bara innan
   fråga 1 har startat och innan något lag har tagit en plats — har någon redan valt lag, tryck
   på laget → **Släpp** först. Antalet överlever **Nollställ spelet**, så ordningen spelar ingen
   roll — men gör det innan gästerna kommer.
3. Pillen ska säga **Admin**. Tryck **Nollställ spelet** → skriv **NOLLSTÄLL** i rutan →
   **Ja, nollställ hela spelet**. Alla lag ska stå som **ledig**.
4. Lägg ut QR-lapparna. När gästerna skannar och väljer lag byts **ledig** mot **väntar**.
5. Säg i micken innan fråga 1, två saker:
   - "Stäng av wifi på telefonen och kör på mobildata." (Barens wifi kan ha en inloggningssida
     som stoppar appen.)
   - "Bara EN telefon per lag skannar. Resten lägger undan telefonen."
   Skriv lagnumret för hand på varje bords QR-blad (`/qr` skriver ut samma kod).
6. Förklara poängen högt, och en gång till efter fråga 1: **plats 10 ger 10 poäng, plats 1 ger
   1 poäng.** Det svåra svaret är värt mest. Alla tror tvärtom första gången.
7. Inga deployer efter att gästerna kommit. Måste du ändå: tryck **Nollställ spelet** direkt
   efteråt, annars pekar en pågående fråga på fel lista.

### Per fråga — det här trycker du

| Steg | Knapp | Vad händer |
|---|---|---|
| 1 | **Starta fråga N** | Alla telefoner visar frågan och 1:30. Läs frågan högt (den står överst på din skärm). |
| 2 | — | Titta på rutnätet: **svar** (grönt) = laget har skickat, **väntar** = inte än, **offline** (rött) = telefonen har tappat kontakten. |
| 3 | **Pausa** / **Fortsätt** | Stoppar och startar klockan på alla telefoner. Överlever att du laddar om sidan. |
| 4 | **+30 s** | Lägger på 30 sekunder. |
| 5 | **Lås svaren nu** | Låser tidigt. Annars låser klockan själv på 0:00 — inga svar tas emot efter det, oavsett vad någons telefon visar. |
| 6 | **Rätta och börja avslöja** | Modellen matchar svaren (några sekunder). Sedan ser du varje lags svar och siffra. |
| 7 | **Visa nästa rad: N** ×10 | Läs raden högt när du trycker. Din skärm visar "Visad: …" och "Nästa: …" så du ser vad som kommer. Lagens telefoner lyser upp när deras rad kommer. Efter rad 10 visas plats 11–15 som nära skott. |
| 8 | **Visa ställningen** | Alla ser tabellen; det egna laget är markerat. |
| 9 | **Nästa fråga** | Tillbaka till Starta fråga. Efter fråga 10: **Visa slutresultat** → vinnaren visas på alla telefoner. |

Vid 0:30 (steg 2): läs raden under rutnätet högt — "X av N har svarat" (N = antalet lag) — och ropa upp lagen som
står kvar på **väntar**. Ett svar som försvann i en dålig uppkoppling syns bara så här.

Rättningen (steg 6) tar 3–5 sekunder normalt, upp till 20 om modellen strular. Prata under
tiden — tryck inte igen. Står något lag på **ogranskad** betyder det att modellen inte svarade
(upptagen, eller fel på nyckeln): tryck **Rätta igen** en gång, annars sätt platsen för hand
— listan på papper är din fusklapp. Skrev du in ett svar för hand efter låsningen rättas det
direkt av sig självt; vänta fem sekunder innan du trycker **Rätta**, annars säger den
"Rättning pågår".

**Nästa fråga** (steg 9) går inte att trycka förrän hela listan är visad — appen säger ifrån. Den går
inte att ångra: frågan är slut och listan kan inte visas igen. Raden med **Nollställ** rör du
inte alls när gästerna väl är på plats; de två länkarna ligger bakom **Mer…** uppe till höger,
och "Nollställ spelet" kräver att du skriver ordet.

**Visa alla** visar hela listan på en gång om du har bråttom.

### Ändra ett lags svar eller poäng

Tryck på ett lag (i rutnätet eller i svarslistan). Där kan du:
- **Skriva svar för hand** (om deras telefon dog, eller om de ropade svaret till dig). Det
  rättas som vilket svar som helst. Gör du det efter att ställningen visats tar rättningen
  några sekunder; **Nästa fråga** väntar tills den är klar och säger "Rättning pågår" om du
  trycker för tidigt, så att inga poäng tappas.
- **Sätta plats för hand**: 0 = utanför listan, 1–15 = raden. Poängen följer direkt, även efter
  att ställningen visats. Varje plats visar radens namn, så du väljer på namn och inte på siffra.
  Rader märkta **ogranskad** sätter du så här om **Rätta igen** inte löste dem.
- **Släppa laget**: platsen blir ledig och en ny telefon kan välja laget. Deras svar och poäng
  finns kvar.

### Om något går fel

| Problem | Gör så här |
|---|---|
| En telefon dog / laddar inte | Skriv lagets svar för hand (tryck på laget). Eller **Släpp laget** och låt en annan telefon välja det. |
| Ett lag valde fel lag | Tryck på laget → **Släpp** → de väljer rätt. |
| Ett lag står som **offline** | Deras telefon har tappat nätet. Den kommer tillbaka av sig själv ("Återansluter…" på deras skärm) med svaret kvar. Sista svaret före låsning gäller. |
| **ogranskad** på en rad | Modellen svarade inte (upptagen, eller fel på nyckeln). Tryck **Rätta igen** en gång; hjälper det inte, tryck på raden och sätt plats för hand. Spelet väntar inte på modellen. |
| Modellen har uppenbart fel | Tryck på raden, sätt rätt plats. Ditt ord gäller. |
| Fel fråga startad / kaos | **Nollställ frågan** (bakom **Mer…** på avslöjande- och ställningsskärmen, längst ner på de andra) → **Ja**. Svaren på den frågan raderas, lagen behåller sina platser och sina poäng från tidigare frågor. |
| Allt behöver börja om | **Nollställ spelet** → skriv **NOLLSTÄLL** i rutan → **Ja**. Allt raderas, alla telefoner får välja lag igen. |
| Din adminsida säger **Fel adminlänk** | Länken saknar `?t=…` eller har fel nyckel. Öppna bokmärket med hela `?t=`-länken **en gång** — då sparas rätt nyckel igen i telefonen, och vanliga `/admin` fungerar efteråt. En länk med fel nyckel skriver inte över den sparade. |
| Ni blev fler eller färre lag mitt i kvällen | Antalet går inte att ändra när spelet startat. Vill du ändå: **Nollställ spelet** (allt raderas) → ställ **Antal lag** → börja om. Annars: låt tomma lag stå kvar, de får noll poäng och stör inget. |
| Din adminsida säger **Återansluter…** länge | Kolla nätet på din telefon. Spelet ligger på Cloudflare och väntar; inget försvinner. |
| En telefon säger "används av en annan telefon" | Vanligt om gästen först öppnade länken inne i Instagram/Snapchat och sedan i Safari. Tryck på laget → **Släpp** → de väljer om. |
| Alla telefoner säger **Återansluter…**, även din | Direkt efter en deploy: fel i `data/quiz.json` — kör `npm test`, rätta, deploya om. Mitt i kvällen: nätet. Säg "mobildata, inte wifi". Pappersbladen om det inte släpper. |
| Ett lag säger att deras svar försvann | Skriv in det för hand (tryck på laget). Sista svaret före låsningen gäller, och ditt handskrivna svar rättas som alla andra. |
| Allt dör | Pappersbladen. Poängen hittills står på adminsidan när den kommer tillbaka. |

När slutresultatet visas: **ta en skärmdump direkt**, och lägg sedan ifrån dig telefonen.
"Nollställ spelet" är den enda knappen kvar på den skärmen.

Loggar från servern, om du vill titta från datorn: `npx wrangler tail` (Ctrl+C avslutar).

---

## 4. Bra att veta

- Klockan är serverns. Telefonerna visar serverns tid, även om deras egen klocka går fel.
  Låsningen sker på servern vid 0:00.
- Allt sparas på servern efter varje tryck. En telefon som laddas om, en Worker som startas
  om — inget svar och ingen poäng försvinner.
- Modellen (Claude) får bara listans rader och lagens svar. Din API-nyckel ligger som hemlighet
  hos Cloudflare, aldrig i telefonerna.
- Kostnad: tio modellanrop per kväll. Försumbart.
- Vill du byta listor efter deployen: ändra `data/quiz.json` och kör `npm run deploy` igen.
  Kör **Nollställ spelet** efteråt, annars kan en pågående fråga peka på fel lista.
