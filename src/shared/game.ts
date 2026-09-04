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
  type GradeRequest,
  type Quiz,
  type Team,
} from './types.ts';

export type { GradeRequest } from './types.ts';

export const DEFAULT_EXTEND_MS = 30_000;

export type GameEvent =
  | {
      type: 'claim';
      team: Team;
      deviceId: string;
      /** Automatic re-claim on reconnect (hello): must present the token the phone was given. */
      auto?: boolean;
      token?: number | null;
    }
  | { type: 'release'; team: Team }
  | { type: 'answer'; team: Team; text: string; source: 'team' | 'admin' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'extend'; ms?: number }
  | { type: 'lock' }
  | { type: 'alarm' }
  | { type: 'tick' } // "check the clock", nothing else (used for pings)
  | { type: 'grade' }
  /** The grader's answer to the request with that id. An id that is not outstanding is ignored. */
  | { type: 'gradeResult'; requestId: number; results: GradeResultRow[]; failed: boolean }
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

export type KickReason = 'release' | 'moved' | 'reset';

export interface Outcome {
  state: GameState;
  changed: boolean;
  /** Swedish message for the sender when the event was refused. */
  error?: { code: string; message: string };
  /** `number` = set the alarm at that time, `null` = clear it, absent = leave it. */
  alarm?: number | null;
  /** Devices whose binding to a team ended; the DO tells those sockets to go back to the tiles. */
  kicked: { team: Team; deviceId: string; reason: KickReason }[];
  /** Answers the DO must send to the grader now. */
  grade?: GradeRequest;
}

const ZERO_BY_TEAM = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 } as Record<Team, number>;

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
    claimGen: { ...ZERO_BY_TEAM },
    answers: {},
    grades: {},
    gradeStatus: {},
    gradeSeq: 0,
    gradeInFlight: {},
    gradeFailed: {},
    updatedAt: now,
  };
}

/** Fill in fields a state persisted by an earlier build may lack. */
export function migrateState(stored: Partial<GameState> & { v: 1 }, now: number): GameState {
  const base = initialState(now);
  const state: GameState = {
    ...base,
    ...stored,
    slots: { ...base.slots, ...(stored.slots ?? {}) },
    claimGen: { ...base.claimGen, ...(stored.claimGen ?? {}) },
    answers: stored.answers ?? {},
    grades: stored.grades ?? {},
    gradeStatus: stored.gradeStatus ?? {},
    gradeSeq: typeof stored.gradeSeq === 'number' ? stored.gradeSeq : 0,
    gradeInFlight: stored.gradeInFlight ?? {},
    gradeFailed: stored.gradeFailed ?? {},
  };
  // Builds before request ids kept a bare `gradePending` counter; it carries no requests to resend.
  delete (state as unknown as Record<string, unknown>)['gradePending'];
  return state;
}

/** Grade requests still unanswered for a question (all of them if no question is given). */
export function gradesInFlight(state: GameState, questionIndex?: number): number {
  let n = 0;
  for (const req of Object.values(state.gradeInFlight)) {
    if (questionIndex === undefined || req.questionIndex === questionIndex) n += 1;
  }
  return n;
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
  delete state.gradeFailed[String(questionIndex)];
  // Requests still out for this question are abandoned: their ids are forgotten here, so their
  // results, whenever they arrive, are ignored rather than settling a later request.
  for (const [id, req] of Object.entries(state.gradeInFlight)) {
    if (req.questionIndex === questionIndex) delete state.gradeInFlight[id];
  }
}

function gradeFromRow(quiz: Quiz, questionIndex: number, rowIndex: number | null, opts: { manual: boolean; needsReview: boolean; reason: string; gradedText: string }): Grade {
  const question = quiz.questions[questionIndex];
  const row = rowIndex !== null && question ? (question.rows[rowIndex] ?? null) : null;
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
  // The clock is checked before every event. If it just ran out, that lock is part of this
  // outcome even when the event itself is refused (a late alarm must never leave the game open).
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
  const refuse = (code: string, message: string): Outcome => {
    const out = done();
    out.error = { code, message };
    return out;
  };
  /** Hand answers to the grader under a fresh id; the id stays outstanding until its result lands. */
  const requestGrade = (answers: GradeRequest['answers']): void => {
    const id = state.gradeSeq;
    state.gradeSeq += 1;
    const req: GradeRequest = { id, questionIndex: qi, answers };
    state.gradeInFlight[String(id)] = req;
    state.gradeStatus[String(qi)] = 'running';
    grade = req;
  };

  switch (event.type) {
    case 'claim': {
      if (!isTeam(event.team)) return refuse('badTeam', 'Ogiltigt lag.');
      const slot = state.slots[event.team];
      if (slot && slot.deviceId !== event.deviceId) {
        return refuse('taken', `${teamName(event.team)} är redan taget`);
      }
      if (event.auto) {
        // A remembered claim is only honoured while its generation is current: a release or a
        // reset while the phone was away invalidates it.
        if (event.token !== state.claimGen[event.team]) {
          return refuse('stale', `Erik släppte ${teamName(event.team)}. Välj lag igen.`);
        }
      }
      // One slot per device: a device that already holds another team is moved, and the socket
      // bound to that other team is told to go back to the tiles.
      for (const other of TEAMS) {
        if (other === event.team) continue;
        const s = state.slots[other];
        if (s && s.deviceId === event.deviceId) {
          state.slots[other] = null;
          state.claimGen[other] += 1;
          kicked.push({ team: other, deviceId: event.deviceId, reason: 'moved' });
          changed = true;
        }
      }
      if (!slot) {
        state.slots[event.team] = { deviceId: event.deviceId, claimedAt: now };
        changed = true;
      }
      return done();
    }

    case 'release': {
      if (!isTeam(event.team)) return refuse('badTeam', 'Ogiltigt lag.');
      const slot = state.slots[event.team];
      if (slot) {
        kicked.push({ team: event.team, deviceId: slot.deviceId, reason: 'release' });
        state.slots[event.team] = null;
        state.claimGen[event.team] += 1;
        changed = true;
      }
      return done();
    }

    case 'answer': {
      if (!isTeam(event.team)) return refuse('badTeam', 'Ogiltigt lag.');
      const text = event.text.trim().slice(0, MAX_ANSWER_LENGTH);
      if (event.source === 'team') {
        if (state.phase === 'lobby' || state.phase === 'final') return refuse('notOpen', 'Frågan har inte startat än.');
        if (state.phase !== 'open') return refuse('locked', 'Tiden är ute – svaret togs inte emot.');
      } else if (!questionActive(state)) {
        return refuse('notOpen', 'Ingen fråga pågår.');
      }
      if (!text) return refuse('empty', 'Skriv ett svar först.');
      const key = answerKey(qi, event.team);
      const answer: Answer = { text, updatedAt: now, source: event.source };
      state.answers[key] = answer;
      changed = true;
      // A new text makes any earlier grade stale. If the question is already graded, grade this one now.
      const existing = state.grades[key];
      if (existing && existing.gradedText !== text) delete state.grades[key];
      if (event.source === 'admin' && state.phase !== 'open' && !state.grades[key]) {
        requestGrade([{ team: event.team, text }]);
      }
      return done();
    }

    case 'start': {
      if (state.phase !== 'lobby') return refuse('phase', 'En fråga pågår redan.');
      if (!question) return refuse('noQuestion', 'Det finns ingen fråga kvar.');
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
        return refuse('phase', 'Klockan går inte.');
      }
      state.pausedRemainingMs = Math.max(0, state.deadlineAt - now);
      state.deadlineAt = null;
      alarm = null;
      changed = true;
      return done();
    }

    case 'resume': {
      if (state.phase !== 'open' || state.pausedRemainingMs === null) return refuse('phase', 'Klockan är inte pausad.');
      state.deadlineAt = now + state.pausedRemainingMs;
      state.pausedRemainingMs = null;
      alarm = state.deadlineAt;
      changed = true;
      return done();
    }

    case 'extend': {
      if (state.phase !== 'open') return refuse('phase', 'Frågan är inte öppen.');
      const ms = event.ms ?? DEFAULT_EXTEND_MS;
      if (!Number.isFinite(ms) || ms <= 0 || ms > 10 * 60_000) return refuse('badExtend', 'Ogiltig förlängning.');
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
      if (state.phase !== 'open') return refuse('phase', 'Frågan är inte öppen.');
      state.phase = 'locked';
      state.pausedRemainingMs = null;
      alarm = null;
      changed = true;
      return done();
    }

    case 'alarm':
    case 'tick': {
      // autoLock already ran. An alarm that fired early leaves the alarm alone; the DO re-arms it.
      return done();
    }

    case 'grade': {
      if (state.phase === 'open' || state.phase === 'lobby' || state.phase === 'final') return refuse('phase', 'Svaren måste vara låsta först.');
      if (state.phase === 'grading' || gradesInFlight(state, qi) > 0) return refuse('busy', 'Rättning pågår.');
      if (!question) return refuse('noQuestion', 'Ingen fråga.');
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
      delete state.gradeFailed[String(qi)];
      requestGrade(answers);
      changed = true;
      return done();
    }

    case 'gradeResult': {
      const id = String(event.requestId);
      const req = state.gradeInFlight[id];
      // Not outstanding: the question was reset, or the id was never issued. Nothing it says
      // may touch the game (the R3 review's route B), and it settles nothing.
      if (!req) return done();
      delete state.gradeInFlight[id];
      const rqi = req.questionIndex;
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
      if (event.failed) state.gradeFailed[String(rqi)] = true;
      if (gradesInFlight(state, rqi) === 0) {
        // Every outstanding request for the question has settled: now, and only now, the reveal
        // may start.
        state.gradeStatus[String(rqi)] = state.gradeFailed[String(rqi)] ? 'failed' : 'done';
        if (rqi === qi && state.phase === 'grading') {
          state.phase = 'reveal';
          state.revealed = 0;
        }
      }
      changed = true;
      return done();
    }

    case 'override': {
      if (!isTeam(event.team)) return refuse('badTeam', 'Ogiltigt lag.');
      if (!questionActive(state) || !question) return refuse('phase', 'Ingen fråga pågår.');
      const rank = event.rank;
      if (!Number.isInteger(rank) || rank < 0 || rank > 15) return refuse('badRank', 'Plats måste vara 0–15.');
      const key = answerKey(qi, event.team);
      const rowIndex = rank === 0 ? null : question.rows.findIndex((r) => r.rank === rank);
      if (rank !== 0 && rowIndex === -1) return refuse('noRow', `Listan har ingen plats ${rank}.`);
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
      if (state.phase !== 'reveal' || !question) return refuse('phase', 'Inget avslöjande pågår.');
      if (state.revealed >= question.topCount) return refuse('done', 'Hela listan är visad.');
      state.revealed += 1;
      changed = true;
      return done();
    }

    case 'revealAll': {
      if (state.phase !== 'reveal' || !question) return refuse('phase', 'Inget avslöjande pågår.');
      if (state.revealed !== question.topCount) {
        state.revealed = question.topCount;
        changed = true;
      }
      return done();
    }

    case 'standings': {
      if (state.phase !== 'reveal') return refuse('phase', 'Visa ställningen efter avslöjandet.');
      state.phase = 'standings';
      changed = true;
      return done();
    }

    case 'backToReveal': {
      if (state.phase !== 'standings') return refuse('phase', 'Ställningen visas inte.');
      state.phase = 'reveal';
      changed = true;
      return done();
    }

    case 'next': {
      if (state.phase !== 'standings' && state.phase !== 'reveal') return refuse('phase', 'Avsluta frågan först.');
      // A hand-typed answer may still be with the grader (SPELLEDNING: "även efter att ställningen
      // visats"). Moving on now would leave that team's points for this question ungraded for
      // good, so the request must land first. Never silent: admin shows this message.
      if (gradesInFlight(state, qi) > 0) return refuse('busy', 'Rättning pågår – vänta några sekunder och tryck igen.');
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
      if (event.confirm !== CONFIRM_WORD) return refuse('confirm', 'Bekräfta med NOLLSTÄLL.');
      if (state.phase === 'lobby') return refuse('phase', 'Frågan har inte startat.');
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
      if (event.confirm !== CONFIRM_WORD) return refuse('confirm', 'Bekräfta med NOLLSTÄLL.');
      for (const team of TEAMS) {
        const slot = state.slots[team];
        if (slot) kicked.push({ team, deviceId: slot.deviceId, reason: 'reset' });
      }
      const fresh = initialState(now);
      // Generations keep counting up across resets, so no phone's remembered claim survives one.
      for (const team of TEAMS) fresh.claimGen[team] = state.claimGen[team] + 1;
      // Request ids keep counting too: a grader answer to a pre-reset request must never match
      // a request made after it.
      fresh.gradeSeq = state.gradeSeq;
      return { state: fresh, changed: true, alarm: null, kicked };
    }

    default: {
      const never: never = event;
      return refuse('unknown', `Okänt kommando ${(never as { type?: string }).type ?? ''}`);
    }
  }
}
