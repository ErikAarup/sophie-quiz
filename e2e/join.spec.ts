// §2.1 Join: tiles, double-claim refusal, release and re-claim, reconnect keeps the team.
import { expect, test } from '@playwright/test';
import { adminRelease, expectTeam, openAdmin, openPlayer, resetGame, type Phone } from './helpers.ts';

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

test('double-claim refusal: a second phone tapping a taken tile is told "Lag 3 är redan taget" and can pick another', async ({ browser }) => {
  const p1 = await openPlayer(browser, 3);
  phones.push(p1);
  await expect(p1.page.getByText('Väntar på att Erik startar')).toBeVisible();

  const p2 = await openPlayer(browser);
  phones.push(p2);
  const tile3 = p2.page.getByRole('button', { name: /^Lag 3/ });
  await expect(tile3).toHaveAttribute('aria-disabled', 'true');
  await expect(tile3).toContainText('TAGET');
  // The tap still goes to the server, which refuses with the exact message.
  await tile3.click();
  await expect(p2.page.getByText('Lag 3 är redan taget')).toBeVisible();
  await expect(p2.page.getByRole('button', { name: 'Lag 1' })).toBeVisible(); // still on the tiles

  await p2.page.getByRole('button', { name: 'Lag 4' }).click();
  await expectTeam(p2.page, 4);
  await expect(admin.page.locator('.team-grid .row').nth(2)).toContainText('väntar');
  await expect(admin.page.locator('.team-grid .row').nth(3)).toContainText('väntar');
});

test('release and re-claim: admin releases Lag 3, that phone is sent back to the tiles with a message, another phone claims Lag 3', async ({ browser }) => {
  const p1 = await openPlayer(browser, 3);
  phones.push(p1);
  await adminRelease(admin.page, 3);
  await expect(p1.page.getByText('Erik släppte Lag 3. Välj lag igen.')).toBeVisible();
  await expect(p1.page.getByRole('button', { name: 'Lag 3' })).toHaveAttribute('aria-disabled', 'false');
  await expect(admin.page.locator('.team-grid .row').nth(2)).toContainText('ledig');

  const p2 = await openPlayer(browser, 3);
  phones.push(p2);
  await expectTeam(p2.page, 3);
  // The released phone now sees the tile as taken by someone else.
  await expect(p1.page.getByRole('button', { name: /^Lag 3/ })).toHaveAttribute('aria-disabled', 'true');
});

test('a reloaded phone comes back as its team; a phone whose slot was taken meanwhile is sent to the tiles', async ({ browser }) => {
  const p1 = await openPlayer(browser, 5);
  phones.push(p1);
  await p1.page.reload();
  await expectTeam(p1.page, 5);
  await expect(p1.page.getByText('Väntar på att Erik startar')).toBeVisible();

  // Erik releases Lag 5 while the phone is away, and a different phone takes it.
  await p1.context.setOffline(true);
  await adminRelease(admin.page, 5);
  const p2 = await openPlayer(browser, 5);
  phones.push(p2);
  await p1.context.setOffline(false);
  await p1.page.reload();
  await expect(p1.page.getByText('Lag 5 används av en annan telefon. Välj lag igen.')).toBeVisible();
  await expect(p1.page.getByRole('button', { name: /^Lag 5/ })).toHaveAttribute('aria-disabled', 'true');
});
