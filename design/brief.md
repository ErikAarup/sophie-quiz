# Sophies topp tio — design brief for Claude Design

## What it is

A mobile web app used for 45 minutes at a birthday party. Eight teams, one phone each,
plus the host's phone (admin). Swedish UI. No big screen. Host reads questions aloud.

## Flow per question

Host taps "Starta fråga N" → all phones: question + 150 s countdown (same clock everywhere;
host can pause, resume, +30 s, lock early; locks by itself at 0:00) → answers locked →
host taps "Rätta" (model matches answers to list rows) → host reveals rows 1…10 one tap at
a time, then 11–15 as near misses → host shows standings → next question. Ten questions,
then a final standings screen with the winner.

## Scoring

Points = rank of the matched row (1 = top entry … 10 = tenth). Ranks 11–15 = 0 points but
shown as "plats N". No match = 0. Cumulative leaderboard, ties share a position. Host can
override any grade and type any team's answer by hand.

## Screens and copy (Swedish, use verbatim where it fits)

1. **Välj lag** — eyebrow "Sophie 25 år", title "Topp tio", "Välj ert lag. En telefon per
   lag.", tiles Lag 1 … Lag 8 (taken: dimmed + "TAGET"), footer "Fel lag? Säg till Erik så
   släpper han det."
2. **Väntar** — pill "Ansluten", "Fråga 0 av 10", eyebrow "Ni är", huge "Lag 3", "Väntar på
   att Erik startar". Rules box "Så funkar det": "Ett svar per lag och fråga. Poäng = svarets
   plats på listan: ettan ger 1, tian ger 10. Utanför listan ger 0. Ni har 2:30 per fråga."
3. **Fråga** — pill "Lag 3", "Fråga 4 av 10", ring countdown "1:47" + "kvar", eyebrow
   "Frågan", question "Vilka är EU:s tio folkrikaste länder?", small print "Enligt Eurostat,
   1 januari 2025. Ett svar: skriv landet ni tror ligger så långt ner på listan som möjligt
   utan att ramla ur.", text field (sample "Portugal"), button "Skicka svar", note "Ni kan
   ändra ert svar tills tiden går ut." After sending: "Svar skickat".
4. **Tiden är ute** — big "Tiden är ute", "Lyssna på Erik.", card "Ert svar / Portugal /
   Låst. Rättas när Erik läser listan."
5. **Avslöjande** — heading "EU:s folkrikaste länder", rows 1 Tyskland 83,6 milj · 2
   Frankrike 68,6 milj · 3 Italien 58,9 milj · 4 Spanien 49,1 milj · 5 Polen 36,5 milj · 6
   Rumänien 19,0 milj · 7 Nederländerna 18,0 milj · 8 Belgien 11,9 milj · 9 Tjeckien 10,9
   milj · 10 Portugal 10,7 milj; near misses 11 Sverige · 12 Grekland · 13 Ungern · 14
   Österrike · 15 Bulgarien. Hidden rows show "·····". Bottom card before reveal: "?" +
   "Ert svar: Portugal" + "Inte avslöjat än. Håll tummarna."; after: "10" + "Ert svar:
   Portugal · plats 10 · 10 poäng".
6. **Ställning** — "Efter fråga 4", title "Ställning", rows: 1 Lag 7 27 · 2 Lag 1 24 · 3
   Lag 3 · ni 22 (highlighted) · 4 Lag 5 19 · 5 Lag 2 17 · 6 Lag 8 15 · 7 Lag 4 12 · 8 Lag 6
   9; footer "Senaste: Portugal, plats 10, +10 poäng".
7. **Admin — fråga öppen** — pill "Admin", "Fråga 4 av 10 · svar öppna", huge "1:47",
   buttons "Pausa", "+30 s", question title, 2×4 grid Lag 1–8 with status "svar" (accent),
   "väntar" (muted), "offline" (red), buttons "Lås svaren nu" (danger) and "Rätta och börja
   avslöja" (primary, disabled until locked), note "Låses av sig själv på 0:00. Rättning tar
   några sekunder."
8. **Admin — avslöjande** — "Fråga 4 av 10 · avslöjar", counter "6/10", main button "Visa
   nästa rad: 7", eyebrow "Lagens svar · tryck för att ändra", rows: Lag 1 Spanien 4 · Lag 2
   Nederländerna 7 · Lag 3 Portugal 10 · Lag 4 Sverige 0 (plats 11) · Lag 5 tjeckien 9 ·
   Lag 6 [field "skriv svar för hand…"] offline · Lag 7 Polen 5 · Lag 8 Grekland 0 (plats
   12); buttons "Visa ställningen", "Nästa fråga".

Also needed but lower priority: a "Återansluter…" pill state, a final screen "Vinnare:
Lag 7", and an admin confirm sheet for "Nollställ frågan" / "Nollställ spelet".

## Visual direction

- Background #0a0b10, top glow #1a1f33 (radial, subtle). Surfaces #12141d / #171a26,
  borders #1f2333 / #2a2f44. Text #f2f3f7, secondary #c9cddb, muted #8a90a6.
- Accent #d8ff3d (countdown ring, own team, primary buttons, "svar" status). Danger
  #ff6b8a on #2a1420.
- Type: Bebas Neue (numbers, headings), IBM Plex Sans 400/500/600 (text).
- Radii 12–14 px, primary buttons 56 px tall, tap targets ≥ 44 px, 390 px phone width,
  fluid down to 360 px.
- No emoji, no fake status bar, no decorative gradients, no confetti. One motion: a row
  sliding in on reveal and the team card lighting up.
