import { describe, expect, it } from 'vitest';
import { buildPrepass, normalize, rowVariants } from '../../src/shared/normalize.ts';
import { eu } from './helpers.ts';

describe('normalize', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(normalize('  Tjeckien! ')).toBe('tjeckien');
    expect(normalize('Österrike')).toBe('osterrike');
    expect(normalize('Sankt   Petersburg')).toBe('sankt petersburg');
    expect(normalize('Avatar: The Way of Water')).toBe('avatar the way of water');
    expect(normalize('Kongo-Kinshasa')).toBe('kongo kinshasa');
    expect(normalize('Ålesund/Ø')).toBe('alesund o');
  });
});

describe('rowVariants', () => {
  it('adds the name without a parenthetical and the aliases', () => {
    expect(rowVariants('Heathrow (London)', ['LHR'])).toEqual(['heathrow london', 'heathrow', 'lhr']);
  });
});

describe('buildPrepass on the EU list (§2.5 example)', () => {
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
