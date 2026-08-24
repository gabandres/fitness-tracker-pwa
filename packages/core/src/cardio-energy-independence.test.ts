import { describe, expect, it } from 'vitest';
import { WORKOUT_MARKER_KCAL, workoutMarkerEntry } from './cardio';
import { dailyTargets } from './targets';
import type { DailyLog, Profile } from './types';

/**
 * The seam between an IMPORTED CARDIO CALORIE and the TARGET, pinned.
 *
 * ## Why this file exists
 *
 * `tdee-wearable-independence.test.ts` pins the same seam one level up, for the
 * daily `activeKcal` SCALAR: with enough logged days the target comes from
 * energy balance, and the wearable cannot move it. ADR-0026 decision 5 extends
 * that to the workout EVENT stream, and this is where that extension is
 * enforced.
 *
 * The reasoning is identical and worth restating, because the tempting change
 * is so plausible. Once a ring hands us `kcal: 612` for a run, "we have the
 * number, spend it" looks like an improvement. It is a double-count: the weight
 * trend the estimator reads ALREADY contains that run. Adding it to the day's
 * budget pays for the same calories twice.
 *
 * ## What the failure would actually look like
 *
 * There is exactly one place it can happen. Finishing a workout stamps a
 * `DailyLog` so the day counts toward the streak (ADR-0007), and that log is an
 * input to energy balance. If the marker ever carried the ring's number instead
 * of zero, every measured user's target would move — silently, and only for the
 * days they trained, which is the hardest possible shape to notice.
 *
 * So test 1 pins the marker at zero, and test 2 shows what test 1 is worth by
 * measuring how far the target moves when the marker is wired up the wrong way.
 * Without test 2, test 1 could pass because the marker is dead code.
 */

const KEY = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deterministic LCG + Box-Muller, as in the sibling test: a bound measured
 *  against a different sample every run is not a bound. */
function noise(seed: number): () => number {
  let s = seed;
  const next = (): number => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return () => {
    const u = Math.max(next(), 1e-9);
    const v = Math.max(next(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const PROFILE = {
  heightIn: 70,
  age: 34,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1,
  goalDirection: 'lose',
  calorieFloor: 1500,
} as unknown as Profile;

/**
 * 120 days of a consistent logger who trains every other day.
 *
 * `markerKcal` is what the workout-finish marker writes on a training day —
 * zero in reality, and the parameter exists so the wrong wiring can be
 * simulated without shipping it.
 */
function buildHistory(markerKcal: number, days = 120) {
  const g = noise(20260824);
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  const day0 = new Date('2026-04-26T12:00:00');
  let trueWeight = 200;
  for (let i = 0; i < days; i++) {
    const d = new Date(day0);
    d.setDate(d.getDate() + i);
    const calories = Math.round(2200 + g() * 180);
    trueWeight += (calories - 2600) / 3500;
    const weight = Math.round((trueWeight + g() * 1.2) * 10) / 10;
    logs.push({ date: d, calories, weight, protein: 150 });
    weights[KEY(d)] = weight;
    // Trained today: the session's marker log lands on the same day.
    if (i % 2 === 0) {
      logs.push({ date: new Date(d), calories: markerKcal, exerciseCompleted: true });
    }
  }
  return { logs, weights };
}

describe('an imported cardio calorie cannot reach a target', () => {
  it('writes a zero-calorie marker however much the ring reported', () => {
    expect(WORKOUT_MARKER_KCAL).toBe(0);

    // A brutal session by any measure — and the marker is unmoved.
    const entry = workoutMarkerEntry([{ kcal: 1200 }, { kcal: 800 }]);
    expect(entry.calories).toBe(0);
    expect(entry.exerciseCompleted).toBe(true);

    // …and identical to the no-cardio case, which is the actual invariant:
    // the presence of cardio changes nothing about what gets logged.
    expect(entry).toEqual(workoutMarkerEntry());
    expect(entry).toEqual(workoutMarkerEntry([]));
  });

  it('leaves the measured target byte-identical across 120 days of training', () => {
    // The chain under test, end to end: a session's cardio decides the marker,
    // the marker becomes a log, the logs decide the target. Vary the FIRST link
    // across a rest day, a jog and a brutal session, and the last must not move.
    const targetFor = (cardioKcal: number[]) => {
      const marker = workoutMarkerEntry(cardioKcal.map((kcal) => ({ kcal })));
      const history = buildHistory(marker.calories);
      return dailyTargets(PROFILE, history.logs, history.weights);
    };

    const baseline = targetFor([]);

    // Guard the guard: if this were not measured mode, the assertions below
    // would be about the formula path and would prove nothing.
    expect(baseline.tdee.source).toBe('measured');

    for (const cardio of [[400], [1200], [612, 340], [1200, 1200, 1200]]) {
      const result = targetFor(cardio);
      expect(result.tdee.source).toBe('measured');
      expect(result.calorieTarget).toBe(baseline.calorieTarget);
      expect(result.tdee.trueTdee).toBe(baseline.tdee.trueTdee);
    }
  });
});

describe('the seam is worth something', () => {
  // Without this, the tests above would pass just as happily if the marker were
  // never written at all — which is the opposite failure from the one they
  // exist to catch. This measures the damage of the plausible wrong change.
  it('measurably moves the target when the marker is wired up the wrong way', () => {
    const clean = buildHistory(0);
    const baseline = dailyTargets(PROFILE, clean.logs, clean.weights);

    const wrong = buildHistory(612); // a typical ring number for a 5k
    const damaged = dailyTargets(PROFILE, wrong.logs, wrong.weights);

    expect(damaged.tdee.source).toBe('measured');
    expect(damaged.calorieTarget).not.toBe(baseline.calorieTarget);

    // Not a rounding wobble: spending the ring's number on every other day
    // shifts the estimate by hundreds of calories.
    expect(Math.abs(damaged.tdee.trueTdee - baseline.tdee.trueTdee)).toBeGreaterThan(100);
  });
});
