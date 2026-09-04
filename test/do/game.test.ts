// Durable Object integration: real workerd, real WebSockets, real storage alarm.
// QUESTION_SECONDS is 2 here (vitest.config.ts), so "lock at zero" is observable in a test.
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../../src/shared/types.ts';
import { GAME_NAME } from '../../src/worker/config.ts';
import { Client, TOKEN, admin, player, resetGame, sleep } from './client.ts';
import { MODEL_CONTROL_URL, type ModelMode } from './model-mock.ts';

/** Switch the mock model (vitest.config.ts `outboundService`) for the rest of a test. */
async function setModel(mode: ModelMode): Promise<void> {
  const res = await fetch(MODEL_CONTROL_URL, { method: 'POST', body: JSON.stringify({ mode }) });
  if (!res.ok) throw new Error(`model mock: ${res.status}`);
}

let a: Client;
const open: Client[] = [];

beforeEach(async () => {
  a = await admin();
  open.push(a);
  await resetGame(a);
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      // ignore
    }
  }
});

async function joined(deviceId: string, team: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): Promise<Client> {
  const p = await player(deviceId);
  open.push(p);
  await p.playerState((s) => s.team === null);
  p.send({ type: 'claim', team, deviceId });
  await p.playerState((s) => s.team === team);
  return p;
}

describe('join and slots (§2.1)', () => {
  it('claims a tile, refuses a second phone with the Swedish message, releases from admin', async () => {
    const p1 = await joined('device-aaaaaaaa', 3);
    const p2 = await player('device-bbbbbbbb');
    open.push(p2);
    await p2.playerState((s) => s.taken.includes(3));
    p2.send({ type: 'claim', team: 3, deviceId: 'device-bbbbbbbb' });
    const err = await p2.error();
    expect(err).toEqual({ type: 'error', code: 'taken', message: 'Lag 3 är redan taget' });
    await p2.playerState((s) => s.team === null);

    expect((await a.admin({ type: 'release', team: 3 })).type).toBe('ok');
    const released = await p1.until((m) => m.type === 'released');
    expect(released).toMatchObject({ type: 'released', message: 'Erik släppte Lag 3. Välj lag igen.' });
    await p1.playerState((s) => s.team === null && !s.taken.includes(3));

    p2.send({ type: 'claim', team: 3, deviceId: 'device-bbbbbbbb' });
    await p2.playerState((s) => s.team === 3);
    const av = await a.adminState((s) => s.teams[2]?.claimed === true);
    expect(av.teams[2]?.status).toBe('väntar');
  });

  it('a reconnecting phone keeps its team by device id and claim token', async () => {
    const first = await joined('device-cccccccc', 5);
    const token = (await first.playerState((s) => s.team === 5)).claimToken;
    const again = await player('device-cccccccc', 5, token);
    open.push(again);
    const s = await again.playerState();
    expect(s.team).toBe(5);
    expect(s.taken).not.toContain(5);
  });

  it('a release while the phone is offline sticks: its reconnect with the remembered team is sent to the tiles', async () => {
    const p = await joined('device-oooooooo', 4);
    const token = (await p.playerState((s) => s.team === 4)).claimToken;
    expect(typeof token).toBe('number');
    p.close(); // offline: nobody receives the release
    await sleep(100);
    expect((await a.admin({ type: 'release', team: 4 })).type).toBe('ok');
    await a.adminState((s) => s.teams[3]?.claimed === false);

    const back = await player('device-oooooooo', 4, token); // what the phone remembers
    open.push(back);
    const msg = await back.until((m) => m.type === 'released');
    expect(msg).toMatchObject({ type: 'released', message: 'Erik släppte Lag 4. Välj lag igen.' });
    const s = await back.playerState();
    expect(s.team).toBeNull();
    // A fresh tap works again.
    back.send({ type: 'claim', team: 4, deviceId: 'device-oooooooo' });
    await back.playerState((x) => x.team === 4);
  });

  it('one phone cannot hold two teams: claiming another team moves it and kicks the old team socket', async () => {
    const p = await joined('device-pppppppp', 1);
    p.send({ type: 'claim', team: 2, deviceId: 'device-pppppppp' });
    await p.playerState((s) => s.team === 2);
    const av = await a.adminState((s) => s.teams[1]?.claimed === true && s.teams[0]?.claimed === false);
    expect(av.teams[0]?.status).toBe('ledig');
  });

  it('a phone whose slot was taken by another device is sent back to the tiles', async () => {
    await joined('device-dddddddd', 6);
    const intruder = await player('device-eeeeeeee', 6);
    open.push(intruder);
    const msg = await intruder.until((m) => m.type === 'released');
    expect(msg).toMatchObject({ type: 'released' });
    const s = await intruder.playerState();
    expect(s.team).toBeNull();
    expect(s.taken).toContain(6);
  });

  it('refuses admin commands with a wrong token', async () => {
    const c = await Client.connect();
    open.push(c);
    c.send({ type: 'start', token: 'nope' });
    expect((await c.error()).code).toBe('auth');
    c.send({ type: 'hello', role: 'admin', token: 'nope' });
    expect((await c.error()).code).toBe('auth');
  });
});

describe('question clock (§2.2, §2.3, §2.4)', () => {
  it('starts with a server deadline, accepts and replaces answers, locks at zero by alarm, refuses late answers', async () => {
    const p = await joined('device-ffffffff', 1);
    const t0 = Date.now();
    expect((await a.admin({ type: 'start' })).type).toBe('ok');
    const s = await p.playerState((x) => x.phase === 'open');
    expect(s.deadlineAt).not.toBeNull();
    expect(s.deadlineAt! - t0).toBeGreaterThan(1500);
    expect(s.deadlineAt! - t0).toBeLessThan(3000);
    expect(s.totalMs).toBe(2000);
    expect(Math.abs(s.serverNow - Date.now())).toBeLessThan(1000);

    p.send({ type: 'answer', text: 'Spanien' });
    await p.until((m) => m.type === 'ok');
    p.send({ type: 'answer', text: 'Portugal' });
    await p.until((m) => m.type === 'ok');
    const av = await a.adminState((x) => x.teams[0]?.answer === 'Portugal');
    expect(av.teams[0]?.status).toBe('svar');

    // The storage alarm locks it; nobody sends anything.
    const locked = await p.playerState((x) => x.phase === 'locked', 5000);
    expect(locked.answer).toBe('Portugal');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);

    p.send({ type: 'answer', text: 'Polen' });
    const err = await p.error();
    expect(err.message).toBe('Tiden är ute – svaret togs inte emot.');
    const after = await a.adminState((x) => x.phase === 'locked');
    expect(after.teams[0]?.answer).toBe('Portugal');
  });

  it('pause survives an admin reload, resume continues, +30 s extends, lock early works', async () => {
    const p = await joined('device-gggggggg', 2);
    await a.admin({ type: 'start' });
    await p.playerState((x) => x.phase === 'open');
    await sleep(300);
    expect((await a.admin({ type: 'pause' })).type).toBe('ok');
    const paused = await p.playerState((x) => x.pausedRemainingMs !== null);
    expect(paused.pausedRemainingMs).toBeGreaterThan(1000);
    expect(paused.pausedRemainingMs).toBeLessThan(1900);

    // "Reload": the admin socket goes away and a new one connects.
    a.close();
    await sleep(2500); // well past the original deadline: still paused, not locked
    a = await admin();
    open.push(a);
    const again = await a.adminState();
    expect(again.phase).toBe('open');
    expect(again.pausedRemainingMs).toBe(paused.pausedRemainingMs);

    expect((await a.admin({ type: 'extend' })).type).toBe('ok');
    const ext = await a.adminState((x) => (x.pausedRemainingMs ?? 0) > 30_000);
    expect(ext.pausedRemainingMs).toBe(paused.pausedRemainingMs! + 30_000);
    expect(ext.totalMs).toBe(32_000);

    expect((await a.admin({ type: 'resume' })).type).toBe('ok');
    const running = await p.playerState((x) => x.pausedRemainingMs === null && x.deadlineAt !== null);
    expect(running.deadlineAt! - Date.now()).toBeGreaterThan(29_000);

    expect((await a.admin({ type: 'lock' })).type).toBe('ok');
    await p.playerState((x) => x.phase === 'locked');
  });
});

describe('grading and reveal (§2.5, §2.6, §2.7)', () => {
  it('grades exact hits without a model, flags the rest "ogranskad" when no key is set, reveals row by row, standings, next', async () => {
    const p3 = await joined('device-hhhhhhhh', 3);
    const p4 = await joined('device-iiiiiiii', 4);
    const p8 = await joined('device-jjjjjjjj', 8);
    await a.admin({ type: 'start' });
    await p3.playerState((x) => x.phase === 'open');
    p3.send({ type: 'answer', text: 'portugal' });
    p4.send({ type: 'answer', text: 'Czech Republic' });
    p8.send({ type: 'answer', text: 'Tjekkiet' }); // Danish spelling: not in the alias table
    await a.adminState((x) => x.teams.filter((t) => t.answer !== null).length === 3);
    await a.admin({ type: 'lock' });
    expect((await a.admin({ type: 'grade' })).type).toBe('ok');
    const graded = await a.adminState((x) => x.phase === 'reveal', 8000);
    expect(graded.gradeStatus).toBe('failed'); // no ANTHROPIC_API_KEY in the test env
    expect(graded.teams[2]?.grade).toMatchObject({ rank: 10, points: 10, needsReview: false });
    expect(graded.teams[3]?.grade).toMatchObject({ rank: 9, points: 9, needsReview: false });
    expect(graded.teams[7]?.grade).toMatchObject({ rank: null, points: 0, needsReview: true });

    // Erik sets the flagged one by hand.
    expect((await a.admin({ type: 'override', team: 8, rank: 9 })).type).toBe('ok');
    await a.adminState((x) => x.teams[7]?.grade?.manual === true && x.teams[7]?.grade.rank === 9);

    // Players see nothing until rows are revealed.
    let s3 = await p3.playerState((x) => x.phase === 'reveal');
    expect(s3.rows.every((r) => r.name === null)).toBe(true);
    expect(s3.result).toEqual({ kind: 'pending' });
    for (let i = 1; i <= 9; i++) {
      await a.admin({ type: 'revealNext' });
      s3 = await p3.playerState((x) => x.revealed === i);
      expect(s3.result).toEqual({ kind: 'pending' });
      expect(s3.rows[i - 1]?.name).not.toBeNull();
      expect(s3.rows[i]?.name).toBeNull();
    }
    const s4 = await p4.playerState((x) => x.revealed === 9);
    expect(s4.result).toEqual({ kind: 'hit', rank: 9, points: 9, rowName: 'Tjeckien' });
    await a.admin({ type: 'revealNext' });
    s3 = await p3.playerState((x) => x.revealed === 10);
    expect(s3.result).toEqual({ kind: 'hit', rank: 10, points: 10, rowName: 'Portugal' });
    expect(s3.visibleRows).toBe(15);
    expect(s3.rows[10]).toEqual({ rank: 11, name: 'Sverige', label: '10,6 milj', near: true });
    expect((await a.admin({ type: 'revealNext' })).type).toBe('error');

    await a.admin({ type: 'standings' });
    const st = await p3.playerState((x) => x.phase === 'standings');
    expect(st.standings.slice(0, 3)).toEqual([
      { position: 1, team: 3, points: 10 },
      { position: 2, team: 4, points: 9 },
      { position: 2, team: 8, points: 9 },
    ]);
    expect(st.last).toBe('Senaste: portugal, plats 10, +10 poäng');

    await a.admin({ type: 'next' });
    const lobby = await p3.playerState((x) => x.phase === 'lobby');
    expect(lobby.questionIndex).toBe(1);
    expect(lobby.answer).toBeNull();
    expect(lobby.standings[0]).toEqual({ position: 1, team: 3, points: 10 });
  });

  it('manual entry from admin is graded like any other answer, before and after Rätta', async () => {
    const p7 = await joined('device-kkkkkkkk', 7);
    await a.admin({ type: 'start' });
    await p7.playerState((x) => x.phase === 'open');
    expect((await a.admin({ type: 'manualAnswer', team: 7, text: 'Polen' })).type).toBe('ok');
    const s7 = await p7.playerState((x) => x.answer === 'Polen');
    expect(s7.answerSource).toBe('admin');
    await a.admin({ type: 'lock' });
    await a.admin({ type: 'grade' });
    await a.adminState((x) => x.phase === 'reveal' && x.teams[6]?.grade?.rank === 5, 8000);
    // After grading: a hand-typed answer for Lag 2 gets graded on the spot (exact hit).
    expect((await a.admin({ type: 'manualAnswer', team: 2, text: 'Belgien' })).type).toBe('ok');
    const av = await a.adminState((x) => x.teams[1]?.grade?.rank === 8, 8000);
    expect(av.teams[1]?.grade).toMatchObject({ rank: 8, points: 8, manual: false });
  });
});

describe('resilience (§2.9)', () => {
  it('survives a Durable Object restart mid-question with slots, answers and the clock intact', async () => {
    const p = await joined('device-llllllll', 5);
    const token = (await p.playerState((s) => s.team === 5)).claimToken;
    await a.admin({ type: 'start' });
    await a.admin({ type: 'pause' }); // pause so the 2 s clock cannot run out during the restart
    await p.playerState((x) => x.pausedRemainingMs !== null);
    p.send({ type: 'answer', text: 'Italien' });
    await p.until((m) => m.type === 'ok');
    const before = await a.adminState((x) => x.teams[4]?.answer === 'Italien');

    // Tear the instance down (storage kept, sockets closed) — the same thing a worker restart does.
    const stub = env.GAME.get(env.GAME.idFromName(GAME_NAME));
    await evictDurableObject(stub, { webSockets: 'close' });
    await sleep(200);

    const p2 = await player('device-llllllll', 5, token);
    open.push(p2);
    const s = await p2.playerState();
    expect(s.team).toBe(5);
    expect(s.phase).toBe('open');
    expect(s.answer).toBe('Italien');
    expect(s.pausedRemainingMs).toBe(before.pausedRemainingMs);
    expect(s.questionIndex).toBe(before.questionIndex);

    a = await admin();
    open.push(a);
    const av = await a.adminState();
    expect(av.teams[4]?.claimed).toBe(true);
  });

  it('an idle phone that only pings stays "väntar" well past the presence window', async () => {
    const p = await joined('device-nnnnnnnn', 2);
    await a.adminState((x) => x.teams[1]?.status === 'väntar');
    const t0 = Date.now();
    while (Date.now() - t0 < 10_500) {
      p.ws.send('ping'); // what the player page sends every 3 s
      await sleep(2_000);
    }
    a.send({ type: 'ping' });
    const av = await a.adminState();
    expect(av.teams[1]?.status).toBe('väntar');
    expect(av.teams[1]?.online).toBe(true);
  });

  it('shows offline within a few seconds of a phone closing its socket', async () => {
    const p = await joined('device-mmmmmmmm', 1);
    await a.adminState((x) => x.teams[0]?.online === true);
    const t0 = Date.now();
    p.close();
    const off = await a.adminState((x) => x.teams[0]?.status === 'offline', 10_000);
    expect(off.teams[0]?.claimed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});

describe('R3 review fix: grade requests have an identity (grade-request-has-no-identity)', () => {
  const STATE_KEY = 'state'; // the DO's storage key
  const stub = () => env.GAME.get(env.GAME.idFromName(GAME_NAME));

  /** Question 1 played to the standings: Lag 2 = Portugal (exact hit, 10 points, no model call). */
  async function standings(): Promise<Client> {
    const p2 = await joined('device-rrrrrrrr', 2);
    await a.admin({ type: 'start' });
    await p2.playerState((x) => x.phase === 'open');
    p2.send({ type: 'answer', text: 'Portugal' });
    await p2.until((m) => m.type === 'ok');
    await a.admin({ type: 'lock' });
    await a.admin({ type: 'grade' });
    await a.adminState((x) => x.phase === 'reveal', 8000);
    await a.admin({ type: 'revealAll' });
    await a.admin({ type: 'standings' });
    await a.adminState((x) => x.phase === 'standings');
    return p2;
  }

  it('"Nästa fråga" is refused with a message while a hand-typed answer is with the grader, then accepted with the points intact', async () => {
    const p2 = await standings();
    // A slow model: 1.5 s, then "Tjekkiet" → Tjeckien (plats 9). The request is in flight long
    // enough to tap "Nästa fråga" meanwhile.
    await setModel('slow');
    try {
      a.send({ type: 'manualAnswer', team: 3, text: 'Tjekkiet', token: TOKEN });
      await a.adminState((x) => x.gradeStatus === 'running');
      a.send({ type: 'next', token: TOKEN });
      const reply = await a.until((m) => m.type === 'error' || (m.type === 'ok' && m.of === 'next'));
      expect(reply).toEqual({ type: 'error', code: 'busy', message: 'Rättning pågår – vänta några sekunder och tryck igen.' });
      const still = await a.adminState((x) => x.phase === 'standings');
      expect(still.questionIndex).toBe(0);

      // The grade lands (plats 9, 9 points); only now is next accepted, and the points stay.
      const settled = await a.adminState((x) => x.gradeStatus === 'done' && x.teams[2]?.grade?.rank === 9, 8000);
      expect(settled.phase).toBe('standings');
      expect(settled.teams[2]?.grade).toMatchObject({ rank: 9, points: 9, manual: false, needsReview: false });
      a.send({ type: 'next', token: TOKEN });
      const ok = await a.until((m) => m.type === 'error' || (m.type === 'ok' && m.of === 'next'));
      expect(ok).toEqual({ type: 'ok', of: 'next' });
      const lobby = await p2.playerState((x) => x.phase === 'lobby');
      expect(lobby.questionIndex).toBe(1);
      expect(lobby.standings.slice(0, 2)).toEqual([
        { position: 1, team: 2, points: 10 },
        { position: 2, team: 3, points: 9 },
      ]);
    } finally {
      await setModel('fail');
    }
  });

  it('a restart while a request is out re-sends exactly that request; its grade lands and the game goes on (§2.9)', async () => {
    await standings();
    // Freeze the moment between "request persisted" and "result landed": Erik typed Belgien for
    // Lag 4 from the standings, the request went out as id 7, and the Worker died.
    await runInDurableObject(stub(), async (_instance, state) => {
      const s = (await state.storage.get<GameState>(STATE_KEY))!;
      s.answers['0:4'] = { text: 'Belgien', updatedAt: Date.now(), source: 'admin' };
      s.gradeInFlight['7'] = { id: 7, questionIndex: 0, answers: [{ team: 4, text: 'Belgien' }] };
      s.gradeSeq = 8;
      s.gradeStatus['0'] = 'running';
      await state.storage.put(STATE_KEY, s);
    });
    await evictDurableObject(stub(), { webSockets: 'close' });
    await sleep(200);

    a = await admin();
    open.push(a);
    // The re-sent request is an exact hit (no model needed): rank 8, 8 points, and the question
    // is settled — still on the standings, nothing skipped.
    const landed = await a.adminState((x) => x.teams[3]?.grade?.rank === 8 && x.gradeStatus === 'done', 8000);
    expect(landed.phase).toBe('standings');
    expect(landed.questionIndex).toBe(0);
    expect(landed.teams[3]?.grade).toMatchObject({ rank: 8, points: 8, manual: false, needsReview: false });
    expect(landed.teams[3]?.total).toBe(8);
    expect(landed.teams[1]?.total).toBe(10);
    expect((await a.admin({ type: 'next' })).type).toBe('ok');
    await a.adminState((x) => x.phase === 'lobby' && x.questionIndex === 1);
  });

  it('a state from the build before request ids (grading, nothing outstanding) is graded afresh after a restart', async () => {
    const p2 = await joined('device-ssssssss', 2);
    await a.admin({ type: 'start' });
    await p2.playerState((x) => x.phase === 'open');
    p2.send({ type: 'answer', text: 'Portugal' });
    await p2.until((m) => m.type === 'ok');
    await a.admin({ type: 'lock' });
    await a.adminState((x) => x.phase === 'locked');
    await runInDurableObject(stub(), async (_instance, state) => {
      const s = (await state.storage.get<GameState>(STATE_KEY))!;
      const legacy = { ...s, phase: 'grading', gradePending: 1 } as Record<string, unknown>;
      delete legacy['gradeInFlight'];
      delete legacy['gradeSeq'];
      await state.storage.put(STATE_KEY, legacy);
    });
    await evictDurableObject(stub(), { webSockets: 'close' });
    await sleep(200);

    a = await admin();
    open.push(a);
    const graded = await a.adminState((x) => x.phase === 'reveal', 8000);
    expect(graded.teams[1]?.grade).toMatchObject({ rank: 10, points: 10 });
    expect(graded.gradeStatus).toBe('done');
  });
});
