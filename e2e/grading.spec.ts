// §2.5 Grade, §2.6 Reveal, §2.7 Standings, §2.8 Manual entry.
import { expect, test } from '@playwright/test';
import { adminGrade, adminLock, adminManualAnswer, adminOverride, adminStart, mockStatus, openAdmin, openPlayer, resetGame, setMock, type Phone } from './helpers.ts';

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

async function answer(p: Phone, text: string): Promise<void> {
  await p.page.getByPlaceholder('Ert svar').fill(text);
  await p.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p.page.getByText(`Svar skickat: ${text}`)).toBeVisible();
}

function adminRow(team: number) {
  return admin.page.locator('.answers .row').nth(team - 1);
}

test('grade, manual entry, override, reveal row by row with highlight timing, standings with shared positions, next question', async ({ browser }) => {
  const p1 = await openPlayer(browser, 1);
  const p3 = await openPlayer(browser, 3);
  const p4 = await openPlayer(browser, 4);
  const p8 = await openPlayer(browser, 8);
  phones.push(p1, p3, p4, p8);
  await adminStart(admin.page);
  await p1.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  await answer(p1, 'Norge'); // not on the list
  await answer(p3, 'portugal'); // exact (casing)
  await answer(p4, 'Czechia'); // alias table → exact, no model
  await answer(p8, 'Tjekkiet'); // Danish spelling → the model (mock) resolves it
  await adminLock(admin.page);

  const t0 = Date.now();
  await adminGrade(admin.page);
  expect(Date.now() - t0).toBeLessThan(20_000);
  await expect(adminRow(3)).toContainText('10');
  await expect(adminRow(4)).toContainText('9');
  await expect(adminRow(8)).toContainText('9');
  await expect(adminRow(1).locator('.score')).toHaveText('0');
  await expect(adminRow(1)).toHaveClass(/miss/);
  const mock = await mockStatus();
  expect(mock.requests).toHaveLength(1);
  expect(mock.requests[0]?.answers).toBe(2); // only Norge + Tjekkiet went to the model
  expect(mock.requests[0]?.apiKey).toBe('e2e-dummy-key'); // the real key never reaches the e2e mock
  expect(mock.requests[0]?.model).toBe('claude-opus-5');

  // §2.8 manual entry after grading: graded on the spot like any other answer.
  await adminManualAnswer(admin.page, 6, 'Italien');
  await expect(adminRow(6)).toContainText('Italien');
  await expect(adminRow(6).locator('.score')).toHaveText('3');

  // §2.5 override before the reveal: Norge → plats 12 by hand.
  await adminOverride(admin.page, 1, 12);
  await expect(adminRow(1)).toContainText('plats 12');
  await expect(adminRow(1)).toContainText('hand');
  await expect(adminRow(1).locator('.score')).toHaveText('0');

  // §2.6 reveal: nothing visible before, rows appear one by one, highlight at the right moment.
  await expect(p3.page.getByText('Inte avslöjat än. Håll tummarna.')).toBeVisible();
  await expect(p3.page.locator('.reveal-rows .row').first()).toContainText('·····');
  await expect(admin.page.locator('.counter')).toContainText('0/10');
  for (let i = 1; i <= 9; i++) {
    await admin.page.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
    await expect(p3.page.locator('.reveal-rows .row').nth(i - 1)).not.toContainText('·····');
  }
  await expect(p3.page.locator('.reveal-rows .row').nth(8)).toContainText('Tjeckien');
  await expect(p3.page.locator('.reveal-rows .row').nth(9)).toContainText('·····');
  await expect(p4.page.getByText('Ert svar: Czechia · plats 9 · 9 poäng')).toBeVisible();
  await expect(p4.page.locator('.result')).toHaveClass(/lit/);
  await expect(p8.page.getByText('Ert svar: Tjekkiet · plats 9 · 9 poäng')).toBeVisible();
  await expect(p3.page.getByText('Inte avslöjat än. Håll tummarna.')).toBeVisible(); // Portugal is row 10
  await expect(p1.page.getByText('Inte avslöjat än. Håll tummarna.')).toBeVisible();

  await admin.page.getByRole('button', { name: 'Visa nästa rad: 10' }).click();
  await expect(p3.page.getByText('Ert svar: portugal · plats 10 · 10 poäng')).toBeVisible();
  await expect(p3.page.locator('.result')).toHaveClass(/lit/);
  await expect(p3.page.locator('.reveal-rows .row').nth(9)).toHaveClass(/mine/);
  await expect(p3.page.getByText('Nära skott', { exact: false })).toBeVisible();
  await expect(p3.page.locator('.reveal-rows .row').nth(10)).toContainText('Sverige');
  await expect(p1.page.getByText('Ert svar: Norge · plats 12 · 0 poäng')).toBeVisible();
  await expect(admin.page.getByRole('button', { name: 'Visa ställningen' }).first()).toBeVisible();

  // §2.7 standings: own row highlighted, ties share a position.
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(p3.page.getByText('Ställning', { exact: true })).toBeVisible();
  await expect(p3.page.locator('.standings .row.mine')).toContainText('Lag 3 · ni');
  const rows = p3.page.locator('.standings .row');
  await expect(rows.nth(0)).toContainText('1');
  await expect(rows.nth(0)).toContainText('Lag 3');
  await expect(rows.nth(0).locator('.points')).toHaveText('10');
  await expect(rows.nth(1).locator('.rank')).toHaveText('2');
  await expect(rows.nth(1)).toContainText('Lag 4');
  await expect(rows.nth(2).locator('.rank')).toHaveText('2'); // Lag 8 shares 2nd
  await expect(rows.nth(2)).toContainText('Lag 8');
  await expect(rows.nth(3).locator('.rank')).toHaveText('4');
  await expect(rows.nth(3)).toContainText('Lag 6');
  await expect(p3.page.getByText('Senaste: portugal, plats 10, +10 poäng')).toBeVisible();
  await expect(p1.page.getByText('Senaste: Norge, plats 12, +0 poäng')).toBeVisible();

  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(p3.page.getByText('Väntar på att Erik startar')).toBeVisible();
  await expect(p3.page.getByText('Fråga 1 av 10')).toBeVisible(); // one question done
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 2' })).toBeVisible();
});

test('manual entry during an open question is graded with everyone else on Rätta', async ({ browser }) => {
  const p2 = await openPlayer(browser, 2);
  phones.push(p2);
  await adminStart(admin.page);
  await adminManualAnswer(admin.page, 7, 'Polen');
  await expect(admin.page.locator('.team-grid .row').nth(6)).toContainText('svar');
  await adminManualAnswer(admin.page, 2, 'Belgien');
  await expect(p2.page.getByText('Svar skickat: Belgien (inskrivet av Erik)')).toBeVisible();
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await expect(adminRow(7).locator('.score')).toHaveText('5');
  await expect(adminRow(2).locator('.score')).toHaveText('8');
  expect((await mockStatus()).requests).toHaveLength(0); // both exact: no model call
});

test('Nästa fråga while a hand-typed answer is being graded is refused with a message; the grade lands and the points stay (R3 route A)', async ({ browser }) => {
  const p3 = await openPlayer(browser, 3);
  phones.push(p3);
  await adminStart(admin.page);
  await p3.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  await answer(p3, 'Portugal'); // exact: no model call
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await admin.page.getByRole('button', { name: 'Visa alla' }).click();
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(admin.page.getByText('Ställning', { exact: true })).toBeVisible();
  await expect(p3.page.getByText('Ställning', { exact: true })).toBeVisible();

  // The model is slow tonight (3 s). Erik types Lag 6's answer from the standings — the flow
  // SPELLEDNING offers — and taps "Nästa fråga" before it is graded.
  await setMock('slow');
  await admin.page.locator('.standings .row').filter({ hasText: 'Lag 6' }).click();
  await admin.page.getByRole('dialog').getByPlaceholder('skriv svar för hand…').fill('Tjekkiet');
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Spara svar' }).click();
  await expect(admin.page.getByRole('dialog')).toBeHidden();
  await expect(admin.page.getByText('Rättar ett svar…', { exact: false })).toBeVisible();
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByText('Rättning pågår', { exact: false })).toBeVisible();
  await expect(admin.page.getByText('Ställning', { exact: true })).toBeVisible(); // did not move on

  // The grade lands: plats 9, 9 points, on admin and on every phone's leaderboard.
  const lag6 = admin.page.locator('.standings .row').filter({ hasText: 'Lag 6' });
  await expect(lag6).toContainText('plats 9', { timeout: 15_000 });
  await expect(lag6.locator('.points')).toHaveText('9');
  await expect(admin.page.getByText('Rättar ett svar…', { exact: false })).toBeHidden();
  await expect(p3.page.locator('.standings .row').filter({ hasText: 'Lag 6' }).locator('.points')).toHaveText('9');
  expect((await mockStatus()).requests).toHaveLength(1);

  // Now "Nästa fråga" works, and the points are still there.
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 2' })).toBeVisible();
  await expect(p3.page.getByText('Väntar på att Erik startar')).toBeVisible();
});

test('grader fallback when the model call fails: exact hits are graded, the rest are flagged ogranskad, Erik sets them by hand', async ({ browser }) => {
  await setMock('fail');
  const p3 = await openPlayer(browser, 3);
  const p5 = await openPlayer(browser, 5);
  phones.push(p3, p5);
  await adminStart(admin.page);
  await p3.page.getByRole('button', { name: 'Skicka svar' }).waitFor();
  await answer(p3, 'Portugal');
  await answer(p5, 'Tjekkiet');
  await adminLock(admin.page);
  const t0 = Date.now();
  await adminGrade(admin.page);
  expect(Date.now() - t0).toBeLessThan(20_000);
  await expect(adminRow(3).locator('.score')).toHaveText('10');
  await expect(adminRow(5)).toContainText('ogranskad');
  await expect(adminRow(5).locator('.score')).toHaveText('?');
  await expect(admin.page.getByText('Modellen kunde inte rätta alla svar', { exact: false })).toBeVisible();
  expect((await mockStatus()).requests.length).toBeGreaterThanOrEqual(2); // one retry

  await adminOverride(admin.page, 5, 9);
  await expect(adminRow(5).locator('.score')).toHaveText('9');
  await admin.page.getByRole('button', { name: 'Visa alla' }).click();
  await expect(p5.page.getByText('Ert svar: Tjekkiet · plats 9 · 9 poäng')).toBeVisible();
  await expect(p3.page.getByText('Ert svar: Portugal · plats 10 · 10 poäng')).toBeVisible();
});
