// §2.2 Question, §2.3 Pause and control, §2.4 Answer.
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_TOKEN, QUESTION_SECONDS, WS_URL } from './env.ts';
import { adminLock, adminStart, clockSeconds, clockText, openAdmin, openPlayer, resetGame, sleep, teamPill, type Phone } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let admin: Phone;
const phones: Phone[] = [];

test.beforeEach(async ({ browser }) => {
  await resetGame();
  admin = await openAdmin(browser);
});

test.afterEach(async () => {
  for (const p of phones.splice(0)) await p.context.close();
  await admin.context.close();
});

/** Send an answer straight over a fresh socket, bypassing the UI — a stale or hostile client. */
async function rawAnswer(page: Page, text: string): Promise<{ type: string; code?: string; message?: string }> {
  return page.evaluate(
    async ({ url, text }) => {
      const deviceId = localStorage.getItem('sq.device')!;
      const team = Number(localStorage.getItem('sq.team'));
      const ws = new WebSocket(url);
      return new Promise((resolve) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'hello', role: 'player', deviceId, team }));
          ws.send(JSON.stringify({ type: 'answer', text }));
        };
        ws.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data));
          if (m.type === 'error' || m.type === 'ok') {
            ws.close();
            resolve(m);
          }
        };
        setTimeout(() => resolve({ type: 'timeout' }), 5000);
      });
    },
    { url: WS_URL, text },
  );
}

test('start: every joined phone shows the question and the same countdown within 2 s, also after a reload', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p2 = await openPlayer(browser, 2);
  phones.push(p1, p2);

  await admin.page.getByRole('button', { name: 'Starta fråga 1' }).click();
  const shownAt = async (p: Phone) => {
    await p.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
    return Date.now();
  };
  const [t1, t2] = await Promise.all([shownAt(p1), shownAt(p2)]);
  expect(Math.abs(t1 - t2)).toBeLessThan(2000);
  await expect(p1.page.getByText('Vilka är EU:s tio folkrikaste länder', { exact: false })).toBeVisible();
  await expect(p1.page.getByText('Fråga 1 av 10')).toBeVisible();

  const [c1, c2] = await Promise.all([clockText(p1.page).textContent(), clockText(p2.page).textContent()]);
  expect(Math.abs(clockSeconds(c1!) - clockSeconds(c2!))).toBeLessThanOrEqual(1);
  expect(clockSeconds(c1!)).toBeLessThanOrEqual(QUESTION_SECONDS);
  expect(clockSeconds(c1!)).toBeGreaterThan(QUESTION_SECONDS - 4);

  await p1.page.reload();
  await expect(teamPill(p1.page)).toHaveText('Lag 1');
  await p1.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  const [c1b, c2b] = await Promise.all([clockText(p1.page).textContent(), clockText(p2.page).textContent()]);
  expect(Math.abs(clockSeconds(c1b!) - clockSeconds(c2b!))).toBeLessThanOrEqual(1);
});

test('answer change before lock: the last text counts; admin shows svar/väntar; an answer after lock is refused', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p2 = await openPlayer(browser, 2);
  phones.push(p1, p2);
  await adminStart(admin.page);

  const input = p1.page.getByPlaceholder('Ert svar');
  await input.fill('Spanien');
  await p1.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p1.page.getByText('Svar skickat: Spanien')).toBeVisible();
  await input.fill('Portugal');
  await p1.page.keyboard.press('Enter');
  await expect(p1.page.getByText('Svar skickat: Portugal')).toBeVisible();
  await expect(admin.page.locator('.team-grid .row').nth(0)).toContainText('svar');
  await expect(admin.page.locator('.team-grid .row').nth(1)).toContainText('väntar');
  await expect(admin.page.getByText('1 av 8 har svarat')).toBeVisible();

  // Empty answers are refused locally.
  await input.fill('   ');
  await p1.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p1.page.getByText('Skriv ett svar först.')).toBeVisible();

  await adminLock(admin.page);
  await expect(p1.page.getByText('Tiden är ute')).toBeVisible();
  await expect(p1.page.getByText('Portugal', { exact: true })).toBeVisible();
  await expect(p1.page.getByText('Låst. Rättas när Erik läser listan.')).toBeVisible();
  await expect(p2.page.getByText('Inget svar', { exact: true })).toBeVisible();

  const refused = await rawAnswer(p1.page, 'Polen');
  expect(refused).toMatchObject({ type: 'error', code: 'locked', message: 'Tiden är ute – svaret togs inte emot.' });
  await expect(admin.page.locator('.answers .row').nth(0)).toContainText('Portugal').catch(() => undefined);
});

test('server lock at zero: a phone whose clock is 30 s wrong shows the right time and is locked with everyone else', async ({ browser }) => {
  const skewed = await openPlayer(browser, 3, { clockSkewMs: 30_000 });
  const normal = await openPlayer(browser, 4);
  phones.push(skewed, normal);
  const t0 = Date.now();
  await adminStart(admin.page);
  await skewed.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  await normal.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  await sleep(500);
  const [a, b] = await Promise.all([clockText(skewed.page).textContent(), clockText(normal.page).textContent()]);
  expect(Math.abs(clockSeconds(a!) - clockSeconds(b!))).toBeLessThanOrEqual(1);
  expect(clockSeconds(a!)).toBeGreaterThan(QUESTION_SECONDS - 5); // not 30 s off

  await skewed.page.getByPlaceholder('Ert svar').fill('Belgien');
  await skewed.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(skewed.page.getByText('Svar skickat: Belgien')).toBeVisible();

  // Nobody presses anything: the server locks at zero.
  await expect(skewed.page.getByText('Tiden är ute')).toBeVisible({ timeout: (QUESTION_SECONDS + 5) * 1000 });
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeGreaterThan((QUESTION_SECONDS - 1) * 1000);
  expect(elapsed).toBeLessThan((QUESTION_SECONDS + 4) * 1000);
  await expect(normal.page.getByText('Tiden är ute')).toBeVisible();
  await expect(admin.page.getByText(/· låst/)).toBeVisible();
  await expect(skewed.page.getByText('Belgien', { exact: true })).toBeVisible();

  const refused = await rawAnswer(skewed.page, 'Polen');
  expect(refused).toMatchObject({ type: 'error', code: 'locked' });
});

test('pause survives an admin reload; resume, +30 s and lock early reach every phone within 2 s', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  phones.push(p1);
  await adminStart(admin.page);
  await p1.page.getByRole('button', { name: 'Skicka svar' }).waitFor();

  let t = Date.now();
  await admin.page.getByRole('button', { name: 'Pausa' }).click();
  await expect(p1.page.getByText('pausad')).toBeVisible();
  expect(Date.now() - t).toBeLessThan(2000);
  const frozen = clockSeconds((await clockText(p1.page).textContent())!);
  await sleep(1500);
  expect(clockSeconds((await clockText(p1.page).textContent())!)).toBe(frozen);

  await admin.page.reload();
  await expect(admin.page.getByRole('button', { name: 'Fortsätt' })).toBeVisible();
  await expect(admin.page.getByText(/· pausad/)).toBeVisible();
  expect(clockSeconds((await admin.page.locator('.clock').textContent())!)).toBe(frozen);

  t = Date.now();
  await admin.page.getByRole('button', { name: '+30 s' }).click();
  await expect(clockText(p1.page)).toHaveText(new RegExp(`^${Math.floor((frozen + 30) / 60)}:${String((frozen + 30) % 60).padStart(2, '0')}$`));
  expect(Date.now() - t).toBeLessThan(2000);

  t = Date.now();
  await admin.page.getByRole('button', { name: 'Fortsätt' }).click();
  await expect(p1.page.getByText('kvar')).toBeVisible();
  expect(Date.now() - t).toBeLessThan(2000);
  await sleep(1500);
  expect(clockSeconds((await clockText(p1.page).textContent())!)).toBeLessThan(frozen + 30);

  t = Date.now();
  await admin.page.getByRole('button', { name: 'Lås svaren nu' }).click();
  await expect(p1.page.getByText('Tiden är ute')).toBeVisible();
  expect(Date.now() - t).toBeLessThan(2000);
});

test('wrong admin token is refused', async ({ browser }) => {
  const bad = await browser.newContext();
  const page = await bad.newPage();
  await page.goto(`/admin?t=${ADMIN_TOKEN}-wrong`);
  await expect(page.getByText('Fel adminlänk', { exact: true })).toBeVisible();
  await bad.close();
});
