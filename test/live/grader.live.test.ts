// One live grading round with the real model on test/fixtures/answers.json (WORK_ORDER §5).
// Runs only when ANTHROPIC_API_KEY is available (env or .dev.vars). `npm run grader:live`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRADER_MODEL, gradeAnswers } from '../../src/worker/grader.ts';
import { buildQuiz } from '../../src/worker/bank.ts';
import type { Team } from '../../src/shared/types.ts';

function readKey(): string | undefined {
  if (process.env['ANTHROPIC_API_KEY']) return process.env['ANTHROPIC_API_KEY'];
  const file = resolve(import.meta.dirname, '..', '..', '.dev.vars');
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.+)$/.exec(line);
    if (m) return m[1]!.trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

interface Fixture {
  slug: string;
  answers: { team: Team; text: string; expectedRank: number | null; via: 'prepass' | 'model' }[];
}

const apiKey = readKey();
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'fixtures', 'answers.json'), 'utf8')) as Fixture;

describe.skipIf(!apiKey)('live grader (real model)', () => {
  it(`grades the sample answers with ${GRADER_MODEL} within 20 s`, async () => {
    const quiz = buildQuiz({ questions: [fixture.slug] });
    const question = quiz.questions.find((q) => q.slug === fixture.slug);
    expect(question).toBeDefined();
    const t0 = Date.now();
    const out = await gradeAnswers(question!, fixture.answers.map((a) => ({ team: a.team, text: a.text })), { apiKey });
    const ms = Date.now() - t0;

    const lines = fixture.answers.map((a) => {
      const row = out.rows.find((r) => r.team === a.team)!;
      const got = row.rowIndex === null ? null : question!.rows[row.rowIndex]!.rank;
      const name = row.rowIndex === null ? 'utanför listan' : question!.rows[row.rowIndex]!.name;
      const ok = got === a.expectedRank && !row.needsReview;
      return `${ok ? 'OK  ' : 'FAIL'} Lag ${a.team} "${a.text}" -> ${name} (rank ${got ?? '-'}; expected ${a.expectedRank ?? '-'}; ${a.via}${row.needsReview ? '; NEEDS REVIEW' : ''}) ${row.reason}`;
    });
    const report = `live grader run ${new Date().toISOString()}\nmodel=${out.model ?? '?'} usedModel=${out.usedModel} failed=${out.failed} time=${ms} ms\n` + lines.join('\n') + '\n';
    console.log(report);
    mkdirSync(resolve(import.meta.dirname, '..', '..', 'proof'), { recursive: true });
    writeFileSync(resolve(import.meta.dirname, '..', '..', 'proof', 'live-grader.txt'), report, 'utf8');

    expect(out.failed).toBe(false);
    expect(out.usedModel).toBe(true);
    expect(ms).toBeLessThan(20_000);
    for (const a of fixture.answers) {
      const row = out.rows.find((r) => r.team === a.team)!;
      const got = row.rowIndex === null ? null : question!.rows[row.rowIndex]!.rank;
      expect(row.needsReview, `Lag ${a.team} ${a.text}`).toBe(false);
      expect(got, `Lag ${a.team} "${a.text}"`).toBe(a.expectedRank);
    }
  });
});

describe.skipIf(Boolean(apiKey))('live grader (no key)', () => {
  it('is skipped: ANTHROPIC_API_KEY not found in env or .dev.vars', () => {
    expect(apiKey).toBeUndefined();
  });
});
