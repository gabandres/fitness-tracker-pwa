import { dropEmptySets, isLoggedSet } from './workout';
import type { SessionExercise, WorkoutSet } from './workout';

describe('isLoggedSet', () => {
  it('requires reps for weight-reps / bodyweight sets (weight alone is not enough)', () => {
    expect(isLoggedSet({ kind: 'working', weight: 100 })).toBe(false); // blank-reps bug
    expect(isLoggedSet({ kind: 'working', weight: 100, reps: 8 })).toBe(true);
    expect(isLoggedSet({ kind: 'mini', reps: 4 })).toBe(true);
    expect(isLoggedSet({ kind: 'working', reps: 5 }, 'bodyweight')).toBe(true);
    expect(isLoggedSet({ kind: 'working', weight: 25 }, 'bodyweight')).toBe(false);
  });

  it('requires a duration for time sets', () => {
    expect(isLoggedSet({ kind: 'working', weight: 45 }, 'time')).toBe(false);
    expect(isLoggedSet({ kind: 'working', durationSec: 30 }, 'time')).toBe(true);
  });

  it('treats a bare scaffold row (kind/group only) as unlogged', () => {
    expect(isLoggedSet({ kind: 'activation', group: 2 })).toBe(false);
  });
});

describe('dropEmptySets', () => {
  const ex = (sets: WorkoutSet[], logStyle?: SessionExercise['logStyle']): SessionExercise => ({
    exerciseId: 'e1',
    name: 'Pull-up',
    cues: [],
    logStyle,
    sets,
  });

  it('drops a phantom cluster (weight-only / empty rows) and renumbers what remains', () => {
    const result = dropEmptySets([
      ex([
        { kind: 'activation', group: 1, reps: 5 },
        { kind: 'mini', group: 1, reps: 3 },
        // phantom 2nd cluster the user never performed — no reps:
        { kind: 'activation', group: 2, weight: 0 },
        { kind: 'mini', group: 2 },
      ]),
    ]);
    expect(result[0].sets).toEqual([
      { kind: 'activation', group: 1, reps: 5 },
      { kind: 'mini', group: 1, reps: 3 },
    ]);
  });

  it('keeps every cluster set carrying a group after a drop', () => {
    const result = dropEmptySets([
      ex([
        { kind: 'activation', reps: 5 }, // group lost on write
        { kind: 'mini', reps: 3 },
      ]),
    ]);
    expect(result[0].sets.every((s) => s.group === 1)).toBe(true);
  });
});
