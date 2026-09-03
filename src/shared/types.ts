// Domain and wire types shared by the Durable Object, the clients and the tests.
// The DO is the single source of truth; clients render what they are sent (WORK_ORDER §B).

export const TEAM_COUNT = 8;
export type Team = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const TEAMS: readonly Team[] = [1, 2, 3, 4, 5, 6, 7, 8];
export const MAX_ANSWER_LENGTH = 80;

export function isTeam(x: unknown): x is Team {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= TEAM_COUNT;
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

export interface GameState {
  v: 1;
  phase: Phase;
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
  /** Grade requests in flight for the current question; reveal starts only when it reaches 0. */
  gradePending: number;
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
  | { type: 'resetGame'; confirm: string };

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

export interface AdminStateView extends BaseStateView {
  role: 'admin';
  teams: AdminTeamView[];
  gradeStatus: GradeStatus;
}

export type ServerMessage =
  | PlayerStateView
  | AdminStateView
  | { type: 'error'; code: string; message: string }
  | { type: 'released'; message: string } // your slot was released: go back to the tiles
  | { type: 'ok'; of: string }
  | { type: 'pong' };
