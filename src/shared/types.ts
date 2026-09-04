// Domain and wire types shared by the Durable Object, the clients and the tests.
// The DO is the single source of truth; clients render what they are sent (WORK_ORDER §B).

/** The count a new game starts with, and the one an older persisted state is migrated to. */
export const TEAM_COUNT = 8;
export const MIN_TEAM_COUNT = 2;
export const MAX_TEAM_COUNT = 12;
export type Team = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/**
 * Every team number the wire type allows — the key space of the per-team records, not the teams
 * in play. How many are playing is `GameState.teamCount`; iterate with `teamsUpTo(count)`.
 * (WO-084: the old `TEAMS` meant "the eight teams", so it was renamed rather than widened —
 * the compiler then had to be shown every place that assumed eight.)
 */
export const ALL_TEAMS: readonly Team[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const MAX_ANSWER_LENGTH = 80;

/** A team number the protocol knows (1..12). Whether it is *in play* also needs the count. */
export function isTeam(x: unknown): x is Team {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= MAX_TEAM_COUNT;
}

export function isTeamCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= MIN_TEAM_COUNT && x <= MAX_TEAM_COUNT;
}

/** Force any stored/received number into the allowed range (used when migrating old state). */
export function clampTeamCount(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return TEAM_COUNT;
  return Math.min(MAX_TEAM_COUNT, Math.max(MIN_TEAM_COUNT, Math.round(x)));
}

/** The teams in play, in order: `[1..count]`. */
export function teamsUpTo(count: number): readonly Team[] {
  return ALL_TEAMS.slice(0, clampTeamCount(count));
}

export function teamName(team: Team): string {
  return `Lag ${team}`;
}

export type Phase = 'lobby' | 'open' | 'locked' | 'grading' | 'reveal' | 'standings' | 'final';

// ---------- Quiz content (from data/bank.json + data/quiz.json, bundled) ----------

export interface QuizRow {
  rank: number; // 1..15, ties allowed (two rows may share a rank)
  name: string; // name_sv, the row label and the grader's target
  value: string; // raw value from the bank, e.g. "83 577 100"
  unit: string; // e.g. "invånare"
  label: string; // formatted right-hand value, e.g. "83,6 milj"
}

export interface QuizQuestion {
  slug: string;
  title: string; // title_sv — reveal heading
  question: string; // host_question_sv — what the phone shows during the question
  definition: string; // definition_sv — small print
  source: string; // source_name
  rows: QuizRow[]; // sorted by rank, then bank order
  topCount: number; // rows with rank <= 10 (10, or more with a tie at the edge)
  aliases: Record<string, string[]>; // row name -> extra spellings (data/aliases.json)
}

export interface Quiz {
  questions: QuizQuestion[];
  durationMs: number;
}

// ---------- Persisted game state (Durable Object storage) ----------

export interface Slot {
  deviceId: string;
  claimedAt: number;
}

export interface Answer {
  text: string;
  updatedAt: number;
  source: 'team' | 'admin';
}

export interface Grade {
  rank: number | null; // matched row's rank (1..15), null = utanför listan / unresolved
  rowIndex: number | null; // index into question.rows, for reveal highlighting
  points: number; // rank 1..10 -> rank; otherwise 0
  manual: boolean; // set by Erik (override); the model never overwrites a manual grade
  needsReview: boolean; // grader could not resolve ("ogranskad") — Erik sets it by hand
  reason: string;
  gradedText: string; // the answer text this grade belongs to (stale grades are dropped)
}

export type GradeStatus = 'idle' | 'running' | 'done' | 'failed';

/**
 * One call to the grader. The id is the request's identity: the result echoes it back, and a
 * result whose id is no longer outstanding is ignored, so a late answer to an abandoned request
 * (reset question, changed text) can never settle or disturb a later one.
 */
export interface GradeRequest {
  id: number;
  questionIndex: number;
  answers: { team: Team; text: string }[];
}

export interface GameState {
  v: 1;
  phase: Phase;
  /** How many teams play tonight (2..12). Set from admin before question 1; survives a game reset. */
  teamCount: number;
  questionIndex: number; // 0-based. In 'lobby' it is the question that "Starta fråga N" will open.
  deadlineAt: number | null; // epoch ms while the clock runs (open, not paused); kept after lock for display
  pausedRemainingMs: number | null; // set while paused
  totalMs: number; // question length incl. extensions — the ring's denominator
  revealed: number; // rows revealed from the top (0..topCount). At topCount the near misses show too.
  slots: Record<Team, Slot | null>;
  /**
   * Per-slot claim generation. Bumped on every release and reset, so a phone that stored
   * "I am Lag 3" while offline cannot walk back onto the slot: its remembered token no longer
   * matches and its automatic re-claim is refused (an explicit tap is a fresh claim).
   */
  claimGen: Record<Team, number>;
  answers: Record<string, Answer>; // key `${questionIndex}:${team}`
  grades: Record<string, Grade>; // same key
  gradeStatus: Record<string, GradeStatus>; // key `${questionIndex}`
  /** Id given to the next grade request. Never rewinds, not even on a full reset, so ids never repeat. */
  gradeSeq: number;
  /**
   * Grade requests sent but not yet answered, by id. Persisted with the state: a Worker restart
   * re-sends exactly these. The reveal starts, and "Nästa fråga" is allowed, only when none is
   * left for the current question.
   */
  gradeInFlight: Record<string, GradeRequest>;
  /** Whether any grade batch for the question failed (→ status 'failed' once settled). */
  gradeFailed: Record<string, boolean>;
  updatedAt: number;
}

export function answerKey(questionIndex: number, team: Team): string {
  return `${questionIndex}:${team}`;
}

// ---------- Wire protocol: client -> server ----------

export type ClientMessage =
  | { type: 'hello'; role: 'player'; deviceId: string; team: Team | null; token?: number | null }
  | { type: 'hello'; role: 'admin'; token: string }
  | { type: 'claim'; team: Team; deviceId: string }
  | { type: 'leave' } // player gives up its slot voluntarily (not in the spec's UI; kept for tests)
  | { type: 'answer'; text: string }
  | { type: 'ping' }
  | AdminMessage;

export type AdminMessage = { token: string } & AdminCommand;

export type AdminCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'extend'; ms?: number }
  | { type: 'lock' }
  | { type: 'grade' }
  | { type: 'revealNext' }
  | { type: 'revealAll' }
  | { type: 'standings' }
  | { type: 'backToReveal' }
  | { type: 'next' }
  | { type: 'release'; team: Team }
  | { type: 'manualAnswer'; team: Team; text: string }
  | { type: 'override'; team: Team; rank: number } // 0 = utanför listan, 1..15 = row rank
  | { type: 'resetQuestion'; confirm: string }
  | { type: 'resetGame'; confirm: string }
  | { type: 'setTeamCount'; count: number };

export const CONFIRM_WORD = 'NOLLSTÄLL';

// ---------- Wire protocol: server -> client ----------

export interface RowView {
  rank: number;
  name: string | null; // null while hidden (player view only)
  label: string | null;
  near: boolean; // rank > 10 (nära skott)
}

export interface StandingRow {
  position: number; // ties share a position (1, 2, 2, 4 ...)
  team: Team;
  points: number;
}

export interface QuestionView {
  number: number; // 1-based
  slug: string;
  title: string;
  question: string;
  definition: string;
  source: string;
  topCount: number;
  rowCount: number;
}

export interface BaseStateView {
  type: 'state';
  serverNow: number;
  phase: Phase;
  questionIndex: number;
  questionCount: number;
  teamCount: number;
  question: QuestionView | null;
  deadlineAt: number | null;
  pausedRemainingMs: number | null;
  totalMs: number;
  revealed: number;
  visibleRows: number; // how many entries of `rows` are visible (players get names only for those)
  rows: RowView[];
  standings: StandingRow[];
  winners: Team[]; // non-empty only in 'final'
}

export type PlayerResult =
  | { kind: 'none' } // no answer for this question
  | { kind: 'pending' } // graded, but the row is not revealed yet
  | { kind: 'hit'; rank: number; points: number; rowName: string }
  | { kind: 'miss' } // utanför listan, 0 points
  | { kind: 'review' }; // grader could not decide; Erik will set it by hand

export interface PlayerStateView extends BaseStateView {
  role: 'player';
  team: Team | null;
  /** Claim generation of the own slot; the phone stores it and sends it back in `hello`. */
  claimToken: number | null;
  taken: Team[]; // slots claimed by a different device (for the tiles)
  answer: string | null; // this team's answer for the current question
  answerSource: 'team' | 'admin' | null;
  result: PlayerResult;
  last: string | null; // standings footer, e.g. "Senaste: Portugal, plats 10, +10 poäng"
}

export type TeamStatus = 'ledig' | 'offline' | 'väntar' | 'svar';

export interface AdminTeamView {
  team: Team;
  claimed: boolean;
  online: boolean;
  status: TeamStatus;
  answer: string | null;
  answerSource: 'team' | 'admin' | null;
  grade: {
    rank: number | null;
    points: number;
    manual: boolean;
    needsReview: boolean;
    rowName: string | null;
  } | null;
  total: number; // cumulative points
}

/** Why "Antal lag" cannot be changed right now, or null when it can (WO-084 AC1). */
export type TeamCountLock = 'started' | 'held';

export interface AdminStateView extends BaseStateView {
  role: 'admin';
  teams: AdminTeamView[];
  gradeStatus: GradeStatus;
  /** null = the stepper is live. Otherwise the reason, so the client shows what the server would say. */
  teamCountLock: TeamCountLock | null;
}

export type ServerMessage =
  | PlayerStateView
  | AdminStateView
  | { type: 'error'; code: string; message: string }
  | { type: 'released'; message: string } // your slot was released: go back to the tiles
  | { type: 'ok'; of: string }
  | { type: 'pong' };
