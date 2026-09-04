import { startServers, startWrangler } from './servers.ts';

export default async function globalSetup(): Promise<void> {
  const h = await startServers();
  await startWrangler(h, { cleanState: true });
}
