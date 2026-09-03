# Spelledning — Sophies topp tio

Det här är din lathund, Erik. Fredag: gör appen redo. Lördag: kör kvällen. Allt du behöver
trycka på står här; koden bakom står i `README.md` och `WORK_ORDER.md`.

**Adresser (efter `npm run deploy`, se 2.4):**

| Vad | Adress |
|---|---|
| Gästernas sida (den QR-koden pekar på) | `https://sophie-quiz.<ditt-konto>.workers.dev/` |
| Din adminsida | `https://sophie-quiz.<ditt-konto>.workers.dev/admin?t=<ADMIN_TOKEN>` |
| QR-sidan att skriva ut | `https://sophie-quiz.<ditt-konto>.workers.dev/qr` |

`<ADMIN_TOKEN>` är raden `ADMIN_TOKEN=…` i `.dev.vars` i repots rot. Den filen är hemlig och
ligger inte i git. Spara adminlänken som bokmärke i telefonen, då slipper du skriva in den.

---

## 1. Så funkar spelet (30 sekunder)

- Åtta lag, **Lag 1–Lag 8**, en telefon per lag. Gästerna skannar QR-koden och trycker på sitt
  lag. En upptagen ruta är nedtonad med "TAGET".
- Du trycker **Starta fråga N**. Alla telefoner visar frågan och samma klocka: **2:30**.
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
4. Kontroll att allt hänger ihop:
   ```
   npm run typecheck
   npm test
   ```
   `npm test` faller om en slug saknas eller om en lista inte är verifierad.

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
Skriptet bygger telefonsidorna, kontrollerar att ingen nyckel hamnat i bygget, och laddar upp
Workern. Sista raderna visar adressen, i stil med
`https://sophie-quiz.erik-aarup.workers.dev`. Skriv in den i tabellen överst.

Om deployen klagar på rättigheter ("scope"): din API-token i Windows (`CLOUDFLARE_API_TOKEN`)
saknar behörighet — ge den *Workers Scripts: Edit* på
https://dash.cloudflare.com/3230330a438cc5c59b377e1834847e76/api-tokens och kör igen.

### 2.5 Rök-test med två telefoner (10 minuter)

1. Öppna adminlänken på din telefon. Pillen uppe till vänster ska säga **Admin** (grön).
   Säger den "Återansluter…" i mer än några sekunder: kolla mobildata/wifi.
2. Tryck **Nollställ spelet** → **Ja, nollställ hela spelet**.
3. Ta två andra telefoner, skanna QR-sidan (eller skriv adressen). Välj Lag 1 på den ena
   och Lag 2 på den andra. Prova att välja Lag 1 på den andra också: den ska säga
   "Lag 1 är redan taget".
4. Admin: **Starta fråga 1**. Båda telefonerna ska visa frågan och 2:30 samtidigt.
5. Skriv ett svar på Lag 1 (t.ex. rätt svar från listan) och ett fel svar på Lag 2. Ändra
   Lag 1:s svar en gång. Admin ska visa **svar** på båda.
6. Admin: **Pausa**, ladda om adminsidan — klockan ska stå still på samma tid. **Fortsätt**.
   **+30 s**. **Lås svaren nu**. Telefonerna ska visa "Tiden är ute".
7. Admin: **Rätta och börja avslöja**. Inom några sekunder står en siffra vid varje lag.
   Om det står **ogranskad** på ett lag: tryck på raden och välj plats för hand. (Det betyder
   att modellen inte nåddes — kontrollera `ANTHROPIC_API_KEY` i 2.1.)
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

---

## 3. Lördag — kvällen

### Innan gästerna kommer

1. Öppna adminlänken på din telefon. Sätt skärmen på "släcks aldrig" (iPhone: Inställningar →
   Bildskärm → Autolås → Aldrig). Ladda telefonen.
2. Pillen ska säga **Admin**. Tryck **Nollställ spelet** → **Ja, nollställ hela spelet**.
   Alla åtta lag ska stå som **ledig**.
3. Lägg ut QR-lapparna. När gästerna skannar och väljer lag byts **ledig** mot **väntar**.

### Per fråga — det här trycker du

| Steg | Knapp | Vad händer |
|---|---|---|
| 1 | **Starta fråga N** | Alla telefoner visar frågan och 2:30. Läs frågan högt (den står överst på din skärm). |
| 2 | — | Titta på rutnätet: **svar** (grönt) = laget har skickat, **väntar** = inte än, **offline** (rött) = telefonen har tappat kontakten. |
| 3 | **Pausa** / **Fortsätt** | Stoppar och startar klockan på alla telefoner. Överlever att du laddar om sidan. |
| 4 | **+30 s** | Lägger på 30 sekunder. |
| 5 | **Lås svaren nu** | Låser tidigt. Annars låser klockan själv på 0:00 — inga svar tas emot efter det, oavsett vad någons telefon visar. |
| 6 | **Rätta och börja avslöja** | Modellen matchar svaren (några sekunder). Sedan ser du varje lags svar och siffra. |
| 7 | **Visa nästa rad: N** ×10 | Läs raden högt när du trycker. Din skärm visar "Visad: …" och "Nästa: …" så du ser vad som kommer. Lagens telefoner lyser upp när deras rad kommer. Efter rad 10 visas plats 11–15 som nära skott. |
| 8 | **Visa ställningen** | Alla ser tabellen; det egna laget är markerat. |
| 9 | **Nästa fråga** | Tillbaka till Starta fråga. Efter fråga 10: **Visa slutresultat** → vinnaren visas på alla telefoner. |

**Visa alla** visar hela listan på en gång om du har bråttom.

### Ändra ett lags svar eller poäng

Tryck på ett lag (i rutnätet eller i svarslistan). Där kan du:
- **Skriva svar för hand** (om deras telefon dog, eller om de ropade svaret till dig). Det
  rättas som vilket svar som helst.
- **Sätta plats för hand**: 0 = utanför listan, 1–15 = raden. Poängen följer direkt, även efter
  att ställningen visats. Rader märkta **ogranskad** måste du sätta så här.
- **Släppa laget**: platsen blir ledig och en ny telefon kan välja laget. Deras svar och poäng
  finns kvar.

### Om något går fel

| Problem | Gör så här |
|---|---|
| En telefon dog / laddar inte | Skriv lagets svar för hand (tryck på laget). Eller **Släpp laget** och låt en annan telefon välja det. |
| Ett lag valde fel lag | Tryck på laget → **Släpp** → de väljer rätt. |
| Ett lag står som **offline** | Deras telefon har tappat nätet. Den kommer tillbaka av sig själv ("Återansluter…" på deras skärm) med svaret kvar. Sista svaret före låsning gäller. |
| **ogranskad** på en rad | Modellen nådde inte fram i tid. Tryck på raden och sätt plats för hand. Spelet väntar inte på modellen. |
| Modellen har uppenbart fel | Tryck på raden, sätt rätt plats. Ditt ord gäller. |
| Fel fråga startad / kaos | **Nollställ frågan** (längst ner) → **Ja**. Svaren på den frågan raderas, lagen behåller sina platser och sina poäng från tidigare frågor. |
| Allt behöver börja om | **Nollställ spelet** → **Ja**. Allt raderas, alla telefoner får välja lag igen. |
| Din adminsida säger **Fel adminlänk** | Länken saknar `?t=…` eller har fel nyckel. Öppna bokmärket igen. |
| Din adminsida säger **Återansluter…** länge | Kolla nätet på din telefon. Spelet ligger på Cloudflare och väntar; inget försvinner. |
| Allt dör | Pappersbladen. Poängen hittills står på adminsidan när den kommer tillbaka. |

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
