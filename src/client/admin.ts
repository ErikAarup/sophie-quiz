// Admin page (/admin?t=<ADMIN_TOKEN>): Erik's phone. One-handed, big buttons, every action is one
// message to the DO; the DO answers with the full state for everyone.

import { formatClock } from '../shared/format.ts';
import {
  CONFIRM_WORD,
  teamName,
  type AdminCommand,
  type AdminStateView,
  type AdminTeamView,
  type ServerMessage,
  type Team,
} from '../shared/types.ts';
import { byId, h, setText, toggle } from './dom.ts';
import { Connection } from './ws.ts';

const TOKEN_KEY = 'sq.admin';

function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // ignore
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const token = readToken();
const app = byId('app');

let state: AdminStateView | null = null;
let online = false;
let sheet: { kind: 'team'; team: Team } | { kind: 'confirm'; what: 'question' | 'game' } | null = null;
let toastTimer: number | undefined;
let failToastFor = -1;

const conn = new Connection({
  hello: () => ({ type: 'hello', role: 'admin', token }),
  ping: JSON.stringify({ type: 'ping' }),
  onMessage,
  onStatus: (v) => {
    online = v;
    updateStatus();
  },
});

function onMessage(m: ServerMessage): void {
  switch (m.type) {
    case 'state':
      if (m.role !== 'admin') return;
      state = m;
      render();
      break;
    case 'error':
      toast(m.message, true);
      if (m.code === 'auth') {
        app.replaceChildren(
          h(
            'div',
            { class: 'stack', style: 'margin-top:20vh;text-align:center;gap:12px' },
            h('div', { class: 'display', style: 'font-size:56px;line-height:0.95' }, 'Fel adminlänk'),
            h('div', { style: 'color:var(--text-2)' }, 'Öppna admin med länken som innehåller nyckeln: /admin?t=…'),
          ),
        );
      }
      break;
    default:
      break;
  }
}

function cmd(c: AdminCommand): void {
  if (!conn.send({ ...c, token })) toast('Ingen anslutning – försöker igen…', true);
}

function toast(text: string, isError = false): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: 'toast' + (isError ? ' error' : ''), role: 'status' }, text);
  document.body.appendChild(el);
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 3500);
}

// ---------- rendering ----------

interface Screen {
  key: string;
  el: HTMLElement;
  update(s: AdminStateView): void;
  tick?: () => void;
}

let current: Screen | null = null;
let ticker: number | undefined;

function screenKey(s: AdminStateView): string {
  switch (s.phase) {
    case 'lobby':
      return `lobby:${s.questionIndex}`;
    case 'open':
    case 'locked':
    case 'grading':
      return `question:${s.questionIndex}`;
    case 'reveal':
      return `reveal:${s.questionIndex}`;
    case 'standings':
      return `standings:${s.questionIndex}`;
    default:
      return 'final';
  }
}

function render(): void {
  if (!state) return;
  const key = screenKey(state);
  if (!current || current.key !== key) {
    current = buildScreen(state, key);
    app.replaceChildren(current.el);
    window.scrollTo(0, 0);
    if (ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
    if (current.tick) ticker = window.setInterval(() => current?.tick?.(), 200);
  }
  current.update(state);
  renderSheet();
  updateStatus();
}

function updateStatus(): void {
  const pill = document.querySelector<HTMLElement>('[data-pill]');
  if (!pill) return;
  toggle(pill, 'offline', !online);
  toggle(pill, 'accent', online);
  setText(pill.querySelector('.label') ?? pill, online ? 'Admin' : 'Återansluter…');
}

function topbar(right: HTMLElement): HTMLElement {
  return h('div', { class: 'topbar' }, h('div', { class: 'pill accent', 'data-pill': true }, h('span', { class: 'dot' }), h('span', { class: 'label' }, 'Admin')), right);
}

function remainingMs(s: AdminStateView): number {
  if (s.phase !== 'open') return 0;
  if (s.pausedRemainingMs !== null) return s.pausedRemainingMs;
  if (s.deadlineAt === null) return 0;
  return Math.max(0, s.deadlineAt - conn.now());
}

function buildScreen(s: AdminStateView, key: string): Screen {
  switch (s.phase) {
    case 'lobby':
      return lobbyScreen(key);
    case 'open':
    case 'locked':
    case 'grading':
      return questionScreen(key);
    case 'reveal':
      return revealScreen(key);
    case 'standings':
      return standingsScreen(key);
    default:
      return finalScreen(key);
  }
}

// ---- team grid (2×4) ----
function teamGrid(): { el: HTMLElement; update: (s: AdminStateView) => void } {
  const cells = ([1, 2, 3, 4, 5, 6, 7, 8] as Team[]).map((t) => {
    const status = h('div', { class: 'status' });
    const cell = h(
      'button',
      {
        class: 'row',
        type: 'button',
        'data-team': t,
        onClick: () => {
          sheet = { kind: 'team', team: t };
          renderSheet();
        },
      },
      h('div', { class: 'grow', style: 'font-size:15px;font-weight:600' }, teamName(t)),
      status,
    );
    return { cell, status };
  });
  const el = h('div', { class: 'team-grid' }, cells.map((c) => c.cell));
  return {
    el,
    update(s) {
      s.teams.forEach((tv, i) => {
        const c = cells[i]!;
        c.status.className = `status ${tv.status}`;
        setText(c.status, tv.status);
        toggle(c.cell, 'offline', tv.status === 'offline');
      });
    },
  };
}

function smallLinks(...items: { label: string; onClick: () => void }[]): HTMLElement {
  return h(
    'div',
    { class: 'small-links' },
    items.map((it) => h('button', { class: 'btn btn-ghost', type: 'button', onClick: it.onClick }, it.label)),
  );
}

const resetQuestionItem = {
  label: 'Nollställ frågan',
  onClick: () => {
    sheet = { kind: 'confirm', what: 'question' };
    renderSheet();
  },
};

const resetGameItem = {
  label: 'Nollställ spelet',
  onClick: () => {
    sheet = { kind: 'confirm', what: 'game' };
    renderSheet();
  },
};

/**
 * WO-083 A4: on the two screens that carry "Nästa fråga" the resets live behind a "Mer…" button in
 * the topbar instead of eight pixels under the primary button — a thumb aiming at the bottom of the
 * screen cannot reach them, and they still need a deliberate tap to even appear (WO-078 R4: both
 * resets stay reachable from every screen).
 */
function moreMenu(): { button: HTMLElement; panel: HTMLElement } {
  const panel = h('div', { class: 'more-panel hidden' }, smallLinks(resetQuestionItem, resetGameItem));
  const button = h(
    'button',
    {
      class: 'btn btn-ghost btn-sm more-button',
      type: 'button',
      'aria-expanded': 'false',
      onClick: () => {
        const open = panel.classList.contains('hidden');
        toggle(panel, 'hidden', !open);
        button.setAttribute('aria-expanded', String(open));
      },
    },
    'Mer…',
  );
  return { button, panel };
}

// ---- Lobby: "Starta fråga N" ----
function lobbyScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const title = h('div', { style: 'font-size:15px;font-weight:600;line-height:1.3' });
  const question = h('div', { class: 'muted', style: 'font-size:14px;line-height:1.5' });
  const grid = teamGrid();
  const start = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => cmd({ type: 'start' }) }, 'Starta fråga');
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px;flex-grow:1' },
    topbar(label),
    h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, 'Nästa lista'), title, question),
    h('div', { class: 'eyebrow' }, 'Lagen · tryck för att släppa en plats'),
    grid.el,
    h(
      'div',
      { class: 'bottom', style: 'gap:10px' },
      start,
      h('div', { style: 'font-size:12px;color:var(--muted);text-align:center' }, 'Klockan startar direkt. Läs frågan högt när den syns.'),
      smallLinks(resetGameItem),
    ),
  );
  return {
    key,
    el,
    update(s) {
      setText(label, `Fråga ${s.questionIndex + 1} av ${s.questionCount} · väntar`);
      setText(title, s.question?.title ?? '');
      setText(question, s.question?.question ?? '');
      setText(start, `Starta fråga ${s.questionIndex + 1}`);
      grid.update(s);
    },
  };
}

// ---- Question open / locked / grading ----
function questionScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const clock = h('div', { class: 'display clock' }, '2:30');
  const pause = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Pausa');
  const extend = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => cmd({ type: 'extend' }) }, '+30 s');
  const title = h('div', { style: 'font-size:15px;font-weight:600;line-height:1.3' });
  // The host question, verbatim, under the title: it is what Erik reads into the mic, and the
  // guests have it in front of them (player.ts). The title alone is not the question.
  const question = h('div', { class: 'muted', 'data-host-question': true, style: 'font-size:14px;line-height:1.5' });
  const grid = teamGrid();
  const lock = h('button', { class: 'btn btn-danger', type: 'button', onClick: () => cmd({ type: 'lock' }) }, 'Lås svaren nu');
  const grade = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => cmd({ type: 'grade' }) }, 'Rätta och börja avslöja');
  const note = h('div', { style: 'font-size:12px;color:var(--muted);text-align:center' });
  let paused = false;
  pause.addEventListener('click', () => cmd({ type: paused ? 'resume' : 'pause' }));

  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px;flex-grow:1' },
    topbar(label),
    h('div', { class: 'clock-row' }, clock, h('div', { class: 'clock-buttons' }, pause, extend)),
    h('div', { class: 'stack', style: 'gap:6px' }, title, question),
    h('div', { class: 'eyebrow' }, 'Lagen · tryck för att skriva svar eller släppa'),
    grid.el,
    h('div', { class: 'bottom', style: 'gap:10px' }, lock, grade, note, smallLinks(resetQuestionItem, resetGameItem)),
  );

  let last: AdminStateView | null = null;
  const tick = () => {
    if (!last) return;
    const rem = remainingMs(last);
    setText(clock, last.phase === 'open' ? formatClock(rem) : '0:00');
    toggle(clock, 'paused', last.pausedRemainingMs !== null);
    toggle(clock, 'zero', last.phase !== 'open' || rem <= 0);
  };
  return {
    key,
    el,
    tick,
    update(s) {
      last = s;
      tick();
      paused = s.pausedRemainingMs !== null;
      const status = s.phase === 'open' ? (paused ? 'pausad' : 'svar öppna') : s.phase === 'locked' ? 'låst' : 'rättar…';
      setText(label, `Fråga ${s.questionIndex + 1} av ${s.questionCount} · ${status}`);
      setText(title, s.question?.title ?? '');
      setText(question, s.question?.question ?? '');
      setText(pause, paused ? 'Fortsätt' : 'Pausa');
      pause.disabled = s.phase !== 'open';
      extend.disabled = s.phase !== 'open';
      lock.disabled = s.phase !== 'open';
      grade.disabled = s.phase !== 'locked';
      setText(grade, s.phase === 'grading' ? 'Rättar…' : s.gradeStatus === 'failed' ? 'Rätta igen' : 'Rätta och börja avslöja');
      const answered = s.teams.filter((t) => t.answer !== null).length;
      setText(
        note,
        s.phase === 'open'
          ? `Låses av sig själv på 0:00. ${answered} av 8 har svarat. Rättning tar några sekunder.`
          : s.phase === 'locked'
            ? `Svaren är låsta (${answered} av 8). Tryck Rätta när du är redo att läsa listan.`
            : 'Modellen matchar svaren mot listan. Fastnar den får du rätta för hand.',
      );
      grid.update(s);
    },
  };
}

// ---- Reveal ----
function answerRow(t: AdminTeamView, onTap: () => void): HTMLElement {
  const g = t.grade;
  const scoreText = g ? (g.needsReview ? '?' : String(g.points)) : t.answer ? '…' : '';
  const score = h('div', { class: 'display score' + (g && !g.needsReview && g.points === 0 ? ' zero' : '') }, scoreText);
  const extra: string[] = [];
  if (g && g.rank !== null && g.rank > 10) extra.push(`plats ${g.rank}`);
  if (g && g.needsReview) extra.push('ogranskad');
  if (g && g.manual) extra.push('hand');
  const rowClass = 'row' + (g && g.needsReview ? ' review' : g && !g.needsReview && g.points === 0 ? ' miss' : '');
  return h(
    'button',
    { class: rowClass, type: 'button', onClick: onTap },
    h('div', { class: 'team' }, teamName(t.team)),
    h('div', { class: 'grow text' + (t.answer ? '' : ' empty') }, t.answer ?? (t.claimed ? 'inget svar · skriv för hand…' : 'ledig · skriv för hand…')),
    extra.length ? h('div', { class: 'muted', style: 'font-size:12px;white-space:nowrap' }, extra.join(' · ')) : null,
    score,
  );
}

function answersList(): { el: HTMLElement; update: (s: AdminStateView) => void } {
  const el = h('div', { class: 'answers stack', style: 'gap:6px' });
  return {
    el,
    update(s) {
      el.replaceChildren(
        ...s.teams.map((t) =>
          answerRow(t, () => {
            sheet = { kind: 'team', team: t.team };
            renderSheet();
          }),
        ),
      );
    },
  };
}

function revealScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const counter = h('div', { class: 'display counter' });
  const main = h('button', { class: 'btn btn-primary', type: 'button', style: 'flex-grow:1' }, 'Visa nästa rad');
  const lastRow = h('div', { style: 'font-size:15px;line-height:1.4' });
  const nextRow = h('div', { class: 'muted', style: 'font-size:14px;line-height:1.4' });
  const all = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => cmd({ type: 'revealAll' }) }, 'Visa alla');
  // WO-083 A6: offered only while something is still "ogranskad"; the reducer re-grades exactly
  // those answers and leaves every grade that already stands (and Erik's own) alone.
  const regrade = h('button', { class: 'btn btn-ghost btn-sm hidden', type: 'button', onClick: () => cmd({ type: 'grade' }) }, 'Rätta igen');
  const answers = answersList();
  const standings = h('button', { class: 'btn btn-ghost btn-md', type: 'button', onClick: () => cmd({ type: 'standings' }) }, 'Visa ställningen');
  const next = h('button', { class: 'btn btn-primary btn-md', type: 'button', onClick: () => cmd({ type: 'next' }) }, 'Nästa fråga');
  const more = moreMenu();
  let mode: 'next' | 'standings' = 'next';
  main.addEventListener('click', () => cmd({ type: mode === 'next' ? 'revealNext' : 'standings' }));

  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:14px;flex-grow:1' },
    topbar(h('div', { class: 'topbar-right' }, label, more.button)),
    more.panel,
    h('div', { class: 'reveal-controls' }, counter, main),
    h('div', { class: 'card', style: 'padding:12px 14px;gap:4px' }, lastRow, nextRow),
    h('div', { class: 'topbar' }, h('div', { class: 'eyebrow' }, 'Lagens svar · tryck för att ändra'), h('div', { class: 'small-links reveal-tools' }, regrade, all)),
    answers.el,
    h('div', { class: 'bottom', style: 'gap:8px' }, standings, next),
  );
  return {
    key,
    el,
    update(s) {
      const top = s.question?.topCount ?? 10;
      const n = s.revealed;
      setText(label, `Fråga ${s.questionIndex + 1} av ${s.questionCount} · avslöjar`);
      counter.replaceChildren(String(n), h('span', { class: 'of' }, `/${top}`));
      if (n < top) {
        mode = 'next';
        setText(main, `Visa nästa rad: ${n + 1}`);
        all.disabled = false;
      } else {
        mode = 'standings';
        setText(main, 'Visa ställningen');
        all.disabled = true;
      }
      const shown = s.rows[n - 1];
      const coming = s.rows[n];
      setText(lastRow, n === 0 ? 'Ingen rad visad än. Första trycket visar plats 1 – listan läses uppifrån.' : `Visad: ${shown?.rank}. ${shown?.name ?? ''}${shown?.label ? ' · ' + shown.label : ''}`);
      setText(
        nextRow,
        n < top && coming ? `Nästa: ${coming.rank}. ${coming.name ?? ''}${coming.label ? ' · ' + coming.label : ''}` : n >= top ? 'Hela topplistan är visad. Plats 11–15 syns nu som nära skott på telefonerna.' : '',
      );
      setText(next, s.questionIndex + 1 >= s.questionCount ? 'Visa slutresultat' : 'Nästa fråga');
      const running = s.gradeStatus === 'running';
      const ungraded = s.teams.some((t) => t.grade?.needsReview === true);
      toggle(regrade, 'hidden', !ungraded && !running);
      regrade.disabled = running || !ungraded;
      setText(regrade, running ? 'Rättar…' : 'Rätta igen');
      if (s.gradeStatus === 'failed' && failToastFor !== s.questionIndex) {
        failToastFor = s.questionIndex; // once per question, not on every state update
        toast('Modellen kunde inte rätta alla svar. Tryck "Rätta igen", eller sätt platsen för hand.', true);
      }
      answers.update(s);
    },
  };
}

// ---- Standings ----
function standingsScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const list = h('div', { class: 'standings stack' });
  const back = h('button', { class: 'btn btn-ghost btn-md', type: 'button', onClick: () => cmd({ type: 'backToReveal' }) }, 'Tillbaka till listan');
  const next = h('button', { class: 'btn btn-primary btn-md', type: 'button', onClick: () => cmd({ type: 'next' }) }, 'Nästa fråga');
  // A hand-typed answer is still with the grader: the server refuses "Nästa fråga" with a message
  // until it lands; this line says so before Erik taps.
  const grading = h('div', { class: 'hidden', 'data-grading': true, style: 'font-size:13px;color:var(--accent);text-align:center' }, 'Rättar ett svar… Nästa fråga väntar tills det är klart.');
  const more = moreMenu();
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px;flex-grow:1' },
    topbar(h('div', { class: 'topbar-right' }, label, more.button)),
    more.panel,
    h('div', { class: 'display', style: 'font-size:56px;line-height:0.95' }, 'Ställning'),
    h('div', { class: 'eyebrow' }, 'Tryck på ett lag för att ändra dess svar eller plats'),
    list,
    h('div', { class: 'bottom', style: 'gap:8px' }, grading, back, next),
  );
  return {
    key,
    el,
    update(s) {
      setText(label, `Fråga ${s.questionIndex + 1} av ${s.questionCount} · ställning`);
      toggle(grading, 'hidden', s.gradeStatus !== 'running');
      list.replaceChildren(
        ...s.standings.map((row) => {
          const tv = s.teams[row.team - 1];
          return h(
            'button',
            {
              class: 'row',
              type: 'button',
              style: 'width:100%;text-align:left',
              onClick: () => {
                sheet = { kind: 'team', team: row.team };
                renderSheet();
              },
            },
            h('div', { class: 'rank display' + (row.position === 1 ? ' top' : '') }, String(row.position)),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, teamName(row.team)), h('div', { class: 'muted', style: 'font-size:12px' }, tv?.answer ? `${tv.answer} · ${tv.grade ? (tv.grade.needsReview ? 'ogranskad' : tv.grade.rank === null ? 'utanför' : 'plats ' + tv.grade.rank) : '…'}` : 'inget svar')),
            h('div', { class: 'display points' }, String(row.points)),
          );
        }),
      );
      setText(next, s.questionIndex + 1 >= s.questionCount ? 'Visa slutresultat' : 'Nästa fråga');
    },
  };
}

// ---- Final ----
function finalScreen(key: string): Screen {
  const winners = h('div', { class: 'display winner small' });
  const list = h('div', { class: 'standings stack' });
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px;flex-grow:1' },
    topbar(h('div', { class: 'eyebrow' }, 'Slutresultat')),
    h('div', { class: 'stack center', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, 'Vinnare'), winners),
    list,
    h(
      'div',
      { class: 'bottom' },
      smallLinks(resetGameItem),
    ),
  );
  return {
    key,
    el,
    update(s) {
      setText(winners, s.winners.map(teamName).join(' & ') || '–');
      list.replaceChildren(
        ...s.standings.map((row) =>
          h(
            'div',
            { class: 'row' },
            h('div', { class: 'rank display' + (row.position === 1 ? ' top' : '') }, String(row.position)),
            h('div', { class: 'grow name' }, teamName(row.team)),
            h('div', { class: 'display points' }, String(row.points)),
          ),
        ),
      );
    },
  };
}

// ---------- sheets ----------

let sheetEl: HTMLElement | null = null;
/** Identity of the sheet currently in the DOM: while it is unchanged the sheet is updated, not rebuilt. */
let sheetKey: string | null = null;
let sheetUpdate: ((s: AdminStateView) => void) | null = null;

interface Sheet {
  nodes: (HTMLElement | null)[];
  update(s: AdminStateView): void;
}

function sheetKeyOf(sh: NonNullable<typeof sheet>): string {
  return sh.kind === 'team' ? `team:${sh.team}` : `confirm:${sh.what}`;
}

function closeSheet(): void {
  sheet = null;
  sheetKey = null;
  sheetUpdate = null;
  if (sheetEl) {
    sheetEl.remove();
    sheetEl = null;
  }
}

/**
 * WO-083 A8: the Durable Object broadcasts on every change, socket close, error and hello, and
 * `render()` reaches here on each one. Rebuilding the sheet on a broadcast wiped whatever Erik had
 * half-typed and stole the keyboard, so while the open sheet's identity (kind + team / what) is
 * unchanged only its labels are refreshed; the input keeps its text and its focus.
 */
function renderSheet(): void {
  if (!sheet || !state) {
    if (sheetEl) {
      sheetEl.remove();
      sheetEl = null;
    }
    sheetKey = null;
    sheetUpdate = null;
    return;
  }
  const key = sheetKeyOf(sheet);
  if (sheetEl && sheetKey === key && sheetUpdate) {
    sheetUpdate(state);
    return;
  }
  if (sheetEl) sheetEl.remove();
  const built = sheet.kind === 'team' ? teamSheet(state, sheet.team) : confirmSheet(state, sheet.what);
  sheetEl = h(
    'div',
    {
      class: 'sheet-backdrop',
      onClick: (ev) => {
        if (ev.target === sheetEl) closeSheet();
      },
    },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, built.nodes),
  );
  sheetKey = key;
  sheetUpdate = built.update;
  document.body.appendChild(sheetEl);
  built.update(state);
}

function teamSheet(s: AdminStateView, team: Team): Sheet {
  const input = h('input', {
    class: 'answer-input',
    type: 'text',
    maxlength: 80,
    placeholder: 'skriv svar för hand…',
    autocomplete: 'off',
  });
  input.value = s.teams[team - 1]?.answer ?? '';
  /** What the field held when it was last filled from the server; anything else is Erik's typing. */
  let seeded = input.value;
  const save = h(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onClick: () => {
        const text = input.value.trim();
        if (!text) {
          toast('Skriv ett svar först.', true);
          return;
        }
        cmd({ type: 'manualAnswer', team, text });
        closeSheet();
      },
    },
    'Spara svar',
  );
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      save.click();
    }
  });

  const status = h('div', { class: 'status' });
  const answerEyebrow = h('div', { class: 'eyebrow' });
  const typedByYou = h('div', { class: 'muted hidden', style: 'font-size:12px' }, 'Nuvarande svar är inskrivet av dig.');
  const gradeLine = h('div', { style: 'font-size:14px;color:var(--text-2)' });
  // WO-083 A5: every place carries its row name. On a 390 px phone Erik is choosing between names,
  // not between numbers — the name was in a `title` attribute before, which a thumb never sees.
  const rankList = h('div', { class: 'rank-list' });
  const overrideBlock = h('div', { class: 'stack hidden' }, h('div', { class: 'eyebrow' }, 'Plats på listan · rätta för hand (0 = utanför)'), gradeLine, rankList);
  const overrideNote = h('div', { class: 'muted hidden', style: 'font-size:13px' }, 'Plats kan sättas för hand när svaren är låsta.');
  const release = h(
    'button',
    {
      class: 'btn btn-danger hidden',
      type: 'button',
      onClick: () => {
        cmd({ type: 'release', team });
        closeSheet();
      },
    },
    `Släpp ${teamName(team)} (telefonen får välja lag igen)`,
  );
  const noPhone = h('div', { class: 'muted hidden', style: 'font-size:13px' }, 'Ingen telefon har valt det här laget.');

  let ranksKey = '';
  return {
    nodes: [
      h('div', { class: 'topbar' }, h('h2', { class: 'display' }, teamName(team)), status),
      h('div', { class: 'stack' }, answerEyebrow, input, save, typedByYou),
      overrideBlock,
      overrideNote,
      release,
      noPhone,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: closeSheet }, 'Stäng'),
    ],
    update(v) {
      const tv = v.teams[team - 1]!;
      const questionActive = v.phase !== 'lobby' && v.phase !== 'final';
      const canOverride = questionActive && v.phase !== 'open';
      status.className = `status ${tv.status}`;
      setText(status, tv.status + (tv.total ? ` · ${tv.total} p totalt` : ''));
      setText(answerEyebrow, questionActive ? `Svar på fråga ${v.questionIndex + 1}` : 'Svar');
      input.disabled = !questionActive;
      save.disabled = !questionActive;
      // Follow the server only while the field is untouched: never overwrite what Erik typed, and
      // never take the caret out of a field he is typing in.
      const fromServer = tv.answer ?? '';
      if (document.activeElement !== input && input.value === seeded && fromServer !== seeded) {
        input.value = fromServer;
        seeded = fromServer;
      }
      toggle(typedByYou, 'hidden', tv.answerSource !== 'admin');

      toggle(overrideBlock, 'hidden', !canOverride);
      toggle(overrideNote, 'hidden', canOverride || !questionActive);
      if (canOverride) {
        setText(
          gradeLine,
          tv.grade
            ? tv.grade.needsReview
              ? 'Ogranskad – modellen kunde inte avgöra. Välj plats nedan.'
              : tv.grade.rank === null
                ? `Utanför listan · 0 poäng${tv.grade.manual ? ' (satt för hand)' : ''}`
                : `Plats ${tv.grade.rank} · ${tv.grade.rowName ?? ''} · ${tv.grade.points} poäng${tv.grade.manual ? ' (satt för hand)' : ''}`
            : 'Inte rättad än.',
        );
        const currentRank = tv.grade ? (tv.grade.needsReview ? -1 : (tv.grade.rank ?? 0)) : -1;
        const key = `${v.questionIndex}:${currentRank}:${v.rows.length}`;
        if (key !== ranksKey) {
          ranksKey = key;
          const ranks = Array.from(new Set(v.rows.map((r) => r.rank))).sort((a, b) => a - b);
          rankList.replaceChildren(
            ...[0, ...ranks].map((r) =>
              h(
                'button',
                {
                  class: 'row rank-row' + (r === currentRank ? ' current' : ''),
                  type: 'button',
                  'data-rank': r,
                  onClick: () => {
                    cmd({ type: 'override', team, rank: r });
                    closeSheet();
                  },
                },
                h('div', { class: 'rank display' }, String(r)),
                h('div', { class: 'grow' }, r === 0 ? 'utanför listan' : v.rows.filter((row) => row.rank === r).map((row) => row.name ?? '').join(' / ')),
              ),
            ),
          );
        }
      }

      toggle(release, 'hidden', !tv.claimed);
      toggle(noPhone, 'hidden', tv.claimed);
    },
  };
}

function confirmSheet(s: AdminStateView, what: 'question' | 'game'): Sheet {
  const isQ = what === 'question';
  const go = h(
    'button',
    {
      class: 'btn btn-danger',
      type: 'button',
      onClick: () => {
        cmd(isQ ? { type: 'resetQuestion', confirm: CONFIRM_WORD } : { type: 'resetGame', confirm: CONFIRM_WORD });
        closeSheet();
      },
    },
    isQ ? 'Ja, nollställ frågan' : 'Ja, nollställ hela spelet',
  );
  // WO-083 A4: wiping the whole evening takes more than two taps. The red button stays dead until
  // the confirm word is typed — something no thumb does by accident, and nothing a state broadcast
  // can clear (the sheet is updated, not rebuilt: see renderSheet).
  const typed = h('input', {
    class: 'answer-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: false,
    maxlength: 20,
    placeholder: CONFIRM_WORD,
    'aria-label': `Skriv ${CONFIRM_WORD}`,
    'data-confirm-input': true,
  });
  const check = (): void => {
    go.disabled = typed.value.trim().toLocaleUpperCase('sv-SE') !== CONFIRM_WORD;
  };
  if (!isQ) {
    go.disabled = true;
    typed.addEventListener('input', check);
    typed.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        check();
        if (!go.disabled) go.click();
      }
    });
  }

  const body = h(
    'div',
    { style: 'font-size:15px;color:var(--text-2);line-height:1.5' },
    isQ
      ? `Alla svar och poäng på fråga ${s.questionIndex + 1} raderas och frågan går tillbaka till "Starta fråga". Lagen behåller sina platser.`
      : 'Alla lag, svar och poäng raderas och spelet börjar om från fråga 1. Alla telefoner får välja lag igen. Gör detta innan gästerna kommer.',
  );
  return {
    nodes: [
      h('h2', { class: 'display' }, isQ ? 'Nollställ frågan?' : 'Nollställ spelet?'),
      body,
      isQ ? null : h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'eyebrow' }, `Skriv ${CONFIRM_WORD} för att låsa upp knappen`), typed),
      go,
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: closeSheet }, 'Avbryt'),
    ],
    update(v) {
      if (isQ) setText(body, `Alla svar och poäng på fråga ${v.questionIndex + 1} raderas och frågan går tillbaka till "Starta fråga". Lagen behåller sina platser.`);
    },
  };
}

// ---------- boot ----------

if (!token) {
  app.replaceChildren(
    h(
      'div',
      { class: 'stack', style: 'margin-top:20vh;text-align:center;gap:12px' },
      h('div', { class: 'display', style: 'font-size:56px;line-height:0.95' }, 'Adminnyckel saknas'),
      h('div', { style: 'color:var(--text-2)' }, 'Öppna admin med länken som innehåller nyckeln: /admin?t=…'),
    ),
  );
} else {
  app.replaceChildren(
    h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;flex-grow:1' },
      h('div', { class: 'display', style: 'font-size:64px;line-height:0.95' }, 'Admin'),
      h('div', { class: 'pill offline', 'data-pill': true }, h('span', { class: 'dot' }), h('span', { class: 'label' }, 'Ansluter…')),
    ),
  );
  conn.start();
}
