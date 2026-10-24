import { describe, it, expect } from 'vitest';
import { lastSetRirRequired, requiresLastSetRir, setsRequiringRir } from './rir-required';
import type { SessionExercise, WorkoutSet } from './workout';

const ex = (sets: Partial<WorkoutSet>[], extra: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'lat', name: 'Lat Pulldown', cues: [], logStyle: 'weight-reps',
  sets: sets.map((s) => ({ kind: 'working', ...s }) as WorkoutSet),
  ...extra,
});
const RIR2 = { structure: 'straight' as const, effortStandard: 'rir2' as const };

describe('requiresLastSetRir', () => {
  it('straight + rir1/rir2 + weight-reps or bodyweight; never time, failure, or another structure', () => {
    expect(requiresLastSetRir(ex([]), RIR2)).toBe(true);
    expect(requiresLastSetRir(ex([]), { ...RIR2, effortStandard: 'rir1' })).toBe(true);
    expect(requiresLastSetRir(ex([], { logStyle: 'bodyweight' }), RIR2)).toBe(true);
    expect(requiresLastSetRir(ex([], { logStyle: undefined }), RIR2)).toBe(true);
    expect(requiresLastSetRir(ex([], { logStyle: 'time' }), RIR2)).toBe(false);
    expect(requiresLastSetRir(ex([]), { ...RIR2, effortStandard: 'failure' })).toBe(false);
    expect(requiresLastSetRir(ex([]), { structure: 'straight' })).toBe(false);
    expect(requiresLastSetRir(ex([]), { ...RIR2, structure: 'myoreps' })).toBe(false);
    expect(requiresLastSetRir(ex([]), null)).toBe(false);
  });
});

describe('lastSetRirRequired (live)', () => {
  it('is the last WORKING set in the list — a trailing drop set is not it', () => {
    expect(lastSetRirRequired(ex([{}, {}, {}]), RIR2)).toBe(2);
    expect(lastSetRirRequired(ex([{ kind: 'warmup' }, {}, {}, { kind: 'drop' }]), RIR2)).toBe(2);
    expect(lastSetRirRequired(ex([{ kind: 'warmup' }]), RIR2)).toBeNull();
    expect(lastSetRirRequired(ex([{}, {}]), { ...RIR2, effortStandard: 'failure' })).toBeNull();
  });
});

describe('setsRequiringRir (Finish)', () => {
  const lift = () => RIR2;
  it('the last SAVED working set with no RIR, with the lift’s target', () => {
    const out = setsRequiringRir([ex([{ reps: 12, done: true }, { reps: 12, done: true }, { reps: 11, done: true }])], lift);
    expect(out).toEqual([{ exerciseIndex: 0, exerciseId: 'lat', name: 'Lat Pulldown', setIndex: 2, targetRir: 2 }]);
  });
  it('a third set never done is dropped on save: the second is then the last', () => {
    expect(setsRequiringRir([ex([{ reps: 12, done: true }, { reps: 12, done: true }, {}])], lift)[0].setIndex).toBe(1);
    // A typed, unticked count is saved too, so it counts as the last set.
    expect(setsRequiringRir([ex([{ reps: 12, done: true }, { reps: 10 }])], lift)[0].setIndex).toBe(1);
  });
  it('nothing when the last set has an RIR (earlier blanks are the non-blocking question), or nothing was logged', () => {
    expect(setsRequiringRir([ex([{ reps: 12, done: true }, { reps: 12, done: true, rir: 1 }])], lift)).toEqual([]);
    expect(setsRequiringRir([ex([{}, {}])], lift)).toEqual([]);
  });
  it('per lift: only the lifts that require it, by index', () => {
    const out = setsRequiringRir(
      [ex([{ reps: 8, done: true }]), ex([{ reps: 8, done: true }], { exerciseId: 'curl', name: 'Curl' })],
      (e) => (e.exerciseId === 'curl' ? { structure: 'straight', effortStandard: 'rir1' } : { structure: 'straight', effortStandard: 'failure' }),
    );
    expect(out).toEqual([{ exerciseIndex: 1, exerciseId: 'curl', name: 'Curl', setIndex: 0, targetRir: 1 }]);
  });
});
