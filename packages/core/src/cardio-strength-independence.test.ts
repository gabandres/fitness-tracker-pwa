import { describe, expect, it } from 'vitest';
import type { CardioBlock } from './cardio';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';
import {
  bestE1RMByExercise,
  sessionCounts,
  sessionVolume,
  trainHeroStats,
} from './train-view';
import { computeExercisePRs } from './workout-progression';

/**
 * The seam between CARDIO and the STRENGTH math, pinned.
 *
 * ## Why this file exists
 *
 * ADR-0025 put cardio on the workout session as a second array rather than in
 * a second collection, and the whole case for that shape rests on one
 * property: **the strength derivations never see it.** `sessionVolume` is
 * Σ weight×reps, `computeExercisePRs` is an Epley 1RM over working sets, and
 * `suggestProgression` is double-progression on load. A 5k has no weight and
 * no reps, so if a cardio block ever reaches those functions the failure is
 * not a crash — it is a silently wrong tonnage, or a PR chart with a gap, or a
 * progression suggestion to add 5 lb to a run.
 *
 * The alternative shape (a separate `cardioSessions` collection) would have
 * bought this property structurally. This shape buys it by discipline, so the
 * discipline needs a test. Adding a cardio branch to `sessionVolume` is a
 * natural-looking change — "sum the whole session" — and every other test in
 * this package would stay green while it happened.
 *
 * ## What is asserted
 *
 * 1. Strength numbers are byte-identical with 0, 1, 5 and 20 cardio blocks.
 * 2. `sessionCounts` counts SETS, not blocks — the summary line must not
 *    inflate.
 * 3. A cardio-only session is not mistaken for a strength session with work in
 *    it, which is what would make a run show up as a 0-volume lifting day.
 * 4. The cardio derivations do see the blocks — otherwise (1) could pass
 *    simply because the field is dead everywhere.
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

/** Deliberately varied: different modalities, wildly different magnitudes, and
 *  a `kcal` big enough that summing it anywhere would be obvious. */
function block(i: number): CardioBlock {
  const modality = (['run', 'ride', 'row', 'swim', 'walk'] as const)[i % 5];
  return {
    modality,
    durationSec: 600 + i * 137,
    distanceM: 1000 + i * 911,
    avgHr: 120 + (i % 60),
    kcal: 200 + i * 97,
    rpe: (i % 10) + 1,
    source: 'manual',
  };
}

function session(cardioCount: number): WorkoutSession {
  const date = new Date(NOW - DAY);
  return {
    status: 'completed',
    date,
    exercises: [
      ex('bench', [set({ weight: 135, reps: 8 }), set({ weight: 155, reps: 5 })]),
      ex('row', [set({ weight: 95, reps: 10 }), set({ kind: 'warmup', weight: 45, reps: 12 })]),
    ],
    cardio: Array.from({ length: cardioCount }, (_, i) => block(i)),
    createdAt: date,
    updatedAt: date,
  };
}

/** Every strength number the Train tab renders, in one object so the assertion
 *  is a single deep-equal rather than a list that can be added to without the
 *  test noticing. */
function strengthNumbers(s: WorkoutSession) {
  return {
    volume: sessionVolume(s),
    counts: sessionCounts(s),
    hero: trainHeroStats([s], NOW),
    bestE1RM: bestE1RMByExercise([s]),
    benchPRs: computeExercisePRs(s.exercises.filter((e) => e.exerciseId === 'bench')),
  };
}

describe('cardio cannot reach the strength math', () => {
  it('leaves every strength number byte-identical at 0, 1, 5 and 20 blocks', () => {
    const baseline = strengthNumbers(session(0));

    // Guard the guard: a baseline of all zeroes would make this vacuous.
    expect(baseline.volume).toBeGreaterThan(0);
    expect(baseline.hero.topSet).toBeGreaterThan(0);

    for (const count of [1, 5, 20]) {
      expect(strengthNumbers(session(count))).toEqual(baseline);
    }
  });

  it('counts sets, not cardio blocks, in the session summary', () => {
    // Three logged sets (two bench + one row) plus a warm-up, which isLoggedSet
    // still counts because it carries reps — 4. Twenty cardio blocks must not
    // make it 24.
    expect(sessionCounts(session(0)).sets).toBe(4);
    expect(sessionCounts(session(20)).sets).toBe(4);
    expect(sessionCounts(session(20)).exercises).toBe(2);
  });

  it('reports a cardio-only session as having no strength work, not zero-weight work', () => {
    const date = new Date(NOW - DAY);
    const run: WorkoutSession = {
      status: 'completed',
      date,
      exercises: [],
      cardio: [block(0)],
      createdAt: date,
      updatedAt: date,
    };
    expect(sessionVolume(run)).toBe(0);
    expect(sessionCounts(run)).toEqual({ exercises: 0, sets: 0 });
    expect(bestE1RMByExercise([run])).toEqual({});
    expect(trainHeroStats([run], NOW).topSet).toBe(0);
  });
});

describe('the field is not simply dead', () => {
  // Without this, the suite above would pass just as happily if `cardio` were
  // dropped on the floor by every consumer — which is the failure mode it is
  // meant to catch the opposite of.
  it('is visible to the cardio derivations', async () => {
    const { cardioWeekStats, longestEffortSec, modalityCounts } = await import('./cardio-view');
    const s = session(5);

    const stats = cardioWeekStats([s], NOW);
    expect(stats.blocks).toBe(5);
    expect(stats.sessions).toBe(1);
    expect(stats.minutes).toBeGreaterThan(0);
    expect(stats.distanceM).toBeGreaterThan(0);

    expect(longestEffortSec([s])).toBe(600 + 4 * 137);
    expect(modalityCounts([s])).toEqual({ run: 1, ride: 1, row: 1, swim: 1, walk: 1 });
  });
});
