import { describe, expect, it } from 'vitest';
import {
  DURATION_CAP_MIN,
  UNTIMED_DEFAULT_MIN,
  capDuration,
  durationNoteFor,
  endAtLastSet,
  finishDurationCall,
  idleState,
  isStaleOpen,
  lastLoggedAt,
  untimedReason,
} from './session-idle';
import { applySessionAction } from './workout-session';
import type { WorkoutSession, WorkoutSet } from './workout';

const START = new Date('2026-11-10T11:02:09Z');
const at = (min: number) => new Date(START.getTime() + min * 60_000);
const set = (min?: number, extra: Partial<WorkoutSet> = {}): WorkoutSet => ({
  kind: 'working', weight: 50, reps: 10, done: true, ...(min != null ? { loggedAt: at(min).toISOString() } : {}), ...extra,
});
const session = (sets: WorkoutSet[], extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  status: 'active',
  date: START,
  exercises: [{ exerciseId: 'x', name: 'X', cues: [], sets }],
  createdAt: START,
  updatedAt: START,
  ...extra,
});

describe('set times', () => {
  it('reads the last logged set, ignoring unlogged ones', () => {
    const s = session([set(5), set(40), { kind: 'working', done: false, loggedAt: at(90).toISOString() }]);
    expect(lastLoggedAt(s)?.toISOString()).toBe(at(40).toISOString());
  });
  it('names why times cannot place the end', () => {
    expect(untimedReason(session([set(), set()]))).toBe('none');
    expect(untimedReason(session([set(3), set()]))).toBe('partial');
    // 11/10: every set shared one moment — bulk.
    expect(untimedReason(session(Array.from({ length: 8 }, () => set(1))))).toBe('bulk');
    expect(untimedReason(session([set(3), set(10), set(20)]))).toBeUndefined();
  });
});

describe('idleState', () => {
  const s = session([set(5), set(52)]);
  it('is active until 20 min after the last set', () => {
    expect(idleState(s, at(71)).kind).toBe('active');
    expect(idleState(s, at(71)).kind === 'active' && idleState(s, at(71))).toMatchObject({ promptAt: at(72) });
  });
  it('asks at 20 min, auto-ends at 30 — at the last set + 5', () => {
    expect(idleState(s, at(75))).toMatchObject({ kind: 'prompt', autoEndAt: at(82) });
    const st = idleState(s, at(178));
    expect(st.kind).toBe('auto-end');
    if (st.kind === 'auto-end') {
      expect(st.end.endAt).toEqual(at(57));
      expect(st.end.durationMin).toBe(57);
    }
  });
  it('"Keep going" restarts the clock, and then the last set is not the end', () => {
    expect(idleState(s, at(80), at(74)).kind).toBe('active');
    // Idle again past the grace with nothing logged since "Keep going": ask.
    expect(idleState(s, at(110), at(74)).kind).toBe('ask');
  });
  it('asks rather than guesses with no set times', () => {
    expect(idleState(session([set(), set()]), at(60)).kind).toBe('ask');
  });
  it('counts from a Resume', () => {
    const paused = session([set(10, { segment: 1 })], { segments: [{ start: START, end: at(15) }, { start: at(100) }] });
    expect(idleState(paused, at(110)).kind).toBe('active');
  });
});

describe('isStaleOpen', () => {
  it('after 2 h, once per 2 h after asking', () => {
    const s = session([set(5)]);
    expect(isStaleOpen(s, at(119))).toBe(false);
    expect(isStaleOpen(s, at(121))).toBe(true);
    expect(isStaleOpen(s, at(130), at(121))).toBe(false);
    expect(isStaleOpen({ ...s, status: 'paused' }, at(300))).toBe(false);
  });
});

describe('finishDurationCall / capDuration', () => {
  it('11/10: 178 on the timer → asks, suggests the last set + 5', () => {
    const s = session([set(5), set(52)]);
    const c = finishDurationCall(s, 178);
    expect(c).toMatchObject({ overCap: true, ask: true, suggestedMin: 57 });
    expect(capDuration(s, 178, false)).toMatchObject({ durationMin: 57 });
    expect(capDuration(s, 178, false).note).toMatch(/^auto-capped: 178 → 57 min/);
    expect(capDuration(s, 178, true)).toEqual({ durationMin: 178 });
    expect(capDuration(s, DURATION_CAP_MIN, false)).toEqual({ durationMin: DURATION_CAP_MIN });
  });
  it('no times → asks with 60 min, and the cap falls back to it', () => {
    const s = session([set(), set()]);
    expect(finishDurationCall(s, 45)).toMatchObject({ ask: true, untimed: 'none', suggestedMin: UNTIMED_DEFAULT_MIN, overCap: false });
    expect(capDuration(s, 897, false).durationMin).toBe(UNTIMED_DEFAULT_MIN);
  });
  it('a timed session under the cap is not asked about', () => {
    expect(finishDurationCall(session([set(5), set(40)]), 45).ask).toBe(false);
  });
  it('notes stay under the rules\' 300 chars', () => {
    for (const src of ['auto-ended', 'auto-capped', 'ended-at-last-set', 'entered', 'confirmed-long'] as const) {
      expect((durationNoteFor(src, { timerMin: 1440, savedMin: 999, lastSetAt: at(1) }) ?? '').length).toBeLessThanOrEqual(300);
    }
    expect(durationNoteFor('entered', { timerMin: 50, savedMin: 50 })).toBeUndefined();
  });
});

describe('the reducer stamps loggedAt', () => {
  const base = session([{ kind: 'working', weight: 50, reps: 10, done: false }]);
  const tick = (s: WorkoutSession, done: boolean, now?: Date) =>
    applySessionAction(s, { type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { done } }, now);
  it('on the done flip, with a clock', () => {
    expect(tick(base, true, at(3)).exercises[0].sets[0].loggedAt).toBe(at(3).toISOString());
  });
  it('not without one (editing a finished session)', () => {
    expect(tick(base, true).exercises[0].sets[0].loggedAt).toBeUndefined();
  });
  it('keeps the first time on a re-tick, drops it on an untick', () => {
    const once = tick(base, true, at(3));
    expect(tick(once, true, at(9)).exercises[0].sets[0].loggedAt).toBe(at(3).toISOString());
    expect(tick(once, false, at(9)).exercises[0].sets[0].loggedAt).toBeUndefined();
  });
  it('and endAtLastSet reads it', () => {
    expect(endAtLastSet(tick(base, true, at(3)))?.durationMin).toBe(8);
  });
});
