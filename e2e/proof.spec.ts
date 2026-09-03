// User-seat proof (WORK_ORDER §5): one full three-question game with nine browser contexts
// (8 teams + admin), recorded (trace + video via the `proof` project), plus screenshots of the
// eight canvas screens as built → proof/screens/. Run with `npm run proof`.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Team } from '../src/shared/types.ts';
import { ROOT } from './env.ts';
import { adminGrade, adminLock, adminManualAnswer, adminRelease, adminSocket, adminStart, expectTeam, openAdmin, openPlayer, resetGame, setMock, type Phone } from './helpers.ts';

const SCREENS = resolve(ROOT, 'proof', 'screens');
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SCREENS, `${name}.png`), fullPage: false });

test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

async function answer(p: Phone, text: string): Promise<void> {
  await p.page.getByPlaceholder('Ert svar').fill(text);
  await p.page.getByRole('button', { name: 'Skicka svar' }).click();
  await expect(p.page.getByText(`Svar skickat: ${text}`)).toBeVisible();
}

async function revealAll(admin: Page, top = 10): Promise<void> {
  for (let i = 1; i <= top; i++) await admin.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
  await expect(admin.getByRole('button', { name: 'Visa ställningen' }).first()).toBeVisible();
}

test('a full three-question game with eight teams and Erik, with the eight canvas screens captured', async ({ browser }) => {
  mkdirSync(SCREENS, { recursive: true });
  await resetGame();
  await setMock('ok');

  const admin = await openAdmin(browser);
  await shot(admin.page, 'x-admin-lobby');

  // Two teams join first, so a fresh phone sees "TAGET" tiles like the Main artboard.
  const phones = new Map<Team, Phone>();
  phones.set(2, await openPlayer(browser, 2));
  phones.set(5, await openPlayer(browser, 5));
  const fresh = await openPlayer(browser);
  await expect(fresh.page.getByRole('button', { name: /^Lag 5/ })).toHaveClass(/taken/);
  await shot(fresh.page, '1-main');
  await fresh.context.close();
  for (const t of [1, 3, 4, 6, 7, 8] as Team[]) phones.set(t, await openPlayer(browser, t));
  const p = (t: Team) => phones.get(t)!.page;
  await shot(p(3), '2-lobby');
  await expect(admin.page.locator('.team-grid .row').nth(7)).toContainText('väntar');

  // ---------- Question 1: EU:s folkrikaste länder ----------
  // Lag 6's phone dies right before the question (context closed): admin shows offline, Erik types for them.
  await phones.get(6)!.context.close();
  await expect(admin.page.locator('.team-grid .row').nth(5)).toContainText('offline');
  await adminStart(admin.page);
  await p(3).getByRole('button', { name: 'Skicka svar' }).waitFor();
  await p(3).getByPlaceholder('Ert svar').fill('Portugal');
  await shot(p(3), '3-question');
  await answer(phones.get(3)!, 'Portugal');
  await answer(phones.get(1)!, 'Norge');
  await answer(phones.get(2)!, 'Tyskland');
  await answer(phones.get(4)!, 'Czechia');
  await answer(phones.get(5)!, 'Spanien');
  await answer(phones.get(7)!, 'Polen');
  await shot(admin.page, '7-admin');
  await answer(phones.get(8)!, 'Grekland');
  await adminManualAnswer(admin.page, 6, 'Italien');
  await adminLock(admin.page);
  await shot(p(3), '4-locked');
  await shot(admin.page, 'x-admin-locked');
  await adminGrade(admin.page);
  for (let i = 1; i <= 6; i++) await admin.page.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
  await expect(p(3).locator('.reveal-rows .row').nth(5)).toContainText('Rumänien');
  await p(3).waitForTimeout(500);
  await shot(p(3), '5-reveal');
  await shot(admin.page, '8-admin-reveal');
  await admin.page.getByRole('button', { name: /^Lag 6\b/ }).first().click();
  await expect(admin.page.getByRole('dialog')).toBeVisible();
  await shot(admin.page, 'x-admin-team-sheet');
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Stäng' }).click();
  for (let i = 7; i <= 10; i++) await admin.page.getByRole('button', { name: `Visa nästa rad: ${i}` }).click();
  await expect(p(3).getByText('Ert svar: Portugal · plats 10 · 10 poäng')).toBeVisible();
  await expect(p(8).getByText('Ert svar: Grekland · plats 12 · 0 poäng')).toBeVisible();
  await expect(p(1).getByText('Ert svar: Norge · utanför listan · 0 poäng')).toBeVisible();
  await shot(p(3), 'x-reveal-all');
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(p(3).getByText('Ställning', { exact: true })).toBeVisible();
  await expect(p(3).locator('.standings .row').first()).toContainText('Lag 3');
  await shot(p(3), 'x-standings-q1');
  await shot(admin.page, 'x-admin-standings');
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 2' })).toBeVisible();

  // Lag 6 gets a new phone: Erik releases the slot, the new phone claims it.
  await adminRelease(admin.page, 6);
  phones.set(6, await openPlayer(browser, 6));
  await expectTeam(p(6), 6);

  // ---------- Question 2: Europas största länder efter yta ----------
  await adminStart(admin.page);
  await p(1).getByRole('button', { name: 'Skicka svar' }).waitFor();
  await answer(phones.get(1)!, 'Sverige');
  await answer(phones.get(2)!, 'Italien');
  await answer(phones.get(3)!, 'Finland');
  await answer(phones.get(4)!, 'Ukraine');
  await answer(phones.get(5)!, 'Norway');
  await answer(phones.get(6)!, 'Tyskland');
  await answer(phones.get(7)!, 'Danmark');
  await answer(phones.get(8)!, 'Polen');
  await expect(admin.page.getByText('8 av 8 har svarat')).toBeVisible();
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await revealAll(admin.page);
  await expect(p(3).getByText('Ert svar: Finland · plats 8 · 8 poäng')).toBeVisible();
  await expect(p(5).getByText('Ert svar: Norway · plats 6 · 6 poäng')).toBeVisible();
  await expect(p(7).getByText('Ert svar: Danmark · utanför listan · 0 poäng')).toBeVisible();
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(p(3).getByText('Ställning', { exact: true })).toBeVisible();
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 3' })).toBeVisible();

  // ---------- Question 3: Världens folkrikaste länder ----------
  await adminStart(admin.page);
  await p(1).getByRole('button', { name: 'Skicka svar' }).waitFor();
  await answer(phones.get(1)!, 'Indien');
  await answer(phones.get(2)!, 'Kina');
  await answer(phones.get(3)!, 'USA');
  await answer(phones.get(4)!, 'Indonesien');
  await answer(phones.get(5)!, 'Brasilien');
  await answer(phones.get(6)!, 'Mexiko');
  await answer(phones.get(7)!, 'Japan');
  await answer(phones.get(8)!, 'Nigeria');
  await adminLock(admin.page);
  await adminGrade(admin.page);
  await revealAll(admin.page);
  await expect(p(6).getByText('Ert svar: Mexiko · plats 10 · 10 poäng')).toBeVisible();
  await expect(p(7).getByText('Ert svar: Japan · plats 12 · 0 poäng')).toBeVisible();
  await admin.page.getByRole('button', { name: 'Visa ställningen' }).first().click();
  await expect(p(3).getByText('Ställning', { exact: true })).toBeVisible();

  // Totals after three questions: Lag 3 21, Lag 6 20, Lag 5 17, Lag 4 15, Lag 8 15, Lag 2 13, Lag 1 6, Lag 7 5.
  const rows = p(3).locator('.standings .row');
  const expected: [string, string, string][] = [
    ['1', 'Lag 3', '21'],
    ['2', 'Lag 6', '20'],
    ['3', 'Lag 5', '17'],
    ['4', 'Lag 4', '15'],
    ['4', 'Lag 8', '15'],
    ['6', 'Lag 2', '13'],
    ['7', 'Lag 1', '6'],
    ['8', 'Lag 7', '5'],
  ];
  for (let i = 0; i < expected.length; i++) {
    await expect(rows.nth(i).locator('.rank')).toHaveText(expected[i]![0]);
    await expect(rows.nth(i)).toContainText(expected[i]![1]);
    await expect(rows.nth(i).locator('.points')).toHaveText(expected[i]![2]);
  }
  await expect(p(3).locator('.standings .row.mine')).toContainText('Lag 3 · ni');
  await shot(p(3), '6-leaderboard');
  await admin.page.getByRole('button', { name: 'Nästa fråga' }).click();
  await expect(admin.page.getByRole('button', { name: 'Starta fråga 4' })).toBeVisible();

  // Fast-forward questions 4–10 without answers (admin socket), to reach the final screen.
  for (let q = 4; q <= 10; q++) {
    await adminSocket({ type: 'start' });
    await adminSocket({ type: 'lock' });
    await adminSocket({ type: 'grade' });
    await expect(admin.page.getByRole('button', { name: /^Visa nästa rad: 1$/ })).toBeVisible({ timeout: 20_000 });
    await adminSocket({ type: 'revealAll' });
    await adminSocket({ type: 'standings' });
    await adminSocket({ type: 'next' });
  }
  await expect(p(3).getByText('Vinnare', { exact: true })).toBeVisible();
  await expect(p(3).locator('.winner')).toHaveText('Lag 3');
  await expect(p(3).getByText('Grattis!')).toBeVisible();
  await expect(p(7).getByText('Tack för i kväll.')).toBeVisible();
  await shot(p(3), 'x-final');
  await shot(admin.page, 'x-admin-final');

  for (const ph of phones.values()) await ph.context.close();
  await admin.context.close();
});
