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

  // WO-084 §2.2: the board is over the teams in play, whatever the count is.
  it('is computed over `teamCount` teams: positions, ties and winners all follow it', () => {
    const grades: Record<string, Grade> = { '0:1': g(4), '0:2': g(9), '0:5': g(10) };
    const rows = standings(grades, 3);
    expect(rows.map((r) => [r.position, r.team, r.points])).toEqual([
      [1, 2, 9],
      [2, 1, 4],
      [3, 3, 0],
    ]);
    // Lag 5's ten points are outside a three-team game and never reach the board.
    expect(totals(grades, 3)[5]).toBe(0);
    expect(winners(grades, 3)).toEqual([2]);
    // Twelve teams: everyone is listed, the absent ones on zero.
    expect(standings(grades, 12)).toHaveLength(12);
    expect(winners(grades, 12)).toEqual([5]);
  });
});
