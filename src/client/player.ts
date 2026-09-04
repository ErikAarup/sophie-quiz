// Player page (/): the guests' phone. Renders whatever the DO sends; computes nothing but the
// clock display (server deadline minus offset-corrected local time).

import { formatClock } from '../shared/format.ts';
import { TEAMS, teamName, type PlayerResult, type PlayerStateView, type ServerMessage, type Team } from '../shared/types.ts';
import { byId, h, setText, svg, toggle } from './dom.ts';
import { Connection } from './ws.ts';

const DEVICE_KEY = 'sq.device';
const TEAM_KEY = 'sq.team';
const RING_R = 76;
const RING_C = 2 * Math.PI * RING_R;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode etc.: identity lives in memory only for this page load
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const deviceId = (() => {
  let id = storageGet(DEVICE_KEY);
  if (!id || id.length < 8) {
    id = randomId();
    storageSet(DEVICE_KEY, id);
  }
  return id;
})();

const TOKEN_KEY = 'sq.token';

let team: Team | null = (() => {
  const t = Number(storageGet(TEAM_KEY));
  return t >= 1 && t <= 8 ? (t as Team) : null;
})();
/** The claim generation the server gave us; sent back in hello so a released claim is not resurrected. */
let claimToken: number | null = (() => {
  const raw = storageGet(TOKEN_KEY);
  return raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
})();

function saveTeam(t: Team | null, token: number | null): void {
  team = t;
  claimToken = t === null ? null : token;
  storageSet(TEAM_KEY, t === null ? null : String(t));
  storageSet(TOKEN_KEY, t === null || token === null ? null : String(token));
}

// ---------- state ----------

let state: PlayerStateView | null = null;
let notice = '';
let noticeIsError = false;
let answerError = '';
let draft = '';
let online = false;
let toastTimer: number | undefined;

const app = byId('app');

const conn = new Connection({
  hello: () => ({ type: 'hello', role: 'player', deviceId, team, token: claimToken }),
  ping: 'ping',
  onMessage,
  onStatus: (v) => {
    online = v;
    updateStatus();
  },
});

function onMessage(m: ServerMessage): void {
  switch (m.type) {
    case 'state':
      if (m.role !== 'player') return;
      state = m;
      if (m.team !== team || m.claimToken !== claimToken) saveTeam(m.team, m.claimToken);
      render();
      break;
    case 'released':
      saveTeam(null, null);
      notice = m.message;
      noticeIsError = false;
      render();
      break;
    case 'error':
      if (m.code === 'taken' || m.code === 'badTeam' || m.code === 'badDevice') {
        notice = m.message;
        noticeIsError = true;
        render();
      } else if (m.code === 'locked' || m.code === 'notOpen' || m.code === 'empty' || m.code === 'noTeam') {
        answerError = m.message;
        render();
      } else {
        toast(m.message, true);
      }
      break;
    case 'ok':
      if (m.of === 'answer') answerError = '';
      break;
    default:
      break;
  }
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
  update(s: PlayerStateView): void;
  tick?: () => void;
}

let current: Screen | null = null;
let ticker: number | undefined;

function screenKey(s: PlayerStateView): string {
  if (s.team === null) return 'tiles';
  if (s.phase === 'final') return 'final';
  return `${s.phase === 'grading' ? 'locked' : s.phase}:${s.questionIndex}:${s.team}`;
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
  updateStatus();
}

function updateStatus(): void {
  const pill = document.querySelector<HTMLElement>('[data-pill]');
  if (!pill) return;
  const label = pill.dataset['pill'] ?? '';
  toggle(pill, 'offline', !online);
  setText(pill.querySelector('.label') ?? pill, online ? label : 'Återansluter…');
}

function questionLabel(s: PlayerStateView): string {
  const n = s.phase === 'lobby' ? s.questionIndex : s.questionIndex + 1;
  return `Fråga ${n} av ${s.questionCount}`;
}

function pill(label: string, accent = false): HTMLElement {
  return h('div', { class: 'pill' + (accent ? ' accent' : ''), 'data-pill': label }, h('span', { class: 'dot' }), h('span', { class: 'label' }, label));
}

function topbar(s: PlayerStateView, right: string): HTMLElement {
  return h('div', { class: 'topbar' }, pill(s.team ? teamName(s.team) : 'Ansluten'), h('div', { class: 'eyebrow' }, right));
}

function buildScreen(s: PlayerStateView, key: string): Screen {
  if (key === 'tiles') return tilesScreen(key);
  if (key === 'final') return finalScreen(key);
  switch (s.phase) {
    case 'lobby':
      return lobbyScreen(key);
    case 'open':
      return questionScreen(s, key);
    case 'locked':
    case 'grading':
      return lockedScreen(key);
    case 'reveal':
      return revealScreen(s, key);
    case 'standings':
      return standingsScreen(key);
    default:
      return lobbyScreen(key);
  }
}

// ---- 1. Välj lag ----
function tilesScreen(key: string): Screen {
  const tiles = TEAMS.map((t) =>
    h(
      'button',
      {
        class: 'btn btn-ghost display tile',
        type: 'button',
        'data-team': t,
        onClick: () => {
          if (!online) {
            notice = 'Ingen anslutning – försöker igen…';
            noticeIsError = true;
            render();
            return;
          }
          notice = '';
          conn.send({ type: 'claim', team: t, deviceId });
        },
      },
      teamName(t),
      h('span', { class: 'tag hidden' }, 'TAGET'),
    ),
  );
  const noticeEl = h('div', { class: 'notice', 'data-notice': true });
  const el = h(
    'div',
    { class: 'screen-inner stack', style: 'display:flex;flex-direction:column;gap:28px;flex-grow:1' },
    h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:6px' },
      h('div', { class: 'eyebrow' }, 'Sofie 25 år'),
      h('div', { class: 'display', style: 'font-size:64px;line-height:0.95' }, 'Topp ', h('br'), 'tio'),
      h('div', { style: 'font-size:16px;color:var(--text-2);margin-top:8px' }, 'Välj ert lag. En telefon per lag.'),
    ),
    h('div', { class: 'tiles' }, tiles),
    noticeEl,
    h('div', { class: 'bottom center', style: 'font-size:13px;color:var(--muted)' }, 'Fel lag? Säg till Erik så släpper han det.'),
  );
  return {
    key,
    el,
    update(st) {
      tiles.forEach((tile, i) => {
        const t = TEAMS[i]!;
        const taken = st.taken.includes(t);
        // Dimmed with "TAGET" but still tappable: the server is the one that refuses (§2.1), so a
        // phone with a stale view gets the real answer, "Lag 3 är redan taget".
        toggle(tile, 'taken', taken);
        const tag = tile.querySelector('.tag');
        if (tag) toggle(tag, 'hidden', !taken);
      });
      setText(noticeEl, notice);
      toggle(noticeEl, 'error', noticeIsError);
    },
  };
}

// ---- 2. Väntar ----
function lobbyScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const name = h('div', { class: 'display lobby-name', style: 'font-size:140px;line-height:0.9;color:var(--accent)' });
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:24px;flex-grow:1' },
    h('div', { class: 'topbar' }, pill('Ansluten'), label),
    h(
      'div',
      { style: 'display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:min(120px, 14vh);text-align:center' },
      h('div', { class: 'eyebrow' }, 'Ni är'),
      name,
      h('div', { style: 'font-size:17px;color:var(--text-2);margin-top:16px' }, 'Väntar på att Erik startar'),
    ),
    h(
      'div',
      { class: 'card bottom', style: 'gap:10px;padding:16px' },
      h('div', { style: 'font-weight:600;font-size:15px' }, 'Så funkar det'),
      h(
        'div',
        { style: 'font-size:14px;color:var(--text-2);line-height:1.5' },
        'Ett svar per lag och fråga. Poäng = svarets plats på listan: ettan ger 1, tian ger 10. Utanför listan ger 0. Ni har 1:30 per fråga.',
      ),
    ),
  );
  return {
    key,
    el,
    update(st) {
      setText(label, questionLabel(st));
      setText(name, st.team ? teamName(st.team) : '');
    },
  };
}

// ---- 3. Fråga ----
function questionScreen(s: PlayerStateView, key: string): Screen {
  const ringFg = svg('circle', {
    cx: 84,
    cy: 84,
    r: RING_R,
    fill: 'none',
    stroke: 'var(--accent)',
    'stroke-width': 8,
    'stroke-linecap': 'round',
    'stroke-dasharray': RING_C.toFixed(1),
    'stroke-dashoffset': '0',
    transform: 'rotate(-90 84 84)',
  });
  const ringSvg = svg('svg', { width: 168, height: 168, viewBox: '0 0 168 168' });
  ringSvg.appendChild(svg('circle', { cx: 84, cy: 84, r: RING_R, fill: 'none', stroke: 'var(--border)', 'stroke-width': 8 }));
  ringSvg.appendChild(ringFg);
  const time = h('div', { class: 'display time', 'data-clock': true }, '1:30');
  const ring = h('div', { class: 'ring' }, ringSvg, time);
  const under = h('div', { class: 'eyebrow', style: 'margin-top:6px' }, 'kvar');

  const input = h('input', {
    class: 'answer-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'send',
    maxlength: 80,
    placeholder: 'Ert svar',
    'aria-label': 'Ert svar',
  });
  input.value = draft;
  input.addEventListener('input', () => {
    draft = input.value;
  });
  const sent = h('div', { class: 'sent', 'data-sent': true });
  const err = h('div', { class: 'notice error', 'data-error': true });
  const button = h('button', { class: 'btn btn-primary', type: 'button' }, 'Skicka svar');
  const submit = () => {
    const text = input.value.trim();
    if (!text) {
      answerError = 'Skriv ett svar först.';
      render();
      return;
    }
    if (!conn.send({ type: 'answer', text })) {
      answerError = 'Ingen anslutning – försöker igen…';
      render();
      return;
    }
    answerError = '';
    render();
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submit();
    }
  });

  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:20px;flex-grow:1' },
    topbar(s, questionLabel(s)),
    h('div', { style: 'display:flex;flex-direction:column;align-items:center;margin-top:8px' }, ring, under),
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'Frågan'),
      h('div', { class: 'question-text' }, s.question?.question ?? ''),
      h('div', { class: 'muted', style: 'font-size:14px;line-height:1.5' }, s.question?.definition ?? ''),
    ),
    h(
      'div',
      { class: 'bottom' },
      input,
      button,
      sent,
      err,
      h('div', { style: 'font-size:13px;color:var(--muted);text-align:center' }, 'Ni kan ändra ert svar tills tiden går ut.'),
    ),
  );

  let lastState: PlayerStateView = s;
  const tick = () => {
    const st = lastState;
    const remaining = st.pausedRemainingMs !== null ? st.pausedRemainingMs : st.deadlineAt !== null ? Math.max(0, st.deadlineAt - conn.now()) : 0;
    const total = Math.max(1, st.totalMs);
    setText(time, formatClock(remaining));
    ringFg.setAttribute('stroke-dashoffset', (RING_C * (1 - Math.min(1, remaining / total))).toFixed(1));
    toggle(ring, 'paused', st.pausedRemainingMs !== null);
    toggle(ring, 'zero', remaining <= 0 && st.pausedRemainingMs === null);
    setText(under, st.pausedRemainingMs !== null ? 'pausad' : 'kvar');
  };
  return {
    key,
    el,
    tick,
    update(st) {
      lastState = st;
      tick();
      if (st.answer) {
        setText(sent, `Svar skickat: ${st.answer}` + (st.answerSource === 'admin' ? ' (inskrivet av Erik)' : ''));
        if (!draft && document.activeElement !== input) {
          input.value = st.answer;
          draft = st.answer;
        }
      } else {
        setText(sent, '');
      }
      setText(err, answerError);
    },
  };
}

// ---- 4. Tiden är ute ----
function lockedScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const answer = h('div', { style: 'font-size:26px;font-weight:600' });
  const sub = h('div', { class: 'muted', style: 'font-size:14px' });
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:20px;flex-grow:1' },
    h('div', { class: 'topbar' }, pill(team ? teamName(team) : 'Ansluten'), label),
    h(
      'div',
      { style: 'display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:min(140px, 16vh);text-align:center' },
      h('div', { class: 'display', style: 'font-size:72px;line-height:0.95' }, 'Tiden ', h('br'), 'är ute'),
      h('div', { style: 'font-size:16px;color:var(--text-2)' }, 'Lyssna på Erik.'),
    ),
    h('div', { class: 'card bottom' }, h('div', { class: 'eyebrow' }, 'Ert svar'), answer, sub),
  );
  return {
    key,
    el,
    update(st) {
      setText(label, questionLabel(st));
      setText(answer, st.answer ?? 'Inget svar');
      setText(sub, st.answer ? 'Låst. Rättas när Erik läser listan.' : 'Inget svar hann in. 0 poäng den här gången.');
    },
  };
}

// ---- 5. Avslöjande ----
function revealScreen(s: PlayerStateView, key: string): Screen {
  const rows = s.rows.map((r, i) => {
    const name = h('div', { class: 'grow', style: 'font-size:17px' }, '·····');
    const label = h('div', { class: 'muted', style: 'font-size:13px' });
    const row = h('div', { class: 'row hidden-row' + (r.near ? ' near' : ''), 'data-row': i }, h('div', { class: 'rank display' }, String(r.rank)), name, label);
    return { row, name, label, shown: false };
  });
  const topCount = s.question?.topCount ?? 10;
  const nearHeader = h('div', { class: 'eyebrow hidden', style: 'margin-top:6px' }, 'Nära skott · plats 11–15 ger 0 poäng');
  const list = h('div', { class: 'reveal-rows stack' });
  rows.forEach((r, i) => {
    if (i === topCount) list.appendChild(nearHeader);
    list.appendChild(r.row);
  });

  const big = h('div', { class: 'display big' }, '?');
  const line1 = h('div', { style: 'font-size:15px;font-weight:600' });
  const line2 = h('div', { class: 'muted', style: 'font-size:13px' });
  const result = h('div', { class: 'result', style: 'position:sticky;bottom:12px' }, big, h('div', { class: 'stack', style: 'gap:2px' }, line1, line2));

  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px;flex-grow:1' },
    topbar(s, questionLabel(s)),
    h('div', { style: 'font-size:18px;font-weight:600;line-height:1.3' }, s.question?.title ?? ''),
    list,
    h('div', { class: 'bottom' }, result),
  );

  return {
    key,
    el,
    update(st) {
      const visible = st.visibleRows;
      toggle(nearHeader, 'hidden', visible <= topCount);
      rows.forEach((r, i) => {
        const data = st.rows[i];
        if (i < visible && data && data.name !== null) {
          setText(r.name, data.name);
          setText(r.label, data.label ?? '');
          toggle(r.row, 'hidden-row', false);
          if (!r.shown) {
            r.shown = true;
            r.row.classList.add('in');
          }
        } else {
          setText(r.name, '·····');
          setText(r.label, '');
          toggle(r.row, 'hidden-row', true);
        }
        toggle(r.row, 'mine', st.result.kind === 'hit' && data?.name === st.result.rowName && data?.rank === st.result.rank);
      });
      renderResult(st.result, st.answer, big, line1, line2, result);
    },
  };
}

function renderResult(r: PlayerResult, answer: string | null, big: HTMLElement, line1: HTMLElement, line2: HTMLElement, card: HTMLElement): void {
  toggle(card, 'lit', r.kind === 'hit');
  toggle(card, 'miss', r.kind === 'miss');
  switch (r.kind) {
    case 'hit':
      setText(big, String(r.rank));
      setText(line1, `Ert svar: ${answer ?? r.rowName} · plats ${r.rank} · ${r.points} poäng`);
      setText(line2, r.rank <= 10 ? `Listan säger: ${r.rowName}` : 'Nära skott – plats 11–15 ger 0 poäng.');
      break;
    case 'miss':
      setText(big, '0');
      setText(line1, `Ert svar: ${answer ?? ''} · utanför listan · 0 poäng`);
      setText(line2, 'Inte på listan den här gången.');
      break;
    case 'review':
      setText(big, '?');
      setText(line1, `Ert svar: ${answer ?? ''}`);
      setText(line2, 'Erik avgör den här för hand.');
      break;
    case 'none':
      setText(big, '–');
      setText(line1, 'Inget svar');
      setText(line2, '0 poäng den här gången.');
      break;
    default:
      setText(big, '?');
      setText(line1, `Ert svar: ${answer ?? ''}`);
      setText(line2, 'Inte avslöjat än. Håll tummarna.');
  }
}

// ---- 6. Ställning ----
function standingsList(): { el: HTMLElement; update: (s: PlayerStateView) => void } {
  const el = h('div', { class: 'standings stack' });
  return {
    el,
    update(st) {
      el.replaceChildren(
        ...st.standings.map((row) =>
          h(
            'div',
            { class: 'row' + (row.team === st.team ? ' mine' : '') },
            h('div', { class: 'rank display' + (row.position === 1 ? ' top' : '') }, String(row.position)),
            h('div', { class: 'grow name' }, teamName(row.team) + (row.team === st.team ? ' · ni' : '')),
            h('div', { class: 'display points' }, String(row.points)),
          ),
        ),
      );
    },
  };
}

function standingsScreen(key: string): Screen {
  const label = h('div', { class: 'eyebrow' });
  const list = standingsList();
  const footer = h('div', { class: 'bottom center', style: 'font-size:14px;color:var(--muted)' });
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:20px;flex-grow:1' },
    h('div', { class: 'topbar' }, pill(team ? teamName(team) : 'Ansluten'), label),
    h('div', { class: 'display', style: 'font-size:56px;line-height:0.95' }, 'Ställning'),
    list.el,
    footer,
  );
  return {
    key,
    el,
    update(st) {
      setText(label, `Efter fråga ${st.questionIndex + 1}`);
      list.update(st);
      setText(footer, st.last ?? '');
    },
  };
}

// ---- 7. Slutställning ----
function finalScreen(key: string): Screen {
  const winners = h('div', { class: 'display winner' });
  const list = standingsList();
  const footer = h('div', { class: 'bottom center', style: 'font-size:14px;color:var(--muted)' });
  const el = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:20px;flex-grow:1' },
    h('div', { class: 'topbar' }, pill(team ? teamName(team) : 'Ansluten'), h('div', { class: 'eyebrow' }, 'Slutresultat')),
    h('div', { class: 'stack center', style: 'gap:6px' }, h('div', { class: 'eyebrow' }, 'Vinnare'), winners),
    list.el,
    footer,
  );
  return {
    key,
    el,
    update(st) {
      const names = st.winners.map(teamName);
      setText(winners, names.length ? names.join(' & ') : '–');
      toggle(winners, 'small', names.length > 1);
      list.update(st);
      setText(footer, st.team && st.winners.includes(st.team) ? 'Grattis!' : 'Tack för i kväll.');
    },
  };
}

// ---------- boot ----------

app.replaceChildren(
  h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;flex-grow:1' },
    h('div', { class: 'eyebrow' }, 'Sofie 25 år'),
    h('div', { class: 'display', style: 'font-size:64px;line-height:0.95' }, 'Topp tio'),
    h('div', { class: 'pill offline', 'data-pill': 'Ansluten' }, h('span', { class: 'dot' }), h('span', { class: 'label' }, 'Ansluter…')),
  ),
);
conn.start();

// Test hook (e2e): simulate a dropped connection. Harmless in production.
(window as unknown as { __sophie?: { drop: () => void } }).__sophie = { drop: () => conn.drop() };
