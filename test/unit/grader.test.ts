import { describe, expect, it } from 'vitest';
import { buildUserPrompt, gradeAnswers, parseModelOutput, type ModelInput } from '../../src/worker/grader.ts';
import { quiz } from './helpers.ts';

const eu = quiz.questions[0]!;
const rowIndexOf = (name: string) => eu.rows.findIndex((r) => r.name === name);

describe('parseModelOutput', () => {
  it('accepts the schema shape and rejects everything else', () => {
    expect(parseModelOutput('{"results":[{"team":1,"row":9,"reason":"x"}]}')).toEqual({ results: [{ team: 1, row: 9, reason: 'x' }] });
    expect(parseModelOutput('{"results":[{"team":2,"row":null,"reason":""}]}').results[0]?.row).toBeNull();
    expect(() => parseModelOutput('not json')).toThrow();
    expect(() => parseModelOutput('{"nope":true}')).toThrow();
    expect(() => parseModelOutput('{"results":[{"team":"1","row":1,"reason":""}]}')).toThrow();
    expect(() => parseModelOutput('{"results":[{"team":1,"row":1.5,"reason":""}]}')).toThrow();
  });
});

describe('gradeAnswers', () => {
  it('grades exact and alias hits without calling the model', async () => {
    let called = false;
    const out = await gradeAnswers(eu, [{ team: 1, text: 'portugal' }, { team: 2, text: 'Czech Republic' }], {
      callModel: async () => {
        called = true;
        return { results: [] };
      },
    });
    expect(called).toBe(false);
    expect(out).toMatchObject({ failed: false, usedModel: false });
    expect(out.rows).toEqual([
      { team: 1, gradedText: 'portugal', rowIndex: rowIndexOf('Portugal'), needsReview: false, reason: 'Exakt träff' },
      { team: 2, gradedText: 'Czech Republic', rowIndex: rowIndexOf('Tjeckien'), needsReview: false, reason: 'Exakt träff' },
    ]);
  });

  it('sends only the remainder to the model, with the pre-pass hits for context, and maps row numbers back', async () => {
    let input: ModelInput | null = null;
    const out = await gradeAnswers(eu, [{ team: 3, text: 'Portugal' }, { team: 5, text: 'Tjekkiet' }, { team: 8, text: 'Norge' }], {
      callModel: async (i) => {
        input = i;
        return {
          results: [
            { team: 5, row: rowIndexOf('Tjeckien') + 1, reason: 'dansk stavning' },
            { team: 8, row: null, reason: 'inte i EU' },
          ],
        };
      },
    });
    expect(input!.answers).toEqual([{ team: 5, text: 'Tjekkiet' }, { team: 8, text: 'Norge' }]);
    expect(input!.prepassHits).toEqual([{ team: 3, text: 'Portugal', row: rowIndexOf('Portugal') + 1 }]);
    expect(out.failed).toBe(false);
    expect(out.usedModel).toBe(true);
    expect(out.rows.find((r) => r.team === 5)).toMatchObject({ rowIndex: rowIndexOf('Tjeckien'), needsReview: false, reason: 'dansk stavning' });
    expect(out.rows.find((r) => r.team === 8)).toMatchObject({ rowIndex: null, needsReview: false });
    const prompt = buildUserPrompt(input!);
    expect(prompt).toContain('"Tjekkiet"');
    expect(prompt).toContain('"name":"Tjeckien"');
  });

  it('flags the remainder for review when the model fails, without touching the exact hits', async () => {
    const out = await gradeAnswers(eu, [{ team: 1, text: 'Spanien' }, { team: 2, text: 'Tjekkiet' }], {
      callModel: async () => {
        throw new Error('503 from upstream');
      },
    });
    expect(out.failed).toBe(true);
    expect(out.rows).toEqual([
      { team: 1, gradedText: 'Spanien', rowIndex: rowIndexOf('Spanien'), needsReview: false, reason: 'Exakt träff' },
      { team: 2, gradedText: 'Tjekkiet', rowIndex: null, needsReview: true, reason: expect.stringContaining('503') },
    ]);
  });

  it('flags for review when no key is configured, when a team is missing from the output, or when the row does not exist', async () => {
    const noKey = await gradeAnswers(eu, [{ team: 2, text: 'Tjekkiet' }], {});
    expect(noKey.rows[0]).toMatchObject({ needsReview: true, reason: expect.stringContaining('ANTHROPIC_API_KEY') });
    expect(noKey.failed).toBe(true);

    const partial = await gradeAnswers(eu, [{ team: 2, text: 'Tjekkiet' }, { team: 3, text: 'Portugall' }], {
      callModel: async () => ({ results: [{ team: 2, row: 99, reason: 'made up' }] }),
    });
    expect(partial.failed).toBe(true);
    expect(partial.rows.find((r) => r.team === 2)).toMatchObject({ rowIndex: null, needsReview: true });
    expect(partial.rows.find((r) => r.team === 3)).toMatchObject({ rowIndex: null, needsReview: true });
  });

  it('a schema-valid but contradictory response (duplicate team rows) is never trusted: everything pending goes to review', async () => {
    const out = await gradeAnswers(eu, [{ team: 1, text: 'Atlantis' }, { team: 2, text: 'Tjekkiet' }], {
      callModel: async () => ({
        results: [
          { team: 1, row: null, reason: 'utanför' },
          { team: 1, row: 1, reason: 'träff' }, // contradicts the row above
          { team: 2, row: rowIndexOf('Tjeckien') + 1, reason: 'ok' },
        ],
      }),
    });
    expect(out.failed).toBe(true);
    expect(out.rows.find((r) => r.team === 1)).toMatchObject({ rowIndex: null, needsReview: true });
    expect(out.rows.find((r) => r.team === 2)).toMatchObject({ rowIndex: null, needsReview: true });
  });

  it('an echo of a pre-pass team is ignored (the pre-pass is final), whatever row it claims', async () => {
    const out = await gradeAnswers(eu, [{ team: 3, text: 'Portugal' }, { team: 5, text: 'Tjekkiet' }], {
      callModel: async () => ({
        results: [
          { team: 3, row: 1, reason: 'echo with a wrong row' },
          { team: 5, row: rowIndexOf('Tjeckien') + 1, reason: 'dansk stavning' },
        ],
      }),
    });
    expect(out.failed).toBe(false);
    expect(out.rows.find((r) => r.team === 3)).toMatchObject({ rowIndex: rowIndexOf('Portugal'), needsReview: false });
    expect(out.rows.find((r) => r.team === 5)).toMatchObject({ rowIndex: rowIndexOf('Tjeckien'), needsReview: false });
  });

  it('a response that names a team that was not asked about is not trusted either', async () => {
    const out = await gradeAnswers(eu, [{ team: 1, text: 'Atlantis' }], {
      callModel: async () => ({ results: [{ team: 1, row: null, reason: '' }, { team: 7, row: 2, reason: 'extra' }] }),
    });
    expect(out.failed).toBe(true);
    expect(out.rows[0]).toMatchObject({ team: 1, rowIndex: null, needsReview: true });
  });

  it('never invents a hit for an unmatched answer', async () => {
    const out = await gradeAnswers(eu, [{ team: 4, text: 'Slovenien' }], { callModel: async () => ({ results: [{ team: 4, row: null, reason: 'not listed' }] }) });
    expect(out.rows[0]).toMatchObject({ rowIndex: null, needsReview: false });
  });
});
