// The Game Durable Object: single source of truth for one quiz night (WORK_ORDER §B).
// - One instance (idFromName("sophie-2026")), SQLite-backed storage, whole state persisted on
//   every transition before anything is broadcast.
// - WebSocket Hibernation API for all clients; each socket carries a small attachment
//   (role, deviceId, team) that survives hibernation.
// - The clock lives here: `deadlineAt` + a storage alarm that locks answers at zero. Every
//   incoming event also re-checks the deadline, so a late alarm can never let an answer in.
// - Full state on every change and on connect; no deltas.

import { DurableObject } from 'cloudflare:workers';
import { initialState, migrateState, reduce, type GameEvent, type GradeRequest, type KickReason, type Outcome } from '../shared/game.ts';
import {
  CONFIRM_WORD,
  TEAMS,
  isTeam,
  teamName,
  type AdminCommand,
  type ClientMessage,
  type GameState,
  type Quiz,
  type ServerMessage,
  type Team,
} from '../shared/types.ts';
import { adminView, playerView } from '../shared/view.ts';
import { buildQuiz } from './bank.ts';
import { gradeAnswers } from './grader.ts';
import type { Env } from './index.ts';

interface Attachment {
  role: 'player' | 'admin';
  deviceId: string | null;
  team: Team | null;
  connectedAt: number;
  lastSeen: number;
}

/** A team counts as online if one of its sockets showed life within this window. */
const PRESENCE_WINDOW_MS = 8_000;
const STATE_KEY = 'state';

export class Game extends DurableObject<Env> {
  private state: GameState = initialState(0);
  private readonly quiz: Quiz;
  private resumeGrading = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const seconds = env.QUESTION_SECONDS ? Number(env.QUESTION_SECONDS) : undefined;
    this.quiz = buildQuiz({ durationSeconds: Number.isFinite(seconds) ? seconds : undefined });
    // Player phones send the text "ping" every few seconds; the runtime answers "pong" without
    // waking us, and remembers when (presence).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<GameState>(STATE_KEY);
      if (stored && stored.v === 1) {
        this.state = migrateState(stored, Date.now());
        if (this.state.phase === 'grading' || this.state.gradePending > 0) {
          // We died with grading in flight. Nothing is outstanding any more: back to locked if we
          // were grading, and grade again on the next alarm (manual grades are never overwritten).
          if (this.state.phase === 'grading') this.state.phase = 'locked';
          this.state.gradePending = 0;
          this.resumeGrading = true;
          await ctx.storage.put(STATE_KEY, this.state);
          await ctx.storage.setAlarm(Date.now() + 500);
        }
      } else {
        this.state = initialState(Date.now());
        await ctx.storage.put(STATE_KEY, this.state);
      }
    });
  }

  // ---------- HTTP: WebSocket upgrade only ----------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    const att: Attachment = { role: 'player', deviceId: null, team: null, connectedAt: now, lastSeen: now };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- WebSocket events ----------

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    if (raw === 'ping') {
      // Reached when the runtime's auto-response did not answer (it only does while we hibernate).
      // Record liveness ourselves so an idle phone never reads "offline" on admin.
      const att = this.attachment(ws);
      att.lastSeen = Date.now();
      ws.serializeAttachment(att);
      this.safeSend(ws, 'pong');
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { type: 'error', code: 'badJson', message: 'Ogiltigt meddelande.' });
      return;
    }
    const att = this.attachment(ws);
    att.lastSeen = Date.now();
    ws.serializeAttachment(att);

    switch (msg.type) {
      case 'hello':
        if (msg.role === 'admin') await this.helloAdmin(ws, att, msg.token);
        else await this.helloPlayer(ws, att, msg.deviceId, msg.team, msg.token);
        return;
      case 'claim':
        await this.claim(ws, att, msg.team, msg.deviceId);
        return;
      case 'leave':
        if (att.team !== null) await this.apply({ type: 'release', team: att.team });
        return;
      case 'answer': {
        if (att.team === null) {
          this.send(ws, { type: 'error', code: 'noTeam', message: 'Välj lag först.' });
          return;
        }
        const out = await this.apply({ type: 'answer', team: att.team, text: String(msg.text ?? ''), source: 'team' });
        if (out.error) this.send(ws, { type: 'error', ...out.error });
        else if (!out.changed) this.sendState(ws, att);
        else this.send(ws, { type: 'ok', of: 'answer' });
        return;
      }
      case 'ping': {
        // A ping runs the clock check too, so a delayed alarm can never leave phones on "open".
        const out = await this.apply({ type: 'tick' });
        if (!out.changed) this.sendState(ws, att);
        return;
      }
      default:
        await this.adminCommand(ws, att, msg);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void code;
    void reason;
    void wasClean;
    try {
      ws.close(1000, 'bye');
    } catch {
      // already closed
    }
    this.broadcastAdmin();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed
    }
    this.broadcastAdmin();
  }

  // ---------- Alarm: lock at zero ----------

  override async alarm(): Promise<void> {
    await this.apply({ type: 'alarm' });
    const s = this.state;
    if (s.phase === 'open' && s.pausedRemainingMs === null && s.deadlineAt !== null) {
      // Fired early (clock skew): try again at the deadline.
      await this.ctx.storage.setAlarm(s.deadlineAt);
    }
    if (this.resumeGrading) {
      this.resumeGrading = false;
      if (s.phase === 'locked' || s.phase === 'reveal' || s.phase === 'standings') await this.apply({ type: 'grade' });
    }
  }

  // ---------- Handlers ----------

  private async helloPlayer(ws: WebSocket, att: Attachment, deviceId: unknown, team: unknown, token: unknown): Promise<void> {
    if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 64) {
      this.send(ws, { type: 'error', code: 'badDevice', message: 'Ogiltig enhet.' });
      return;
    }
    att.role = 'player';
    att.deviceId = deviceId;
    att.team = null;
    if (team !== null && team !== undefined && isTeam(team)) {
      att.team = team; // optimistic, see claim()
      ws.serializeAttachment(att);
      // A remembered team is an automatic re-claim: it must carry the token the phone was given.
      const out = await this.apply({ type: 'claim', team, deviceId, auto: true, token: typeof token === 'number' ? token : null });
      if (out.error) {
        att.team = null;
        const owner = this.state.slots[team];
        const message = owner && owner.deviceId !== deviceId ? `${teamName(team)} används av en annan telefon. Välj lag igen.` : out.error.message;
        this.send(ws, { type: 'released', message });
      }
    }
    ws.serializeAttachment(att);
    this.sendState(ws, att);
    this.broadcastAdmin();
  }

  private async helloAdmin(ws: WebSocket, att: Attachment, token: unknown): Promise<void> {
    if (!(await this.tokenOk(token))) {
      this.send(ws, { type: 'error', code: 'auth', message: 'Fel adminlänk. Öppna länken med rätt nyckel.' });
      try {
        ws.close(4401, 'auth');
      } catch {
        // ignore
      }
      return;
    }
    att.role = 'admin';
    att.team = null;
    ws.serializeAttachment(att);
    this.sendState(ws, att);
  }

  private async claim(ws: WebSocket, att: Attachment, team: unknown, deviceId: unknown): Promise<void> {
    if (!isTeam(team)) {
      this.send(ws, { type: 'error', code: 'badTeam', message: 'Ogiltigt lag.' });
      return;
    }
    const id = typeof deviceId === 'string' && deviceId.length >= 8 ? deviceId : att.deviceId;
    if (!id) {
      this.send(ws, { type: 'error', code: 'badDevice', message: 'Ogiltig enhet.' });
      return;
    }
    att.deviceId = id;
    // Bind the socket to the team before applying, so the broadcast inside apply() already
    // counts this phone as online for its team (no "offline" flash on admin). Revert on refusal.
    const prevTeam = att.team;
    att.team = team;
    ws.serializeAttachment(att);
    const out = await this.apply({ type: 'claim', team, deviceId: id });
    if (out.error) {
      att.team = prevTeam;
      ws.serializeAttachment(att);
      this.send(ws, { type: 'error', ...out.error });
      this.sendState(ws, att);
      return;
    }
    if (!out.changed) this.sendState(ws, att);
  }

  private async adminCommand(ws: WebSocket, att: Attachment, msg: ClientMessage): Promise<void> {
    const cmd = msg as AdminCommand & { token?: unknown };
    if (!(await this.tokenOk(cmd.token))) {
      this.send(ws, { type: 'error', code: 'auth', message: 'Fel adminnyckel.' });
      return;
    }
    if (att.role !== 'admin') {
      att.role = 'admin';
      ws.serializeAttachment(att);
    }
    const event = toEvent(cmd);
    if (!event) {
      this.send(ws, { type: 'error', code: 'unknown', message: `Okänt kommando ${String((cmd as { type?: unknown }).type)}` });
      return;
    }
    const out = await this.apply(event);
    if (out.error) {
      this.send(ws, { type: 'error', ...out.error });
      this.sendState(ws, att);
    } else {
      this.send(ws, { type: 'ok', of: cmd.type });
      if (!out.changed) this.sendState(ws, att);
    }
  }

  // ---------- Core: reduce, persist, effects, broadcast ----------

  private async apply(event: GameEvent): Promise<Outcome> {
    const out = reduce(this.state, event, Date.now(), this.quiz);
    if (out.changed) {
      this.state = out.state;
      await this.ctx.storage.put(STATE_KEY, this.state);
    }
    if (out.alarm === null) await this.ctx.storage.deleteAlarm();
    else if (typeof out.alarm === 'number') await this.ctx.storage.setAlarm(out.alarm);

    for (const k of out.kicked) this.kick(k.deviceId, k.team, k.reason);
    if (out.changed) this.broadcastAll();
    if (out.grade) await this.runGrader(out.grade);
    return out;
  }

  /** Tell the sockets of `deviceId` that are bound to `team` (and only those) to go back to the tiles. */
  private kick(deviceId: string, team: Team, reason: KickReason): void {
    const message =
      reason === 'moved'
        ? `Den här telefonen valde ett annat lag i en annan flik. ${teamName(team)} är släppt.`
        : reason === 'reset'
          ? 'Erik nollställde spelet. Välj lag igen.'
          : `Erik släppte ${teamName(team)}. Välj lag igen.`;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att.role === 'player' && att.deviceId === deviceId && att.team === team) {
        att.team = null;
        ws.serializeAttachment(att);
        this.send(ws, { type: 'released', message });
      }
    }
  }

  private async runGrader(req: GradeRequest): Promise<void> {
    const question = this.quiz.questions[req.questionIndex];
    if (!question) return;
    const result = await gradeAnswers(question, req.answers, {
      apiKey: this.env.ANTHROPIC_API_KEY,
      baseURL: this.env.ANTHROPIC_BASE_URL,
    });
    await this.apply({ type: 'gradeResult', questionIndex: req.questionIndex, results: result.rows, failed: result.failed });
  }

  private presence(now: number): Record<Team, boolean> {
    const online = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false, 8: false } as Record<Team, boolean>;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att.role !== 'player' || att.team === null) continue;
      const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      const seen = Math.max(att.lastSeen, att.connectedAt, auto ? auto.getTime() : 0);
      if (now - seen < PRESENCE_WINDOW_MS) online[att.team] = true;
    }
    return online;
  }

  private view(att: Attachment, now: number) {
    if (att.role === 'admin') return adminView(this.state, this.quiz, now, this.presence(now));
    return playerView(this.state, this.quiz, now, att.team, att.deviceId);
  }

  private sendState(ws: WebSocket, att: Attachment): void {
    this.send(ws, this.view(att, Date.now()));
  }

  private broadcastAll(): void {
    const now = Date.now();
    let presence: Record<Team, boolean> | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att.role === 'admin') {
        presence ??= this.presence(now);
        this.send(ws, adminView(this.state, this.quiz, now, presence));
      } else {
        this.send(ws, playerView(this.state, this.quiz, now, att.team, att.deviceId));
      }
    }
  }

  private broadcastAdmin(): void {
    const now = Date.now();
    const sockets = this.ctx.getWebSockets();
    const admins = sockets.filter((ws) => this.attachment(ws).role === 'admin');
    if (admins.length === 0) return;
    const view = adminView(this.state, this.quiz, now, this.presence(now));
    for (const ws of admins) this.send(ws, view);
  }

  private attachment(ws: WebSocket): Attachment {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att && typeof att === 'object') return att;
    const now = Date.now();
    return { role: 'player', deviceId: null, team: null, connectedAt: now, lastSeen: now };
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    this.safeSend(ws, JSON.stringify(msg));
  }

  private safeSend(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch {
      // Closed underneath us; the close event cleans up.
    }
  }

  private async tokenOk(token: unknown): Promise<boolean> {
    const expected = this.env.ADMIN_TOKEN;
    if (!expected || typeof token !== 'string' || token.length === 0) return false;
    const a = new TextEncoder().encode(token);
    const b = new TextEncoder().encode(expected);
    if (a.byteLength !== b.byteLength) return false;
    return crypto.subtle.timingSafeEqual(a, b);
  }
}

/** Map an admin wire command to a reducer event. Returns null for an unknown type. */
function toEvent(cmd: AdminCommand): GameEvent | null {
  switch (cmd.type) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'lock':
    case 'grade':
    case 'revealNext':
    case 'revealAll':
    case 'standings':
    case 'backToReveal':
    case 'next':
      return { type: cmd.type };
    case 'extend':
      return typeof cmd.ms === 'number' ? { type: 'extend', ms: cmd.ms } : { type: 'extend' };
    case 'release':
      return { type: 'release', team: cmd.team };
    case 'manualAnswer':
      return { type: 'answer', team: cmd.team, text: String(cmd.text ?? ''), source: 'admin' };
    case 'override':
      return { type: 'override', team: cmd.team, rank: Number(cmd.rank) };
    case 'resetQuestion':
      return { type: 'resetQuestion', confirm: String(cmd.confirm ?? '') };
    case 'resetGame':
      return { type: 'resetGame', confirm: String(cmd.confirm ?? '') };
    default:
      return null;
  }
}

export { CONFIRM_WORD, TEAMS };
