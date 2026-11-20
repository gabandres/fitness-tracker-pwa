import type { ImportedWorkout } from '@macrolog/core';

jest.mock('@/lib/ledger', () => ({
  addExercise: jest.fn(),
  getAllExercises: jest.fn(),
  getAllSessions: jest.fn(),
  startSession: jest.fn(),
}));

import { addExercise, getAllExercises, getAllSessions, startSession } from '@/lib/ledger';
import { IMPORT_MAX_EXERCISES, planWorkoutImport, runWorkoutImport, wordKey } from '@/lib/workout-import';

/**
 * UX_AUDIT S24-17 (2026-11-19): a Hevy / Strong export becomes this account's
 * own completed sessions. These pin what the import decides — which lifts are
 * new, which workouts are already here, what unit the weights land in.
 */

const at = (d: number, h = 18, min = 0) => new Date(2024, 0, d, h, min, 0);
const workout = (d: number, exercises: ImportedWorkout['exercises'], name = 'Push'): ImportedWorkout => ({
  name,
  date: at(d),
  durationMin: 60,
  exercises,
});
const bench = { name: 'Bench Press (Barbell)', sets: [{ kind: 'working' as const, weight: 100, reps: 5, rir: 1 }] };
const pullUp = { name: 'Pull Up', sets: [{ kind: 'working' as const, reps: 9 }] };
const plank = { name: 'Plank', sets: [{ kind: 'working' as const, durationSec: 60 }] };

describe('planWorkoutImport', () => {
  it('matches a lift by name whatever its case, and creates only the ones the catalog lacks', () => {
    const plan = planWorkoutImport(
      { workouts: [workout(1, [bench, pullUp, plank])] },
      'lb',
      [{ name: 'bench press (barbell)  ', logStyle: 'weight-reps' }],
      [],
    );
    expect(plan.newExercises).toEqual([
      { key: 'pull up', name: 'Pull Up', logStyle: 'bodyweight' },
      { key: 'plank', name: 'Plank', logStyle: 'time' },
    ]);
    expect(plan.sessions[0].exercises.map((e) => e.logStyle)).toEqual(['weight-reps', 'bodyweight', 'time']);
  });

  it('stores weights in pounds: kilograms convert, pounds stay', () => {
    const kg = planWorkoutImport({ workouts: [workout(1, [bench])] }, 'kg', [], []);
    expect(kg.sessions[0].exercises[0].sets[0]).toEqual({ kind: 'working', weight: 220.46, reps: 5, rir: 1, done: true });
    const lb = planWorkoutImport({ workouts: [workout(1, [bench])] }, 'lb', [], []);
    expect(lb.sessions[0].exercises[0].sets[0].weight).toBe(100);
  });

  it('skips a workout that is already here, so the same file twice adds nothing', () => {
    const plan = planWorkoutImport(
      { workouts: [workout(1, [bench]), workout(2, [bench])] },
      'lb',
      [],
      // Same start minute, seconds apart — and an ACTIVE session at the other
      // start does not count as "already imported".
      [
        { status: 'completed', date: new Date(2024, 0, 1, 18, 0, 40) },
        { status: 'active', date: at(2) },
      ],
    );
    expect(plan.duplicates).toBe(1);
    expect(plan.sessions.map((s) => s.date)).toEqual([at(2)]);
  });

  it('takes the first of two workouts in one file that start the same minute', () => {
    const plan = planWorkoutImport({ workouts: [workout(1, [bench], 'A'), workout(1, [pullUp], 'B')] }, 'lb', [], []);
    expect(plan.sessions.map((s) => s.name)).toEqual(['A']);
    expect(plan.duplicates).toBe(1);
  });

  it('keeps a session inside what the rules allow, and says how many lifts it dropped', () => {
    const many = Array.from({ length: IMPORT_MAX_EXERCISES + 3 }, (_, i) => ({ ...bench, name: `Lift ${i}` }));
    const plan = planWorkoutImport({ workouts: [workout(1, many, 'x'.repeat(140))] }, 'lb', [], []);
    expect(plan.sessions[0].exercises).toHaveLength(IMPORT_MAX_EXERCISES);
    expect(plan.droppedExercises).toBe(3);
    expect(plan.sessions[0].name).toHaveLength(100);
  });
});

describe('runWorkoutImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAllExercises as jest.Mock).mockResolvedValue([{ id: 'e-bench', name: 'Bench Press (Barbell)', logStyle: 'weight-reps' }]);
    (getAllSessions as jest.Mock).mockResolvedValue([]);
    (addExercise as jest.Mock).mockImplementation(async (_uid: string, d: { name: string }) => `new-${d.name}`);
    (startSession as jest.Mock).mockResolvedValue('s1');
  });

  it('adds the missing lifts first, then writes each workout as a completed session', async () => {
    const progress = jest.fn();
    const out = await runWorkoutImport('u1', { workouts: [workout(1, [bench, pullUp]), workout(3, [bench])] }, 'lb', progress);
    expect(out).toEqual({ imported: 2, duplicates: 0, exercisesAdded: 1, failed: 0 });
    expect(addExercise).toHaveBeenCalledWith('u1', { name: 'Pull Up', muscles: [], defaultCues: [], logStyle: 'bodyweight' });
    const drafts = (startSession as jest.Mock).mock.calls.map((c) => c[1]);
    expect(drafts.every((d) => d.status === 'completed')).toBe(true);
    const first = drafts.find((d) => d.date.getDate() === 1);
    expect(first.templateName).toBe('Push');
    expect(first.durationMin).toBe(60);
    expect(first.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(['e-bench', 'new-Pull Up']);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it('carries on past a session that fails to save, and counts it', async () => {
    (startSession as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue('s2');
    const out = await runWorkoutImport('u1', { workouts: [workout(1, [bench]), workout(2, [bench]), workout(3, [bench])] }, 'lb');
    expect(out.imported).toBe(2);
    expect(out.failed).toBe(1);
  });
});

// UX_AUDIT S24-17 follow-up (2026-11-20): Hevy and Strong put the equipment
// last, in brackets; the seeded catalog puts it first.
describe('planWorkoutImport — the same words in another order', () => {
  it('reads "Bench Press (Barbell)" as the "Barbell Bench Press" in the catalog', () => {
    expect(wordKey('Bench Press (Barbell)')).toBe(wordKey('Barbell Bench Press'));
    const plan = planWorkoutImport(
      { workouts: [workout(1, [bench, pullUp])] },
      'lb',
      [{ name: 'Barbell Bench Press', logStyle: 'weight-reps' }],
      [],
    );
    expect(plan.newExercises.map((e) => e.name)).toEqual(['Pull Up']);
    expect(plan.sessions[0].exercises[0]).toMatchObject({ key: 'barbell bench press', name: 'Barbell Bench Press' });
  });

  it('does not guess when two catalog lifts have those words, or when a word differs', () => {
    const two = planWorkoutImport(
      { workouts: [workout(1, [bench])] },
      'lb',
      [
        { name: 'Barbell Bench Press', logStyle: 'weight-reps' },
        { name: 'Press, Barbell Bench', logStyle: 'weight-reps' },
      ],
      [],
    );
    expect(two.newExercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)']);
    const other = planWorkoutImport(
      { workouts: [workout(1, [bench])] },
      'lb',
      [{ name: 'Dumbbell Bench Press', logStyle: 'weight-reps' }],
      [],
    );
    expect(other.newExercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)']);
  });

  it('prefers the exact name when both exist', () => {
    const plan = planWorkoutImport(
      { workouts: [workout(1, [bench])] },
      'lb',
      [
        { name: 'Barbell Bench Press', logStyle: 'weight-reps' },
        { name: 'Bench Press (Barbell)', logStyle: 'weight-reps' },
      ],
      [],
    );
    expect(plan.newExercises).toEqual([]);
    expect(plan.sessions[0].exercises[0].key).toBe('bench press (barbell)');
  });
});
