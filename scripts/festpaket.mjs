#!/usr/bin/env node
/**
 * Festpaketet — genererar värdens utskrivbara A4-paket för Sofies quiz.
 *
 *   node scripts/festpaket.mjs      (eller: npm run festpaket)
 *
 * Läser:
 *   data/quiz.json     — kvällens tio slugs i frågeordning + durationSeconds
 *   data/bank.json     — listorna (titel, fråga, källa, rader)
 *   data/aliases.json  — bara för emojiglyferna på fråga 5
 *   .dev.vars          — ADMIN_TOKEN, för adminlänken
 *
 * Skriver:
 *   festpaket-2026-09-05.pdf i repots rot (gitignorerad — den innehåller adminlänken)
 *
 * Adminnyckeln läses bara här, i minnet, och skrivs bara in i PDF:en.
 * Den skrivs aldrig ut i terminalen och hamnar aldrig i någon annan fil.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const PARTY_DATE = '5 september 2026';
const GENERATED = '4 sept 2026';
const OUT_NAME = 'festpaket-2026-09-05.pdf';
const BASE_URL = 'https://sophie-quiz.erik-aarup.workers.dev';
const DEFAULT_TEAMS = 8;
const TEAM_PHRASE = 'så många lag som ni bestämt (standard 8)';

/* ------------------------------------------------------------------ data */

const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const quiz = read('data/quiz.json');
const bank = read('data/bank.json');
const aliases = read('data/aliases.json');

const bySlug = new Map(bank.lists.map((l) => [l.slug_en, l]));
const durationSeconds = quiz.durationSeconds;
const clock = `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')}`;

const ten = quiz.questions.map((slug, i) => {
  const list = bySlug.get(slug);
  if (!list) throw new Error(`Slug saknas i data/bank.json: ${slug}`);
  return { no: i + 1, slug, list };
});

/**
 * Reserverna i Eriks prioritetsordning, R1–R12, från vaultens
 * current/sophie-quiz/kvallens-listor.md (§ Reserver). Ordningen bor här
 * eftersom vaulten inte är en del av repot.
 */
const RESERVE_SLUGS = [
  'largest-lakes-sweden', // R1 — även särskiljningsfrågan
  'boys-names-born-2001-sweden', // R2
  'heaviest-land-animals', // R3
  'largest-islands-sweden', // R4
  'car-brands-swedish-fleet', // R5
  'most-popular-dog-breeds-sweden', // R6
  'richest-people-world-forbes', // R7
  'smallest-countries-by-area', // R8
  'countries-by-area', // R9
  'most-common-surnames-sweden', // R10
  'most-visited-websites-similarweb', // R11
  'most-valuable-brands-interbrand', // R12
];

const reserves = RESERVE_SLUGS.map((slug, i) => {
  const list = bySlug.get(slug);
  if (!list) throw new Error(`Reservslug saknas i data/bank.json: ${slug}`);
  return { no: i + 1, slug, list };
});

/** Adminlänken — enda stället nyckeln används. Aldrig console.log. */
function adminUrl() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, '.dev.vars'), 'utf8');
  } catch {
    throw new Error('.dev.vars hittades inte i repots rot — adminlänken kan inte byggas.');
  }
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith('ADMIN_TOKEN='));
  if (!line) throw new Error('Raden ADMIN_TOKEN= saknas i .dev.vars.');
  const token = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  if (!token) throw new Error('ADMIN_TOKEN är tomt i .dev.vars.');
  return `${BASE_URL}/admin?t=${token}`;
}

/* --------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Svenska tusentalsavskiljare: smalt mellanslag, aldrig radbrytning. */
const THIN = '\u2009';
const thin = (s) => String(s).replace(/(\d)[ \u00a0](?=\d{3}(\D|$))/g, `$1${THIN}`);

const MONTHS = [
  'jan',
  'feb',
  'mars',
  'apr',
  'maj',
  'juni',
  'juli',
  'aug',
  'sept',
  'okt',
  'nov',
  'dec',
];

/** "2026-09-04" → "4 sept 2026", "2026-06" → "juni 2026", fri text passerar. */
function fmtDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  // "31 december 2025" → "31 dec 2025"
  const LONG = {
    januari: 'jan',
    februari: 'feb',
    mars: 'mars',
    april: 'apr',
    maj: 'maj',
    juni: 'juni',
    juli: 'juli',
    augusti: 'aug',
    september: 'sept',
    oktober: 'okt',
    november: 'nov',
    december: 'dec',
  };
  return s.replace(
    /\b(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/gi,
    (w) => LONG[w.toLowerCase()] ?? w,
  );
}

/** Emojiglyferna för fråga 5 — första aliaset är själva emojin. */
const EMOJI_RE = /^[\p{Extended_Pictographic}\u200d\ufe0f]+$/u;
function glyphFor(slug, name) {
  const entry = aliases?.[slug]?.[name];
  if (!Array.isArray(entry)) return '';
  return entry.find((a) => EMOJI_RE.test(a)) ?? '';
}
const hasGlyphs = (slug, list) => list.items.some((it) => glyphFor(slug, it.name_sv));

/** Värdet är ren rangordning på ett par listor — då är kolumnen bara brus. */
function valueIsJustRank(list) {
  return list.items.every(
    (it) => String(it.value).trim() === String(it.rank) && /rank|rangplats/i.test(it.unit ?? ''),
  );
}

function valueCell(item) {
  const v = thin(esc(item.value));
  const u = item.unit ? ` ${esc(item.unit)}` : '';
  return `${v}${u}`;
}

/* --------------------------------------------------- kurerade "Att veta" */

/**
 * Två–tre rader per kort, kokade ur bankens notes/reason och kvallens-listor
 * till det en värd faktiskt säger högt. Saknas en slug faller vi tillbaka på
 * bankens första meningar, så ett listbyte fortfarande ger ett körbart kort.
 */
const KNOW = {
  'swedish-municipalities-by-population': [
    'Namnen är ortnamn: <b>Stockholm</b>, inte "Stockholms kommun".',
    'Tydlig poänggräns — Norrköping tia, Lund elva, drygt 13 000 emellan.',
    'Siffrorna är folkmängd per 30 juni 2026 (SCB via Wikipedia).',
  ],
  'countries-by-mcdonalds-restaurants': [
    '<b>Filippinerna</b> på tia — inte känd trivia, men gissningsbar. Bra chansplats.',
    'Ryssland finns inte med: McDonald\u2019s sålde sin ryska verksamhet 2022.',
    'Alla 15 länder har samma datum, 31 dec 2025 — inga blandade årtal.',
  ],
  'girls-names-born-2001-sweden': [
    '<b>Julia</b> etta — hon toppade 1999, 2000 och 2001.',
    'Gränsen: Maja tia (789 barn), Klara elva (745). Inga delade platser.',
    'Stavningsvarianter räknas ihop under den vanligaste stavningen (SCB).',
  ],
  'highest-grossing-film-franchises': [
    '<b>Fälla:</b> Marvel Cinematic Universe (1) och Avengers (6) är samma familj — be laget precisera innan du ger poäng. Samma sak DC (9) och Batman (10).',
    '"Harry Potter" är svensk benämning på källans "Wizarding World".',
    'Rang 12–15 är ca-belopp; listan flyttar sig när nya filmer kommer.',
  ],
  'most-used-emojis-unicode': [
    '<b>Ord eller emoji — båda funkar.</b> Säg det när du läser frågan.',
    'Plats 8–10 är tre snarlika leende ansikten — döm generöst så länge svaret är entydigt.',
    '🙏 heter "knäppta händer"; "bön" och "high five" godtas också.',
  ],
  'most-common-occupations-sweden': [
    '<b>Fälla:</b> två slags butikssäljare — fackhandel (3) och dagligvaror (6).',
    'Bara "butikssäljare" utan precisering räknas som plats 3.',
    'SCB:s yrkesregister 2024, anställda 16–69 år.',
  ],
  'highest-paid-athletes-forbes': [
    '<b>Listan har bara tio rader</b> — inga nära skott att läsa upp efter tian.',
    'Inkomster maj 2025–maj 2026, lön och prispengar plus sponsring (Forbes 22 maj 2026).',
    'Chansar ett lag på plats 11–15 finns inget stöd i källan: sätt plats 0 för hand.',
  ],
  'most-visited-websites-sweden': [
    '<b>Ögonblicksbild för juli 2026</b> — säg datumet i micken, ordningen svänger månadsvis.',
    'Similarweb publicerar inga besökssiffror öppet: rangordningen är själva svaret.',
    'Aftonbladet femma och Expressen tia — de svenska sajterna ligger mitt i.',
  ],
  'largest-companies-by-market-cap': [
    '<b>SpaceX ligger sjua</b> (noterat som SPCX, 4 sept 2026) — den överraskar.',
    'Google = Alphabet, Facebook = Meta, Aramco = Saudi Aramco. Alla godkänns.',
    'Uttal: <b>TSMC</b> bokstav för bokstav, <b>Broadcom</b> "bråd-kom". Kurserna rör sig under dagen.',
  ],
  'most-followed-instagram-accounts': [
    '<b>Fälla: Instagrams eget konto är etta</b> — lagen glömmer det och gissar en person.',
    'Dwayne Johnson och Kylie Jenner delar plats 5 — båda ger 5 poäng.',
    'Uttal: <b>Khloé</b> ("klo-é") Kardashian på tia. Följartal per juni 2026.',
  ],
  /* reserver */
  'largest-lakes-sweden': [
    'Storsjön avser sjön i Jämtland, inte Mälarens delbassäng.',
    'Källan har bara tio rader; 11–13 är styrkta mot svenska Wikipedia.',
  ],
  'boys-names-born-2001-sweden': [
    '<b>Bara tio rader</b> — SCB redovisar bara topp tio för det året.',
    'Emil (7) och Alexander (8) hade båda 951 barn, men skilda ranger i källan.',
  ],
  'heaviest-land-animals': [
    'Vit noshörning och flodhäst delar plats 4–5 (4 500 kg) — båda ger sin plats.',
    'Tamboskap på elva är tamdjur men ligger utanför poäng, så det stör inget.',
  ],
  'largest-islands-sweden': [
    '<b>Södertörn räknas som ö</b> sedan 2014 (kanal och sluss) — därför trea, före Orust och Hisingen.',
    'Rad 8 och 12–15 är SCB-kluster av sammanvuxna öar, angivna under sin mest kända delö.',
  ],
  'car-brands-swedish-fleet': [
    'BMW (6) och Kia (7) skiljer knappt 900 bilar — men ingen delad plats.',
    'Registerdata per 3 sept 2026; ordningen 7–11 kan skifta mellan månader.',
  ],
  'most-popular-dog-breeds-sweden': [
    'Svenska Kennelklubbens <b>registreringar 2024</b>, inte alla hundar i landet.',
    'Var generös med stavning: bichon havanais, dansk-svensk gårdshund, miniature american shepherd.',
  ],
  'richest-people-world-forbes': [
    'Rob, Jim och Alice Walton är tre syskon — godta bara "Walton" på rätt ungefär.',
    'Förmögenheter per mars 2026, rör sig dagligen med börsen. Säg datumet.',
  ],
  'smallest-countries-by-area': [
    'Beroende territorier räknas inte — bara suveräna stater.',
    'Andorra (468 km²) ligger strax utanför topp 15.',
  ],
  'countries-by-area': [
    'Godta bara "Kongo-Kinshasa" eller "DR Kongo", inte Kongo-Brazzaville.',
    'Krim ingår i Rysslands yta i den här siffran.',
  ],
  'most-common-surnames-sweden': [
    'Alla är -sson-namn och låter lika — läs långsamt i micken.',
    'Persson (8) och Svensson (9) ligger tätast; gränsen 10/11 är däremot tydlig.',
  ],
  'most-visited-websites-similarweb': [
    '"X (Twitter)" avser x.com. Inga delade placeringar.',
    'Similarweb juli 2026 — ordningen ändras varje månad.',
  ],
  'most-valuable-brands-interbrand': [
    'Interbrand Best Global Brands 2025; plats 11–14 är uppskattade belopp.',
    'Instagram (8) och YouTube (13) räknas som egna varumärken, skilda från Meta och Google.',
  ],
};

function knowBullets(slug, list, max = 3) {
  const curated = KNOW[slug];
  if (curated) return curated.slice(0, max);
  const src = list.notes || list.reason_sv || '';
  return src
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
    .map(esc);
}

/* ----------------------------------------------------------- byggblock */

const pages = [];
const push = (title, html) => pages.push({ title, html });

function knowBox(slug, list, max) {
  const bullets = knowBullets(slug, list, max);
  if (!bullets.length) return '';
  return `<div class="knowbox"><div class="kb-label">Att veta</div><ul>${bullets
    .map((b) => `<li>${b}</li>`)
    .join('')}</ul></div>`;
}

/** Långa källnamn bär ofta en parentes med metodanteckningar — den hör inte hemma på kortet. */
function shortSource(name) {
  const s = String(name);
  if (s.length <= 62) return s;
  const cut = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return cut.length ? cut : s;
}

function sourceLine(list) {
  const tags = [];
  if (list.verdict === 'corrected') tags.push('<span class="tag">rättad</span>');
  if (list.verdict === 'verified') tags.push('<span class="tag">verifierad</span>');
  // "FÖRÄNDERLIG" i vaultens läsfil = volatility "volatile" i banken.
  if (list.volatility === 'volatile') tags.push('<span class="tag warn">säg datumet</span>');
  return `<div class="srcline"><b>Källa:</b> ${esc(shortSource(list.source_name))} · per ${esc(
    fmtDate(list.as_of),
  )}${tags.join('')}</div>`;
}

function rowsTable(slug, list) {
  const showValue = !valueIsJustRank(list);
  const showGlyph = hasGlyphs(slug, list);
  const out = [];
  list.items.forEach((it, idx) => {
    const isTenth = idx === 9;
    const glyph = showGlyph
      ? `<td class="gl emoji">${glyphFor(slug, it.name_sv) || ''}</td>`
      : '';
    out.push(
      `<tr class="${isTenth ? 'boundary' : ''}"><td class="r">${it.rank}</td>${glyph}` +
        `<td class="nm">${esc(it.name_sv)}</td>` +
        (showValue ? `<td class="v">${valueCell(it)}</td>` : '') +
        `</tr>`,
    );
    if (isTenth && list.items.length > 10) {
      const span = 2 + (showGlyph ? 1 : 0) + (showValue ? 1 : 0);
      out.push(
        `<tr class="bmark"><td colspan="${span}">▲ poänggräns · plats 11–15 läses upp som nära skott men ger 0 p</td></tr>`,
      );
    }
  });
  if (list.items.length <= 10) {
    const span = 2 + (showGlyph ? 1 : 0) + (showValue ? 1 : 0);
    out.push(
      `<tr class="miss"><td colspan="${span}">Källan har bara ${list.items.length} rader — slut här.</td></tr>`,
    );
  }
  return `<table class="rows">${out.join('')}</table>`;
}

function paperRow() {
  const heads = Array.from({ length: DEFAULT_TEAMS }, (_, i) => `<th>Lag ${i + 1}</th>`).join('');
  const blanks = Array.from({ length: DEFAULT_TEAMS }, () => '<td></td>').join('');
  return `<div class="paperrow">
    <div class="pr-label">Pappersrad — bara om appen är nere · ${esc(TEAM_PHRASE)}</div>
    <table class="pr">
      <tr><th class="rh">Lag</th>${heads}</tr>
      <tr><td class="rh">Plats</td>${blanks}</tr>
      <tr><td class="rh">Poäng</td>${blanks}</tr>
    </table>
  </div>`;
}

/* ---------------------------------------------------------- sida 1 */

function pageQuickCard(admin, planBPage) {
  const rows = [];
  ten.forEach((q) => {
    rows.push(
      `<tr><td class="n">${q.no}</td><td>${esc(q.list.title_sv)}</td><td class="src">${esc(
        fmtDate(q.list.as_of),
      )}</td></tr>`,
    );
    if (q.no === 5)
      rows.push('<tr class="halftime"><td colspan="3">Halvtid — visa ställningen, 2 min</td></tr>');
  });

  return `
  <h1>Sofies topp tio — värdens snabbkort</h1>
  <div class="lead">Lördag ${PARTY_DATE} · ${
    ten.length
  } frågor · ${durationSeconds} sekunders betänketid (${clock} på klockan) · 45 minuter</div>

  <div class="link-card">
    <div class="label">Deltagarlänk — den du skickar i gruppchatten</div>
    <div class="url">${esc(BASE_URL)}/</div>
    <div class="hint">Säg högt: "sophie-quiz punkt erik-aarup punkt workers punkt dev". Skicka den <b>först när lagen sitter</b> — annars tar telefoner lag i förväg och det blir TAGET-kaos.</div>
  </div>

  <div class="link-card admin">
    <div class="label">Adminlänk — bara din, visa den inte för någon</div>
    <div class="url">${esc(admin)}</div>
    <div class="hint">Spara som bokmärke på hemskärmen. Pillen uppe till vänster ska säga <b>Admin</b>.</div>
  </div>

  <h2>Kvällens tio, i ordning</h2>
  <table class="ten">${rows.join('')}</table>

  <h2>De sex knapparna, varje fråga</h2>
  <p class="small"><b>Starta fråga N</b> → (<b>Pausa</b> / <b>+30 s</b> / <b>Lås svaren nu</b>) → <b>Rätta och börja avslöja</b> → <b>Visa nästa rad</b> ×10 → <b>Visa ställningen</b> → <b>Nästa fråga</b>. Har du bråttom: <b>Visa alla</b>.</p>

  <div class="planb">Plan B: appen dör → sida ${planBPage} (pappersläge). Poängen hittills står kvar på adminsidan när den kommer tillbaka.</div>`;
}

/* ---------------------------------------------------------- sida 2 */

function pageBeforeGuests() {
  return `
  <h1>Före gästerna</h1>
  <div class="lead">Kryssa av. De två första blocken görs hemma, det tredje i baren.</div>

  <h2>Fredag kväll — vid datorn</h2>
  <ul class="check">
    <li>PR #1 och #2 mergade.</li>
    <li><code>git pull</code> · <code>npm run deploy</code> — sista raden visar adressen.</li>
    <li>Rök-test med två telefoner enligt SPELLEDNING §2.5.</li>
    <li><b>Nollställ spelet</b> när rök-testet är klart.</li>
    <li>Skriv ut det här paketet — ensidigt, A4.</li>
    <li>Skriv ut svarsbladen (ett per lag) och räknebladet ×1.</li>
    <li>Skriv ut QR-sidan <code>${esc(BASE_URL)}/qr</code>, ett par exemplar per bord.</li>
  </ul>

  <h2>Lördag, hemma</h2>
  <ul class="check">
    <li>Telefonen fulladdad · powerbank eller laddare i fickan.</li>
    <li>Adminlänken som bokmärke på hemskärmen (sida 1).</li>
    <li>Autolås: <b>Aldrig</b> (Inställningar → Bildskärm → Autolås).</li>
    <li>Stör ej: <b>på</b> — ett samtal mitt i avslöjandet förstör showen.</li>
    <li>Ljusstyrkan upp.</li>
  </ul>

  <h2>I baren, innan gästerna</h2>
  <ul class="check">
    <li>Öppna adminlänken på plats. Pillen ska säga <b>Admin</b>. Står det "Återansluter…" länge → byt wifi/mobildata. Barens wifi med inloggningssida → kör mobildata.</li>
    <li><b>Nollställ spelet.</b> Alla lag ska stå som <b>ledig</b> — ${esc(TEAM_PHRASE)}.</li>
    <li>Utse en medhjälpare för papper och räkning. Namn: ______________________</li>
    <li>Bestäm vilket bord som är vilket lag. Lagen heter Lag 1 och uppåt, ${esc(TEAM_PHRASE)}.</li>
    <li>Blir det fler eller färre bord än väntat: sätt antalet lag i admin <i>innan</i> någon väljer lag. Finns inte inställningen — kör vidare, tomma lag stör ingenting.</li>
  </ul>

  <h2>När lagen sitter</h2>
  <ul class="check">
    <li>Skicka deltagarlänken i gruppchatten — <b>först nu</b>.</li>
    <li>Varje lag utser en telefonhållare.</li>
    <li>Kontrollera på rutnätet att alla lag står som <b>väntar</b> innan du tar micken.</li>
  </ul>`;
}

/* ---------------------------------------------------------- sida 3 */

function pageScript() {
  return `
  <h1>Reglerna i micken</h1>
  <div class="lead">60–90 sekunder. Läs i den här ordningen — du behöver inte läsa ordagrant, men ta med varje punkt.</div>

  <ol class="script">
    <li>"Välkomna. Vi kör Sofies topp tio: ${ten.length} frågor, ${
      durationSeconds
    } sekunder på var och en, klart om 45 minuter."</li>
    <li>"Ett svar per lag, på den telefon ni har valt. Det är laget som svarar, inte personen."</li>
    <li>"Jag läser upp en topp tio-lista. Ni skriver <b>ETT</b> svar som ni tror finns på listan."</li>
    <li>"Poängen är platsen på listan. Ettan ger 1 poäng, tian ger 10. Plats 11 till 15 läser jag upp, men de ger noll. Utanför listan: noll."</li>
    <li>"Alltså: <b>våga chansa på det som ligger långt ner — men inte så långt att det faller av.</b>"</li>
    <li>"Klockan står på ${clock}. Ni kan ändra er hur många gånger ni vill; den sista texten är den som gäller. När klockan är noll låser det."</li>
    <li>"Sen är avslöjandet showen: jag läser listan uppifrån och ner, och er telefon lyser upp när ert svar kommer."</li>
    <li>"Halvtid efter fem frågor. Ställningen visas efter varje fråga."</li>
    <li>"Dör en telefon: ropa svaret till mig, så skriver jag in det."</li>
    <li>"Mitt ord gäller vid tvist. Källan står på mitt papper."</li>
  </ol>

  <div class="box grey tight">
    <h3>Innan du startar fråga 1</h3>
    <p class="small">Läs <b>fetstilsraden</b> på frågekortet <b>två gånger</b> — den innehåller kriteriet och datumet, och det är det som avgör tvister. Sedan trycker du Starta.</p>
  </div>

  <div class="box hair tight">
    <h3>Halvtid (efter fråga 5, ~2 min)</h3>
    <p class="small">Visa ställningen. Läs topp tre <b>och</b> sista laget, med en glimt i ögat. "Det är tio poäng per fråga kvar — allt kan hända." Kolla klockan mot tidsplanen på sida 6.</p>
  </div>

  <div class="box hair tight">
    <h3>Vinnaren (efter fråga 10, ~3 min)</h3>
    <p class="small"><b>Visa slutresultat</b> → alla telefoner visar vinnaren. Läs pallen <b>nedifrån</b>: trea, tvåa, etta. Delad seger → särskiljningsfrågan, sida 6.</p>
  </div>`;
}

/* ---------------------------------------------------------- sida 4 */

function pageButtons() {
  const steps = [
    ['1', 'Starta fråga N', `Alla telefoner visar frågan och ${clock}. Läs fetstilsraden högt, två gånger.`],
    ['2', '— titta på rutnätet', '<b>svar</b> (grönt) = laget har skickat · <b>väntar</b> = inte än · <b>offline</b> (rött) = telefonen tappat nätet, den kommer tillbaka själv.'],
    ['3', 'Pausa / Fortsätt', 'Stoppar och startar klockan på alla telefoner. Överlever att du laddar om sidan.'],
    ['4', '+30 s', 'Lägger på 30 sekunder. Använd den på de svåra listorna hellre än att stressa.'],
    ['5', 'Lås svaren nu', 'Låser tidigt. Annars låser klockan själv på 0:00 — inget tas emot efter det, oavsett vad någons telefon visar.'],
    ['6', 'Rätta och börja avslöja', 'Modellen matchar svaren mot listans rader (några sekunder). Sedan ser du varje lags svar och siffra.'],
    ['7', 'Visa nästa rad ×10', 'Läs raden högt när du trycker. Din skärm visar "Visad" och "Nästa". Lagens telefoner lyser upp när deras rad kommer. Efter rad 10 visas 11–15 som nära skott.'],
    ['8', 'Visa ställningen', 'Alla ser tabellen, det egna laget markerat.'],
    ['9', 'Nästa fråga', 'Tillbaka till Starta. Efter fråga 10: <b>Visa slutresultat</b>.'],
  ];
  return `
  <h1>Per fråga — det här trycker du</h1>
  <div class="lead">Har du bråttom: <b>Visa alla</b> visar hela listan på en gång i stället för rad för rad.</div>

  <table class="grid">
    <tr><th class="step">#</th><th class="btn">Knapp</th><th>Vad händer</th></tr>
    ${steps
      .map(([n, b, w]) => `<tr><td class="step">${n}</td><td class="btn">${b}</td><td>${w}</td></tr>`)
      .join('')}
  </table>

  <h2>Ändra ett lags svar eller poäng</h2>
  <p class="small">Tryck på laget — i rutnätet eller i svarslistan. Där kan du:</p>
  <ul>
    <li><b>Skriva svar för hand</b> — om deras telefon dog eller de ropade svaret till dig. Det rättas som vilket svar som helst. Gör du det efter att ställningen visats tar rättningen några sekunder; <b>Nästa fråga</b> väntar in den och säger "Rättning pågår" om du trycker för tidigt.</li>
    <li><b>Sätta plats för hand</b> — 0 = utanför listan, 1–15 = raden. Poängen följer direkt, även efter att ställningen visats. Rader märkta <b>ogranskad</b> <i>måste</i> sättas så här.</li>
    <li><b>Släppa laget</b> — platsen blir ledig och en ny telefon kan välja laget. Svar och poäng finns kvar.</li>
  </ul>

  <div class="box grey tight">
    <h3>Två saker som är lätta att missa</h3>
    <p class="small">Klockan är <b>serverns</b>, inte telefonernas — låsningen sker på servern vid 0:00. Och allt sparas efter varje tryck: en telefon som laddas om tappar ingenting.</p>
  </div>`;
}

/* ---------------------------------------------------------- sida 5 */

function pageTrouble(planBPage) {
  return `
  <h1>Om något går fel</h1>
  <div class="lead">I den här ordningen. Spelet väntar aldrig på modellen, och ingenting försvinner från servern.</div>

  <ol class="steps">
    <li><b>En telefon krånglar.</b> Skriv lagets svar för hand (tryck på laget), eller <b>Släpp laget</b> och låt en annan telefon ta det. Incognito-läge tappar laget vid omladdning — släpp och välj om.</li>
    <li><b>Rättningen säger "ogranskad" eller har uppenbart fel.</b> Tryck på raden och sätt plats för hand, med frågekortet framför dig. Ditt ord gäller.</li>
    <li><b>Adminsidan säger "Återansluter…".</b> Vänta — allt ligger sparat på servern. Byt nät. Öppna bokmärket igen. Står det <b>Fel adminlänk</b> saknar länken sin <code>?t=</code> eller har fel nyckel — skriv av den från sida 1.</li>
    <li><b>Fel fråga startad, eller kaos.</b> <b>Nollställ frågan</b> längst ner → Ja. Svaren på den frågan raderas; lagen behåller sina platser och alla tidigare poäng.</li>
    <li><b>Hoppa över en fråga</b> (det finns ingen knapp för det): Lås svaren nu → Rätta → Visa alla → Nästa fråga. Alla får 0 på den. Säg "vi hoppar den".</li>
    <li><b>Ett lag valde fel lag.</b> Tryck på laget → Släpp → de väljer om.</li>
    <li><b>Allt dör.</b> Pappersläget, sida ${planBPage}. Anteckna ställningen från adminsidan när den syns igen och fortsätt räkna på räknebladet.</li>
  </ol>

  <div class="dont">
    <b>Gör inte det här under festen:</b> Nollställ spelet efter att fråga 1 startat · deploya · dela adminlänken · byta en lista på plats (det kräver deploy och en ny nollställning).
  </div>

  <div class="box hair tight">
    <h3>Om du vill se serverns loggar från datorn</h3>
    <p class="small"><code>npx wrangler tail</code> i repots rot. Ctrl+C avslutar. Behövs nästan aldrig mitt i kvällen.</p>
  </div>`;
}

/* ---------------------------------------------------------- sida 6 */

function pageTiming() {
  const lake = reserves[0].list;
  const vanern = lake.items[0];
  const budget = [
    ['Regler och lagnamn', 4],
    ['Fråga 1–5', 15],
    ['Halvtidsställning', 2],
    ['Fråga 6–10', 15],
    ['Slutställning och vinnare', 3],
    ['Buffert', 6],
  ];
  return `
  <h1>Tidsplan, nödbromsar, särskiljning</h1>
  <div class="lead">Ramen är 45 minuter. Räknat på ${durationSeconds} sekunders betänketid blir det <b>~3 minuter per fråga</b> (läsning ~25 s inbakad i klockan, rättning ~15 s, avslöjande ~60–70 s, ställning ~10 s).</div>

  <table class="budget">
    ${budget.map(([m, min]) => `<tr><td>${m}</td><td class="m">${min} min</td></tr>`).join('')}
    <tr class="sum"><td>Summa</td><td class="m">45 min</td></tr>
  </table>

  <div class="box grey tight" style="margin-top:3mm">
    <h3>Kontrollpunkt</h3>
    <p class="small">Halvtiden ska <b>börja senast 20 minuter</b> efter att fråga 1 startade. Skriv upp klockslaget när du trycker Starta på fråga 1: ______ : ______</p>
  </div>

  <h2>Nödbromsar</h2>
  <ul>
    <li><b>Mer än 5 minuter efter vid halvtid:</b> stryk fråga 8 (Sveriges webbplatser). Räcker inte det — stryk även fråga 6 (yrken). Hoppa enligt sida 5, punkt 5, och säg "vi hoppar den".</li>
    <li><b>Går det för fort:</b> lägg in en extra fråga <i>bara på papper</i> — reserv R1, Sveriges största sjöar. Appen har exakt ${ten.length} frågor och kan inte utökas på plats.</li>
    <li><b>Ett avslöjande drar ut:</b> tryck <b>Visa alla</b> i stället för rad för rad på nästa fråga.</li>
  </ul>

  <h2>Särskiljning vid delad seger</h2>
  <div class="box">
    <p class="small">Appen delar placeringen. Avgör med en närmast-vinner-fråga från reserverna:</p>
    <p style="font-size:14pt;font-weight:700;margin:2mm 0">"Hur stor är Vänern i km²?"</p>
    <p class="small">Svar: <b>${thin(esc(vanern.value))} ${esc(vanern.unit)}</b> (${esc(
      lake.source_name,
    )}, per ${esc(fmtDate(lake.as_of))}). Lagen skriver ner sitt tal utan att prata — närmast vinner. Ligger två lika: närmast <i>under</i> vinner.</p>
  </div>

  <h2>Vinnarmanus</h2>
  <p class="small"><b>Visa slutresultat</b> → alla telefoner visar vinnaren → läs pallen nedifrån och upp. Tacka medhjälparen vid namn.</p>`;
}

/* ---------------------------------------------------- frågekort 1–10 */

function pageQuestionCard(q) {
  return `
  <div class="card-head">
    <div class="card-no">${q.no}</div>
    <div class="card-title">${esc(q.list.title_sv)}</div>
  </div>
  <div class="readout">${esc(q.list.host_question_sv)}<span class="twice">Läs högt — två gånger</span></div>
  ${sourceLine(q.list)}
  ${knowBox(q.slug, q.list, 3)}
  ${rowsTable(q.slug, q.list)}
  ${paperRow()}`;
}

/* ------------------------------------------------------- reservkort */

function reserveCard(r) {
  const showValue = !valueIsJustRank(r.list);
  const scoring = r.list.items.filter((it) => it.rank <= 10);
  const near = r.list.items.filter((it) => it.rank > 10);
  const row = (it) =>
    `<tr><td class="r">${it.rank}</td><td class="nm">${esc(it.name_sv)}</td>` +
    (showValue ? `<td class="v">${valueCell(it)}</td>` : '') +
    `</tr>`;

  const nearCol = near.length
    ? `<div class="colhead soft">11–15 · nära skott, 0 p</div><table class="rrows">${near
        .map(row)
        .join('')}</table>`
    : `<div class="colhead soft">11–15</div><p class="tiny" style="margin-top:1mm">Källan redovisar bara ${scoring.length} rader — inga nära skott.</p>`;

  const tie =
    r.no === 1
      ? `<div class="tiebreak"><b>Särskiljning vid delad seger:</b> "Hur stor är Vänern i km²?" — svar <b>${thin(
          esc(r.list.items[0].value),
        )} ${esc(r.list.items[0].unit)}</b>. Närmast vinner, ingen får prata.</div>`
      : '';

  return `<div class="reserve">
    <div class="rv-head"><div class="rv-no">R${r.no}</div><div class="rv-title">${esc(
      r.list.title_sv,
    )}</div></div>
    <div class="readout">${esc(r.list.host_question_sv)}</div>
    ${sourceLine(r.list)}
    ${knowBox(r.slug, r.list, 2)}
    <div class="cols">
      <div><div class="colhead">1–10 · ger poäng</div><table class="rrows">${scoring
        .map(row)
        .join('')}</table></div>
      <div>${nearCol}</div>
    </div>
    ${tie}
  </div>`;
}

/* ---------------------------------------------------- pappersläge */

function pagePaperMode() {
  return `
  <h1>Pappersläge — så kör du utan appen</h1>
  <div class="lead">Allt du behöver finns redan i det här paketet: frågekorten (raderna), svarsbladen och räknebladet. Ingen internetuppkoppling behövs.</div>

  <h2>Så går en fråga</h2>
  <ol class="steps">
    <li>Läs <b>fetstilsraden</b> på frågekortet, två gånger. Säg frågenumret så lagen skriver på rätt rad.</li>
    <li>Ta tid med telefonens stoppur: <b>${clock}</b>. Ropa <b>"30 sekunder kvar"</b>, sedan <b>"pennorna ner"</b> — var hård, här finns ingen automatisk låsning.</li>
    <li>Läs listan uppifrån, plats 1 till 10, med samma pauser som appen gjort. Lagen självrättar mot sitt svar och skriver <b>plats</b> och <b>poäng</b> på svarsbladet.</li>
    <li>Läs plats 11–15 som nära skott. De ger 0.</li>
    <li>Medhjälparen för in poängen på räknebladet.</li>
  </ol>

  <h2>Regler som skiljer sig från appen</h2>
  <ul>
    <li><b>Ingen automatisk låsning</b> — din röst är klockan. Säg "pennorna ner" och mena det.</li>
    <li><b>Ingen modell</b> — din bedömning av stavning och synonymer gäller direkt. Var generös: rätt svar felstavat är rätt svar.</li>
    <li><b>Summering</b> i halvtid och efter sista frågan, på räknebladet. Läs upp ställningen båda gångerna.</li>
    <li>Delad plats på listan (t.ex. fråga 10, plats 5) ger båda svaren platsens poäng.</li>
  </ul>

  <h2>Tillbaka till appen när den lever igen</h2>
  <ul>
    <li>Öppna adminlänken. Poängen som redan låg på servern finns kvar.</li>
    <li>Fyll i de manuella poängen via <b>Sätt plats för hand</b> på varje lag, så blir slutresultatet rätt på skärmarna.</li>
    <li>Orkar du inte det mitt i kvällen — kör resten på papper och läs vinnaren från räknebladet. Det märks inte.</li>
  </ul>

  <div class="box grey tight">
    <h3>Behöver du fler frågor på papper</h3>
    <p class="small">Reservkorten R1–R${reserves.length} fungerar precis som frågekorten, men saknar pappersrad — skriv platserna på räknebladets tomma rader i stället.</p>
  </div>`;
}

/* ------------------------------------------------------- svarsblad */

function pageAnswerSheet(n, total) {
  const rows = [];
  for (let q = 1; q <= ten.length; q++) {
    rows.push(
      `<tr><td class="q">${q}</td><td></td><td class="pl"></td><td class="po"></td></tr>`,
    );
    if (q === 5)
      rows.push(
        '<tr class="sum"><td colspan="3">Summa efter fråga 5 (halvtid)</td><td class="po"></td></tr>',
      );
  }
  rows.push('<tr class="sum"><td colspan="3">Summa totalt</td><td class="po"></td></tr>');

  return `
  <div class="sheet-title">
    <h1 style="margin:0">Svarsblad</h1>
    <div class="tiny">Sofies topp tio · ${PARTY_DATE} · blad ${n} av ${total}</div>
  </div>
  <p style="font-size:15pt;margin:2mm 0 3mm"><b>Lag:</b> <span class="bigfield"></span></p>
  <p class="small" style="margin-bottom:2.5mm">Ett svar per fråga. Poäng = platsen på listan: ettan ger 1, tian ger 10. Plats 11–15 ger 0. Utanför listan ger 0.</p>
  <table class="answer">
    <tr><th class="q">Fråga</th><th>Vårt svar</th><th class="pl">Plats</th><th class="po">Poäng</th></tr>
    ${rows.join('')}
  </table>`;
}

/* ------------------------------------------------------- räkneblad */

function pageTally() {
  const qh = Array.from({ length: ten.length }, (_, i) => `<th>${i + 1}</th>`).join('');
  const cells = Array.from({ length: ten.length }, () => '<td></td>').join('');
  const teamRows = Array.from(
    { length: DEFAULT_TEAMS },
    (_, i) =>
      `<tr><td class="rh">Lag ${
        i + 1
      }</td>${cells}<td class="halfcol"></td><td class="totcol"></td><td class="placcol"></td></tr>`,
  ).join('');

  return `
  <div class="sheet-title">
    <h1 style="margin:0">Räkneblad</h1>
    <div class="tiny">Värden och medhjälparen · Sofies topp tio · ${PARTY_DATE} · 1 exemplar</div>
  </div>
  <p class="small" style="margin-bottom:2.5mm">Poäng per fråga i rutorna. <b>Halvtid</b> summeras efter fråga 5, <b>Totalt</b> efter fråga ${
    ten.length
  }. Raderna är Lag 1–${DEFAULT_TEAMS}; kör ni ett annat antal — ${esc(
    TEAM_PHRASE,
  )} — stryk eller skriv till i marginalen.</p>

  <table class="tally">
    <tr><th class="rh">Lag</th>${qh}<th class="halfcol">Halvtid</th><th class="totcol">Totalt</th><th class="placcol">Plac.</th></tr>
    ${teamRows}
  </table>

  <div class="box" style="margin-top:5mm">
    <h3>Särskiljning vid delad seger</h3>
    <p class="small">Fråga: <b>"Hur stor är Vänern i km²?"</b> Närmast vinner, ingen får prata. Svaret står på reservkort R1.</p>
    <table class="tally" style="margin-top:2mm">
      <tr><th class="rh">Lag</th><th>Gissning (km²)</th><th>Avstånd</th><th>Vinnare</th></tr>
      <tr><td class="rh"></td><td></td><td></td><td></td></tr>
      <tr><td class="rh"></td><td></td><td></td><td></td></tr>
      <tr><td class="rh"></td><td></td><td></td><td></td></tr>
    </table>
  </div>

  <div class="box hair tight" style="margin-top:4mm">
    <h3>Extra rader (reservfrågor på papper)</h3>
    <table class="tally">
      <tr><th class="rh">Lag</th><th>Reserv A</th><th>Reserv B</th><th>Nytt totalt</th></tr>
      <tr><td class="rh"></td><td></td><td></td><td></td></tr>
      <tr><td class="rh"></td><td></td><td></td><td></td></tr>
    </table>
  </div>`;
}

/* ------------------------------------------------------- bakgrund */

function pageBackground() {
  const verdicts = ten.reduce((acc, q) => {
    acc[q.list.verdict] = (acc[q.list.verdict] ?? 0) + 1;
    return acc;
  }, {});
  return `
  <h1>Bakgrund — för fredagen, inte för festen</h1>
  <div class="lead">Den här sidan behöver du inte ta med i micken. Den finns för att du ska hitta tillbaka till maskineriet om något behöver ändras.</div>

  <h2>Repo och deploy</h2>
  <ul>
    <li>Kod: <code>C:\\Users\\erika\\projects\\sophie-quiz</code> — Cloudflare Worker + Durable Object, telefonapp via QR.</li>
    <li><code>npm run deploy</code> bygger telefonsidorna, kontrollerar att ingen nyckel hamnat i bygget och laddar upp Workern. Klagar den på "malformed response": kör en gång till.</li>
    <li>Klagar den på rättigheter ("scope"): API-token i Windows saknar <i>Workers Scripts: Edit</i> i Cloudflare-dashboarden.</li>
    <li>Hemligheter: <code>.dev.vars</code> i repots rot (<code>ANTHROPIC_API_KEY</code>, <code>ADMIN_TOKEN</code>). Skickas upp med <code>npx wrangler secret bulk .dev.vars</code>. Filen ligger inte i git.</li>
  </ul>

  <h2>Listorna</h2>
  <ul>
    <li>Banken: <code>data/bank.json</code>, ${bank.count} listor, genererad ${esc(
      fmtDate(bank.generated_on),
    )}. Varje lista har en <i>verdict</i> från en oberoende faktagranskare.</li>
    <li>Kvällens tio: <code>data/quiz.json</code> — ${Object.entries(verdicts)
      .map(([k, v]) => `${v} ${k === 'verified' ? 'verifierade' : 'rättade'}`)
      .join(', ')}. Byt en slug där för att byta lista; <code>npm test</code> säger om det håller.</li>
    <li>Stavningar och synonymer: <code>data/aliases.json</code>. Det som står där rättas utan modellen.</li>
    <li>Betänketiden är ${durationSeconds} s, satt i <code>data/quiz.json</code> (<code>durationSeconds</code>). Underlag i vaultens <i>betanketid.md</i>.</li>
    <li>Läsfil med alla rader och reserverna i din ordning: vaultens <i>current/sophie-quiz/kvallens-listor.md</i>.</li>
  </ul>

  <h2>Kostnad</h2>
  <p class="small">Tio modellanrop per kväll (ett per fråga, rättningen). Ören. Nyckeln ligger som hemlighet hos Cloudflare, aldrig i telefonerna — modellen får bara listans rader och lagens svar.</p>

  <h2>Det här paketet</h2>
  <p class="small">Genererat ${GENERATED} av <code>scripts/festpaket.mjs</code> ur <code>data/quiz.json</code>, <code>data/bank.json</code> och <code>.dev.vars</code>. Kör <code>npm run festpaket</code> igen efter en liständring — filen skrivs över. <b>PDF:en innehåller adminlänken och ligger därför i .gitignore. Skriv ut den, lägg den inte i molnet.</b></p>`;
}

/* ------------------------------------------------------------ montage */

function build(admin) {
  pages.length = 0;

  // Sidräkningen är deterministisk: en .page = ett papper.
  // 1 snabbkort, 2 före gästerna, 3 manus, 4 knappar, 5 fel, 6 tidsplan,
  // 7..(6+N) frågekort, sedan reserver 2 per sida, sedan pappersläget.
  const reservePages = Math.ceil(reserves.length / 2);
  const planBPage = 6 + ten.length + reservePages + 1;

  push('Snabbkort', pageQuickCard(admin, planBPage));
  push('Före gästerna', pageBeforeGuests());
  push('Manus', pageScript());
  push('Knappar', pageButtons());
  push('Om något går fel', pageTrouble(planBPage));
  push('Tidsplan', pageTiming());

  ten.forEach((q) => push(`Fråga ${q.no}`, pageQuestionCard(q)));

  for (let i = 0; i < reserves.length; i += 2) {
    const pair = reserves.slice(i, i + 2);
    push(
      `Reserver R${pair[0].no}–R${pair[pair.length - 1].no}`,
      pair.map(reserveCard).join(''),
    );
  }

  push('Pappersläge', pagePaperMode());
  const sheets = DEFAULT_TEAMS;
  for (let i = 1; i <= sheets; i++) push(`Svarsblad ${i}`, pageAnswerSheet(i, sheets));
  push('Räkneblad', pageTally());
  push('Bakgrund', pageBackground());

  if (pages[planBPage - 1]?.title !== 'Pappersläge') {
    throw new Error(
      `Plan B-referensen pekar på sida ${planBPage} men där ligger "${
        pages[planBPage - 1]?.title
      }".`,
    );
  }

  const css = readFileSync(join(HERE, 'festpaket', 'style.css'), 'utf8');
  const total = pages.length;
  const body = pages
    .map(
      (p, i) =>
        `<section class="page"><div class="body">${p.html}</div>` +
        `<div class="pfoot"><span>Sofies topp tio · ${PARTY_DATE} · ${esc(
          p.title,
        )}</span><span>Sida ${i + 1} av ${total}</span></div></section>`,
    )
    .join('\n');

  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Festpaketet — Sofies topp tio</title><style>${css}</style></head>
<body>${body}</body></html>`;
}

/* ------------------------------------------------------------- render */

/** Antal sidblad i PDF:en — sidträdet har mellannoder, så räkna löven. */
function pdfPageCount(buf) {
  const n = [...buf.toString('latin1').matchAll(/\/Type\s*\/Page(?![s])/g)].length;
  return n || null;
}

async function main() {
  const admin = adminUrl();
  const html = build(admin);
  const expected = pages.length;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });

    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('.page')].flatMap((el, i) => {
        const b = el.querySelector('.body');
        const slack = b.scrollHeight - b.clientHeight;
        return slack > 2 ? [{ page: i + 1, overflowPx: slack }] : [];
      }),
    );

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });

    const out = join(ROOT, OUT_NAME);
    writeFileSync(out, pdf);

    const actual = pdfPageCount(pdf);
    console.log(`Festpaketet skrivet: ${OUT_NAME}`);
    console.log(`  sidor: ${actual ?? '?'} (förväntat ${expected})`);
    console.log(`  ${ten.length} frågekort · ${reserves.length} reserver · ${DEFAULT_TEAMS} svarsblad`);
    console.log(`  betänketid ${durationSeconds} s (${clock}) ur data/quiz.json`);
    console.log('  adminlänken infogad (visas aldrig här — den finns bara i PDF:en)');

    if (overflow.length) {
      console.error('  VARNING — innehåll får inte plats på:');
      for (const o of overflow) console.error(`    sida ${o.page}: ${o.overflowPx} px över`);
      process.exitCode = 1;
    }
    if (actual != null && actual !== expected) {
      console.error(`  VARNING — sidantalet stämmer inte (${actual} ≠ ${expected}).`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`Festpaketet kunde inte byggas: ${err.message}`);
  process.exit(1);
});
