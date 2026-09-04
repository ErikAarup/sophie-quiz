import { describe, expect, it } from 'vitest';
import { pointsForRank, standings, totals, winners } from '../../src/shared/scoring.ts';
import type { Grade } from '../../src/shared/types.ts';

function g(points: number): Grade {
  return { rank: points || null, rowIndex: null, points, manual: false, needsReview: false, reason: '', gradedText: '' };
}

describe('pointsForRank', () => {
  it('gives rank as points for 1–10 and 0 otherwise', () => {
    expect(pointsForRank(1)).toBe(1);
    expect(pointsForRank(10)).toBe(10);
    expect(pointsForRank(11)).toBe(0);
    expect(pointsForRank(15)).toBe(0);
    expect(pointsForRank(null)).toBe(0);
    expect(pointsForRank(0)).toBe(0);
  });
});

describe('standings', () => {
  it('sums over questions and shares positions on ties (1, 2, 2, 4)', () => {
    const grades: Record<string, Grade> = {
      '0:1': g(10),
      '1:1': g(5), // Lag 1 = 15
      '0:2': g(7),
      '1:2': g(3), // Lag 2 = 10
      '0:3': g(10), // Lag 3 = 10
      '0:4': g(2), // Lag 4 = 2
    };
    expect(totals(grades)[1]).toBe(15);
    const rows = standings(grades);
    expect(rows.map((r) => [r.position, r.team, r.points])).toEqual([
      [1, 1, 15],
      [2, 2, 10],
      [2, 3, 10],
      [4, 4, 2],
      [5, 5, 0],
      [5, 6, 0],
      [5, 7, 0],
      [5, 8, 0],
    ]);
    expect(winners(grades)).toEqual([1]);
  });

  it('names every team on a shared first place', () => {
    expect(winners({ '0:2': g(9), '0:5': g(9) })).toEqual([2, 5]);
  });
});
