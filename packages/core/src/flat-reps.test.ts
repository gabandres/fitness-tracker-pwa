import { describe, it, expect } from 'vitest';
import { flatRepsWarning } from './flat-reps';
import type { WorkoutSession, WorkoutSet } from './workout';

const day = (n: number) => new Date(2026, 9, n, 7);
const session = (d: number, sets: Partial<WorkoutSet>[], extra: Partial<WorkoutSession> = {}): WorkoutSession =>
  ({
    id: `s${d}`, status: 'completed', date: day(d), createdAt: day(d), updatedAt: day(d),
    exercises: [{ exerciseId: 'lat', name: 'Lat Pulldown', cues: [], sets: sets.map((s) => ({ kind: 'working', weight: 60, done: true, ...s })) }],
    ...extra,
  }) as WorkoutSession;
const flat = (d: number, reps = 12, n = 3) => session(d, Array.from({ length: n }, () => ({ reps })));

describe('flatRepsWarning', () => {
  it('two sessions running, every set the same reps, no RIR → the warning, newest first', () => {
    expect(flatRepsWarning([flat(20, 12), flat(22, 10)], 'lat', 'straight')).toEqual({ sessions: 2, reps: [10, 12] });
  });

  it('one RIR anywhere in either session silences it', () => {
    const withRir = session(22, [{ reps: 12 }, { reps: 12, rir: 2 }, { reps: 12 }]);
    expect(flatRepsWarning([flat(20), withRir], 'lat', 'straight')).toBeNull();
  });

  it('reps that differ inside a session are not flat', () => {
    expect(flatRepsWarning([flat(20), session(22, [{ reps: 12 }, { reps: 11 }, { reps: 10 }])], 'lat', 'straight')).toBeNull();
  });

  it('needs two sessions, each with at least two working sets', () => {
    expect(flatRepsWarning([flat(22)], 'lat', 'straight')).toBeNull();
    expect(flatRepsWarning([flat(20), flat(22, 12, 1)], 'lat', 'straight')).toBeNull();
    // Warm-ups do not count toward the two, nor against "the same reps".
    const warm = session(22, [{ kind: 'warmup', reps: 20 }, { reps: 12 }, { reps: 12 }]);
    expect(flatRepsWarning([flat(20), warm], 'lat', 'straight')).toEqual({ sessions: 2, reps: [12, 12] });
  });

  it('only the LAST two: an older varied session does not matter, a newer varied one does', () => {
    const varied = (d: number) => session(d, [{ reps: 12 }, { reps: 9 }]);
    expect(flatRepsWarning([varied(10), flat(20), flat(22)], 'lat', 'straight')).not.toBeNull();
    expect(flatRepsWarning([flat(10), flat(20), varied(22)], 'lat', 'straight')).toBeNull();
  });

  it('ignores the live session, deload sessions and sessions without the lift', () => {
    const live = { ...flat(23), status: 'active' } as WorkoutSession;
    const deload = { ...flat(21), deload: true } as WorkoutSession;
    const other = { ...flat(21), exercises: [] } as WorkoutSession;
    expect(flatRepsWarning([flat(20), deload, other, live], 'lat', 'straight')).toBeNull();
    expect(flatRepsWarning([flat(19), flat(20), deload, other, live], 'lat', 'straight')).toEqual({ sessions: 2, reps: [12, 12] });
  });

  it('straight lifts only', () => {
    expect(flatRepsWarning([flat(20), flat(22)], 'lat', 'myoreps')).toBeNull();
    expect(flatRepsWarning([flat(20), flat(22)], 'lat', undefined)).toBeNull();
  });
});
