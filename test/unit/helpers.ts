import { buildQuiz } from '../../src/worker/bank.ts';
import { initialState, reduce, type GameEvent, type Outcome } from '../../src/shared/game.ts';
import type { GameState, Quiz, Team } from '../../src/shared/types.ts';
import { TEST_QUESTIONS } from '../fixtures/questions.ts';

/** The pinned test ten (question 1 = the EU list), not the evening's quiz.json. */
export const quiz: Quiz = buildQuiz({ questions: TEST_QUESTIONS });
export const T0 = 1_700_000_000_000; // a fixed "now"

/** Apply events in order; throw on the first refusal so tests stay short. */
export function run(state: GameState, events: GameEvent[], now: number, q: Quiz = quiz): GameState {
  let s = state;
  for (const e of events) {
    const out = reduce(s, e, now, q);
    if (out.error) throw new Error(`${e.type} refused: ${out.error.code} ${out.error.message}`);
    s = out.state;
  }
  return s;
}

export function step(state: GameState, event: GameEvent, now: number, q: Quiz = quiz): Outcome {
  return reduce(state, event, now, q);
}

export function fresh(now = T0): GameState {
  return initialState(now);
}

export function claimAll(state: GameState, now = T0): GameState {
  const events: GameEvent[] = ([1, 2, 3, 4, 5, 6, 7, 8] as Team[]).map((team) => ({
    type: 'claim',
    team,
    deviceId: `dev-${team}`,
  }));
  return run(state, events, now);
}
