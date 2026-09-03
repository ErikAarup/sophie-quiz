// Per-role projections of the game state. Players only ever receive what their phone may show
// (hidden rows stay hidden, their own grade appears the moment the row is revealed).

import { gradesInFlight } from './game.ts';
import { standings as computeStandings, totals, winners } from './scoring.ts';
import {
  TEAMS,
  answerKey,
  type AdminStateView,
  type AdminTeamView,
  type BaseStateView,
  type GameState,
  type PlayerResult,
  type PlayerStateView,
  type Quiz,
  type QuizQuestion,
  type RowView,
  type Team,
  type TeamStatus,
} from './types.ts';

/** How many rows are visible: the revealed top rows, and everything once the top is complete. */
export function visibleRowCount(state: GameState, question: QuizQuestion | undefined): number {
  if (!question) return 0;
  if (state.phase !== 'reveal' && state.phase !== 'standings' && state.phase !== 'final') return 0;
  return state.revealed >= question.topCount ? question.rows.length : state.revealed;
}

function base(state: GameState, quiz: Quiz, now: number, maskHidden: boolean): BaseStateView {
  const question = quiz.questions[state.questionIndex];
  const visible = visibleRowCount(state, question);
  // Players never see the next question's text (nor its row shape) before Erik starts it; admin
  // needs it for "Nästa lista".
  const questionVisible = question !== undefined && !(maskHidden && state.phase === 'lobby');
  const rows: RowView[] = questionVisible
    ? question.rows.map((row, i) => ({
        rank: row.rank,
        name: !maskHidden || i < visible ? row.name : null,
        label: !maskHidden || i < visible ? row.label : null,
        near: row.rank > 10,
      }))
    : [];
  return {
    type: 'state',
    serverNow: now,
    phase: state.phase,
    questionIndex: state.questionIndex,
    questionCount: quiz.questions.length,
    question: questionVisible
      ? {
          number: state.questionIndex + 1,
          slug: question.slug,
          title: question.title,
          question: question.question,
          definition: question.definition,
          source: question.source,
          topCount: question.topCount,
          rowCount: question.rows.length,
        }
      : null,
    deadlineAt: state.deadlineAt,
    pausedRemainingMs: state.pausedRemainingMs,
    totalMs: state.totalMs,
    revealed: state.revealed,
    visibleRows: visible,
    rows,
    standings: computeStandings(state.grades),
    winners: state.phase === 'final' ? winners(state.grades) : [],
  };
}

function playerResult(state: GameState, question: QuizQuestion | undefined, team: Team): PlayerResult {
  const key = answerKey(state.questionIndex, team);
  const answer = state.answers[key];
  if (!answer) return { kind: 'none' };
  const grade = state.grades[key];
  const visible = visibleRowCount(state, question);
  const allShown = question ? visible >= question.rows.length : false;
  if (!grade) return { kind: 'pending' };
  if (grade.needsReview) return allShown ? { kind: 'review' } : { kind: 'pending' };
  if (grade.rowIndex === null) return allShown ? { kind: 'miss' } : { kind: 'pending' };
  if (grade.rowIndex < visible && question) {
    const row = question.rows[grade.rowIndex];
    return { kind: 'hit', rank: grade.rank ?? 0, points: grade.points, rowName: row ? row.name : answer.text };
  }
  return { kind: 'pending' };
}

function lastLine(state: GameState, question: QuizQuestion | undefined, team: Team): string | null {
  if (state.phase !== 'standings' && state.phase !== 'final') return null;
  const key = answerKey(state.questionIndex, team);
  const answer = state.answers[key];
  if (!answer) return 'Senaste: inget svar, 0 poäng';
  const grade = state.grades[key];
  if (!grade || grade.needsReview) return `Senaste: ${answer.text}, rättas av Erik`;
  if (grade.rank === null) return `Senaste: ${answer.text}, utanför listan, 0 poäng`;
  return `Senaste: ${answer.text}, plats ${grade.rank}, +${grade.points} poäng`;
}

export function playerView(state: GameState, quiz: Quiz, now: number, team: Team | null, deviceId: string | null): PlayerStateView {
  const question = quiz.questions[state.questionIndex];
  const taken = TEAMS.filter((t) => {
    const slot = state.slots[t];
    return slot !== null && slot.deviceId !== deviceId;
  });
  const key = team ? answerKey(state.questionIndex, team) : null;
  const answer = key ? state.answers[key] : undefined;
  return {
    ...base(state, quiz, now, true),
    role: 'player',
    team,
    claimToken: team ? state.claimGen[team] : null,
    taken,
    answer: answer?.text ?? null,
    answerSource: answer?.source ?? null,
    result: team ? playerResult(state, question, team) : { kind: 'none' },
    last: team ? lastLine(state, question, team) : null,
  };
}

export function adminView(state: GameState, quiz: Quiz, now: number, online: Record<Team, boolean>): AdminStateView {
  const question = quiz.questions[state.questionIndex];
  const sums = totals(state.grades);
  const teams: AdminTeamView[] = TEAMS.map((team) => {
    const claimed = state.slots[team] !== null;
    const key = answerKey(state.questionIndex, team);
    const answer = state.answers[key];
    const grade = state.grades[key];
    // offline beats svar (§2.9: Erik must see a dropped phone), svar beats ledig (a hand-typed
    // answer for a team without a phone still counts as answered).
    let status: TeamStatus;
    if (claimed && !online[team]) status = 'offline';
    else if (answer) status = 'svar';
    else if (claimed) status = 'väntar';
    else status = 'ledig';
    return {
      team,
      claimed,
      online: claimed && online[team],
      status,
      answer: answer?.text ?? null,
      answerSource: answer?.source ?? null,
      grade: grade
        ? {
            rank: grade.rank,
            points: grade.points,
            manual: grade.manual,
            needsReview: grade.needsReview,
            rowName: grade.rowIndex !== null && question ? question.rows[grade.rowIndex]?.name ?? null : null,
          }
        : null,
      total: sums[team],
    };
  });
  return {
    ...base(state, quiz, now, false),
    role: 'admin',
    teams,
    gradeStatus: gradesInFlight(state, state.questionIndex) > 0 ? 'running' : (state.gradeStatus[String(state.questionIndex)] ?? 'idle'),
  };
}
