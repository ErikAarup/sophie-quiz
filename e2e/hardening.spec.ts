// WO-083 §5 user-seat proof: the party hardening, driven through the real admin UI on a 390×844
// phone. Screenshots of the changed screens land in proof/wo-083/.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIRM_WORD } from '../src/shared/types.ts';
import { ROOT } from './env.ts';
import { adminGrade, adminLock, adminStart, openAdmin, openPlayer, resetGame, setMock, sleep, teamPill, type Phone } from './helpers.ts';

const SHOTS = resolve(ROOT, 'proof', 'wo-083');
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

test('AC3/AC8: mid-reveal "Nästa fråga" is refused with a Swedish toast and works after the last row; the resets are behind "Mer…"', async ({ browser }) => {
  const p3 = await openPlayer(browser, 3);
  phones.push(p3);

  // AC8(b): the player lobby counts the question about to start, the way admin does.
  await expect(p3.page.getByText('Fråga 1 av 10 · väntar')).toBeVisible();
  await expect(admin.page.getByText('Fråga 1 av 10 · väntar')).toBeVisible();
  await shot(p3.page, '5-player-lobby-counter');

  await adminStart(admin.page);
  // AC8(c): the admin question screen carries the host question under the title.
  const hostQuestion = (await p3.page.locator('.question-text').innerText()).trim();
  expect(hostQuestion.length).toBeGreaterThan(10);
  await expect(admin.page.locator('[data-host-question]')).toHaveText(hostQuestion);
  await shot(admin.page, '4-admin-question-with-question');

  await answer(p3, 'Portugal');
  await adminLock(admin.page);
  await adminGrade(admin.page);

  // Nothing revealed yet: the primary button is "Visa nästa rad: 1", and the hint says the first
  // press shows place 1, read from the top (AC8(a)).
  await expect(admin.page.getByRole('button', { name: 'Visa nästa rad: 1' })).toBeVisible();
  await expect(admin.page.getByText('Första trycket visar plats 1 – listan läses uppifrån.')).toBeVisible();
  // AC3: the reset links are not on this screen at all until "Mer…" is tapped.
  await expect(admin.page.getByRole('button', { name: 'Nollställ spelet' })).toBeHidden();
  await expect(admin.page.getByRole('button', { name: 'Nollställ frågan' })).toBeHidden();
  await shot(admin.page, '1-reveal-controls');

  // AC3: "Nästa fråga" is refused mid-reveal, with the message on screen.
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.locator('.toast')).toHaveText('Visa hela listan först.');
  await expect(admin.page.getByRole('button', { name: 'Visa nästa rad: 1' })).toBeVisible(); // did not move on

  // Nine of ten rows: still refused.
  for (let i = 1; i <= 9; i++) await admin.page.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
  await expect(admin.page.getByRole('button', { name: 'Visa nästa rad: 10' })).toBeVisible();
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.locator('.toast')).toHaveText('Visa hela listan först.');
  await expect(admin.page.getByRole('button', { name: 'Visa nästa rad: 10' })).toBeVisible();

  // The last row lands: now it moves on.
  await admin.page.getByRole('button', { name: 'Visa nästa rad: 10' }).click();
  await expect(admin.page.getByRole('button', { name: 'Visa ställningen' }).first()).toBeVisible();
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 2' })).toBeVisible();
});

test('AC3: "Nollställ spelet" needs the confirm word typed; "Nollställ frågan" keeps its two taps', async ({ browser }) => {
  const p2 = await openPlayer(browser, 2);
  phones.push(p2);
  await adminStart(admin.page);
  await answer(p2, 'Polen');
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await admin.page.getByRole('button', { name: 'Visa alla' }).click();
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(admin.page.getByText('Ställning', { exact: true })).toBeVisible();

  // On the standings the resets live behind "Mer…" too — both of them, still reachable.
  await expect(admin.page.getByRole('button', { name: 'Nollställ spelet' })).toBeHidden();
  await admin.page.getByRole('button', { name: 'Mer…' }).click();
  await expect(admin.page.getByRole('button', { name: 'Nollställ frågan' })).toBeVisible();

  // "Nollställ frågan": two taps, no typing (unchanged).
  await admin.page.getByRole('button', { name: 'Nollställ frågan' }).click();
  const qSheet = admin.page.getByRole('dialog');
  await expect(qSheet.locator('[data-confirm-input]')).toHaveCount(0);
  await expect(qSheet.getByRole('button', { name: 'Ja, nollställ frågan' })).toBeEnabled();
  await qSheet.getByRole('button', { name: 'Avbryt' }).click();

  // "Nollställ spelet": the red button is dead until the word is typed. ("Mer…" is still open —
  // closing the sheet does not rebuild the screen behind it.)
  await admin.page.getByRole('button', { name: 'Nollställ spelet' }).click();
  const sheet = admin.page.getByRole('dialog');
  const go = sheet.getByRole('button', { name: 'Ja, nollställ hela spelet' });
  await expect(go).toBeDisabled();
  await shot(admin.page, '2-typed-confirm-sheet');
  await sheet.locator('[data-confirm-input]').fill('nollstall');
  await expect(go).toBeDisabled(); // near enough is not enough
  await sheet.locator('[data-confirm-input]').fill(CONFIRM_WORD.toLowerCase());
  await expect(go).toBeEnabled(); // case-insensitive
  await go.click();

  await expect(admin.page.getByRole('button', { name: 'Starta fråga 1' })).toBeVisible();
  await expect(admin.page.locator('.team-grid .row').nth(1)).toContainText('ledig');
  await expect(p2.page.getByRole('button', { name: 'Lag 1' })).toBeVisible(); // back to the tiles
});

test('AC5/AC6: the override control shows the row name for every place, and it survives broadcasts while Erik types', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p4 = await openPlayer(browser, 4);
  phones.push(p1, p4);
  await adminStart(admin.page);
  await answer(p1, 'Polen');
  await adminLock(admin.page);
  await adminGrade(admin.page);

  // AC5: places 0–15 with names, not numbers only.
  await admin.page.getByRole('button', { name: /^Lag 1\b/ }).first().click();
  const sheet = admin.page.getByRole('dialog');
  await expect(sheet.locator('.rank-list .rank-row')).toHaveCount(16);
  await expect(sheet.locator('.rank-list .rank-row[data-rank="0"]')).toContainText('utanför listan');
  for (const rank of [1, 10, 15]) {
    const row = sheet.locator(`.rank-list .rank-row[data-rank="${rank}"]`);
    await expect(row).toBeVisible();
    expect((await row.innerText()).replace(String(rank), '').trim().length).toBeGreaterThan(1);
  }
  await sheet.locator('.rank-list').scrollIntoViewIfNeeded();
  await shot(admin.page, '3-override-with-names');

  // AC6: type into the sheet, then make another phone reconnect. Every broadcast that causes
  // (close, hello, claim) used to rebuild the sheet and wipe the field.
  const input = sheet.getByPlaceholder('skriv svar för hand…');
  await input.click();
  await input.fill('halvskrivet svar');
  await p4.page.evaluate(() => (window as unknown as { __sophie: { drop: () => void } }).__sophie.drop());
  await expect(teamPill(p4.page)).toHaveText('Lag 4', { timeout: 10_000 });
  await sleep(1500); // let the reconnect's broadcasts land on admin
  await expect(input).toHaveValue('halvskrivet svar');
  await expect(input).toBeFocused();

  // And it still saves what he typed.
  await sheet.getByRole('button', { name: 'Spara svar' }).click();
  await expect(admin.page.getByRole('dialog')).toBeHidden();
  await expect(admin.page.locator('.answers .row').nth(0)).toContainText('halvskrivet svar');
});

test('AC4: "Rätta igen" appears while an answer is ogranskad and re-grades only that answer', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p3 = await openPlayer(browser, 3);
  phones.push(p1, p3);
  await setMock('fail'); // the model is down: the non-exact answer comes back "ogranskad"
  await adminStart(admin.page);
  await answer(p1, 'Portugal'); // exact hit: graded without the model
  await answer(p3, 'Tjekkiet'); // needs the model
  await adminLock(admin.page);
  await adminGrade(admin.page);

  await expect(admin.page.locator('.answers .row').nth(2)).toContainText('ogranskad');
  await expect(admin.page.locator('.answers .row').nth(0)).toContainText('10');
  const regrade = admin.page.getByRole('button', { name: 'Rätta igen' });
  await expect(regrade).toBeVisible();
  await shot(admin.page, '6-ratta-igen');

  // The model is back. "Rätta igen" sends only Lag 3's answer.
  await setMock('ok');
  await regrade.click();
  await expect(admin.page.locator('.answers .row').nth(2)).toContainText('9', { timeout: 20_000 });
  await expect(admin.page.locator('.answers .row').nth(2)).not.toContainText('ogranskad');
  await expect(admin.page.locator('.answers .row').nth(0)).toContainText('10'); // untouched
  await expect(regrade).toBeHidden();
});
