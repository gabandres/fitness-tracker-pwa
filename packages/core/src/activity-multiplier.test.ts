import { describe, it, expect } from 'vitest';
import {
  activityMultiplier,
  deriveActivityLevel,
  impliedMultiplier,
  PAL_CEILING,
  PAL_FLOOR_FREE_LIVING,
} from './activity-level';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor } from './tdee';

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

describe('snapMultiplier survives for naming only', () => {
  it('still names a bucket, and still disagrees with the continuous value', () => {
    // Kept because copy has to say a word, not a number. The point of this
    // test is that the two are now allowed to differ: the label reads
    // "sedentary" while the arithmetic uses 1.40.
    expect(deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)).toBe('sedentary');
    expect(activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)).toBe(1.4);
    expect(ACTIVITY_MULTIPLIERS.sedentary).toBe(1.2);
  });
});
