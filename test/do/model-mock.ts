// The model, as the Durable Object tests see it. Installed as Miniflare's `outboundService` in
// vitest.config.ts, so every outbound fetch from the test worker (the DO's grader call included)
// lands here, in the Vitest process — nothing ever reaches the real API. Default mode `fail`
// answers 500 (the SDK retries once, then the grader flags the batch "ogranskad"); a test can
// switch to `slow` (thinks for SLOW_MODEL_MS, then grades) or `ok` through MODEL_CONTROL_URL.
import { normalize } from '../../src/shared/normalize.ts';

export type ModelMode = 'fail' | 'slow' | 'ok';

/** POST {mode} here from a test to switch the mock; GET returns the current mode. */
export const MODEL_CONTROL_URL = 'http://model-mock.test/mode';
export const SLOW_MODEL_MS = 1_500;

/** Spellings the mock "understands" beyond exact (normalised) row names. */
const ALIASES: Record<string, string> = { tjekkiet: 'Tjeckien', czechia: 'Tjeckien', germany: 'Tyskland', belgium: 'Belgien' };

/**
 * `modell: <radens namn>` is a test answer that only the model can resolve: the prefix makes it
 * invisible to the deterministic pre-pass (it is neither a row name nor an alias), and the mock
 * strips it. It lets a test force a real model round-trip for whatever list quiz.json holds.
 */
const MODEL_ONLY = /^\s*modell:\s*/i;

interface Payload {
  list: { rows: { row: number; rank: number; name: string }[] };
  answers: { team: number; text: string }[];
}

function payloadOf(body: unknown): Payload | null {
  const content = (body as { messages?: { content?: unknown }[] }).messages?.[0]?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? '').join('') : '';
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as Payload;
  } catch {
    return null;
  }
}

export function createModelMock(): (request: Request) => Promise<Response> {
  let mode: ModelMode = 'fail';
  return async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'model-mock.test') {
      if (request.method === 'POST') {
        const body = (await request.json()) as { mode?: ModelMode };
        if (body.mode) mode = body.mode;
      }
      return Response.json({ mode });
    }
    if (!url.pathname.startsWith('/v1/messages')) return new Response('not found', { status: 404 });
    if (mode === 'fail') {
      return Response.json({ type: 'error', error: { type: 'api_error', message: 'mock: no model in the DO tests' } }, { status: 500 });
    }
    if (mode === 'slow') await new Promise((r) => setTimeout(r, SLOW_MODEL_MS));
    const payload = payloadOf(await request.json());
    const byName = new Map((payload?.list.rows ?? []).map((r) => [normalize(r.name), r.row]));
    const results = (payload?.answers ?? []).map((a) => {
      const n = normalize(a.text.replace(MODEL_ONLY, ''));
      const alias = ALIASES[n];
      const row = byName.get(n) ?? (alias ? byName.get(normalize(alias)) : undefined) ?? null;
      return { team: a.team, row, reason: row ? 'mock: matched' : 'mock: not on the list' };
    });
    return Response.json({
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-mock',
      content: [{ type: 'text', text: JSON.stringify({ results }) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
}
