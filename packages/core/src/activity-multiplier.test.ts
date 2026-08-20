import { describe, it, expect } from 'vitest';
import {
  activityMultiplier,
  deriveActivityLevel,
  impliedMultiplier,
  snapMultiplier,
  PAL_CEILING,
  PAL_FLOOR_FREE_LIVING,
} from './activity-level';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor, calculateTdee } from './tdee';

/**
 * Step 3 — the continuous activity multiplier.
 *
 * Fixtures are the owner's real trailing window, read from Firestore
 * 2026-08-19: 28 of 28 usable days, mean activeKcal 246/day, mean steps 5,213,
 * against a bare Mifflin basal of 1,632 at 157 lb. The reference is that
 * account's own 97-day gap-free energy balance, 2,385.
 */
const BASAL = basalMifflinStJeor({ heightIn: 68, age: 33, sex: 'male' }, 157);
const MEAN_ACTIVE_KCAL = 246;
const BENCHMARK = 2385;

const errVsBenchmark = (multiplier: number) => Math.abs((BASAL * multiplier) / BENCHMARK - 1);

describe('the FAO/WHO/UNU floor is the NEAT correction', () => {
  it('uses the published minimum for a free-living adult, not a fitted constant', () => {
    // FAO/WHO/UNU 2001: sedentary or light activity lifestyle = PAL 1.40-1.69.
    // 1.40 is the bottom of the lowest band for someone who is not bedbound.
    expect(PAL_FLOOR_FREE_LIVING).toBe(1.4);
    // Ceiling deliberately left at the old ladder's top, not FAO's 2.40.
    expect(PAL_CEILING).toBe(1.9);
  });

  it('the raw device signal is below what a free-living adult can be', () => {
    // This is the evidence that activeKcal understates NEAT: 5,213 steps/day
    // and three lifting sessions a week cannot produce a PAL under 1.40.
    const raw = impliedMultiplier(MEAN_ACTIVE_KCAL, BASAL);
    expect(raw).toBeCloseTo(1.279, 3);
    expect(raw).toBeLessThan(PAL_FLOOR_FREE_LIVING);
  });

  it('lands within 5% of the benchmark — the accepted acceptance test', () => {
    const m = activityMultiplier(MEAN_ACTIVE_KCAL, BASAL);
    expect(m).toBe(PAL_FLOOR_FREE_LIVING);
    expect(errVsBenchmark(m!)).toBeLessThan(0.05);   // measured −4.2%
  });

  it('beats every option the five-bucket ladder can express', () => {
    const continuous = errVsBenchmark(activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)!);
    const snapped = errVsBenchmark(
      ACTIVITY_MULTIPLIERS[deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)],
    );
    const stored = errVsBenchmark(ACTIVITY_MULTIPLIERS.moderate);

    expect(continuous).toBeLessThan(snapped);   // 4.2% vs 17.9%
    expect(continuous).toBeLessThan(stored);    // 4.2% vs  6.1%
    // And the ladder's own best rung still cannot reach the 5% target.
    const bestRung = Math.min(...Object.values(ACTIVITY_MULTIPLIERS).map(errVsBenchmark));
    expect(bestRung).toBeGreaterThan(0.02);
  });
});

describe('continuity — the property the ladder could not provide', () => {
  it('expresses values the ladder cannot', () => {
    // A rung is 0.175 apart; anything between them was unreachable.
    const m = activityMultiplier(600, BASAL)!;
    expect(m).toBeGreaterThan(1.4);
    expect(m).toBeLessThan(1.9);
    expect(Object.values(ACTIVITY_MULTIPLIERS)).not.toContain(m);
  });

  it('is monotonic in active energy — more movement never lowers the multiplier', () => {
    let prev = -Infinity;
    for (const kcal of [0.1, 100, 246, 400, 600, 900, 1200, 2000]) {
      const m = activityMultiplier(kcal, BASAL)!;
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('has no discontinuity anywhere across the range', () => {
    // The whole defect being removed. Step 1 kcal at a time, assert no jump
    // larger than the step itself could justify.
    let prev = activityMultiplier(1, BASAL)!;
    for (let kcal = 2; kcal <= 1500; kcal++) {
      const m = activityMultiplier(kcal, BASAL)!;
      expect(m - prev).toBeLessThan(0.001);
      prev = m;
    }
  });

  it('clamps rather than extrapolating, at both ends', () => {
    expect(activityMultiplier(1, BASAL)).toBe(PAL_FLOOR_FREE_LIVING);
    expect(activityMultiplier(100_000, BASAL)).toBe(PAL_CEILING);
  });

  it('returns null when there is nothing to compute from', () => {
    // Null, not a floor: a caller with no device data must fall back to the
    // self-reported bucket rather than silently adopt 1.40 for everyone.
    expect(activityMultiplier(0, BASAL)).toBeNull();
    expect(activityMultiplier(246, 0)).toBeNull();
    expect(activityMultiplier(246, -1)).toBeNull();
    expect(activityMultiplier(Number.NaN, BASAL)).toBeNull();
  });
});

describe('the bucket label names the STORED value, not the raw one', () => {
  it('reads `light`, because 1.40 is what gets stored', () => {
    // The copy bug this closes: naming the raw 1.279 gave "switch to
    // sedentary" while the stored 1.40 produces a target between light and
    // moderate. The label snaps the clamped value instead, so the word and the
    // number describe the same thing.
    expect(snapMultiplier(impliedMultiplier(MEAN_ACTIVE_KCAL, BASAL))).toBe('sedentary'); // raw
    expect(deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)).toBe('light');                   // stored
    expect(activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)).toBe(1.4);
  });

  it('protects the fallback if the multiplier is ever absent', () => {
    // The bucket is what the estimate reverts to with no stored multiplier.
    // Reverting to sedentary would be materially worse than reverting to light.
    expect(errVsBenchmark(ACTIVITY_MULTIPLIERS.sedentary)).toBeGreaterThan(0.15); // -17.9%
    expect(errVsBenchmark(ACTIVITY_MULTIPLIERS.light)).toBeLessThan(0.07);        //  -5.9%
  });
});

describe('the stored multiplier is what the formula estimate uses', () => {
  const base = {
    heightIn: 68, age: 33, sex: 'male', activityLevel: 'moderate',
    targetPaceLbsPerWeek: 0.9, calorieFloor: 1850,
  } as const;
  /** Fewer than MEASURED_MIN_DAYS ⇒ formula mode, which is the anchor's math. */
  const thin = Array.from({ length: 5 }, (_, i) => ({
    date: new Date(`2026-07-0${i + 1}T12:00:00`),
    calories: 1900,
    weight: 157,
  }));

  it('absent ⇒ byte-identical to the ladder, which is every account without Health', () => {
    const withField = calculateTdee(thin, { ...base });
    const asBefore = Math.round(BASAL * ACTIVITY_MULTIPLIERS.moderate);
    expect(withField.source).toBe('formula');
    expect(withField.trueTdee).toBe(asBefore);
  });

  it('present ⇒ the continuous value wins over the bucket', () => {
    const r = calculateTdee(thin, { ...base, activityMultiplier: 1.4 });
    expect(r.trueTdee).toBe(Math.round(BASAL * 1.4));
    // 2,285 against the account's 2,385 benchmark: −4.2%.
    expect(errVsBenchmark(1.4)).toBeLessThan(0.05);
  });

  it('a corrupt stored value degrades to the bucket, never to NaN', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = calculateTdee(thin, { ...base, activityMultiplier: bad as number });
      expect(Number.isFinite(r.trueTdee)).toBe(true);
      expect(r.trueTdee).toBe(Math.round(BASAL * ACTIVITY_MULTIPLIERS.moderate));
    }
  });

  it('the bucket still names the level even when the number disagrees', () => {
    // The stored bucket is the user's stated answer and drives copy; the
    // multiplier drives arithmetic. They are allowed to disagree, and here
    // they do: "moderate" alongside 1.40.
    const p = { ...base, activityMultiplier: 1.4 };
    expect(p.activityLevel).toBe('moderate');
    expect(ACTIVITY_MULTIPLIERS[p.activityLevel]).toBe(1.55);
    expect(calculateTdee(thin, p).trueTdee).toBe(Math.round(BASAL * 1.4));
  });
});
