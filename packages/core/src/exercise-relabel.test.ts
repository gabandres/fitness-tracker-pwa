import { describe, expect, it } from 'vitest';
import { bestE1RMByExercise, exerciseHistory, exerciseSeries } from './train-view';
import type { SessionExercise, WorkoutSession } from './workout';

/**
 * A RELABEL moves a session's rows to a different exercise; it is not a
 * rename, and progress must not join across it (2026-10-02).
 *
 * The 09-29 "Standing calf raise" rows (25 lb × 12/5/4) were one leg of a
 * single-leg DB calf raise — about 1.8× the per-calf load of the two-leg
 * standing raise the exercise has always meant. Merging the two histories
 * would read 09-29 as a collapse from 40 lb to 25 lb. So the 09-29 entry gets
 * the NEW exercise's id as well as its name (`scripts/template-updates-2026-10-02.mjs`),
 * and every progress surface — the per-exercise sparkline, the PR table, the
 * PR celebration — keys on `exerciseId`, never on the display name.
 */

const OLD = 'WJZiGzkNnu2wft3wQMV5'; // Standing calf raise (two legs)
const NEW = 'single-leg-db-calf'; // Single-leg DB calf raise

const cluster = (weight: number, reps: number[]) => [
  { kind: 'activation' as const, group: 1, weight, reps: reps[0], rir: 0, done: false },
  { kind: 'mini' as const, group: 1, weight, reps: reps[1], rir: 0, done: false },
  { kind: 'mini' as const, group: 1, weight, reps: reps[2], rir: 0, done: false },
];
const session = (day: string, ex: SessionExercise): WorkoutSession => ({
  id: day,
  status: 'completed',
  date: new Date(`${day}T12:00:00Z`),
  createdAt: new Date(`${day}T12:00:00Z`),
  updatedAt: new Date(`${day}T12:00:00Z`),
  exercises: [ex],
});
const calf = (id: string, name: string, weight: number, reps: number[]): SessionExercise => ({
  exerciseId: id, name, logStyle: 'weight-reps', cues: [], sets: cluster(weight, reps),
});

/** What the script does to the 09-29 entry: id AND name, sets untouched. */
const relabel = (ex: SessionExercise): SessionExercise =>
  ex.exerciseId === OLD ? { ...ex, exerciseId: NEW, name: 'Single-leg DB calf raise' } : ex;

// Newest-first, as both apps pass sessions.
const before = [
  session('2026-09-29', calf(OLD, 'Standing calf raise', 25, [12, 5, 4])),
  session('2026-09-22', calf(OLD, 'Standing calf raise', 40, [15, 6, 5])),
  session('2026-09-14', calf(OLD, 'Standing calf raise', 40, [14, 6, 4])),
];
const after = before.map((s, i) => (i === 0 ? { ...s, exercises: s.exercises.map(relabel) } : s));

describe('relabeling the 09-29 calf-raise rows', () => {
  it('without the relabel the two lifts merge, and 09-29 reads as a 40 → 25 lb collapse', () => {
    expect(exerciseHistory(before, OLD).map((e) => e.sets[0].weight)).toEqual([25, 40, 40]);
  });

  it('the old exercise keeps only its own two-leg history', () => {
    const history = exerciseHistory(after, OLD);
    expect(history.map((e) => e.sets[0].weight)).toEqual([40, 40]);
    expect(exerciseSeries(history, 'weight-reps')).toHaveLength(2);
  });

  it('the new exercise starts at 09-29 with just those three rows', () => {
    const history = exerciseHistory(after, NEW);
    expect(history).toHaveLength(1);
    expect(history[0].sets.map((s) => [s.weight, s.reps, s.rir])).toEqual([[25, 12, 0], [25, 5, 0], [25, 4, 0]]);
    expect(exerciseSeries(history, 'weight-reps')).toHaveLength(1);
  });

  it('PRs are tracked apart: the new lift cannot lower or raise the old one', () => {
    const best = bestE1RMByExercise(after);
    expect(Object.keys(best).sort()).toEqual([OLD, NEW].sort());
    expect(best[OLD]).toBe(bestE1RMByExercise(before.slice(1))[OLD]);
    expect(best[NEW]).toBeLessThan(best[OLD]);
  });
});
