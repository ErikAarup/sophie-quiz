import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/env.ts';

// One game state is shared by every browser context, so the suite runs serially. The harness
// (mock model, control endpoint, `wrangler dev` on its own port + persisted state) is started
// once in global setup — see e2e/servers.ts.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'e2e', testMatch: /.*\.spec\.ts/, testIgnore: /proof\.spec\.ts/ },
    // Proof: actions-only trace of all nine contexts (small), plus screen videos of the admin phone
    // and Lag 3's phone recorded by the spec itself → proof/.
    { name: 'proof', testMatch: /proof\.spec\.ts/, use: { trace: { mode: 'on', screenshots: false, snapshots: false, sources: false } } },
  ],
});
