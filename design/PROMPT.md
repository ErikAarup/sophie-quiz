# Paste this into claude.ai/design as the first message

Attach `brief.md` from this folder (and, optionally, the eight `*.dc.html` files in
`reference/` as visual references — they are static sketches of the same screens).

---

Design a mobile web app for a live pub quiz at my sister-in-law-ish friend Sophie's
25th birthday party this Saturday. About 40 guests in a rented bar, eight teams of five,
one phone per team, Swedish language throughout. I am the host with a microphone; there is
no big screen, so the phones carry everything the teams need to see.

The format is "topp tio": I read a top-ten list's question aloud ("Vilka är EU:s tio
folkrikaste länder?"), every team types ONE answer within a shared 150-second countdown,
a model matches the answer to a row on the list, and points equal the row's rank (1 point
for the top entry, 10 for the tenth, 0 outside the list). Then I reveal the list row by
row from my phone, teams see where their answer landed, and a leaderboard shows between
questions. Ten questions.

Please produce a clickable prototype of two flows, at 390 px phone width, as one design
system so it can be handed to Claude Code afterwards:

Player flow (the guests): 1 Välj lag — eight big tiles Lag 1–Lag 8, taken ones dimmed
with "Taget". 2 Väntar — the team's name huge, "Väntar på att Erik startar", a short rules
box. 3 Fråga — question number, big ring countdown (e.g. 1:47), the question and its small
print, one text field and a "Skicka svar" button, note that the answer can be changed until
time runs out. 4 Tiden är ute — locked state showing the team's answer. 5 Avslöjande — the
list rows 1–10 appearing one at a time, hidden rows as dots, a bottom card that lights up
when the team's row is revealed ("Ert svar: Portugal · plats 10 · 10 poäng"). 6 Ställning —
leaderboard of eight teams with points, the team's own row highlighted.

Admin flow (me, on my phone, one-handed while holding a mic): 7 Fråga öppen — huge
countdown, Pausa and +30 s buttons, the question, a 2×4 grid of teams with status svar /
väntar / offline, "Lås svaren nu" and "Rätta och börja avslöja". 8 Avslöjande — "Visa
nästa rad: 7" as the main button with a 6/10 counter, then every team's answer with its
matched rank as a big number (0 in red for misses, with "plats 12" for near misses),
tappable to override, one row with a hand-typed answer field for an offline team, then
"Visa ställningen" and "Nästa fråga".

Direction: game show. Very dark background (#0a0b10 with a faint cool glow at the top),
one neon accent #d8ff3d used for the countdown ring, the active team and primary buttons,
red-pink #ff6b8a only for misses and the danger button. Oversized numbers in a condensed
display face (Bebas Neue or similar), IBM Plex Sans for text. No emoji, no fake phone
status bar, no gradients beyond the one glow, generous tap targets (buttons 56 px).
Everything a guest reads is Swedish; keep my copy from the brief where it exists.

Make the prototype clickable in this order: Välj lag → Väntar → Fråga → Tiden är ute →
Avslöjande → Ställning, and separately Admin fråga öppen → Admin avslöjande. Use the
sample data in the brief (EU:s folkrikaste länder, Lag 3, Portugal).
