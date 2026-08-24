import { describe, it, expect } from 'vitest';
import { dailyTargets } from './targets';
import { PAL_CEILING, PAL_FLOOR_FREE_LIVING } from './activity-level';
import type { DailyLog, Profile } from './types';

/**
 * The seam between the WEARABLE and the ESTIMATE, pinned.
 *
 * ## Why this file exists
 *
 * On 2026-08-23 the estimator was compared against MacroFactor, whose published
 * position is that they deliberately take **no** expenditure input from
 * wearables — their stated reason being that wearable error is substantial,
 * nonrandom and hard to predict. The comparison drawn was that Ignia's
 * expenditure estimate is "built on activeKcal from Health", and therefore
 * carries exactly the error MacroFactor refuses.
 *
 * That is not what this codebase does, and the difference is a seam rather
 * than a detail:
 *
 *   - **Measured mode** (≥14 logged days) is pure energy balance — intake
 *     against the observed weight trend. `activeKcal` is not one of its
 *     inputs. This is the same class of estimator MacroFactor describes.
 *   - **Formula mode** (the seed, before there is enough data to measure) is
 *     Mifflin-St Jeor × an activity multiplier, and THAT is where a device
 *     signal is allowed in — as a prior, floored at the FAO/WHO/UNU
 *     free-living minimum, and only ever as a suggestion the user confirms.
 *
 * `activity-level.ts` states the rule in prose at the top of the file
 * ("it never enters `calculateTdee`'s arithmetic"), and `activityMultiplier`
 * is unit-tested in isolation — but nothing asserted the INTEGRATION property,
 * which is the one an optimisation would quietly break. Folding `activeKcal`
 * into the measured branch is a natural-looking change ("we have the data, use
 * it"), it would double-count every training calorie already present in energy
 * balance, and every existing test would stay green.
 *
 * So: test 1 proves the wearable cannot reach a measured target, test 2 proves
 * it still reaches the seed (otherwise test 1 could pass because the field is
 * simply dead), and test 3 bounds how far a measured target may move per new
 * day, which is the other half of the same comparison.
 */

const KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deterministic LCG + Box-Muller. No `Math.random`: a volatility bound
 *  measured against a different sample every run is not a bound. */
function noise(seed: number) {
  let s = seed;
  const next = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
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
 * 120 days of a consistent logger: true burn 2,600, eats ~2,200, so the weight
 * trend carries a real ~0.8 lb/week signal under 1.2 lb of daily water noise.
 * Deliberately a CLEAN history — the point is what the estimator does when it
 * has good data, not how it degrades.
 */
function buildHistory(days = 120) {
  const g = noise(20260823);
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  const day0 = new Date('2026-04-25T12:00:00');
  let trueWeight = 200;
  for (let i = 0; i < days; i++) {
    const d = new Date(day0);
    d.setDate(d.getDate() + i);
    const calories = Math.round(2200 + g() * 180);
    trueWeight += (calories - 2600) / 3500;
    const weight = Math.round((trueWeight + g() * 1.2) * 10) / 10;
    logs.push({ date: d, calories, weight, protein: 150 });
    weights[KEY(d)] = weight;
  }
  return { logs, weights };
}

const slice = (all: ReturnType<typeof buildHistory>, n: number) => {
  const logs = all.logs.slice(0, n);
  const weights: Record<string, number> = {};
  for (const l of logs) weights[KEY(l.date)] = l.weight!;
  return { logs, weights };
};

describe('the wearable signal and the measured estimate', () => {
  const all = buildHistory();

  it('cannot move a MEASURED target, anywhere across its legal range', () => {
    const { logs, weights } = slice(all, 120);
    const baseline = dailyTargets(PROFILE, logs, weights);
    expect(baseline.tdee.source).toBe('measured');

    // The floor and the ceiling are the extremes a stored multiplier may take
    // (`activityMultiplier` clamps to exactly this range), so if the estimate
    // is independent of the device at all it is independent here.
    for (const m of [PAL_FLOOR_FREE_LIVING, 1.55, PAL_CEILING]) {
      const withDevice = dailyTargets(
        { ...PROFILE, activityMultiplier: m } as unknown as Profile,
        logs,
        weights,
      );
      expect(withDevice.tdee.source).toBe('measured');
      expect(withDevice.calorieTarget).toBe(baseline.calorieTarget);
      expect(withDevice.tdee.trueTdee).toBe(baseline.tdee.trueTdee);
    }
  });

  it('DOES move the formula seed — the field is live, just fenced', () => {
    // 10 logged days: below MEASURED_MIN_DAYS, so this is the seed path.
    const { logs, weights } = slice(all, 10);
    const seed = dailyTargets(PROFILE, logs, weights);
    expect(seed.tdee.source).toBe('formula');

    const floored = dailyTargets(
      { ...PROFILE, activityMultiplier: PAL_FLOOR_FREE_LIVING } as unknown as Profile,
      logs,
      weights,
    );
    expect(floored.calorieTarget).not.toBe(seed.calorieTarget);
  });

  it('moves a measured target only modestly as each new day lands', () => {
    // Walk the history forward one logged day at a time, exactly as the app
    // recomputes it, and bound the step. The comparison this pins is against a
    // tool whose targets update WEEKLY: the claim to refute is not "it changes"
    // but "it lurches". A per-day move is allowed to be small; it is not
    // allowed to be a target rewrite.
    const targets: number[] = [];
    for (let n = 14; n <= 120; n++) {
      const { logs, weights } = slice(all, n);
      targets.push(dailyTargets(PROFILE, logs, weights).calorieTarget);
    }
    const steps = targets.slice(1).map((t, i) => Math.abs(t - targets[i]));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;

    // Measured 2026-08-23 on this fixture: mean 18.1, max 129. The bounds are
    // set well clear of those so ordinary numerical drift does not fail the
    // build, while a regression that reintroduces day-to-day lurching does.
    expect(mean).toBeLessThan(40);
    expect(Math.max(...steps)).toBeLessThan(200);

    // And it must actually converge on the truth it was given: true burn 2,600
    // at a 1 lb/wk pace is a 2,100 target.
    // Index rather than `.at(-1)`: this package's tsconfig `lib` predates
    // ES2022, so `.at` does not typecheck here even though it runs.
    const final = targets[targets.length - 1];
    expect(final).toBeGreaterThan(2000);
    expect(final).toBeLessThan(2200);
  });
});
