// The e2e harness's two servers, living in the Playwright runner process:
//  1. a mock of the Anthropic Messages API (what the Worker's grader talks to during e2e), with
//     switchable modes: ok | fail | timeout;
//  2. a control endpoint the tests use to switch the mock and to kill/restart `wrangler dev`
//     (the "worker restart mid-question" scenario).
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { normalize } from '../src/shared/normalize.ts';
import { BASE_URL, E2E_PORT, LOG_DIR, MOCK_PORT, PERSIST_DIR, ROOT } from './env.ts';

export type MockMode = 'ok' | 'fail' | 'timeout';

interface Harness {
  server: Server;
  wrangler: ChildProcess | null;
  mode: MockMode;
  requests: { at: number; apiKey: string | null; model: string | null; answers: number }[];
}

declare global {
  // eslint-disable-next-line no-var
  var __sophieE2E: Harness | undefined;
}

/** English/typo forms the mock understands, on top of exact (normalised) row names. */
const MOCK_ALIASES: Record<string, string> = {
  germany: 'Tyskland',
  france: 'Frankrike',
  italy: 'Italien',
  spain: 'Spanien',
  poland: 'Polen',
  romania: 'Rumänien',
  netherlands: 'Nederländerna',
  holland: 'Nederländerna',
  belgium: 'Belgien',
  czechia: 'Tjeckien',
  'czech republic': 'Tjeckien',
  tjekkiet: 'Tjeckien',
  tjeckin: 'Tjeckien',
  sweden: 'Sverige',
  greece: 'Grekland',
  hungary: 'Ungern',
  austria: 'Österrike',
  bulgaria: 'Bulgarien',
  portugall: 'Portugal',
  russia: 'Ryssland',
  ukraine: 'Ukraina',
  norway: 'Norge',
  finland: 'Finland',
  india: 'Indien',
  china: 'Kina',
  'united states': 'USA',
  brazil: 'Brasilien',
  mexico: 'Mexiko',
  japan: 'Japan',
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface GraderPayload {
  list: { rows: { row: number; rank: number; name: string }[] };
  answers: { team: number; text: string }[];
}

function extractPayload(body: unknown): GraderPayload | null {
  const msgs = (body as { messages?: { content?: unknown }[] }).messages;
  const content = msgs?.[0]?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? '').join('') : '';
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as GraderPayload;
  } catch {
    return null;
  }
}

function gradeLikeAModel(payload: GraderPayload): { team: number; row: number | null; reason: string }[] {
  const byName = new Map(payload.list.rows.map((r) => [normalize(r.name), r.row]));
  return payload.answers.map((a) => {
    const n = normalize(a.text);
    const viaAlias = MOCK_ALIASES[n];
    const row = byName.get(n) ?? (viaAlias ? byName.get(normalize(viaAlias)) : undefined) ?? null;
    return { team: a.team, row, reason: row ? 'mock: matched' : 'mock: not on the list' };
  });
}

async function handleMessages(h: Harness, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: unknown = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // ignore
  }
  const payload = extractPayload(body);
  h.requests.push({
    at: Date.now(),
    apiKey: req.headers['x-api-key'] ? String(req.headers['x-api-key']) : null,
    model: (body as { model?: string }).model ?? null,
    answers: payload?.answers.length ?? 0,
  });
  if (h.mode === 'fail') {
    json(res, 500, { type: 'error', error: { type: 'api_error', message: 'mock: model unavailable' } });
    return;
  }
  if (h.mode === 'timeout') {
    await new Promise((r) => setTimeout(r, 25_000));
    json(res, 500, { type: 'error', error: { type: 'api_error', message: 'mock: too slow' } });
    return;
  }
  const results = payload ? gradeLikeAModel(payload) : [];
  json(res, 200, {
    id: 'msg_mock_' + Date.now(),
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-mock',
    content: [{ type: 'text', text: JSON.stringify({ results }) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 42, output_tokens: 42 },
  });
}

async function handleControl(h: Harness, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method === 'GET') {
    json(res, 200, { mode: h.mode, requests: h.requests, wranglerPid: h.wrangler?.pid ?? null });
    return;
  }
  const body = JSON.parse((await readBody(req)) || '{}') as { mode?: MockMode; reset?: boolean };
  if (path === '/__control/restart') {
    await restartWrangler(h);
    json(res, 200, { ok: true, wranglerPid: h.wrangler?.pid ?? null });
    return;
  }
  if (body.mode) h.mode = body.mode;
  if (body.reset) h.requests = [];
  json(res, 200, { mode: h.mode });
}

export async function startServers(): Promise<Harness> {
  const h: Harness = { server: createServer(), wrangler: null, mode: 'ok', requests: [] };
  h.server.on('request', (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const run = path.startsWith('/__control') ? handleControl(h, req, res, path) : path === '/v1/messages' ? handleMessages(h, req, res) : Promise.resolve(json(res, 404, { error: 'not found' }));
    run.catch((err) => json(res, 500, { error: String(err) }));
  });
  await new Promise<void>((r) => h.server.listen(MOCK_PORT, '127.0.0.1', r));
  globalThis.__sophieE2E = h;
  return h;
}

export async function stopServers(h: Harness): Promise<void> {
  await killWrangler(h);
  await new Promise<void>((r) => h.server.close(() => r()));
}

export async function waitForHealth(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev did not become healthy on ${BASE_URL}: ${lastErr}`);
}

export async function startWrangler(h: Harness, opts: { cleanState?: boolean } = {}): Promise<void> {
  if (opts.cleanState) rmSync(PERSIST_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const log = createWriteStream(resolve(LOG_DIR, 'wrangler-e2e.log'), { flags: 'a' });
  const bin = resolve(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const child = spawn(
    process.execPath,
    [bin, 'dev', '--config', resolve(ROOT, 'e2e', 'wrangler.e2e.jsonc'), '--port', String(E2E_PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST_DIR, '--show-interactive-dev-session=false', '--log-level', 'log'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  h.wrangler = child;
  await waitForHealth();
}

export async function killWrangler(h: Harness): Promise<void> {
  const child = h.wrangler;
  if (!child || child.pid === undefined) return;
  h.wrangler = null;
  const exited = new Promise<void>((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', () => r());
  });
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    // already gone
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
}

/** Kill the Worker (workerd included) and start it again on the same persisted state. */
export async function restartWrangler(h: Harness): Promise<void> {
  await killWrangler(h);
  // Make sure the port is really free before respawning.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/health`);
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      break;
    }
  }
  await startWrangler(h);
}
