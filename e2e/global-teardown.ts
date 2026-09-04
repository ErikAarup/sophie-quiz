import { stopServers } from './servers.ts';

export default async function globalTeardown(): Promise<void> {
  const h = globalThis.__sophieE2E;
  if (h) await stopServers(h);
}
