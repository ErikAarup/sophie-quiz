import type { Env as WorkerEnv } from '../../src/worker/index.ts';

// `import { env } from 'cloudflare:test'` is typed as Cloudflare.Env; bind it to our worker's Env.
declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {}
  }
}

export {};
