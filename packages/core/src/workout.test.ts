import { describe, expect, it } from 'vitest';
import { fillMissingClusterLoads, type SessionExercise } from './workout';

const ex = (over: Partial<SessionExercise>): SessionExercise => ({
  exerciseId: 'x',
  name: 'Ex',
  cues: [],
  logStyle: 'weight-reps',
  sets: [],
  ...over,
});

describe('fillMissingClusterLoads', () => {
  it('heals a logged set with blank weight from its heaviest sibling', () => {
    const [out] = fillMissingClusterLoads([
      ex({
        sets: [
          { kind: 'activation', group: 1, reps: 4, rir: 0, weight: 0, done: true },
          { kind: 'mini', group: 1, reps: 4, weight: 20, done: true },
          { kind: 'mini', group: 1, reps: 4, weight: 20, done: true },
        ],
      }),
    ]);
    expect(out.sets[0].weight).toBe(20);
    expect(out.sets.map((s) => s.weight)).toEqual([20, 20, 20]);
  });

  it('treats missing (undefined) weight the same as 0', () => {
    const [out] = fillMissingClusterLoads([
      ex({ sets: [{ kind: 'working', reps: 8 }, { kind: 'working', reps: 8, weight: 45 }] }),
    ]);
    expect(out.sets[0].weight).toBe(45);
  });

  it('leaves an all-bodyweight exercise untouched (0 is correct)', () => {
    const input = [
      ex({ name: 'Plank', sets: [{ kind: 'working', reps: 60, weight: 0 }, { kind: 'working', reps: 40, weight: 0 }] }),
    ];
    const [out] = fillMissingClusterLoads(input);
    expect(out.sets.every((s) => (s.weight ?? 0) === 0)).toBe(true);
    expect(out).toBe(input[0]); // unchanged reference — no needless copy
  });

  it('skips time and bodyweight log styles', () => {
    const timeEx = ex({ logStyle: 'time', sets: [{ kind: 'working', durationSec: 45 }, { kind: 'working', durationSec: 30, weight: 10 }] });
    const [out] = fillMissingClusterLoads([timeEx]);
    expect(out.sets[0].weight).toBeUndefined();
  });

  it('does not fill an unlogged scaffold set (no reps yet)', () => {
    const [out] = fillMissingClusterLoads([
      ex({ sets: [{ kind: 'working', weight: 0 }, { kind: 'working', reps: 5, weight: 30 }] }),
    ]);
    expect(out.sets[0].weight ?? 0).toBe(0); // untouched — nothing logged there
  });

  it('leaves fully-loaded exercises as the same reference', () => {
    const input = [ex({ sets: [{ kind: 'working', reps: 5, weight: 100 }] })];
    expect(fillMissingClusterLoads(input)[0]).toBe(input[0]);
  });
});
