// Reconnecting WebSocket with a liveness watchdog and the server clock offset (WORK_ORDER §B).
// Backoff 0.5 s → 5 s; full resync on every open because the server sends full state on connect.

import type { ServerMessage } from '../shared/types.ts';

export interface ConnectionOptions {
  /** Sent right after the socket opens (hello). */
  hello: () => object;
  /** What to send as the periodic ping. Players send the bare text "ping" (answered by the
   *  runtime without waking the DO); admin sends a JSON ping so presence refreshes. */
  ping: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (online: boolean) => void;
}

const PING_EVERY_MS = 3_000;
const DEAD_AFTER_MS = 8_000;
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 5_000;

export class Connection {
  private ws: WebSocket | null = null;
  private backoff = BACKOFF_MIN_MS;
  private lastAlive = 0;
  private pingTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private stopped = false;
  /** serverNow - Date.now() from the last state message. */
  offset = 0;
  online = false;

  constructor(private readonly opts: ConnectionOptions) {}

  start(): void {
    this.open();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.kick();
    });
    window.addEventListener('online', () => this.kick());
    window.addEventListener('pageshow', () => this.kick());
  }

  /** Server time as best we know it. */
  now(): number {
    return Date.now() + this.offset;
  }

  send(msg: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /** Close the socket as if the network dropped it; the normal reconnect path takes over. */
  drop(): void {
    if (!this.ws) return;
    try {
      this.ws.close(4000, 'drop');
    } catch {
      // ignore
    }
  }

  /** Reconnect right away if we are not connected (page became visible, network is back). */
  private kick(): void {
    if (this.online) {
      this.sendPing();
      return;
    }
    this.backoff = BACKOFF_MIN_MS;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.open();
  }

  private url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private open(): void {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.backoff = BACKOFF_MIN_MS;
      this.lastAlive = Date.now();
      this.setOnline(true);
      this.send(this.opts.hello());
      this.startPing();
    });
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      this.lastAlive = Date.now();
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'state') this.offset = msg.serverNow - Date.now();
      this.opts.onMessage(msg);
    });
    const onGone = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.setOnline(false);
      this.scheduleReconnect();
    };
    ws.addEventListener('close', onGone);
    ws.addEventListener('error', onGone);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    const wait = this.backoff;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, wait);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastAlive > DEAD_AFTER_MS) {
        // Nothing heard for a while: assume the socket is dead even if the browser has not noticed.
        try {
          this.ws.close(4000, 'watchdog');
        } catch {
          // ignore
        }
        return;
      }
      this.sendPing();
    }, PING_EVERY_MS);
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(this.opts.ping);
    } catch {
      // ignore
    }
  }

  private stopPing(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private setOnline(v: boolean): void {
    if (this.online === v) return;
    this.online = v;
    this.opts.onStatus(v);
  }
}
