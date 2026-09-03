// §2.9 Resilience: reconnect mid-question with the answer intact; worker restart with state intact;
// admin shows offline within 10 s.
import { expect, test } from '@playwright/test';
import { adminGrade, adminLock, adminStart, openAdmin, openPlayer, resetGame, restartWorker, setMock, sleep, teamPill, type Phone } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let admin: Phone;
const phones: Phone[] = [];

test.beforeEach(async ({ browser }) => {
  await resetGame();
  await setMock('ok');
  admin = await openAdmin(browser);
});

test.afterEach(async () => {
  for (const p of phones.splice(0)) await p.context.close();
  await admin.context.close();
});

test('reconnect mid-question: a phone that loses its connection comes back as its team with its answer intact; admin shows offline within 10 s', async ({ browser }) => {
  const p2 = await openPlayer(browser, 2);
  phones.push(p2);
  await adminStart(admin.page);
  await admin.page.getByRole('button', { name: 'Pausa' }).click(); // keep the question open
  await p2.page.getByPlaceholder('Ert svar').fill('Polen');
  await p2.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p2.page.getByText('Svar skickat: Polen')).toBeVisible();

  // Chromium keeps an established loopback WebSocket alive under offline emulation, so the drop
  // itself comes from the client's own drop hook; offline emulation then blocks the reconnects.
  const t0 = Date.now();
  await p2.context.setOffline(true);
  await p2.page.evaluate(() => (window as unknown as { __sophie: { drop: () => void } }).__sophie.drop());
  await expect(teamPill(p2.page)).toHaveText('Återansluter…', { timeout: 12_000 });
  await expect(admin.page.locator('.team-grid .row').nth(1)).toContainText('offline', { timeout: 10_000 });
  expect(Date.now() - t0).toBeLessThan(10_000);
  await sleep(3000); // stays disconnected while offline
  await expect(teamPill(p2.page)).toHaveText('Återansluter…');

  await p2.context.setOffline(false);
  await expect(teamPill(p2.page)).toHaveText('Lag 2', { timeout: 10_000 });
  await expect(p2.page.getByText('Svar skickat: Polen')).toBeVisible();
  await expect(p2.page.getByText('pausad')).toBeVisible();
  await expect(admin.page.locator('.team-grid .row').nth(1)).toContainText('svar');

  // A full reload lands in the same place too.
  await p2.page.reload();
  await expect(teamPill(p2.page)).toHaveText('Lag 2');
  await expect(p2.page.getByText('Svar skickat: Polen')).toBeVisible();
  await expect(p2.page.getByPlaceholder('Ert svar')).toHaveValue('Polen');
});

test('worker restart mid-question: killing and restarting the Worker loses nothing', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p6 = await openPlayer(browser, 6);
  phones.push(p1, p6);
  await adminStart(admin.page);
  await admin.page.getByRole('button', { name: 'Pausa' }).click();
  await expect(p1.page.getByText('pausad')).toBeVisible();
  await p1.page.getByPlaceholder('Ert svar').fill('Spanien');
  await p1.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p1.page.getByText('Svar skickat: Spanien')).toBeVisible();
  const clockBefore = await p1.page.locator('[data-clock]').textContent();

  await restartWorker();

  await expect(teamPill(p1.page)).toHaveText('Lag 1', { timeout: 20_000 });
  await expect(teamPill(p6.page)).toHaveText('Lag 6', { timeout: 20_000 });
  await expect(p1.page.getByText('Svar skickat: Spanien')).toBeVisible();
  await expect(p1.page.getByText('pausad')).toBeVisible();
  expect(await p1.page.locator('[data-clock]').textContent()).toBe(clockBefore);

  await admin.page.reload();
  await expect(admin.page.getByRole('button', { name: 'Fortsätt' })).toBeVisible();
  await expect(admin.page.locator('.team-grid .row').nth(0)).toContainText('svar');
  await expect(admin.page.locator('.team-grid .row').nth(5)).toContainText('väntar');

  // And the game goes on.
  await admin.page.getByRole('button', { name: 'Fortsätt' }).click();
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await expect(admin.page.locator('.answers .row').nth(0).locator('.score')).toHaveText('4');
});
