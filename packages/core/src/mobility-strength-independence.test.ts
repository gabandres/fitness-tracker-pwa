import { describe, expect, it } from 'vitest';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';
import {
  bestE1RMByExercise,
  sessionCounts,
  sessionVolume,
  trainHeroStats,
} from './train-view';
import { computeExercisePRs, isWorkingSet } from './workout-progression';

/**
 * The seam between MOBILITY and the STRENGTH math, pinned — the sibling of
 * `cardio-strength-independence.test.ts`, and it exists for a sharper reason.
 *
 * ADR-0028 put mobility inside the ordinary `exercises[]` array rather than in
 * a block or a collection of its own, and the whole case for that shape is
 * that mobility is invisible to every strength derivation "by the same
 * mechanism warmups already are". That mechanism is ONE clause in
 * `isWorkingSet`. Cardio at least lives in a different array; a mobility set
 * is structurally identical to a working set and sits in the same list.
 *
 * The specific failure this guards is not a crash. `computeExercisePRs` gates
 * on `isWorkingSet` and then reads `s.durationSec` unconditionally, so drop
 * the clause and a 60-second pre-lift hold sets a `maxDurationSec` PR — the
 * app congratulating the user for the one thing the evidence says costs
 * strength (Simic et al., 104 studies: -5.4% maximal strength, -1.9% power).
 * Every other test in this package stays green while that happens.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 24, 12, 0).getTime();

const set = (s: Partial<WorkoutSet> = {}): WorkoutSet => ({ kind: 'working', ...s });

const ex = (exerciseId: string, sets: WorkoutSet[]): SessionExercise => ({
  exerciseId,
  name: exerciseId,
  cues: [],
  sets,
});

/** Deliberately long holds, and a couple carrying weight and reps too — a
 *  loaded stretch is a real thing, and it is exactly what would leak into
 *  tonnage if the kind stopped being checked. */
const holds = (n: number): WorkoutSet[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'mobility' as const,
    durationSec: 45 + i * 31,
    ...(i % 3 === 0 ? { weight: 25, reps: 1 } : {}),
  }));

function session(mobilityCount: number): WorkoutSession {
  const date = new Date(NOW - DAY);
  const exercises: SessionExercise[] = [];
  if (mobilityCount > 0) exercises.push(ex('couch-stretch', holds(mobilityCount)));
  exercises.push(
    ex('bench', [set({ weight: 135, reps: 8 }), set({ weight: 155, reps: 5 })]),
    ex('row', [set({ weight: 95, reps: 10 }), set({ kind: 'warmup', weight: 45, reps: 12 })]),
  );
  return { status: 'completed', date, exercises, createdAt: date, updatedAt: date };
}

/** Every strength number the Train tab renders, in one object so the assertion
 *  is a single deep-equal rather than a list that can be added to silently. */
function strengthNumbers(s: WorkoutSession) {
  const e1rm = bestE1RMByExercise([s]);
  return {
    volume: sessionVolume(s),
    hero: trainHeroStats([s], NOW),
    // Restricted to the LIFTS on purpose. `bestE1RMByExercise` keys every
    // exercise id it sees, so a mobility exercise appears with a 0 the same
    // way a plank or any other `time` exercise already does — that is the
    // map's existing shape, not a mobility leak, and `improvedExercises`
    // treats a 0 that stays 0 as no crossing. What must not move is the
    // lifting numbers, which is what this compares. The mobility entry's own
    // value is asserted separately below.
    bestE1RM: { bench: e1rm['bench'], row: e1rm['row'] },
    benchPRs: computeExercisePRs(s.exercises.filter((e) => e.exerciseId === 'bench')),
  };
}

describe('mobility cannot reach the strength math', () => {
  it('is excluded by isWorkingSet, alongside warmup and drop', () => {
    expect(isWorkingSet({ kind: 'mobility' })).toBe(false);
    expect(isWorkingSet({ kind: 'warmup' })).toBe(false);
    expect(isWorkingSet({ kind: 'drop' })).toBe(false);
    expect(isWorkingSet({ kind: 'working' })).toBe(true);
  });

  it('leaves every strength number byte-identical at 0, 1, 5 and 20 mobility sets', () => {
    const baseline = strengthNumbers(session(0));

    // Guard the guard: a baseline of all zeroes would make this vacuous.
    expect(baseline.volume).toBeGreaterThan(0);
    expect(baseline.hero.topSet).toBeGreaterThan(0);

    for (const count of [1, 5, 20]) {
      expect(strengthNumbers(session(count))).toEqual(baseline);
    }
  });

  it('contributes a 0 e1RM, never a number it invented', () => {
    expect(bestE1RMByExercise([session(5)])['couch-stretch']).toBe(0);
  });

  it('never awards a hold a duration PR', () => {
    // The concrete regression. A 600-second hold on an exercise that also has
    // a real timed working set must not raise maxDurationSec above the working
    // set's own 40 s.
    expect(computeExercisePRs([
      ex('plank', [
        { kind: 'working', durationSec: 40 },
        { kind: 'mobility', durationSec: 600 },
      ]),
    ]).maxDurationSec).toBe(40);
  });

  it('awards no PR at all to an exercise that is only mobility', () => {
    expect(computeExercisePRs([ex('couch-stretch', holds(4))])).toEqual({
      maxWeight: 0, bestE1RM: 0, maxReps: 0, maxDurationSec: 0,
    });
  });

  it('keeps a loaded stretch out of tonnage', () => {
    // holds() puts weight+reps on every third set precisely so this cannot
    // pass by the sets being empty.
    const s = session(3);
    expect(sessionVolume(s)).toBe(sessionVolume(session(0)));
  });
});
