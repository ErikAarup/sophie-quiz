// Tiny WebSocket test client for the DO tests (runs inside workerd via the workers pool).
import { SELF, env } from 'cloudflare:test';
import { CONFIRM_WORD, type AdminCommand, type AdminStateView, type PlayerStateView, type ServerMessage, type Team } from '../../src/shared/types.ts';

/** Whatever the worker sees (vitest.config.ts binds it; a local .dev.vars may win — either way this matches). */
export const TOKEN = env.ADMIN_TOKEN ?? 'test-admin-token';

type StateView = PlayerStateView | AdminStateView;

export class Client {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  /** The most recent state message, so a wait can be satisfied by what already arrived. */
  latest: StateView | null = null;
  closed = false;

  constructor(public readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      const m = JSON.parse(ev.data) as ServerMessage;
      if (m.type === 'state') this.latest = m;
      const w = this.waiters.shift();
      if (w) w(m);
      else this.queue.push(m);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
    });
  }

  static async connect(): Promise<Client> {
    const res = await SELF.fetch('https://quiz.test/ws', { headers: { Upgrade: 'websocket' } });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no websocket (status ${res.status})`);
    const client = new Client(ws);
    ws.accept();
    return client;
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  next(timeoutMs = 4000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('timed out waiting for a message'));
      }, timeoutMs);
      const waiter = (m: ServerMessage) => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiters.push(waiter);
    });
  }

  /** Wait for the next message matching `pred`; non-matching messages are consumed (state is kept in `latest`). */
  async until<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, timeoutMs?: number): Promise<T>;
  async until(pred: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  async until(pred: (m: ServerMessage) => boolean, timeoutMs = 6000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a matching message');
      const m = await this.next(remaining);
      if (pred(m)) return m;
    }
  }

  /** The latest player state satisfying `pred` — already received, or the next one that arrives. */
  async playerState(pred: (s: PlayerStateView) => boolean = () => true, timeoutMs = 6000): Promise<PlayerStateView> {
    const l = this.latest;
    if (l && l.role === 'player' && pred(l)) return l;
    return this.until((m): m is PlayerStateView => m.type === 'state' && m.role === 'player' && pred(m), timeoutMs);
  }

  async adminState(pred: (s: AdminStateView) => boolean = () => true, timeoutMs = 6000): Promise<AdminStateView> {
    const l = this.latest;
    if (l && l.role === 'admin' && pred(l)) return l;
    return this.until((m): m is AdminStateView => m.type === 'state' && m.role === 'admin' && pred(m), timeoutMs);
  }

  error(timeoutMs?: number): Promise<{ type: 'error'; code: string; message: string }> {
    return this.until((m): m is { type: 'error'; code: string; message: string } => m.type === 'error', timeoutMs);
  }

  /** Send an admin command and wait for its ok/error. */
  async admin(cmd: AdminCommand): Promise<ServerMessage> {
    this.send({ ...cmd, token: TOKEN });
    return this.until((m) => m.type === 'ok' || m.type === 'error');
  }

  close(): void {
    this.ws.close(1000, 'test');
  }
}

export async function player(deviceId: string, team: Team | null = null): Promise<Client> {
  const c = await Client.connect();
  c.send({ type: 'hello', role: 'player', deviceId, team });
  return c;
}

export async function admin(): Promise<Client> {
  const c = await Client.connect();
  c.send({ type: 'hello', role: 'admin', token: TOKEN });
  await c.adminState();
  return c;
}

export async function resetGame(a: Client): Promise<void> {
  const r = await a.admin({ type: 'resetGame', confirm: CONFIRM_WORD });
  if (r.type !== 'ok') throw new Error(`reset failed: ${JSON.stringify(r)}`);
  await a.adminState((s) => s.phase === 'lobby' && s.questionIndex === 0 && s.teams.every((t) => !t.claimed));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
