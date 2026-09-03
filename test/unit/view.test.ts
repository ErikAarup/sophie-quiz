import { describe, expect, it } from 'vitest';
import { adminView, playerView } from '../../src/shared/view.ts';
import type { Team } from '../../src/shared/types.ts';
import { T0, claimAll, fresh, quiz, run } from './helpers.ts';

const eu = quiz.questions[0]!;
const rowIndexOf = (name: string) => eu.rows.findIndex((r) => r.name === name);
const allOnline = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true } as Record<Team, boolean>;

function revealState() {
  const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
  const s = run(
    open,
    [
      { type: 'answer', team: 3, text: 'Portugal', source: 'team' },
      { type: 'answer', team: 4, text: 'Sverige', source: 'team' },
      { type: 'answer', team: 8, text: 'Norge', source: 'team' },
      { type: 'lock' },
      { type: 'grade' },
    ],
    T0,
  );
  return run(
    s,
    [
      {
        type: 'gradeResult',
        questionIndex: 0,
        failed: false,
        results: [
          { team: 3, gradedText: 'Portugal', rowIndex: rowIndexOf('Portugal'), needsReview: false, reason: '' },
          { team: 4, gradedText: 'Sverige', rowIndex: rowIndexOf('Sverige'), needsReview: false, reason: '' },
          { team: 8, gradedText: 'Norge', rowIndex: null, needsReview: false, reason: '' },
        ],
      },
    ],
    T0,
  );
}

describe('playerView', () => {
  it('lists slots taken by other devices, not its own', () => {
    const s = run(fresh(), [{ type: 'claim', team: 2, deviceId: 'a' }, { type: 'claim', team: 5, deviceId: 'b' }], T0);
    expect(playerView(s, quiz, T0, null, 'zzz').taken).toEqual([2, 5]);
    expect(playerView(s, quiz, T0, 2, 'a').taken).toEqual([5]);
  });

  it('hides unrevealed rows and the own result until the row is revealed', () => {
    const s = revealState();
    const v0 = playerView(s, quiz, T0, 3, 'dev-3');
    expect(v0.phase).toBe('reveal');
    expect(v0.visibleRows).toBe(0);
    expect(v0.rows.every((r) => r.name === null && r.label === null)).toBe(true);
    expect(v0.rows.map((r) => r.rank).slice(0, 3)).toEqual([1, 2, 3]);
    expect(v0.result).toEqual({ kind: 'pending' });
    expect(v0.answer).toBe('Portugal');

    const s9 = run(s, Array.from({ length: 9 }, () => ({ type: 'revealNext' as const })), T0);
    const v9 = playerView(s9, quiz, T0, 3, 'dev-3');
    expect(v9.visibleRows).toBe(9);
    expect(v9.rows[8]?.name).toBe('Tjeckien');
    expect(v9.rows[9]?.name).toBeNull();
    expect(v9.result).toEqual({ kind: 'pending' });

    const s10 = run(s9, [{ type: 'revealNext' }], T0);
    const v10 = playerView(s10, quiz, T0, 3, 'dev-3');
    expect(v10.visibleRows).toBe(15); // top complete: near misses show too
    expect(v10.rows[9]).toEqual({ rank: 10, name: 'Portugal', label: '10,7 milj', near: false });
    expect(v10.rows[10]).toEqual({ rank: 11, name: 'Sverige', label: '10,6 milj', near: true });
    expect(v10.result).toEqual({ kind: 'hit', rank: 10, points: 10, rowName: 'Portugal' });
    expect(playerView(s10, quiz, T0, 4, 'dev-4').result).toEqual({ kind: 'hit', rank: 11, points: 0, rowName: 'Sverige' });
    expect(playerView(s10, quiz, T0, 8, 'dev-8').result).toEqual({ kind: 'miss' });
    expect(playerView(s10, quiz, T0, 1, 'dev-1').result).toEqual({ kind: 'none' });
  });

  it('shows the standings footer only in standings/final', () => {
    const s = run(revealState(), [{ type: 'revealAll' }], T0);
    expect(playerView(s, quiz, T0, 3, 'dev-3').last).toBeNull();
    const st = run(s, [{ type: 'standings' }], T0);
    expect(playerView(st, quiz, T0, 3, 'dev-3').last).toBe('Senaste: Portugal, plats 10, +10 poäng');
    expect(playerView(st, quiz, T0, 8, 'dev-8').last).toBe('Senaste: Norge, utanför listan, 0 poäng');
    expect(playerView(st, quiz, T0, 1, 'dev-1').last).toBe('Senaste: inget svar, 0 poäng');
    expect(st.phase).toBe('standings');
    expect(playerView(st, quiz, T0, 3, 'dev-3').standings[0]).toEqual({ position: 1, team: 3, points: 10 });
  });

  it('never leaks row names during the question', () => {
    const open = run(claimAll(fresh()), [{ type: 'start' }], T0);
    const v = playerView(open, quiz, T0, 1, 'dev-1');
    expect(v.rows.every((r) => r.name === null)).toBe(true);
    expect(v.question?.question).toContain('folkrikaste');
  });
});

describe('adminView', () => {
  it('reports svar / väntar / offline / ledig per team and full rows', () => {
    const s = run(claimAll(fresh()), [{ type: 'release', team: 8 }, { type: 'start' }], T0);
    const s2 = run(
      s,
      [
        { type: 'answer', team: 1, text: 'Polen', source: 'team' },
        { type: 'answer', team: 6, text: 'Belgien', source: 'admin' }, // offline phone, Erik typed it
        { type: 'answer', team: 8, text: 'Italien', source: 'admin' }, // no phone at all, Erik typed it
      ],
      T0,
    );
    const v = adminView(s2, quiz, T0, { ...allOnline, 6: false });
    const status = Object.fromEntries(v.teams.map((t) => [t.team, t.status]));
    expect(status).toEqual({ 1: 'svar', 2: 'väntar', 3: 'väntar', 4: 'väntar', 5: 'väntar', 6: 'offline', 7: 'väntar', 8: 'svar' });
    expect(v.rows[0]).toEqual({ rank: 1, name: 'Tyskland', label: '83,6 milj', near: false });
    expect(v.teams[0]?.answer).toBe('Polen');
    expect(v.gradeStatus).toBe('idle');
  });

  it('carries grades with row names and manual/needsReview flags', () => {
    const s = run(revealState(), [{ type: 'override', team: 1, rank: 5 }], T0);
    const v = adminView(s, quiz, T0, allOnline);
    expect(v.gradeStatus).toBe('done');
    expect(v.teams[2]?.grade).toEqual({ rank: 10, points: 10, manual: false, needsReview: false, rowName: 'Portugal' });
    expect(v.teams[0]?.grade).toEqual({ rank: 5, points: 5, manual: true, needsReview: false, rowName: 'Polen' });
    expect(v.teams[7]?.grade).toEqual({ rank: null, points: 0, manual: false, needsReview: false, rowName: null });
  });
});
