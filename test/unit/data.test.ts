// The data gate (WO-083 A1). This is the only test that reads the real `data/` files, and it is
// what `npm run deploy` runs before wrangler (`predeploy` in package.json): a list set that would
// 500 every `/ws` after the deploy — a bad slug, an unverified list, a short list, a tie at rank
// 10 — fails here instead, named and explained, while `/health` would still have said "ok".
//
// Proof hook: `SOPHIE_QUIZ_JSON=<path>` checks that file instead of `data/quiz.json`. It exists so
// the gate can be shown failing on a deliberately broken copy without anything under `data/` being
// written. Unset in every normal run, including the one `npm run deploy` makes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildQuiz, bundledData, type QuizData, type QuizFile } from '../../src/worker/bank.ts';

const override = process.env['SOPHIE_QUIZ_JSON'];
const quizSource = override ?? 'data/quiz.json';
const data: QuizData = override ? { ...bundledData, quiz: JSON.parse(readFileSync(override, 'utf8')) as QuizFile } : bundledData;

/**
 * Every reason a list set may not be deployed, as one line each, naming the list and the reason.
 * An empty array means the ten lists are party-ready.
 */
function partyReadiness(): string[] {
  const problems: string[] = [];
  let quiz;
  try {
    // Same builder the Durable Object runs in its constructor: slug exists, verdict is
    // verified/corrected, at least ten rows.
    quiz = buildQuiz({ data });
  } catch (err) {
    problems.push(`${quizSource}: ${err instanceof Error ? err.message.replace(/^quiz\.json: /, '') : String(err)}`);
    return problems;
  }
  for (const question of quiz.questions) {
    if (question.topCount !== 10) {
      const tied = question.rows.filter((r) => r.rank === 10).map((r) => r.name);
      problems.push(
        `${quizSource}: list "${question.slug}" has a top ${question.topCount}, not a top ten` +
          (tied.length > 1 ? ` — rank 10 is shared by ${tied.join(' and ')}; pick another list` : ' — the reveal would not end at ten rows'),
      );
    }
    const aliases = data.aliases[question.slug];
    if (typeof aliases !== 'object') continue;
    for (const key of Object.keys(aliases)) {
      if (!question.rows.some((r) => r.name === key)) {
        problems.push(`data/aliases.json: list "${question.slug}" has aliases for "${key}", which is not a row in that list`);
      }
    }
  }
  return problems;
}

describe('the ten lists are ready for the party (npm run deploy runs this first)', () => {
  it('every list has a real, verified slug, at least ten rows, an exact top ten, and only aliases that name its own rows', () => {
    expect(partyReadiness()).toEqual([]);
  });

  it('is ten questions of 2:30, the shape the runbook and the screens are written for', () => {
    expect(data.quiz.questions).toHaveLength(10);
    expect(data.quiz.durationSeconds).toBe(150);
  });
});
