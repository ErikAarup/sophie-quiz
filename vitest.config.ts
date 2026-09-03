import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Three projects: `unit` (pure modules, Node), `do` (the Durable Object inside workerd via the
// workers pool), `live` (one real model call; skipped unless ANTHROPIC_API_KEY is set — see
// test/live). `npm test` runs unit + do; `npm run grader:live` runs live.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'live',
          include: ['test/live/**/*.test.ts'],
          environment: 'node',
          testTimeout: 90_000,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // A dead API host: the DO tests must never reach the real model, whatever .dev.vars says.
              bindings: {
                ADMIN_TOKEN: 'test-admin-token',
                QUESTION_SECONDS: '2',
                ANTHROPIC_API_KEY: '',
                ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
              },
            },
          }),
        ],
        test: {
          name: 'do',
          include: ['test/do/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
