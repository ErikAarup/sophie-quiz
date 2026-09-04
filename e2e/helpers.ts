// Page and socket helpers for the e2e suite.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CONFIRM_WORD, type AdminCommand, type Team } from '../src/shared/types.ts';
import { ADMIN_TOKEN, CONTROL_URL, WS_URL } from './env.ts';
import type { MockMode } from './servers.ts';

export interface Phone {
  context: BrowserContext;
  page: Page;
}

export async function newPhone(browser: Browser, opts: { clockSkewMs?: number; videoDir?: string } = {}): Promise<Phone> {
  const context = await browser.newContext(opts.videoDir ? { recordVideo: { dir: opts.videoDir, size: { width: 390, height: 844 } } } : {});
  if (opts.clockSkewMs) {
    // A phone whose clock is wrong: Date.now() is shifted, nothing else.
    await context.addInitScript((skew: number) => {
      const realNow = Date.now;
      Date.now = () => realNow() + skew;
    }, opts.clockSkewMs);
  }
  const page = await context.newPage();
  return { context, page };
}

export async function openAdmin(browser: Browser, opts: { videoDir?: string } = {}): Promise<Phone> {
  const phone = await newPhone(browser, opts);
  await phone.page.goto(`/admin?t=${ADMIN_TOKEN}`);
  await expect(phone.page.locator('[data-pill] .label')).toHaveText('Admin');
  return phone;
}

/** Open the player page and, if a team is given, claim it. */
export async function openPlayer(browser: Browser, team?: Team, opts: { clockSkewMs?: number; videoDir?: string } = {}): Promise<Phone> {
  const phone = await newPhone(browser, opts);
  await phone.page.goto('/');
  await expect(phone.page.getByRole('button', { name: 'Lag 1' })).toBeVisible();
  if (team !== undefined) {
    await phone.page.getByRole('button', { name: `Lag ${team}` }).click();
    await expectTeam(phone.page, team);
  }
  return phone;
}

/** The phone is in as `Lag N`: the lobby shows it as the big name, every other screen in the pill. */
export async function expectTeam(page: Page, team: Team): Promise<void> {
  await expect(page.locator('.tiles')).toHaveCount(0);
  await expect(page.locator('[data-pill] .label, .lobby-name').filter({ hasText: new RegExp(`^Lag ${team}$`) }).first()).toBeVisible();
}

export function teamPill(page: Page) {
  return page.locator('[data-pill] .label');
}

export function clockText(page: Page) {
  return page.locator('[data-clock]');
}

/** Parse "m:ss" into seconds. */
export function clockSeconds(text: string): number {
  const m = /^(\d+):(\d\d)$/.exec(text.trim());
  if (!m) throw new Error(`not a clock: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// ---- admin actions through the real UI ----

export async function adminStart(admin: Page): Promise<void> {
  await admin.getByRole('button', { name: /^Starta fråga \d+$/ }).click();
  await expect(admin.getByRole('button', { name: 'Lås svaren nu' })).toBeEnabled();
}

export async function adminLock(admin: Page): Promise<void> {
  await admin.getByRole('button', { name: 'Lås svaren nu' }).click();
  await expect(admin.getByRole('button', { name: /Rätta/ })).toBeEnabled();
}

export async function adminGrade(admin: Page): Promise<void> {
  await admin.getByRole('button', { name: /^Rätta/ }).click();
  await expect(admin.getByRole('button', { name: /^Visa nästa rad|^Visa ställningen$/ }).first()).toBeVisible({ timeout: 30_000 });
}

/** Reset the game through the real UI: open "Mer…" if the screen hides the links there, then type the confirm word. */
export async function adminResetGame(admin: Page): Promise<void> {
  const link = admin.getByRole('button', { name: 'Nollställ spelet' });
  if ((await link.isVisible()) === false) await admin.getByRole('button', { name: 'Mer…' }).click();
  await link.click();
  const sheet = admin.getByRole('dialog');
  await sheet.locator('[data-confirm-input]').fill(CONFIRM_WORD);
  await sheet.getByRole('button', { name: 'Ja, nollställ hela spelet' }).click();
  await expect(admin.getByRole('button', { name: 'Starta fråga 1' })).toBeVisible();
}

/** Open the team sheet on admin (works on the grid and on the answers list). */
export async function adminOpenTeam(admin: Page, team: Team): Promise<void> {
  await admin.getByRole('button', { name: new RegExp(`^Lag ${team}\\b`) }).first().click();
  await expect(admin.getByRole('dialog')).toBeVisible();
}

export async function adminManualAnswer(admin: Page, team: Team, text: string): Promise<void> {
  await adminOpenTeam(admin, team);
  const input = admin.getByRole('dialog').getByPlaceholder('skriv svar för hand…');
  await input.fill(text);
  await admin.getByRole('dialog').getByRole('button', { name: 'Spara svar' }).click();
  await expect(admin.getByRole('dialog')).toBeHidden();
}

export async function adminOverride(admin: Page, team: Team, rank: number): Promise<void> {
  await adminOpenTeam(admin, team);
  await admin.getByRole('dialog').locator(`.rank-list .rank-row[data-rank="${rank}"]`).click();
  await expect(admin.getByRole('dialog')).toBeHidden();
}

export async function adminRelease(admin: Page, team: Team): Promise<void> {
  await adminOpenTeam(admin, team);
  await admin.getByRole('dialog').getByRole('button', { name: /^Släpp Lag/ }).click();
  await expect(admin.getByRole('dialog')).toBeHidden();
}

// ---- out-of-band: raw admin socket for setup/teardown, mock control, worker restart ----

export function adminSocket(cmd: AdminCommand, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`adminSocket ${cmd.type}: timeout`));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'admin', token: ADMIN_TOKEN }));
      ws.send(JSON.stringify({ ...cmd, token: ADMIN_TOKEN }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      const m = JSON.parse(ev.data) as { type: string; of?: string; code?: string; message?: string };
      if (m.type === 'ok' && m.of === cmd.type) {
        clearTimeout(timer);
        ws.close();
        resolve(m);
      } else if (m.type === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`adminSocket ${cmd.type}: ${m.code} ${m.message}`));
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('adminSocket: socket error'));
    });
  });
}

export async function resetGame(): Promise<void> {
  await adminSocket({ type: 'resetGame', confirm: CONFIRM_WORD });
}

export async function setMock(mode: MockMode, reset = true): Promise<void> {
  const res = await fetch(CONTROL_URL, { method: 'POST', body: JSON.stringify({ mode, reset }) });
  if (!res.ok) throw new Error(`setMock failed: ${res.status}`);
}

export async function mockStatus(): Promise<{ mode: MockMode; requests: { apiKey: string | null; model: string | null; answers: number }[] }> {
  const res = await fetch(CONTROL_URL);
  return (await res.json()) as { mode: MockMode; requests: { apiKey: string | null; model: string | null; answers: number }[] };
}

export async function restartWorker(): Promise<void> {
  const res = await fetch(`${CONTROL_URL}/restart`, { method: 'POST', body: '{}' });
  if (!res.ok) throw new Error(`restart failed: ${res.status}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
