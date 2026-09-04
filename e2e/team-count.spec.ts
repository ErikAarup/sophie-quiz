// WO-084 §5 user-seat proof: Erik sets the number of teams on his phone at the venue, the whole
// evening follows it, and the two holes the exploratory testers found are closed. Driven through
// the real admin UI on a 390×844 phone; screenshots land in proof/wo-084/.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AdminCommand } from '../src/shared/types.ts';
import { ADMIN_TOKEN, ROOT, WS_URL } from './env.ts';
import {
  adminGrade,
  adminLock,
  adminResetGame,
  adminSetTeamCount,
  adminStart,
  expectTiles,
  openAdmin,
  openPlayer,
  resetGame,
  setMock,
  type Phone,
} from './helpers.ts';

const SHOTS = resolve(ROOT, 'proof', 'wo-084');
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false });

test.describe.configure({ mode: 'serial' });

let admin: Phone;
const phones: Phone[] = [];

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async ({ browser }) => {
  await resetGame();
  await setMock('ok');
  admin = await openAdmin(browser);
});

test.afterEach(async () => {
  for (const p of phones.splice(0)) await p.context.close();
  await admin.context.close();
});

async function answer(p: Phone, text: string): Promise<void> {
  await p.page.getByPlaceholder('Ert svar').fill(text);
  await p.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p.page.getByText(`Svar skickat: ${text}`)).toBeVisible();
}

/** Two admin commands down one raw socket with nothing awaited in between (the explorer's shape). */
function adminSocketPair(cmd1: AdminCommand, cmd2: AdminCommand, timeoutMs = 20_000): Promise<{ type: string; of?: string; code?: string; message?: string }[]> {
  return new Promise((resolve_, reject) => {
    const ws = new WebSocket(WS_URL);
    const replies: { type: string; of?: string; code?: string; message?: string }[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`adminSocketPair: timeout, got ${JSON.stringify(replies)}`));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'admin', token: ADMIN_TOKEN }));
      ws.send(JSON.stringify({ ...cmd1, token: ADMIN_TOKEN }));
      ws.send(JSON.stringify({ ...cmd2, token: ADMIN_TOKEN }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      const m = JSON.parse(ev.data) as { type: string; of?: string; code?: string; message?: string };
      if (m.type === 'ok' || m.type === 'error') {
        replies.push(m);
        if (replies.length === 2) {
          clearTimeout(timer);
          ws.close();
          resolve_(replies);
        }
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('adminSocketPair: socket error'));
    });
  });
}

/** A phone that still believes in a team: hello + claim on a raw socket, first refusal returned. */
function playerClaim(team: number, deviceId: string, timeoutMs = 10_000): Promise<{ type: string; code?: string; message?: string }> {
  return new Promise((resolve_, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('playerClaim: timeout'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'player', deviceId }));
      ws.send(JSON.stringify({ type: 'claim', team, deviceId }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      const m = JSON.parse(ev.data) as { type: string; code?: string; message?: string };
      if (m.type === 'error' || m.type === 'released') {
        clearTimeout(timer);
        ws.close();
        resolve_(m);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('playerClaim: socket error'));
    });
  });
}

// ---------------------------------------------------------------------------
// AC1 + AC2 + AC3 — the user-seat run the work order asks for, in one go.
// ---------------------------------------------------------------------------
test('AC1/2/3: Erik sets six teams on the lobby, six tiles appear, one question is played to the standings, "Nollställ spelet" keeps six', async ({ browser }) => {
  // A phone is already on the tiles, at eight, before Erik touches anything.
  const waiting = await openPlayer(browser);
  phones.push(waiting);
  await expectTiles(waiting.page, 8);

  // The stepper is live on the first lobby: nobody has taken a tile and nothing has started.
  await expect(admin.page.locator('[data-team-count]')).toHaveText('Antal lag: 8');
  await adminSetTeamCount(admin.page, 6);
  await shot(admin.page, '1-admin-lobby-stepper');

  // The phone that was already open follows immediately — no reload.
  await expectTiles(waiting.page, 6);
  await shot(waiting.page, '2-player-tiles-6');

  const p1 = await openPlayer(browser, 1);
  const p6 = await openPlayer(browser, 6);
  phones.push(p1, p6); // openPlayer() asserts each phone is in as its team

  // With a slot held the stepper is dead and says why (AC1).
  await expect(admin.page.locator('.team-count [data-step="up"]')).toBeDisabled();
  await expect(admin.page.locator('.team-count')).toContainText('Släpp lagen först.');

  // One question, six teams all the way through.
  await adminStart(admin.page);
  await expect(admin.page.locator('.team-grid .row')).toHaveCount(6);
  await expect(admin.page.getByText('av 6 har svarat')).toBeVisible();
  await answer(p1, 'Tyskland');
  await answer(p6, 'Portugal');
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await expect(admin.page.locator('.answers .row')).toHaveCount(6);
  for (let i = 1; i <= 10; i++) await admin.page.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();

  // Standings: six rows, six teams, the points of a six-team game.
  const rows = admin.page.locator('.standings .row');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('Lag 6'); // Portugal = plats 10 = 10 poäng
  await expect(rows.nth(0).locator('.points')).toHaveText('10');
  await expect(rows.nth(1)).toContainText('Lag 1'); // Tyskland = plats 1 = 1 poäng
  await expect(admin.page.getByRole('button', { name: /^Lag 7/ })).toHaveCount(0);
  await shot(admin.page, '3-admin-standings-6');
  await expect(p1.page.locator('.standings .row')).toHaveCount(6);
  await shot(p1.page, '4-player-standings-6');

  // "Nollställ spelet" before the guests: still six (AC3).
  await adminResetGame(admin.page);
  await expect(admin.page.locator('[data-team-count]')).toHaveText('Antal lag: 6');
  await expect(admin.page.locator('.team-grid .row')).toHaveCount(6);
  await expectTiles(p1.page, 6);
  await expectTiles(waiting.page, 6);
  await shot(admin.page, '5-admin-lobby-after-reset-6');
});

test('AC1/AC2: twelve is the top and two the bottom; a claim above the count is refused in Swedish', async ({ browser }) => {
  await adminSetTeamCount(admin.page, 12);
  await expect(admin.page.locator('.team-count [data-step="up"]')).toBeDisabled();
  const p = await openPlayer(browser);
  phones.push(p);
  await expectTiles(p.page, 12);
  await shot(p.page, '6-player-tiles-12');

  await adminSetTeamCount(admin.page, 2);
  await expect(admin.page.locator('.team-count [data-step="down"]')).toBeDisabled();
  await expectTiles(p.page, 2);

  // A phone that still believes in Lag 5 (an old tab, a remembered team) is told, not seated.
  expect(await playerClaim(5, 'stale-device-aaaa')).toMatchObject({
    type: 'error',
    code: 'noTeam',
    message: 'Lag 5 är inte med i kvällens spel.',
  });
});

// ---------------------------------------------------------------------------
// AC4 — the double-grade race the explorer found, through a real socket.
// ---------------------------------------------------------------------------
test('AC4: two "grade" commands back-to-back where every answer is an exact hit — one is accepted, one is refused', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  phones.push(p1);
  await adminStart(admin.page);
  await answer(p1, 'Tyskland'); // exact list hit: the grader resolves it without a model call
  await adminLock(admin.page);

  const replies = await adminSocketPair({ type: 'grade' }, { type: 'grade' });
  const kinds = replies.map((r) => r.type).sort();
  // Before WO-084 this was ['ok','ok'] (explore-b/e2e/explore/double-tap.spec.ts, 3/3): the DO
  // awaited the token check before ever reaching the reducer's busy guard. Now the two commands
  // reduce one after the other, so exactly one can win.
  expect(kinds).toEqual(['error', 'ok']);
  const err = replies.find((r) => r.type === 'error')!;
  expect(['busy', 'done']).toContain(err.code);
  expect(['Rättning pågår.', 'Alla svar är redan rättade.']).toContain(err.message);

  // One grade, and the score is the one a single pass gives.
  await expect(admin.page.getByRole('button', { name: /^Visa nästa rad|^Visa ställningen$/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(admin.page.locator('.answers .row').nth(0).locator('.score')).toHaveText('1');
});

// ---------------------------------------------------------------------------
// AC5 — a wrong admin link cannot poison the cached token.
// ---------------------------------------------------------------------------
test('AC5: a visit with a wrong ?t= shows "Fel adminlänk" and leaves the good cached token alone', async ({ browser }) => {
  // One phone, three visits: the good link, a link with a typo, then the bookmark-less /admin.
  const phone = await openAdmin(browser);
  phones.push(phone);
  await expect(phone.page.locator('[data-pill] .label')).toHaveText('Admin');

  await phone.page.goto(`/admin?t=${ADMIN_TOKEN}-typo`);
  await expect(phone.page.getByText('Fel adminlänk', { exact: true })).toBeVisible();
  await shot(phone.page, '7-admin-wrong-link');

  await phone.page.goto('/admin');
  await expect(phone.page.locator('[data-pill] .label')).toHaveText('Admin', { timeout: 15_000 });
  await expect(phone.page.getByRole('button', { name: /^Starta fråga \d+$/ })).toBeVisible();
});
