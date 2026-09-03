// The game as a pure state machine. The Durable Object calls `reduce` for every event, persists
// the returned state, then applies the effects (alarm, kicked devices, grading). No I/O here, so
// every rule is unit-testable without a Worker (WORK_ORDER §5 "state machine").

import { pointsForRank } from './scoring.ts';
import {
  CONFIRM_WORD,
  MAX_ANSWER_LENGTH,
  TEAMS,
  answerKey,
  isTeam,
  teamName,
  type Answer,
  type GameState,
  type Grade,
  type Quiz,
  type Team,
} from './types.ts';

export const DEFAULT_EXTEND_MS = 30_000;

export type GameEvent =
  | { type: 'claim'; team: Team; deviceId: string }
  | { type: 'release'; team: Team }
  | { type: 'answer'; team: Team; text: string; source: 'team' | 'admin' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'extend'; ms?: number }
  | { type: 'lock' }
  | { type: 'alarm' }
  | { type: 'grade' }
  | { type: 'gradeResult'; questionIndex: number; results: GradeResultRow[]; failed: boolean }
  | { type: 'override'; team: Team; rank: number }
  | { type: 'revealNext' }
  | { type: 'revealAll' }
  | { type: 'standings' }
  | { type: 'backToReveal' }
  | { type: 'next' }
  | { type: 'resetQuestion'; confirm: string }
  | { type: 'resetGame'; confirm: string };

export interface GradeResultRow {
  team: Team;
  gradedText: string;
  rowIndex: number | null;
  needsReview: boolean;
  reason: string;
}

export interface GradeRequest {
  questionIndex: number;
  answers: { team: Team; text: string }[];
}

export interface Outcome {
  state: GameState;
  changed: boolean;
  /** Swedish message for the sender when the event was refused. */
  error?: { code: string; message: string };
  /** `number` = set the alarm at that time, `null` = clear it, absent = leave it. */
  alarm?: number | null;
  /** Devices whose slot was released; the DO tells them to go back to the tiles. */
  kicked: { team: Team; deviceId: string }[];
  /** Answers the DO must send to the grader now. */
  grade?: GradeRequest;
}

export function initialState(now: number): GameState {
  return {
    v: 1,
    phase: 'lobby',
    questionIndex: 0,
    deadlineAt: null,
    pausedRemainingMs: null,
    totalMs: 0,
    revealed: 0,
    slots: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null },
    answers: {},
    grades: {},
    gradeStatus: {},
    updatedAt: now,
  };
}

function refuse(state: GameState, code: string, message: string): Outcome {
  return { state, changed: false, error: { code, message }, kicked: [] };
}

/** Remaining clock time in ms as the server sees it (0 once locked). */
export function remainingMs(state: GameState, now: number): number {
  if (state.phase !== 'open') return 0;
  if (state.pausedRemainingMs !== null) return state.pausedRemainingMs;
  if (state.deadlineAt === null) return 0;
  return Math.max(0, state.deadlineAt - now);
}

/** If the clock has run out, lock — regardless of whether the alarm has fired yet. */
function autoLock(state: GameState, now: number): boolean {
  if (state.phase === 'open' && state.pausedRemainingMs === null && state.deadlineAt !== null && now >= state.deadlineAt) {
    state.phase = 'locked';
    return true;
  }
  return false;
}

function questionActive(state: GameState): boolean {
  return state.phase !== 'lobby' && state.phase !== 'final';
}

function clearQuestion(state: GameState, questionIndex: number): void {
  for (const key of Object.keys(state.answers)) {
    if (key.startsWith(`${questionIndex}:`)) delete state.answers[key];
  }
  for (const key of Object.keys(state.grades)) {
    if (key.startsWith(`${questionIndex}:`)) delete state.grades[key];
  }
  delete state.gradeStatus[String(questionIndex)];
}

function gradeFromRow(quiz: Quiz, questionIndex: number, rowIndex: number | null, opts: { manual: boolean; needsReview: boolean; reason: string; gradedText: string }): Grade {
  const question = quiz.questions[questionIndex];
  const row = rowIndex !== null && question ? question.rows[rowIndex] ?? null : null;
  const rank = row ? row.rank : null;
  return {
    rank,
    rowIndex: row ? rowIndex : null,
    points: pointsForRank(rank),
    manual: opts.manual,
    needsReview: opts.needsReview,
    reason: opts.reason,
    gradedText: opts.gradedText,
  };
}

export function reduce(prev: GameState, event: GameEvent, now: number, quiz: Quiz): Outcome {
  const state: GameState = structuredClone(prev);
  const kicked: Outcome['kicked'] = [];
  let changed = autoLock(state, now);
  let alarm: number | null | undefined = changed ? null : undefined;
  let grade: GradeRequest | undefined;

  const question = quiz.questions[state.questionIndex];
  const qi = state.questionIndex;

  const done = (): Outcome => {
    if (changed) state.updatedAt = now;
    const out: Outcome = { state, changed, kicked };
    if (alarm !== undefined) out.alarm = alarm;
    if (grade) out.grade = grade;
    return out;
  };

  switch (event.type) {
    case 'claim': {
      if (!isTeam(event.team)) return refuse(prev, 'badTeam', 'Ogiltigt lag.');
      const slot = state.slots[event.team];
      if (slot && slot.deviceId !== event.deviceId) {
        return refuse(prev, 'taken', `${teamName(event.team)} är redan taget`);
      }
      if (!slot) {
        state.slots[event.team] = { deviceId: event.deviceId, claimedAt: now };
        changed = true;
      }
      return done();
    }

    case 'release': {
      if (!isTeam(event.team)) return refuse(prev, 'badTeam', 'Ogiltigt lag.');
      const slot = state.slots[event.team];
      if (slot) {
        kicked.push({ team: event.team, deviceId: slot.deviceId });
        state.slots[event.team] = null;
        changed = true;
      }
      return done();
    }

    case 'answer': {
      if (!isTeam(event.team)) return refuse(prev, 'badTeam', 'Ogiltigt lag.');
      const text = event.text.trim().slice(0, MAX_ANSWER_LENGTH);
      if (!text) return refuse(prev, 'empty', 'Skriv ett svar först.');
      if (event.source === 'team') {
        if (state.phase === 'lobby' || state.phase === 'final') {
          return refuse(state, 'notOpen', 'Frågan har inte startat än.');
        }
        if (state.phase !== 'open') {
          // `state` (not `prev`) and `changed` carried over, so an auto-lock that just happened
          // is still persisted even though the answer itself is refused.
          const out = done();
          out.error = { code: 'locked', message: 'Tiden är ute – svaret togs inte emot.' };
          return out;
        }
      } else if (!questionActive(state)) {
        return refuse(state, 'notOpen', 'Ingen fråga pågår.');
      }
      const key = answerKey(qi, event.team);
      const answer: Answer = { text, updatedAt: now, source: event.source };
      state.answers[key] = answer;
      changed = true;
      // A new text makes any earlier grade stale. If the question is already graded, grade this one now.
      const existing = state.grades[key];
      if (existing && existing.gradedText !== text) delete state.grades[key];
      if (event.source === 'admin' && state.phase !== 'open' && !state.grades[key]) {
        grade = { questionIndex: qi, answers: [{ team: event.team, text }] };
      }
      return done();
    }

    case 'start': {
      if (state.phase !== 'lobby') return refuse(state, 'phase', 'En fråga pågår redan.');
      if (!question) return refuse(state, 'noQuestion', 'Det finns ingen fråga kvar.');
      state.phase = 'open';
      state.deadlineAt = now + quiz.durationMs;
      state.pausedRemainingMs = null;
      state.totalMs = quiz.durationMs;
      state.revealed = 0;
      alarm = state.deadlineAt;
      changed = true;
      return done();
    }

    case 'pause': {
      if (state.phase !== 'open' || state.pausedRemainingMs !== null || state.deadlineAt === null) {
        return refuse(state, 'phase', 'Klockan går inte.');
      }
      state.pausedRemainingMs = Math.max(0, state.deadlineAt - now);
      state.deadlineAt = null;
      alarm = null;
      changed = true;
      return done();
    }

    case 'resume': {
      if (state.phase !== 'open' || state.pausedRemainingMs === null) {
        return refuse(state, 'phase', 'Klockan är inte pausad.');
      }
      state.deadlineAt = now + state.pausedRemainingMs;
      state.pausedRemainingMs = null;
      alarm = state.deadlineAt;
      changed = true;
      return done();
    }

    case 'extend': {
      if (state.phase !== 'open') return refuse(state, 'phase', 'Frågan är inte öppen.');
      const ms = event.ms ?? DEFAULT_EXTEND_MS;
      if (!Number.isFinite(ms) || ms <= 0 || ms > 10 * 60_000) return refuse(state, 'badExtend', 'Ogiltig förlängning.');
      if (state.pausedRemainingMs !== null) {
        state.pausedRemainingMs += ms;
      } else if (state.deadlineAt !== null) {
        state.deadlineAt += ms;
        alarm = state.deadlineAt;
      }
      state.totalMs += ms;
      changed = true;
      return done();
    }

    case 'lock': {
      if (state.phase !== 'open') return refuse(state, 'phase', 'Frågan är inte öppen.');
      state.phase = 'locked';
      state.pausedRemainingMs = null;
      alarm = null;
      changed = true;
      return done();
    }

    case 'alarm': {
      // autoLock already ran; the alarm is consumed either way.
      alarm = null;
      return done();
    }

    case 'grade': {
      if (state.phase === 'open' || state.phase === 'lobby' || state.phase === 'final') {
        return refuse(state, 'phase', 'Svaren måste vara låsta först.');
      }
      if (state.phase === 'grading') return refuse(state, 'busy', 'Rättning pågår.');
      if (!question) return refuse(state, 'noQuestion', 'Ingen fråga.');
      const answers: GradeRequest['answers'] = [];
      for (const team of TEAMS) {
        const key = answerKey(qi, team);
        const answer = state.answers[key];
        const existing = state.grades[key];
        if (answer && !(existing && existing.manual)) answers.push({ team, text: answer.text });
      }
      if (state.phase === 'locked') {
        state.phase = 'grading';
        state.revealed = 0;
      }
      state.gradeStatus[String(qi)] = 'running';
      grade = { questionIndex: qi, answers };
      changed = true;
      return done();
    }

    case 'gradeResult': {
      const rqi = event.questionIndex;
      for (const r of event.results) {
        if (!isTeam(r.team)) continue;
        const key = answerKey(rqi, r.team);
        const answer = state.answers[key];
        if (!answer || answer.text !== r.gradedText) continue; // stale: text changed meanwhile
        const existing = state.grades[key];
        if (existing && existing.manual) continue; // Erik's word stands
        state.grades[key] = gradeFromRow(quiz, rqi, r.rowIndex, {
          manual: false,
          needsReview: r.needsReview,
          reason: r.reason,
          gradedText: r.gradedText,
        });
      }
      if (rqi === qi) {
        state.gradeStatus[String(qi)] = event.failed ? 'failed' : 'done';
        if (state.phase === 'grading') {
          state.phase = 'reveal';
          state.revealed = 0;
        }
      }
      changed = true;
      return done();
    }

    case 'override': {
      if (!isTeam(event.team)) return refuse(state, 'badTeam', 'Ogiltigt lag.');
      if (!questionActive(state) || !question) return refuse(state, 'phase', 'Ingen fråga pågår.');
      const rank = event.rank;
      if (!Number.isInteger(rank) || rank < 0 || rank > 15) return refuse(state, 'badRank', 'Plats måste vara 0–15.');
      const key = answerKey(qi, event.team);
      const rowIndex = rank === 0 ? null : question.rows.findIndex((r) => r.rank === rank);
      if (rank !== 0 && rowIndex === -1) return refuse(state, 'noRow', `Listan har ingen plats ${rank}.`);
      state.grades[key] = gradeFromRow(quiz, qi, rowIndex, {
        manual: true,
        needsReview: false,
        reason: 'Satt för hand av Erik',
        gradedText: state.answers[key]?.text ?? '',
      });
      changed = true;
      return done();
    }

    case 'revealNext': {
      if (state.phase !== 'reveal' || !question) return refuse(state, 'phase', 'Inget avslöjande pågår.');
      if (state.revealed >= question.topCount) return refuse(state, 'done', 'Hela listan är visad.');
      state.revealed += 1;
      changed = true;
      return done();
    }

    case 'revealAll': {
      if (state.phase !== 'reveal' || !question) return refuse(state, 'phase', 'Inget avslöjande pågår.');
      if (state.revealed !== question.topCount) {
        state.revealed = question.topCount;
        changed = true;
      }
      return done();
    }

    case 'standings': {
      if (state.phase !== 'reveal') return refuse(state, 'phase', 'Visa ställningen efter avslöjandet.');
      state.phase = 'standings';
      changed = true;
      return done();
    }

    case 'backToReveal': {
      if (state.phase !== 'standings') return refuse(state, 'phase', 'Ställningen visas inte.');
      state.phase = 'reveal';
      changed = true;
      return done();
    }

    case 'next': {
      if (state.phase !== 'standings' && state.phase !== 'reveal') {
        return refuse(state, 'phase', 'Avsluta frågan först.');
      }
      if (qi + 1 < quiz.questions.length) {
        state.phase = 'lobby';
        state.questionIndex = qi + 1;
        state.deadlineAt = null;
        state.pausedRemainingMs = null;
        state.totalMs = 0;
        state.revealed = 0;
      } else {
        state.phase = 'final';
        state.deadlineAt = null;
        state.pausedRemainingMs = null;
      }
      alarm = null;
      changed = true;
      return done();
    }

    case 'resetQuestion': {
      if (event.confirm !== CONFIRM_WORD) return refuse(state, 'confirm', 'Bekräfta med NOLLSTÄLL.');
      if (state.phase === 'lobby') return refuse(state, 'phase', 'Frågan har inte startat.');
      const target = state.phase === 'final' ? Math.max(0, quiz.questions.length - 1) : qi;
      clearQuestion(state, target);
      state.phase = 'lobby';
      state.questionIndex = target;
      state.deadlineAt = null;
      state.pausedRemainingMs = null;
      state.totalMs = 0;
      state.revealed = 0;
      alarm = null;
      changed = true;
      return done();
    }

    case 'resetGame': {
      if (event.confirm !== CONFIRM_WORD) return refuse(state, 'confirm', 'Bekräfta med NOLLSTÄLL.');
      for (const team of TEAMS) {
        const slot = state.slots[team];
        if (slot) kicked.push({ team, deviceId: slot.deviceId });
      }
      const fresh = initialState(now);
      return { state: fresh, changed: true, alarm: null, kicked };
    }

    default: {
      const never: never = event;
      return refuse(prev, 'unknown', `Okänt kommando ${(never as { type?: string }).type ?? ''}`);
    }
  }
}
