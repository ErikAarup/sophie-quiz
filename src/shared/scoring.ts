import { TEAMS, type Grade, type StandingRow, type Team } from './types.ts';

/** Points = rank for ranks 1–10; ranks 11–15 and no match give 0 (WORK_ORDER §A). */
export function pointsForRank(rank: number | null): number {
  if (rank === null) return 0;
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) return 0;
  return rank;
}

/** Cumulative points per team over every stored grade. */
export function totals(grades: Record<string, Grade>): Record<Team, number> {
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } as Record<Team, number>;
  for (const [key, grade] of Object.entries(grades)) {
    const team = Number(key.split(':')[1]) as Team;
    if (team >= 1 && team <= 8) out[team] += grade.points;
  }
  return out;
}

/**
 * Standings sorted by points, then team number for a stable display.
 * Ties share a position ("1224" competition ranking): position = 1 + number of teams with strictly more points.
 */
export function standings(grades: Record<string, Grade>): StandingRow[] {
  const t = totals(grades);
  const sorted = [...TEAMS].sort((a, b) => t[b] - t[a] || a - b);
  return sorted.map((team) => ({
    team,
    points: t[team],
    position: 1 + sorted.filter((other) => t[other] > t[team]).length,
  }));
}

/** Teams sharing the top total. Usually one; a tie names them all. */
export function winners(grades: Record<string, Grade>): Team[] {
  const rows = standings(grades);
  return rows.filter((r) => r.position === 1).map((r) => r.team);
}
