import { describe, it, expect } from 'vitest';
import { calibrationRaise, rowTopReps } from './calibration-raise';
import { recommendOptionsFor } from './progression-engine';
import type { PlannedSet, SessionExercise, WorkoutSet } from './workout';

/** Stephanie's straight row: 3 × 10-12, top of range 12, hold 1, +5 lb. */
const planned: PlannedSet[] = [1, 2, 3].map(() => ({ kind: 'working', reps: 10, repsMax: 12 }));
const row = {
  name: 'Lat Pulldown',
  setStructure: 'straight' as const,
  plannedSets: planned,
  progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 },
};
const catalog = { name: 'Lat Pulldown', effortStandard: 'rir2' as const };
const opts = recommendOptionsFor(row, catalog);

const live = (...sets: Partial<WorkoutSet>[]): SessionExercise => ({
  exerciseId: 'lat', name: 'Lat Pulldown', cues: [], logStyle: 'weight-reps',
  sets: sets.map((s) => ({ kind: 'working', ...s }) as WorkoutSet),
});
const past = (load: number, ...reps: number[]): SessionExercise => ({
  exerciseId: 'lat', name: 'Lat Pulldown', cues: [],
  sets: reps.map((r) => ({ kind: 'working', weight: load, reps: r, done: true }) as WorkoutSet),
});

describe('calibrationRaise', () => {
  it('fires on a calibration session when set 1 is 3+ over the top: one real step for the rest', () => {
    const ex = live({ weight: 60, reps: 15, done: true }, { weight: 60 }, { weight: 60 });
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts })).toEqual({
      suggestedLoad: 65, reps: 15, load: 60, topReps: 12, setIndices: [1, 2],
    });
  });

  it('stays quiet at top + 2', () => {
    const ex = live({ weight: 60, reps: 14, done: true }, { weight: 60 });
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts })).toBeNull();
  });

  it('only on a calibration session: an engine read since the baseline silences it', () => {
    const ex = live({ weight: 60, reps: 15, done: true }, { weight: 60 });
    expect(calibrationRaise({ row, history: [past(60, 12, 12, 11)], sessionExercise: ex, opts })).toBeNull();
    // A history entry with nothing readable is not a read.
    expect(calibrationRaise({ row, history: [{ ...past(60), sets: [] }], sessionExercise: ex, opts })).not.toBeNull();
  });

  it('only on straight rows', () => {
    const myo = recommendOptionsFor({ ...row, setStructure: 'myoreps' }, catalog);
    const ex = live({ weight: 60, reps: 15, done: true }, { weight: 60 });
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts: myo })).toBeNull();
    expect(calibrationRaise({ row: null, history: [], sessionExercise: ex, opts })).toBeNull();
  });

  it('needs set 1 TICKED with a load > 0 on a weight-reps lift', () => {
    expect(calibrationRaise({ row, history: [], sessionExercise: live({ weight: 60, reps: 15 }, { weight: 60 }), opts })).toBeNull();
    expect(calibrationRaise({ row, history: [], sessionExercise: live({ weight: 0, reps: 15, done: true }, {}), opts })).toBeNull();
    const bw = { ...live({ reps: 20, done: true }, {}), logStyle: 'bodyweight' as const };
    expect(calibrationRaise({ row, history: [], sessionExercise: bw, opts })).toBeNull();
    const assisted = recommendOptionsFor(row, { ...catalog, assisted: true });
    expect(calibrationRaise({ row, history: [], sessionExercise: live({ weight: 60, reps: 15, done: true }, { weight: 60 }), opts: assisted })).toBeNull();
  });

  it('uses the engine step: the next availableLoads entry, and the dumbbell grid', () => {
    const stack = recommendOptionsFor(row, { ...catalog, availableLoads: [50, 60, 75, 90] });
    const ex = live({ weight: 60, reps: 16, done: true }, { weight: 60 }, { weight: 60 });
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts: stack })?.suggestedLoad).toBe(75);
    const db = recommendOptionsFor({ ...row, name: 'DB Curl' }, { name: 'DB Curl', effortStandard: 'rir2', dumbbellStepLb: 2.5 });
    const dbEx = live({ weight: 20, reps: 15, done: true }, { weight: 20 });
    expect(calibrationRaise({ row, history: [], sessionExercise: dbEx, opts: db })?.suggestedLoad).toBe(22.5);
  });

  it('raises only the un-ticked working sets still under the step; none left → no prompt', () => {
    const ex = live({ weight: 60, reps: 15, done: true }, { weight: 60, reps: 14, done: true }, { weight: 65 }, { weight: 60 });
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts })?.setIndices).toEqual([3]);
    const raised = live({ weight: 60, reps: 15, done: true }, { weight: 65 }, { weight: 65 });
    expect(calibrationRaise({ row, history: [], sessionExercise: raised, opts })).toBeNull();
  });

  it('set 1 is the first WORKING set — a warm-up before it is skipped', () => {
    const ex: SessionExercise = {
      ...live(),
      sets: [
        { kind: 'warmup', weight: 30, reps: 20, done: true },
        { kind: 'working', weight: 60, reps: 15, done: true },
        { kind: 'working', weight: 60 },
      ] as WorkoutSet[],
    };
    expect(calibrationRaise({ row, history: [], sessionExercise: ex, opts })).toMatchObject({ suggestedLoad: 65, setIndices: [2] });
  });
});

describe('rowTopReps', () => {
  it('progression.targetReps, else the first working set’s repsMax, else its reps', () => {
    expect(rowTopReps(row)).toBe(12);
    expect(rowTopReps({ plannedSets: [{ kind: 'warmup', reps: 15 }, { kind: 'working', reps: 8, repsMax: 10 }] })).toBe(10);
    expect(rowTopReps({ plannedSets: [{ kind: 'working', reps: 8 }] })).toBe(8);
    expect(rowTopReps({ plannedSets: [] })).toBeUndefined();
  });
});
