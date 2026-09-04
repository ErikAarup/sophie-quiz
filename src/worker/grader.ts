// Grader (WORK_ORDER §D): deterministic pre-pass first, then one model call for the remainder,
// structured output, bounded time, and a fallback that never blocks the game.
// Runtime-agnostic (Workers and Node): the SDK only needs `fetch`.

import Anthropic from '@anthropic-ai/sdk';
import type { GradeResultRow } from '../shared/game.ts';
import { buildPrepass } from '../shared/normalize.ts';
import type { QuizQuestion, Team } from '../shared/types.ts';

export interface GraderOptions {
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  /** Per-attempt timeout. Two attempts (SDK maxRetries: 1) must fit inside §2.5's 20 s. */
  timeoutMs?: number;
  model?: string;
  /** Test hook: replaces the SDK call. */
  callModel?: (input: ModelInput) => Promise<ModelOutput>;
}

export interface ModelInput {
  question: QuizQuestion;
  answers: { team: Team; text: string }[];
  prepassHits: { team: Team; text: string; row: number }[];
}

export interface ModelOutput {
  results: { team: number; row: number | null; reason: string }[];
}

export interface GraderOutcome {
  rows: GradeResultRow[];
  failed: boolean; // true if any answer had to be flagged for Erik
  usedModel: boolean;
  error?: string;
  model?: string;
}

export const GRADER_MODEL = 'claude-opus-5';
export const GRADER_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You grade answers for a Swedish pub quiz called "Topp tio". The host reads a ranked top-15 list (rank 1 is the biggest/first). Each team wrote ONE free-text answer. Decide, for every answer, which single list row it refers to.

Rules:
- A match means the SAME ENTITY as one row, in any spelling, language or common alias: misspellings, casing, missing diacritics, Swedish/English/native names ("Tjeckien", "Czechia", "Czech Republic" all match Tjeckien), obvious short forms ("PS4" for "PlayStation 4", "Everest" for "Mount Everest").
- A different entity that is merely similar is NOT a match (Slovakien is not Slovenien; "Avengers" alone is not "Avengers: Endgame" unless the list has exactly one Avengers film).
- If two rows are plausible for one answer, choose none (row: null) and say why in "reason".
- Never invent rows. Only use row numbers that exist in the list.
- An empty, joke or unrelated answer gets row: null.
- The pre-pass hits are exact matches already decided; keep your decisions consistent with them.

Answer with JSON only, following the schema: exactly one result per team in the "answers" list (and none for the "prepass_hits" teams, which are already decided), with the row NUMBER (the "row" field of the list, not the rank) or null, and a short reason in Swedish.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          team: { type: 'integer' },
          row: { type: ['integer', 'null'] },
          reason: { type: 'string' },
        },
        required: ['team', 'row', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

const JSON_TEAM_NOTE = 'return exactly one result per team listed in "answers" and no results for other teams; the "prepass_hits" teams are already decided and must not appear in your results';

export function buildUserPrompt(input: ModelInput): string {
  const payload = {
    list: {
      title: input.question.title,
      definition: input.question.definition,
      rows: input.question.rows.map((r, i) => ({ row: i + 1, rank: r.rank, name: r.name })),
    },
    prepass_hits: input.prepassHits,
    answers: input.answers,
  };
  return `Grade these answers (${JSON_TEAM_NOTE}).\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
}

async function callAnthropic(input: ModelInput, opts: GraderOptions): Promise<ModelOutput & { model: string }> {
  const client = new Anthropic({
    apiKey: opts.apiKey ?? '',
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    timeout: opts.timeoutMs ?? GRADER_TIMEOUT_MS,
    maxRetries: 1, // one retry on 429/5xx/network/timeout
  });
  const response = await client.beta.messages.create({
    model: opts.model ?? GRADER_MODEL,
    // Room for eight answers *and* the thinking Opus does by default, which counts against the cap.
    // At 1024 a full question could stop on max_tokens; :105 then throws and :174 flags every
    // pending answer "ogranskad" — the whole table for Erik to set by hand.
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
  });
  if (response.stop_reason !== 'end_turn') {
    throw new Error(`unexpected stop_reason ${String(response.stop_reason)}`);
  }
  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { ...parseModelOutput(text), model: response.model };
}

/** Strict parse of the model's JSON; anything malformed throws (→ fallback). */
export function parseModelOutput(text: string): ModelOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('grader output is not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { results?: unknown }).results)) {
    throw new Error('grader output lacks results[]');
  }
  const results = (parsed as { results: unknown[] }).results.map((r) => {
    if (!r || typeof r !== 'object') throw new Error('bad result row');
    const { team, row, reason } = r as { team?: unknown; row?: unknown; reason?: unknown };
    if (typeof team !== 'number') throw new Error('bad team');
    if (row !== null && (typeof row !== 'number' || !Number.isInteger(row))) throw new Error('bad row');
    return { team, row: row as number | null, reason: typeof reason === 'string' ? reason : '' };
  });
  return { results };
}

/**
 * Grade a set of answers for one question. Never throws: unresolved answers come back with
 * `needsReview: true` and `failed: true` so admin can show "ogranskad".
 */
export async function gradeAnswers(
  question: QuizQuestion,
  answers: { team: Team; text: string }[],
  opts: GraderOptions = {},
): Promise<GraderOutcome> {
  const prepass = buildPrepass(question);
  const rows: GradeResultRow[] = [];
  const pending: { team: Team; text: string }[] = [];
  const prepassHits: ModelInput['prepassHits'] = [];

  for (const a of answers) {
    const hit = prepass.lookup(a.text);
    if (hit.kind === 'hit') {
      rows.push({ team: a.team, gradedText: a.text, rowIndex: hit.rowIndex, needsReview: false, reason: 'Exakt träff' });
      prepassHits.push({ team: a.team, text: a.text, row: hit.rowIndex + 1 });
    } else {
      pending.push(a);
    }
  }
  if (pending.length === 0) return { rows, failed: false, usedModel: false };

  const flagAll = (reason: string): GraderOutcome => {
    for (const a of pending) rows.push({ team: a.team, gradedText: a.text, rowIndex: null, needsReview: true, reason });
    return { rows, failed: true, usedModel: false, error: reason };
  };
  // Belt and braces for the schema: the output format asks for exactly these teams.
  void JSON_TEAM_NOTE;

  const call = opts.callModel;
  if (!call && !opts.apiKey) return flagAll('Ingen API-nyckel (ANTHROPIC_API_KEY saknas)');

  let output: ModelOutput & { model?: string };
  try {
    output = call ? await call({ question, answers: pending, prepassHits }) : await callAnthropic({ question, answers: pending, prepassHits }, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return flagAll(`Modellen svarade inte (${message.slice(0, 120)})`);
  }

  // The response must contain exactly one row per pending team. Duplicates (possibly
  // contradictory) or rows for a team that was never asked about mean the model did not do what
  // was asked; none of it is trusted, all of it goes to Erik. The one tolerated extra is an echo
  // of a pre-pass team (the model sees those hits for context and sometimes repeats them); a
  // pre-pass hit is final by spec, so such rows are ignored whatever they say.
  const pendingTeams = new Set<number>(pending.map((a) => a.team));
  const prepassTeams = new Set<number>(prepassHits.map((h) => h.team));
  const seen = new Set<number>();
  const byTeam = new Map<number, { row: number | null; reason: string }>();
  for (const r of output.results) {
    if (prepassTeams.has(r.team)) continue;
    if (!pendingTeams.has(r.team)) return flagAll(`Modellen svarade för lag ${r.team} som inte skulle rättas`);
    if (seen.has(r.team)) return flagAll(`Modellen gav flera svar för lag ${r.team}`);
    seen.add(r.team);
    byTeam.set(r.team, { row: r.row, reason: r.reason });
  }
  let anyMissing = false;
  for (const a of pending) {
    const r = byTeam.get(a.team);
    if (!r) {
      anyMissing = true;
      rows.push({ team: a.team, gradedText: a.text, rowIndex: null, needsReview: true, reason: 'Modellen gav inget svar för laget' });
      continue;
    }
    if (r.row === null) {
      rows.push({ team: a.team, gradedText: a.text, rowIndex: null, needsReview: false, reason: r.reason || 'Utanför listan' });
      continue;
    }
    const rowIndex = r.row - 1;
    if (rowIndex < 0 || rowIndex >= question.rows.length) {
      anyMissing = true;
      rows.push({ team: a.team, gradedText: a.text, rowIndex: null, needsReview: true, reason: `Modellen angav rad ${r.row} som inte finns` });
      continue;
    }
    rows.push({ team: a.team, gradedText: a.text, rowIndex, needsReview: false, reason: r.reason });
  }
  const outcome: GraderOutcome = { rows, failed: anyMissing, usedModel: true };
  if (output.model) outcome.model = output.model;
  return outcome;
}
