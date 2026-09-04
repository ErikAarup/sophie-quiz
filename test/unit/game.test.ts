import { describe, expect, it } from 'vitest';
import { CONFIRM_WORD, answerKey, type GameState } from '../../src/shared/types.ts';
import { gradesInFlight, migrateState, remainingMs } from '../../src/shared/game.ts';
import { adminView } from '../../src/shared/view.ts';
import { T0, claimAll, fresh, quiz, run, step } from './helpers.ts';
import { buildQuiz, quizFile } from '../../src/worker/bank.ts';

const DURATION = quiz.durationMs; // 150 000 from data/quiz.json
const eu = quiz.questions[0]!;
const rowIndexOf = (name: string) => eu.rows.findIndex((r) => r.name === name);

describe('quiz data', () => {
  it("the evening's quiz.json builds: ten verified lists, each with at least ten rows", () => {
    const real = buildQuiz();
    expect(quizFile.questions).toHaveLength(10);
    expect(real.questions.map((q) => q.slug)).toEqual(quizFile.questions);
    for (const q of real.questions) {
      expect(q.rows.length).toBeGreaterThanOrEqual(10);
      expect(q.topCount).toBeGreaterThanOrEqual(10);
    }
  });

  it('loads ten verified lists with 15 rows and a top ten', () => {
    expect(quiz.questions).toHaveLength(10);
    expect(DURATION).toBe(150_000);
    for (const q of quiz.questions) {
      expect(q.rows.length).toBeGreaterThanOrEqual(10);
      expect(q.topCount).toBeGreaterThanOrEqual(10);
    }
    expect(eu.title).toBe('EU:s folkrikaste länder');
    expect(eu.rows[9]?.name).toBe('Portugal');
    expect(eu.rows[9]?.label).toBe('10,7 milj');
  });
});

describe('join (§2.1)', () => {
  it('binds a slot, refuses a second device with the Swedish message, and is idempotent for the same device', () => {
    const s1 = run(fresh(), [{ type: 'claim', team: 3, deviceId: 'a' }], T0);
    expect(s1.slots[3]).toEqual({ deviceId: 'a', claimedAt: T0 });
    const refused = step(s1, { type: 'claim', team: 3, deviceId: 'b' }, T0);
    expect(refused.error).toEqual({ code: 'taken', message: 'Lag 3 är redan taget' });
    expect(refused.state.slots[3]?.deviceId).toBe('a');
    const again = step(s1, { type: 'claim', team: 3, deviceId: 'a' }, T0 + 5);
    expect(again.error).toBeUndefined();
    expect(again.changed).toBe(false);
  });

  it('release frees the slot, kicks the device, and lets another device claim', () => {
    const s1 = run(fresh(), [{ type: 'claim', team: 3, deviceId: 'a' }], T0);
    const out = step(s1, { type: 'release', team: 3 }, T0);
    expect(out.kicked).toEqual([{ team: 3, deviceId: 'a', reason: 'release' }]);
    expect(out.state.slots[3]).toBeNull();
    const s2 = run(out.state, [{ type: 'claim', team: 3, deviceId: 'b' }], T0);
    expect(s2.slots[3]?.deviceId).toBe('b');
  });
});

describe('question clock (§2.2, §2.3)', () => {
  it('start opens the question with a server deadline and an alarm', () => {
    const out = step(claimAll(fresh()), { type: 'start' }, T0);
    expect(out.state.phase).toBe('open');
    expect(out.state.deadlineAt).toBe(T0 + DURATION);
    expect(out.state.totalMs).toBe(DURATION);
    expect(out.alarm).toBe(T0 + DURATION);
    expect(remainingMs(out.state, T0 + 1_000)).toBe(DURATION - 1_000);
  });

  it('refuses start outside the lobby', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    expect(step(s, { type: 'start' }, T0).error?.code).toBe('phase');
  });

  it('pause stores the remaining time and clears the alarm; resume continues from it', () => {
    let s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const paused = step(s, { type: 'pause' }, T0 + 40_000);
    expect(paused.state.pausedRemainingMs).toBe(DURATION - 40_000);
    expect(paused.state.deadlineAt).toBeNull();
    expect(paused.alarm).toBeNull();
    // A reload of the admin page changes nothing server-side: still paused, same remaining.
    expect(remainingMs(paused.state, T0 + 400_000)).toBe(DURATION - 40_000);
    const resumed = step(paused.state, { type: 'resume' }, T0 + 400_000);
    expect(resumed.state.deadlineAt).toBe(T0 + 400_000 + DURATION - 40_000);
    expect(resumed.alarm).toBe(resumed.state.deadlineAt);
    s = resumed.state;
    expect(step(s, { type: 'resume' }, T0).error?.code).toBe('phase');
  });

  it('+30 s moves the deadline while running and the remaining time while paused', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const ext = step(s, { type: 'extend' }, T0 + 10_000);
    expect(ext.state.deadlineAt).toBe(T0 + DURATION + 30_000);
    expect(ext.state.totalMs).toBe(DURATION + 30_000);
    expect(ext.alarm).toBe(T0 + DURATION + 30_000);
    const p = run(s, [{ type: 'pause' }], T0 + 10_000);
    const ext2 = step(p, { type: 'extend' }, T0 + 20_000);
    expect(ext2.state.pausedRemainingMs).toBe(DURATION - 10_000 + 30_000);
    expect(ext2.alarm).toBeUndefined();
  });

  it('lock early stops the clock', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const out = step(s, { type: 'lock' }, T0 + 5_000);
    expect(out.state.phase).toBe('locked');
    expect(out.alarm).toBeNull();
  });

  it('locks on the server at zero even if the alarm is late: an answer at deadline is refused and the lock persists', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const late = step(s, { type: 'answer', team: 1, text: 'Portugal', source: 'team' }, T0 + DURATION);
    expect(late.error?.code).toBe('locked');
    expect(late.error?.message).toBe('Tiden är ute – svaret togs inte emot.');
    expect(late.state.phase).toBe('locked');
    expect(late.changed).toBe(true);
    expect(late.state.answers[answerKey(0, 1)]).toBeUndefined();
    const alarm = step(s, { type: 'alarm' }, T0 + DURATION + 1);
    expect(alarm.state.phase).toBe('locked');
    expect(alarm.changed).toBe(true);
  });

  it('an alarm that fires early (still time left) does not lock', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const out = step(s, { type: 'alarm' }, T0 + DURATION - 2_000);
    expect(out.state.phase).toBe('open');
  });
});

describe('answers (§2.4)', () => {
  it('accepts, replaces until lock, keeps the last text', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const a1 = run(s, [{ type: 'answer', team: 3, text: '  Spanien ', source: 'team' }], T0 + 1_000);
    expect(a1.answers[answerKey(0, 3)]).toEqual({ text: 'Spanien', updatedAt: T0 + 1_000, source: 'team' });
    const a2 = run(a1, [{ type: 'answer', team: 3, text: 'Portugal', source: 'team' }], T0 + 2_000);
    expect(a2.answers[answerKey(0, 3)]?.text).toBe('Portugal');
    const locked = run(a2, [{ type: 'lock' }], T0 + 3_000);
    expect(step(locked, { type: 'answer', team: 3, text: 'Polen', source: 'team' }, T0 + 4_000).error?.code).toBe('locked');
    expect(locked.answers[answerKey(0, 3)]?.text).toBe('Portugal');
  });

  it('refuses empty answers and answers before the question starts', () => {
    const s = claimAll(fresh());
    expect(step(s, { type: 'answer', team: 3, text: 'x', source: 'team' }, T0).error?.code).toBe('notOpen');
    const open = run(s, [{ type: 'start' }], T0);
    expect(step(open, { type: 'answer', team: 3, text: '   ', source: 'team' }, T0).error?.code).toBe('empty');
  });

  it('truncates absurdly long answers to 80 characters', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const s = run(open, [{ type: 'answer', team: 1, text: 'a'.repeat(500), source: 'team' }], T0);
    expect(s.answers[answerKey(0, 1)]?.text).toHaveLength(80);
  });
});

describe('grading, override, reveal (§2.5, §2.6)', () => {
  function graded() {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const answered = run(
      open,
      [
        { type: 'answer', team: 1, text: 'Spanien', source: 'team' },
        { type: 'answer', team: 3, text: 'Portugal', source: 'team' },
        { type: 'answer', team: 4, text: 'Sverige', source: 'team' },
        { type: 'answer', team: 8, text: 'Norge', source: 'team' },
      ],
      T0 + 1_000,
    );
    const locked = run(answered, [{ type: 'lock' }], T0 + 2_000);
    const g = step(locked, { type: 'grade' }, T0 + 3_000);
    expect(g.state.phase).toBe('grading');
    expect(g.grade).toEqual({
      id: 0,
      questionIndex: 0,
      answers: [
        { team: 1, text: 'Spanien' },
        { team: 3, text: 'Portugal' },
        { team: 4, text: 'Sverige' },
        { team: 8, text: 'Norge' },
      ],
    });
    expect(g.state.gradeInFlight).toEqual({ '0': g.grade });
    const result = step(
      g.state,
      {
        type: 'gradeResult',
        requestId: 0,
        failed: false,
        results: [
          { team: 1, gradedText: 'Spanien', rowIndex: rowIndexOf('Spanien'), needsReview: false, reason: 'exact' },
          { team: 3, gradedText: 'Portugal', rowIndex: rowIndexOf('Portugal'), needsReview: false, reason: 'exact' },
          { team: 4, gradedText: 'Sverige', rowIndex: rowIndexOf('Sverige'), needsReview: false, reason: 'exact' },
          { team: 8, gradedText: 'Norge', rowIndex: null, needsReview: false, reason: 'not in list' },
        ],
      },
      T0 + 4_000,
    );
    return result.state;
  }

  it('grades ranks 1–10 as points, 11–15 as 0 with the position kept, no match as 0', () => {
    const s = graded();
    expect(s.phase).toBe('reveal');
    expect(s.revealed).toBe(0);
    expect(s.gradeStatus['0']).toBe('done');
    expect(s.gradeInFlight).toEqual({});
    expect(s.grades[answerKey(0, 1)]).toMatchObject({ rank: 4, points: 4, manual: false });
    expect(s.grades[answerKey(0, 3)]).toMatchObject({ rank: 10, points: 10 });
    expect(s.grades[answerKey(0, 4)]).toMatchObject({ rank: 11, points: 0 });
    expect(s.grades[answerKey(0, 8)]).toMatchObject({ rank: null, rowIndex: null, points: 0 });
  });

  it('grade refuses while open, and refuses twice at once', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    expect(step(open, { type: 'grade' }, T0).error?.code).toBe('phase');
    const locked = run(open, [{ type: 'lock' }], T0);
    const g = run(locked, [{ type: 'grade' }], T0);
    expect(step(g, { type: 'grade' }, T0).error?.code).toBe('busy');
  });

  it('a failed model run marks the status failed and still moves to reveal with needsReview rows', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const answered = run(open, [{ type: 'answer', team: 2, text: 'Czechia', source: 'team' }], T0);
    const g = run(answered, [{ type: 'lock' }, { type: 'grade' }], T0);
    const r = run(
      g,
      [
        {
          type: 'gradeResult',
          requestId: 0,
          failed: true,
          results: [{ team: 2, gradedText: 'Czechia', rowIndex: null, needsReview: true, reason: 'model unavailable' }],
        },
      ],
      T0,
    );
    expect(r.phase).toBe('reveal');
    expect(r.gradeStatus['0']).toBe('failed');
    expect(r.grades[answerKey(0, 2)]).toMatchObject({ needsReview: true, points: 0 });
  });

  it('ignores a stale grade whose text no longer matches, and never overwrites a manual grade', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const answered = run(open, [{ type: 'answer', team: 5, text: 'Polen', source: 'team' }], T0);
    const g = run(answered, [{ type: 'lock' }, { type: 'grade' }], T0);
    // Erik changes the text by hand while the model is running, and overrides Lag 6 by hand.
    const changed = run(
      g,
      [
        { type: 'answer', team: 5, text: 'Belgien', source: 'admin' },
        { type: 'override', team: 6, rank: 2 },
      ],
      T0 + 1,
    );
    const r = run(
      changed,
      [
        {
          type: 'gradeResult',
          requestId: 0, // the batch
          failed: false,
          results: [
            { team: 5, gradedText: 'Polen', rowIndex: rowIndexOf('Polen'), needsReview: false, reason: '' },
            { team: 6, gradedText: '', rowIndex: rowIndexOf('Tyskland'), needsReview: false, reason: '' },
          ],
        },
      ],
      T0 + 2,
    );
    expect(r.grades[answerKey(0, 5)]).toBeUndefined(); // stale, dropped; the DO grades 'Belgien' separately (request 1)
    expect(Object.keys(r.gradeInFlight)).toEqual(['1']);
    expect(r.grades[answerKey(0, 6)]).toMatchObject({ rank: 2, points: 2, manual: true });
  });

  it('override sets rank 0–15 by hand, before or after the reveal, and the points follow', () => {
    const s = graded();
    const o = run(s, [{ type: 'override', team: 8, rank: 12 }], T0);
    expect(o.grades[answerKey(0, 8)]).toMatchObject({ rank: 12, points: 0, manual: true, rowIndex: rowIndexOf('Grekland') });
    const o2 = run(o, [{ type: 'override', team: 8, rank: 0 }], T0);
    expect(o2.grades[answerKey(0, 8)]).toMatchObject({ rank: null, points: 0, manual: true });
    const o3 = run(o2, [{ type: 'override', team: 7, rank: 9 }], T0); // Lag 7 never answered
    expect(o3.grades[answerKey(0, 7)]).toMatchObject({ rank: 9, points: 9, manual: true, gradedText: '' });
    expect(step(s, { type: 'override', team: 1, rank: 16 }, T0).error?.code).toBe('badRank');
    expect(step(s, { type: 'override', team: 1, rank: -1 }, T0).error?.code).toBe('badRank');
  });

  it('manual entry after grading asks the DO to grade that one answer', () => {
    const s = graded();
    const out = step(s, { type: 'answer', team: 6, text: 'Italien', source: 'admin' }, T0);
    expect(out.error).toBeUndefined();
    expect(out.state.answers[answerKey(0, 6)]).toMatchObject({ text: 'Italien', source: 'admin' });
    expect(out.grade).toEqual({ id: 1, questionIndex: 0, answers: [{ team: 6, text: 'Italien' }] });
  });

  it('manual entry while the question is open is graded with everyone else on Rätta', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const out = step(open, { type: 'answer', team: 6, text: 'Italien', source: 'admin' }, T0);
    expect(out.grade).toBeUndefined();
    const g = step(run(out.state, [{ type: 'lock' }], T0), { type: 'grade' }, T0);
    expect(g.grade?.answers).toEqual([{ team: 6, text: 'Italien' }]);
  });

  it('reveals row by row up to the top ten, then all; refuses past the end', () => {
    let s = graded();
    for (let i = 1; i <= 10; i++) {
      s = run(s, [{ type: 'revealNext' }], T0);
      expect(s.revealed).toBe(i);
    }
    expect(step(s, { type: 'revealNext' }, T0).error?.code).toBe('done');
    const all = run(graded(), [{ type: 'revealAll' }], T0);
    expect(all.revealed).toBe(eu.topCount);
  });

  it('reveal is refused while the question is open', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    expect(step(open, { type: 'revealNext' }, T0).error?.code).toBe('phase');
  });
});

describe('standings and moving on (§2.7)', () => {
  function afterReveal() {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'answer', team: 2, text: 'Tyskland', source: 'team' }, { type: 'lock' }, { type: 'grade' }], T0);
    return run(
      g,
      [
        {
          type: 'gradeResult',
          requestId: 0,
          failed: false,
          results: [{ team: 2, gradedText: 'Tyskland', rowIndex: rowIndexOf('Tyskland'), needsReview: false, reason: '' }],
        },
        { type: 'revealAll' },
      ],
      T0,
    );
  }

  it('standings <-> reveal, then next opens the lobby for the following question', () => {
    const s = afterReveal();
    const st = run(s, [{ type: 'standings' }], T0);
    expect(st.phase).toBe('standings');
    const back = run(st, [{ type: 'backToReveal' }], T0);
    expect(back.phase).toBe('reveal');
    const nx = step(st, { type: 'next' }, T0);
    expect(nx.state.phase).toBe('lobby');
    expect(nx.state.questionIndex).toBe(1);
    expect(nx.state.deadlineAt).toBeNull();
    expect(nx.state.revealed).toBe(0);
    expect(nx.alarm).toBeNull();
    // Earlier grades survive for the cumulative leaderboard.
    expect(nx.state.grades[answerKey(0, 2)]?.points).toBe(1);
  });

  it('after the last question, next ends in final', () => {
    let s = claimAll(fresh());
    for (let q = 0; q < quiz.questions.length; q++) {
      s = run(s, [{ type: 'start' }, { type: 'lock' }, { type: 'grade' }], T0);
      s = run(s, [{ type: 'gradeResult', requestId: q, failed: false, results: [] }, { type: 'revealAll' }, { type: 'standings' }, { type: 'next' }], T0);
    }
    expect(s.phase).toBe('final');
    expect(s.questionIndex).toBe(quiz.questions.length - 1);
    expect(step(s, { type: 'start' }, T0).error?.code).toBe('phase');
  });
});

describe('R1 review fixes', () => {
  it('a release survives an offline phone: its automatic re-claim with the old token is refused, a tap is a fresh claim', () => {
    const s1 = run(fresh(), [{ type: 'claim', team: 3, deviceId: 'a' }], T0);
    const token = s1.claimGen[3];
    // Same device reconnecting with its token: fine.
    expect(step(s1, { type: 'claim', team: 3, deviceId: 'a', auto: true, token }, T0).error).toBeUndefined();
    // Erik releases while the phone is away (kicked reaches nobody).
    const released = step(s1, { type: 'release', team: 3 }, T0).state;
    expect(released.slots[3]).toBeNull();
    expect(released.claimGen[3]).toBe(token + 1);
    const back = step(released, { type: 'claim', team: 3, deviceId: 'a', auto: true, token }, T0);
    expect(back.error).toEqual({ code: 'stale', message: 'Erik släppte Lag 3. Välj lag igen.' });
    expect(back.state.slots[3]).toBeNull();
    // An explicit tap after that is a new claim and works.
    expect(step(released, { type: 'claim', team: 3, deviceId: 'a' }, T0).state.slots[3]?.deviceId).toBe('a');
    // No token at all (an old client) is refused too.
    expect(step(released, { type: 'claim', team: 3, deviceId: 'a', auto: true, token: null }, T0).error?.code).toBe('stale');
  });

  it('resetGame invalidates every remembered claim', () => {
    const s1 = claimAll(fresh());
    const token = s1.claimGen[5];
    const reset = step(s1, { type: 'resetGame', confirm: CONFIRM_WORD }, T0);
    expect(reset.kicked.map((k) => k.reason)).toEqual(Array(8).fill('reset'));
    expect(reset.state.claimGen[5]).toBe(token + 1);
    expect(step(reset.state, { type: 'claim', team: 5, deviceId: 'dev-5', auto: true, token }, T0).error?.code).toBe('stale');
  });

  it('one slot per device: a second claim moves the device and kicks its old team only', () => {
    const s1 = run(fresh(), [{ type: 'claim', team: 3, deviceId: 'a' }, { type: 'claim', team: 4, deviceId: 'b' }], T0);
    const out = step(s1, { type: 'claim', team: 5, deviceId: 'a' }, T0);
    expect(out.error).toBeUndefined();
    expect(out.state.slots[3]).toBeNull();
    expect(out.state.slots[5]?.deviceId).toBe('a');
    expect(out.state.slots[4]?.deviceId).toBe('b');
    expect(out.kicked).toEqual([{ team: 3, deviceId: 'a', reason: 'moved' }]);
    expect(out.state.claimGen[3]).toBe(s1.claimGen[3] + 1);
  });

  it('the auto-lock survives a refused event (empty answer, late pause) and a bare tick', () => {
    const s = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const empty = step(s, { type: 'answer', team: 1, text: '   ', source: 'team' }, T0 + DURATION + 1_000);
    expect(empty.error?.code).toBe('locked'); // the clock ran out first; that is the message the phone needs
    expect(empty.state.phase).toBe('locked');
    expect(empty.changed).toBe(true);
    expect(empty.alarm).toBeNull();

    const pause = step(s, { type: 'pause' }, T0 + DURATION + 5_000);
    expect(pause.error?.code).toBe('phase');
    expect(pause.state.phase).toBe('locked');
    expect(pause.changed).toBe(true);

    const tick = step(s, { type: 'tick' }, T0 + DURATION);
    expect(tick.state.phase).toBe('locked');
    expect(tick.changed).toBe(true);
    const early = step(s, { type: 'tick' }, T0 + 10);
    expect(early.state.phase).toBe('open');
    expect(early.changed).toBe(false);
    expect(early.alarm).toBeUndefined();
  });

  it('a manual answer typed while the batch is in flight does not end grading early', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const locked = run(open, [{ type: 'answer', team: 1, text: 'Tjekkiet', source: 'team' }, { type: 'lock' }], T0);
    const g = step(locked, { type: 'grade' }, T0);
    expect(gradesInFlight(g.state)).toBe(1);
    const manual = step(g.state, { type: 'answer', team: 2, text: 'Belgien', source: 'admin' }, T0 + 1);
    expect(manual.grade).toEqual({ id: 1, questionIndex: 0, answers: [{ team: 2, text: 'Belgien' }] });
    expect(gradesInFlight(manual.state)).toBe(2);
    // The quick one comes back first: still grading, nothing revealed.
    const first = step(
      manual.state,
      { type: 'gradeResult', requestId: 1, failed: false, results: [{ team: 2, gradedText: 'Belgien', rowIndex: rowIndexOf('Belgien'), needsReview: false, reason: 'Exakt träff' }] },
      T0 + 2,
    );
    expect(first.state.phase).toBe('grading');
    expect(gradesInFlight(first.state)).toBe(1);
    expect(first.state.gradeStatus['0']).toBe('running');
    expect(step(first.state, { type: 'revealNext' }, T0).error?.code).toBe('phase');
    // The batch lands: now the reveal may start, with the batch's failure remembered.
    const second = step(
      first.state,
      { type: 'gradeResult', requestId: 0, failed: true, results: [{ team: 1, gradedText: 'Tjekkiet', rowIndex: null, needsReview: true, reason: 'model down' }] },
      T0 + 3,
    );
    expect(second.state.phase).toBe('reveal');
    expect(gradesInFlight(second.state)).toBe(0);
    expect(second.state.gradeStatus['0']).toBe('failed');
    expect(second.state.grades[answerKey(0, 2)]?.points).toBe(8);
    expect(second.state.grades[answerKey(0, 1)]?.needsReview).toBe(true);
  });

  it('grade is refused while any request is in flight', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'lock' }, { type: 'grade' }], T0);
    expect(step(g, { type: 'grade' }, T0).error?.code).toBe('busy');
  });
});

describe('R3 review fix: grade requests have an identity (grade-request-has-no-identity)', () => {
  const ONLINE = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true };

  /** Question 1 graded (Lag 1 = Tyskland, 1 point; request 0 settled) and the standings shown. */
  function standingsWithLag1Graded(): GameState {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'answer', team: 1, text: 'Tyskland', source: 'team' }, { type: 'lock' }, { type: 'grade' }], T0);
    return run(
      g,
      [
        { type: 'gradeResult', requestId: 0, failed: false, results: [{ team: 1, gradedText: 'Tyskland', rowIndex: rowIndexOf('Tyskland'), needsReview: false, reason: '' }] },
        { type: 'revealAll' },
        { type: 'standings' },
      ],
      T0,
    );
  }

  it('route A: "Nästa fråga" is refused, with a message, while a hand-typed answer is being graded; the grade lands, then next works and the points stay', () => {
    const st = standingsWithLag1Graded();
    expect(adminView(st, quiz, T0, ONLINE).teams[0]?.total).toBe(1);
    // Erik corrects Lag 1's answer from the standings (SPELLEDNING: "även efter att ställningen visats").
    const typed = step(st, { type: 'answer', team: 1, text: 'Spanien', source: 'admin' }, T0 + 1);
    expect(typed.grade).toEqual({ id: 1, questionIndex: 0, answers: [{ team: 1, text: 'Spanien' }] });
    expect(typed.state.grades[answerKey(0, 1)]).toBeUndefined(); // the old grade is stale
    expect(adminView(typed.state, quiz, T0, ONLINE).gradeStatus).toBe('running');

    // Tapping "Nästa fråga" now would drop those points: refused, never silently.
    const early = step(typed.state, { type: 'next' }, T0 + 2);
    expect(early.error).toEqual({ code: 'busy', message: 'Rättning pågår – vänta några sekunder och tryck igen.' });
    expect(early.state.phase).toBe('standings');
    expect(early.state.questionIndex).toBe(0);
    expect(gradesInFlight(early.state)).toBe(1);

    // The result lands by id: graded, status done, still on the standings.
    const landed = step(
      typed.state,
      { type: 'gradeResult', requestId: 1, failed: false, results: [{ team: 1, gradedText: 'Spanien', rowIndex: rowIndexOf('Spanien'), needsReview: false, reason: '' }] },
      T0 + 3,
    );
    expect(landed.state.phase).toBe('standings');
    expect(landed.state.grades[answerKey(0, 1)]).toMatchObject({ rank: 4, points: 4, manual: false });
    expect(landed.state.gradeStatus['0']).toBe('done');
    expect(gradesInFlight(landed.state)).toBe(0);

    const nx = step(landed.state, { type: 'next' }, T0 + 4);
    expect(nx.error).toBeUndefined();
    expect(nx.state.phase).toBe('lobby');
    expect(nx.state.questionIndex).toBe(1);
    expect(adminView(nx.state, quiz, T0, ONLINE).teams[0]?.total).toBe(4); // on every leaderboard from now on
    expect(adminView(nx.state, quiz, T0, ONLINE).standings[0]).toEqual({ position: 1, team: 1, points: 4 });
  });

  it('"Nästa fråga" is refused from the reveal too while a request is out, and accepted once it settles', () => {
    const st = standingsWithLag1Graded();
    const back = run(st, [{ type: 'backToReveal' }, { type: 'answer', team: 5, text: 'Belgien', source: 'admin' }], T0);
    expect(step(back, { type: 'next' }, T0).error?.code).toBe('busy');
    const settled = run(back, [{ type: 'gradeResult', requestId: 1, failed: false, results: [{ team: 5, gradedText: 'Belgien', rowIndex: rowIndexOf('Belgien'), needsReview: false, reason: '' }] }], T0);
    expect(settled.phase).toBe('reveal');
    expect(step(settled, { type: 'next' }, T0).error).toBeUndefined();
  });

  it('route B: a result for a request abandoned by "Nollställ frågan" is ignored, so it cannot end the replay\'s grading', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = step(run(open, [{ type: 'answer', team: 1, text: 'gammalt svar', source: 'team' }, { type: 'lock' }], T0), { type: 'grade' }, T0);
    expect(g.grade?.id).toBe(0);
    // Reset while request 0 is out, then play the same question again.
    const reset = run(g.state, [{ type: 'resetQuestion', confirm: CONFIRM_WORD }], T0 + 1);
    expect(reset.questionIndex).toBe(0);
    expect(gradesInFlight(reset)).toBe(0);
    expect(reset.gradeStatus['0']).toBeUndefined();
    const replay = step(run(reset, [{ type: 'start' }, { type: 'answer', team: 1, text: 'nytt svar', source: 'team' }, { type: 'lock' }], T0 + 2), { type: 'grade' }, T0 + 2);
    expect(replay.grade?.id).toBe(1);
    expect(replay.state.phase).toBe('grading');

    // The first request's late result arrives: nothing happens.
    const stale = step(
      replay.state,
      { type: 'gradeResult', requestId: 0, failed: true, results: [{ team: 1, gradedText: 'gammalt svar', rowIndex: null, needsReview: true, reason: 'late' }] },
      T0 + 3,
    );
    expect(stale.changed).toBe(false);
    expect(stale.error).toBeUndefined();
    expect(stale.state.phase).toBe('grading');
    expect(gradesInFlight(stale.state)).toBe(1);
    expect(stale.state.grades[answerKey(0, 1)]).toBeUndefined();
    expect(stale.state.gradeStatus['0']).toBe('running');
    expect(stale.state.gradeFailed['0']).toBeUndefined(); // its failure is not remembered either
    expect(adminView(stale.state, quiz, T0, ONLINE).gradeStatus).toBe('running');

    // The replay's own result settles it.
    const real = step(
      stale.state,
      { type: 'gradeResult', requestId: 1, failed: false, results: [{ team: 1, gradedText: 'nytt svar', rowIndex: null, needsReview: false, reason: 'Utanför listan' }] },
      T0 + 4,
    );
    expect(real.state.phase).toBe('reveal');
    expect(real.state.gradeStatus['0']).toBe('done');
    expect(real.state.grades[answerKey(0, 1)]).toMatchObject({ rank: null, points: 0, needsReview: false });
  });

  it('a stale result after a reset does not stamp the question\'s grade status (the label stays idle in the lobby)', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'lock' }, { type: 'grade' }], T0);
    const reset = run(g, [{ type: 'resetQuestion', confirm: CONFIRM_WORD }], T0);
    const stale = step(reset, { type: 'gradeResult', requestId: 0, failed: true, results: [] }, T0);
    expect(stale.changed).toBe(false);
    expect(stale.state.gradeStatus['0']).toBeUndefined();
    expect(adminView(stale.state, quiz, T0, ONLINE).gradeStatus).toBe('idle');
  });

  it('a result whose id was never issued is ignored', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'lock' }, { type: 'grade' }], T0);
    const bogus = step(g, { type: 'gradeResult', requestId: 99, failed: false, results: [] }, T0);
    expect(bogus.changed).toBe(false);
    expect(bogus.state.phase).toBe('grading');
    expect(gradesInFlight(bogus.state)).toBe(1);
  });

  it('request ids never repeat: "Nollställ spelet" forgets the requests but keeps counting', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const g = run(open, [{ type: 'lock' }, { type: 'grade' }], T0);
    expect(g.gradeSeq).toBe(1);
    const reset = step(g, { type: 'resetGame', confirm: CONFIRM_WORD }, T0).state;
    expect(reset.gradeInFlight).toEqual({});
    expect(reset.gradeSeq).toBe(1);
    const again = step(run(reset, [{ type: 'claim', team: 1, deviceId: 'x' }, { type: 'start' }, { type: 'lock' }], T0), { type: 'grade' }, T0);
    expect(again.grade?.id).toBe(1);
    // The pre-reset request's result (id 0) cannot touch the new game.
    const stale = step(again.state, { type: 'gradeResult', requestId: 0, failed: false, results: [] }, T0);
    expect(stale.changed).toBe(false);
    expect(stale.state.phase).toBe('grading');
  });

  it('restart recovery: the in-flight requests are persisted with the state, and a legacy gradePending counter is dropped on load', () => {
    const st = standingsWithLag1Graded();
    const typed = step(st, { type: 'answer', team: 1, text: 'Spanien', source: 'admin' }, T0 + 1);
    // What the DO writes to storage before the request goes out: the request itself, by id.
    const persisted = JSON.parse(JSON.stringify(typed.state)) as GameState;
    expect(persisted.gradeInFlight['1']).toEqual({ id: 1, questionIndex: 0, answers: [{ team: 1, text: 'Spanien' }] });
    const reloaded = migrateState(persisted, T0 + 2);
    expect(reloaded.gradeInFlight).toEqual(typed.state.gradeInFlight);
    expect(reloaded.gradeSeq).toBe(2);
    // A state from the build before request ids: no requests to resend, counter gone.
    const legacy = { ...JSON.parse(JSON.stringify(st)), gradePending: 1 } as Partial<GameState> & { v: 1 };
    delete (legacy as { gradeInFlight?: unknown }).gradeInFlight;
    delete (legacy as { gradeSeq?: unknown }).gradeSeq;
    const migrated = migrateState(legacy, T0);
    expect(migrated.gradeInFlight).toEqual({});
    expect(migrated.gradeSeq).toBe(0);
    expect('gradePending' in migrated).toBe(false);
  });
});

describe('resets', () => {
  it('resetQuestion needs the confirm word, clears the question and returns to its lobby', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const s = run(open, [{ type: 'answer', team: 1, text: 'Polen', source: 'team' }], T0);
    expect(step(s, { type: 'resetQuestion', confirm: 'ja' }, T0).error?.code).toBe('confirm');
    const out = step(s, { type: 'resetQuestion', confirm: CONFIRM_WORD }, T0);
    expect(out.state.phase).toBe('lobby');
    expect(out.state.questionIndex).toBe(0);
    expect(out.state.answers).toEqual({});
    expect(out.alarm).toBeNull();
    expect(out.state.slots[1]?.deviceId).toBe('dev-1'); // teams stay joined
  });

  it('resetGame clears everything and kicks every phone', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const out = step(open, { type: 'resetGame', confirm: CONFIRM_WORD }, T0 + 9);
    expect(out.kicked).toHaveLength(8);
    expect(out.state.phase).toBe('lobby');
    expect(out.state.questionIndex).toBe(0);
    expect(Object.values(out.state.slots).every((s) => s === null)).toBe(true);
    expect(out.alarm).toBeNull();
  });
});
