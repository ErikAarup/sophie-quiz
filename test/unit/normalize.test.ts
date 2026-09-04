import { describe, expect, it } from 'vitest';
import { buildPrepass, normalize, rowVariants } from '../../src/shared/normalize.ts';
import { buildQuiz } from '../../src/worker/bank.ts';
import { quiz } from './helpers.ts';

describe('normalize', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(normalize('  Tjeckien! ')).toBe('tjeckien');
    expect(normalize('Österrike')).toBe('osterrike');
    expect(normalize('Sankt   Petersburg')).toBe('sankt petersburg');
    expect(normalize('Avatar: The Way of Water')).toBe('avatar the way of water');
    expect(normalize('Kongo-Kinshasa')).toBe('kongo kinshasa');
    expect(normalize('Ålesund/Ø')).toBe('alesund o');
  });

  it('turns an emoji into a stable token; skin tone, variation selector and repeats do not matter', () => {
    expect(normalize('😂')).toBe('e1f602');
    expect(normalize('❤️')).toBe('e2764');
    expect(normalize('❤')).toBe('e2764');
    expect(normalize('👍🏽')).toBe('e1f44d');
    expect(normalize('😂😂😂')).toBe('e1f602');
    expect(normalize('Tumme upp 👍')).toBe('tumme upp e1f44d');
    expect(normalize('🇸🇪')).toBe('e1f1f8x1f1ea');
  });
});

describe('buildPrepass on the emoji list (a team answers with the emoji itself)', () => {
  const q = buildQuiz({ questions: ['most-used-emojis-unicode'] }).questions[0]!;
  const idx = buildPrepass(q);
  const row = (name: string) => q.rows.findIndex((r) => r.name === name);

  it('hits by the emoji, by the Swedish name and by the English name', () => {
    expect(idx.lookup('😂')).toEqual({ kind: 'hit', rowIndex: row('Gråtskrattande ansikte') });
    expect(idx.lookup('😂😂')).toEqual({ kind: 'hit', rowIndex: row('Gråtskrattande ansikte') });
    expect(idx.lookup('❤️')).toEqual({ kind: 'hit', rowIndex: row('Rött hjärta') });
    expect(idx.lookup('👍🏽')).toEqual({ kind: 'hit', rowIndex: row('Tumme upp') });
    expect(idx.lookup('thumbs up')).toEqual({ kind: 'hit', rowIndex: row('Tumme upp') });
    expect(idx.lookup('Gråtskrattande ansikte')).toEqual({ kind: 'hit', rowIndex: row('Gråtskrattande ansikte') });
  });

  it('every row of the emoji list carries its emoji as an alias', () => {
    for (const r of q.rows) {
      const al = q.aliases[r.name] ?? [];
      expect(al.some((a) => /^e[0-9a-fx]+$/.test(normalize(a)))).toBe(true);
    }
  });
});

describe('rowVariants', () => {
  it('adds the name without a parenthetical and the aliases', () => {
    expect(rowVariants('Heathrow (London)', ['LHR'])).toEqual(['heathrow london', 'heathrow', 'lhr']);
  });
});

describe('buildPrepass on the EU list (§2.5 example)', () => {
  const eu = quiz.questions[0]!;
  const index = buildPrepass(eu);
  const tjeckien = eu.rows.findIndex((r) => r.name === 'Tjeckien');

  it('matches spelling, casing and English names to Tjeckien', () => {
    for (const text of ['tjeckien', 'TJECKIEN', 'Czechia', 'Czech Republic', ' czech republic ']) {
      expect(index.lookup(text)).toEqual({ kind: 'hit', rowIndex: tjeckien });
    }
  });

  it('matches every row by its own name', () => {
    eu.rows.forEach((row, i) => {
      expect(index.lookup(row.name)).toEqual({ kind: 'hit', rowIndex: i });
    });
  });

  it('does not invent hits', () => {
    expect(index.lookup('Norge')).toEqual({ kind: 'none' });
    expect(index.lookup('')).toEqual({ kind: 'none' });
    expect(index.lookup('Tysklandet')).toEqual({ kind: 'none' });
  });

  it('reports ambiguity instead of guessing', () => {
    const idx = buildPrepass({
      rows: [
        { rank: 1, name: 'Norra Tornen (Innovationen)', value: '', unit: '', label: '' },
        { rank: 2, name: 'Norra Tornen (Helix)', value: '', unit: '', label: '' },
      ],
      aliases: {},
    });
    expect(idx.lookup('Norra Tornen')).toEqual({ kind: 'ambiguous', rowIndexes: [0, 1] });
    expect(idx.lookup('norra tornen helix')).toEqual({ kind: 'hit', rowIndex: 1 });
  });
});
