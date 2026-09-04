import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { createModelMock } from './test/do/model-mock.ts';
import { TEST_QUESTIONS } from './test/fixtures/questions.ts';

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
              // The DO tests must never reach the real model, whatever .dev.vars says: every
              // outbound fetch goes to the mock in test/do/model-mock.ts (default: 500, so a grade
              // that needs the model is flagged "ogranskad" after the SDK's one retry), and the
              // API host is a dead port in case the mock is ever detached.
              bindings: {
                ADMIN_TOKEN: 'test-admin-token',
                QUESTION_SECONDS: '2',
                QUIZ_QUESTIONS: JSON.stringify(TEST_QUESTIONS),
                ANTHROPIC_API_KEY: 'do-test-dummy-key',
                ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
              },
              outboundService: createModelMock(),
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
