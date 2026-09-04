// Fixtures for the unit suite (WO-083 A2). The quiz under test is built here, by slug, from
// `data/bank.json` with its own alias table — never from `data/quiz.json`. Erik swaps the ten
// lists in `quiz.json` on the Friday; these tests must keep passing whatever he picks, and in
// whatever order. `data/quiz.json` itself is checked by exactly one test: test/unit/data.test.ts.
import { buildQuestion, listBySlug } from '../../src/worker/bank.ts';
import { initialState, reduce, type GameEvent, type Outcome } from '../../src/shared/game.ts';
import { ALL_TEAMS, teamsUpTo, type GameState, type Quiz, type Team } from '../../src/shared/types.ts';
import { TEST_QUESTIONS } from '../fixtures/questions.ts';

/** Ten bank lists, in a fixed order. Question 1 is the EU list every expectation below is written against. */
export const FIXTURE_SLUGS: readonly string[] = TEST_QUESTIONS;

/**
 * The fixture's own aliases, inline rather than read from `data/aliases.json` — that file belongs
 * to the list session too, so a pre-pass test must not depend on what it happens to contain.
 */
const FIXTURE_ALIASES: Record<string, Record<string, string[]>> = {
  'most-populous-eu-countries': {
    Tyskland: ['Germany', 'Deutschland'],
    Frankrike: ['France'],
    Italien: ['Italy', 'Italia'],
    Spanien: ['Spain', 'España'],
    Polen: ['Poland', 'Polska'],
    Rumänien: ['Romania'],
    Nederländerna: ['Netherlands', 'The Netherlands', 'Holland', 'Nederland'],
    Belgien: ['Belgium'],
    Tjeckien: ['Czechia', 'Czech Republic', 'Tjeckiska republiken', 'Czech'],
    Portugal: [],
    Sverige: ['Sweden'],
    Grekland: ['Greece', 'Hellas'],
    Ungern: ['Hungary'],
    Österrike: ['Austria'],
    Bulgarien: ['Bulgaria'],
  },
};

export const FIXTURE_DURATION_MS = 150_000;

/** Build a quiz from `data/bank.json` by slug. Throws by name if the bank no longer has a list. */
export function quizFromSlugs(slugs: readonly string[], durationMs = FIXTURE_DURATION_MS): Quiz {
  const questions = slugs.map((slug) => {
    const list = listBySlug(slug);
    if (!list) throw new Error(`fixture: data/bank.json has no list with slug "${slug}"`);
    return buildQuestion(list, FIXTURE_ALIASES[slug] ?? {});
  });
  return { questions, durationMs };
}

export const quiz: Quiz = quizFromSlugs(FIXTURE_SLUGS);
/** Question 1 of the fixture: "EU:s folkrikaste länder" (Tyskland 1 … Portugal 10 … Sverige 11). */
export const eu = quiz.questions[0]!;
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

/** Every team in play takes a tile (WO-084: as many as `state.teamCount` says, not always eight). */
export function claimAll(state: GameState, now = T0): GameState {
  const events: GameEvent[] = teamsUpTo(state.teamCount).map((team) => ({
    type: 'claim',
    team,
    deviceId: `dev-${team}`,
  }));
  return run(state, events, now);
}

/** Presence record for `adminView`: keyed over the whole 1..12 space, everyone online. */
export function allOnline(): Record<Team, boolean> {
  return Object.fromEntries(ALL_TEAMS.map((t) => [t, true])) as Record<Team, boolean>;
}
