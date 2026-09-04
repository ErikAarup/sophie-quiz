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
import { buildQuiz, bundledData, type BankList, type QuizData, type QuizFile } from '../../src/worker/bank.ts';

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

describe('what the gate refuses, on data made up for the purpose', () => {
  const list = (over: Partial<BankList>): BankList => ({
    no: 1,
    slug_en: 'made-up',
    category: 'test',
    title_sv: 'Påhittad lista',
    definition_sv: '',
    host_question_sv: '',
    source_name: '',
    source_url: '',
    as_of: '',
    verdict: 'verified',
    items: Array.from({ length: 15 }, (_, i) => ({ rank: i + 1, name_sv: `Rad ${i + 1}`, value: '1', unit: '' })),
    ...over,
  });
  const withLists = (lists: BankList[], slugs = ['made-up']): QuizData => ({
    bank: { generated_on: '', count: lists.length, lists },
    quiz: { questions: slugs, durationSeconds: 150 },
    aliases: {},
  });

  it('a slug the bank does not have', () => {
    expect(() => buildQuiz({ data: withLists([list({})], ['inte-i-banken']) })).toThrow(/no list with slug "inte-i-banken"/);
  });

  it('a list that is not verified or corrected', () => {
    expect(() => buildQuiz({ data: withLists([list({ verdict: 'rejected' })]) })).toThrow(/verdict "rejected"/);
    expect(() => buildQuiz({ data: withLists([list({ verdict: 'corrected' })]) })).not.toThrow();
  });

  it('a list with fewer than ten rows', () => {
    const short = list({ items: Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, name_sv: `Rad ${i + 1}`, value: '1', unit: '' })) });
    expect(() => buildQuiz({ data: withLists([short]) })).toThrow(/has only 9 rows/);
  });

  it('a shared tenth place, which builds fine and is exactly what the top-ten check catches', () => {
    const tie = list({ items: [...list({}).items.slice(0, 10), { rank: 10, name_sv: 'Delad tia', value: '1', unit: '' }, ...list({}).items.slice(10)] });
    const quiz = buildQuiz({ data: withLists([tie]) });
    expect(quiz.questions[0]?.topCount).toBe(11); // eleven rows in the "top ten": the reveal would never end
  });
});
