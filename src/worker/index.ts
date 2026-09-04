// Worker entry: static assets serve the pages (dist/public), `/ws` goes to the single Game DO.
import { GAME_NAME } from './config.ts';
import { Game } from './game-do.ts';

export { Game };

export interface Env {
  GAME: DurableObjectNamespace<Game>;
  ASSETS: Fetcher;
  /** Secret. Every admin message carries it; the admin page is /admin?t=<ADMIN_TOKEN>. */
  ADMIN_TOKEN?: string;
  /** Secret. Used only inside the DO's grader call. Never logged, never sent to a client. */
  ANTHROPIC_API_KEY?: string;
  /** Optional override of the API host (the e2e suite points it at a local mock). */
  ANTHROPIC_BASE_URL?: string;
  /** Optional override of data/quiz.json durationSeconds (the e2e suite shortens the clock). */
  QUESTION_SECONDS?: string;
  /** Optional override of data/quiz.json questions, a JSON array of slugs (test suites only). */
  QUIZ_QUESTIONS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const stub = env.GAME.get(env.GAME.idFromName(GAME_NAME));
      return stub.fetch(request);
    }
    if (url.pathname === '/health') {
      return Response.json({ ok: true, adminTokenSet: Boolean(env.ADMIN_TOKEN), graderKeySet: Boolean(env.ANTHROPIC_API_KEY) });
    }
    // Static assets are tried before the Worker for every other path (wrangler.jsonc); reaching
    // here means no asset matched.
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
