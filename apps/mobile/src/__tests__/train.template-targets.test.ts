/**
 * Per-set template targets, and the invariant that nearly shipped broken.
 *
 * A template can now prescribe reps/load per set. The tempting implementation
 * is to pre-fill those straight into the session's `reps`/`durationSec` — and
 * it is wrong, because `isLoggedSet` reads exactly those fields as proof the
 * set was performed. Doing it that way makes starting a template and walking
 * out of the gym record every prescribed set as completed: fabricated training
 * history, written by the app, on a screen the user never touched.
 *
 * So the targets ride on `targetReps`/`targetDurationSec`, and these tests
 * pin that separation down.
 */
import { dropEmptySets, isLoggedSet, templateToSessionExercises } from '@/lib/workout';
import type { WorkoutTemplate } from '@/lib/workout';

function template(over: Partial<WorkoutTemplate['exercises'][number]> = {}): WorkoutTemplate {
  return {
    name: 'Push',
    exercises: [
      {
        exerciseId: 'ex1',
        name: 'Bench Press',
        logStyle: 'weight-reps',
        plannedSets: [
          { kind: 'working', reps: 8, weight: 135 },
          { kind: 'working', reps: 8, weight: 135 },
        ],
        ...over,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('templateToSessionExercises — per-set targets', () => {
  it('carries reps/load onto the session as TARGETS, not as logged values', () => {
    const [ex] = templateToSessionExercises(template());

    expect(ex.sets).toHaveLength(2);
    for (const s of ex.sets) {
      expect(s.targetReps).toBe(8);
      // The load IS pre-filled outright — a weight with no reps has never
      // counted as a logged set, which is why targetLoad could always be seeded.
      expect(s.weight).toBe(135);
      // The two fields that would fake a completed set.
      expect(s.reps).toBeUndefined();
      expect(s.durationSec).toBeUndefined();
    }
  });

  it('does not mark a prescribed-but-untouched set as logged', () => {
    const [ex] = templateToSessionExercises(template());
    for (const s of ex.sets) expect(isLoggedSet(s, 'weight-reps')).toBe(false);
  });

  it('drops every prescribed set on finish when the lifter logged nothing', () => {
    // The regression that matters: start a template, do nothing, finish.
    const pruned = dropEmptySets(templateToSessionExercises(template()));
    expect(pruned.flatMap((e) => e.sets)).toHaveLength(0);
  });

  it('keeps only the sets that were actually logged', () => {
    const exercises = templateToSessionExercises(template());
    exercises[0].sets[0].reps = 7; // one set performed, one skipped
    const pruned = dropEmptySets(exercises);
    expect(pruned[0].sets).toHaveLength(1);
    expect(pruned[0].sets[0].reps).toBe(7);
  });

  it('falls back to the exercise-level targetLoad for sets with no weight', () => {
    const [ex] = templateToSessionExercises(
      template({ targetLoad: 95, plannedSets: [{ kind: 'working', reps: 5 }] }),
    );
    expect(ex.sets[0].weight).toBe(95);
    expect(ex.sets[0].targetReps).toBe(5);
  });

  it('prefers the per-set weight over the exercise-level targetLoad', () => {
    const [ex] = templateToSessionExercises(
      template({ targetLoad: 95, plannedSets: [{ kind: 'working', weight: 185 }] }),
    );
    expect(ex.sets[0].weight).toBe(185);
  });

  it('routes a time-style prescription to targetDurationSec and carries no load', () => {
    const [ex] = templateToSessionExercises(
      template({ logStyle: 'time', plannedSets: [{ kind: 'working', durationSec: 45 }] }),
    );
    expect(ex.sets[0].targetDurationSec).toBe(45);
    expect(ex.sets[0].durationSec).toBeUndefined();
    expect(ex.sets[0].weight).toBeUndefined();
    expect(isLoggedSet(ex.sets[0], 'time')).toBe(false);
  });

  it('leaves a template that prescribes nothing exactly as it behaved before', () => {
    const [ex] = templateToSessionExercises(
      template({ targetLoad: 100, plannedSets: [{ kind: 'working' }, { kind: 'working' }] }),
    );
    for (const s of ex.sets) {
      expect(s.weight).toBe(100);
      expect(s.targetReps).toBeUndefined();
      expect(s.reps).toBeUndefined();
    }
  });
});
