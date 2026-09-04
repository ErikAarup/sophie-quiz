import { ALL_TEAMS, TEAM_COUNT, teamsUpTo, type Grade, type StandingRow, type Team } from './types.ts';

/** Points = rank for ranks 1–10; ranks 11–15 and no match give 0 (WORK_ORDER §A). */
export function pointsForRank(rank: number | null): number {
  if (rank === null) return 0;
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) return 0;
  return rank;
}

/**
 * Cumulative points per team over every stored grade, for the `teamCount` teams in play. Grades
 * for a team outside the count (a state carried over from a larger game) are ignored, so the
 * board can never show points for a team that is not playing.
 */
export function totals(grades: Record<string, Grade>, teamCount: number = TEAM_COUNT): Record<Team, number> {
  const out = Object.fromEntries(ALL_TEAMS.map((t) => [t, 0])) as Record<Team, number>;
  const playing = teamsUpTo(teamCount);
  for (const [key, grade] of Object.entries(grades)) {
    const team = Number(key.split(':')[1]) as Team;
    if (playing.includes(team)) out[team] += grade.points;
  }
  return out;
}

/**
 * Standings sorted by points, then team number for a stable display.
 * Ties share a position ("1224" competition ranking): position = 1 + number of teams with strictly more points.
 */
export function standings(grades: Record<string, Grade>, teamCount: number = TEAM_COUNT): StandingRow[] {
  const t = totals(grades, teamCount);
  const sorted = [...teamsUpTo(teamCount)].sort((a, b) => t[b] - t[a] || a - b);
  return sorted.map((team) => ({
    team,
    points: t[team],
    position: 1 + sorted.filter((other) => t[other] > t[team]).length,
  }));
}

/** Teams sharing the top total. Usually one; a tie names them all. */
export function winners(grades: Record<string, Grade>, teamCount: number = TEAM_COUNT): Team[] {
  const rows = standings(grades, teamCount);
  return rows.filter((r) => r.position === 1).map((r) => r.team);
}
