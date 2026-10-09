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
import { dropEmptySets, isLoggedSet, seedCallLoad, templateToSessionExercises } from '@/lib/workout';
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

describe('seedCallLoad — the sets hold the card\'s load (owner, 2026-10-09)', () => {
  // The 10/9 Push: "20 lb · HOLD" on the card, every set pre-filled at the
  // template's 25.
  const flat = () =>
    templateToSessionExercises(
      template({
        targetLoad: 25,
        plannedSets: [
          { kind: 'activation', group: 1 },
          { kind: 'mini', group: 1 },
          { kind: 'activation', group: 2 },
          { kind: 'mini', group: 2 },
          { kind: 'drop', weight: 10 },
        ],
      }),
    )[0];

  it('moves every set the template seeded to the call\'s load', () => {
    const ex = seedCallLoad(flat(), 20);
    expect(ex.sets.map((s) => s.weight)).toEqual([20, 20, 20, 20, 10]);
  });

  it('keeps the template\'s load as the record of what it said', () => {
    expect(seedCallLoad(flat(), 20).targetLoad).toBe(25);
  });

  it('leaves a planned set with its own weight alone (the drop at 10)', () => {
    expect(seedCallLoad(flat(), 20).sets[4].weight).toBe(10);
  });

  it('fills sets the template left empty', () => {
    const [ex] = templateToSessionExercises(template({ plannedSets: [{ kind: 'working' }, { kind: 'working' }] }));
    expect(seedCallLoad(ex, 95).sets.map((s) => s.weight)).toEqual([95, 95]);
  });

  it('moves only working sets — a warm-up the template left empty stays empty', () => {
    const [ex] = templateToSessionExercises(
      template({ plannedSets: [{ kind: 'warmup' }, { kind: 'working' }, { kind: 'drop' }] }),
    );
    expect(seedCallLoad(ex, 95).sets.map((s) => s.weight)).toEqual([undefined, 95, undefined]);
  });

  it('reads a template that prescribes per-set weights instead of a targetLoad', () => {
    const [ex] = templateToSessionExercises(
      template({
        plannedSets: [
          { kind: 'activation', group: 1, weight: 25 },
          { kind: 'mini', group: 1, weight: 25 },
        ],
      }),
    );
    const seeded = seedCallLoad(ex, 20);
    expect(seeded.sets.map((s) => s.weight)).toEqual([20, 20]);
    expect(seeded.targetLoad).toBe(25);
  });

  it('never seeds a bodyweight lift: it has no weight box to show the load in', () => {
    const [pullUp] = templateToSessionExercises(
      template({ logStyle: 'bodyweight', plannedSets: [{ kind: 'activation', group: 1 }] }),
    );
    expect(seedCallLoad(pullUp, 5)).toBe(pullUp);
  });

  it('changes nothing without a load, or on a timed lift', () => {
    const ex = flat();
    expect(seedCallLoad(ex, undefined)).toBe(ex);
    const [plank] = templateToSessionExercises(
      template({ logStyle: 'time', plannedSets: [{ kind: 'working', durationSec: 60 }] }),
    );
    expect(seedCallLoad(plank, 20)).toBe(plank);
  });
});
