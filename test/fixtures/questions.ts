/**
 * The ten lists every test suite plays with, pinned so the evening's real data/quiz.json can
 * change without touching a test. Question 1 must stay the EU list: the unit, DO and e2e tests
 * script their answers against it (Portugal = rank 10, Tjeckien, Tyskland). The same ten are
 * spelled out as a JSON string under "vars" in e2e/wrangler.e2e.jsonc.
 */
export const TEST_QUESTIONS: string[] = [
  'most-populous-eu-countries',
  'largest-european-countries-by-area',
  'countries-by-population',
  'tallest-mountains-world',
  'swedish-municipalities-by-population',
  'countries-by-area',
  'largest-lakes-world',
  'highest-grossing-films-worldwide',
  'best-selling-game-consoles-all-time',
  'countries-by-nobel-laureates',
];
