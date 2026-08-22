import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOSE_PACE_LBS_PER_WEEK,
  GAIN_SURPLUS_LBS_PER_WEEK,
  hasFormulaInputs,
  onboardingPace,
  onboardingSeed,
} from './onboarding-seed';
import { computeKcal } from './macro-heuristic';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor } from './tdee';

/**
 * The numbers below are the UX_AUDIT F1 table, recomputed here rather than
 * copied: heights are the CDC/NCHS measured NHANES means for US adults 20+
 * (Aug 2021-Aug 2023), 5ft 8.9in male and 5ft 3.5in female, at the 1.375
 * "lightly active" bucket. The point of the fixture is that the paired rows
 * differ in nothing but sex and that average height -- the two inputs the old
 * heuristic could not take.
 */
const MALE_IN = 68.9;
const FEMALE_IN = 63.5;

function maintenanceFor(sex: 'male' | 'female', heightIn: number, age: number, lb: number): number {
  return Math.round(basalMifflinStJeor({ heightIn, age, sex }, lb) * ACTIVITY_MULTIPLIERS.light);
}

describe('onboardingPace', () => {
  it('defaults "lose" to 1 lb/wk, matching the Refine stepper', () => {
    expect(onboardingPace('lose')).toBe(DEFAULT_LOSE_PACE_LBS_PER_WEEK);
    expect(onboardingPace('lose', null)).toBe(1);
  });

  it('keeps a pace the user already dialled in Refine', () => {
    // Onboarding has no pace control, so a redo must not overwrite 0.7 with 1.
    expect(onboardingPace('lose', 0.7)).toBe(0.7);
  });

  it('treats a stored 0 on a "lose" goal as no pace at all', () => {
    // A user who was on "maintain" (pace 0) and switched to "lose" must get a
    // deficit, not maintenance wearing a lose label.
    expect(onboardingPace('lose', 0)).toBe(1);
  });

  it('persists 0 for maintain and for gain', () => {
    expect(onboardingPace('maintain', 1.5)).toBe(0);
    // Unsigned CutPace: every consumer subtracts it, so a bulker storing 0.5
    // would be handed maintenance MINUS 250 once the estimator takes over.
    expect(onboardingPace('gain', 1.5)).toBe(0);
  });
});

describe('hasFormulaInputs', () => {
  const full = { sex: 'female' as const, heightIn: 64, age: 30, activityLevel: 'light' as const };

  it('accepts a complete, in-band set', () => {
    expect(hasFormulaInputs(full)).toBe(true);
  });

  it.each([
    ['sex', { ...full, sex: null }],
    ['height', { ...full, heightIn: null }],
    ['age', { ...full, age: null }],
    ['activity', { ...full, activityLevel: null }],
  ])('rejects a set missing %s', (_label, input) => {
    expect(hasFormulaInputs(input as never)).toBe(false);
  });

  it.each([39, 97, Number.NaN])('rejects an out-of-band height (%s)', (heightIn) => {
    expect(hasFormulaInputs({ ...full, heightIn })).toBe(false);
  });

  it.each([12, 121])('rejects an out-of-band age (%s)', (age) => {
    expect(hasFormulaInputs({ ...full, age })).toBe(false);
  });
});

describe('onboardingSeed -- the heuristic fallback', () => {
  it('is byte-identical to computeKcal when the profile is absent', () => {
    for (const goal of ['lose', 'maintain', 'gain'] as const) {
      const seed = onboardingSeed({ weightLbs: 200, goal });
      expect(seed.basis).toBe('heuristic');
      expect(seed.maintenance).toBeNull();
      expect(seed.kcal).toBe(computeKcal(200, goal));
    }
  });

  it('falls back on a partial profile rather than guessing the missing field', () => {
    const seed = onboardingSeed({
      weightLbs: 180,
      goal: 'lose',
      sex: 'female',
      heightIn: 63.5,
      age: 45,
      // no activityLevel
    });
    expect(seed.basis).toBe('heuristic');
    expect(seed.kcal).toBe(computeKcal(180, 'lose'));
  });

  it('still applies the calorie floor', () => {
    // 100 lb x 11 = 1,100, under the 1,500 default floor.
    const seed = onboardingSeed({ weightLbs: 100, goal: 'lose' });
    expect(seed.kcal).toBe(1500);
    expect(seed.floorBinding).toBe(true);
  });
});

describe('onboardingSeed -- the defect this exists to fix', () => {
  it('no longer hands a 180 lb 45-year-old woman her own maintenance', () => {
    const maintenance = maintenanceFor('female', FEMALE_IN, 45, 180);
    const seed = onboardingSeed({
      weightLbs: 180,
      goal: 'lose',
      sex: 'female',
      heightIn: FEMALE_IN,
      age: 45,
      activityLevel: 'light',
    });

    // The old number, for the record: 180 x 11 = 1,980, which sits ABOVE this.
    expect(computeKcal(180, 'lose')).toBeGreaterThan(maintenance);
    expect(seed.basis).toBe('formula');
    expect(seed.maintenance).toBe(maintenance);
    // A 500 kcal deficit off 1,978 is 1,478, which the 1,500 floor lifts --
    // so she is told 1,500 and really loses ~0.96 lb/wk instead of nothing.
    expect(seed.kcal).toBe(1500);
    expect(seed.floorBinding).toBe(true);
    expect(seed.kcal).toBeLessThan(maintenance);
  });

  it('gives the paired man and woman the same deficit, not the same target', () => {
    const common = { weightLbs: 150, goal: 'lose' as const, age: 30, activityLevel: 'light' as const };
    const woman = onboardingSeed({ ...common, sex: 'female', heightIn: FEMALE_IN });
    const man = onboardingSeed({ ...common, sex: 'male', heightIn: MALE_IN });

    // Old behaviour: both got 1,650 -- a 0.49 lb/wk cut for her, 1.18 for him.
    expect(computeKcal(150, 'lose')).toBe(1650);
    // New: two different targets. His full 500 kcal deficit clears the floor.
    expect(man.kcal).toBe(Math.round((maintenanceFor('male', MALE_IN, 30, 150) - 500) / 10) * 10);
    // Hers does not -- 1,894 - 500 = 1,394 is under the 1,500 floor, so she is
    // held there and told so. That is the floor doing its job, and it is still
    // a 0.79 lb/wk cut against the 0.49 the old heuristic delivered.
    expect(woman.kcal).toBe(1500);
    expect(woman.floorBinding).toBe(true);
    expect(man.floorBinding).toBe(false);
    expect(man.kcal).toBeGreaterThan(woman.kcal);
  });

  it('seeds "maintain" at maintenance', () => {
    const seed = onboardingSeed({
      weightLbs: 180,
      goal: 'maintain',
      sex: 'female',
      heightIn: FEMALE_IN,
      age: 45,
      activityLevel: 'light',
    });
    expect(seed.kcal).toBe(Math.round(maintenanceFor('female', FEMALE_IN, 45, 180) / 10) * 10);
    expect(seed.floorBinding).toBe(false);
  });

  it('seeds "gain" at a lean-bulk surplus above maintenance', () => {
    const maintenance = maintenanceFor('male', MALE_IN, 30, 150);
    const seed = onboardingSeed({
      weightLbs: 150,
      goal: 'gain',
      sex: 'male',
      heightIn: MALE_IN,
      age: 30,
      activityLevel: 'light',
    });
    expect(seed.kcal).toBe(
      Math.round((maintenance + (GAIN_SURPLUS_LBS_PER_WEEK * 3500) / 7) / 10) * 10,
    );
    expect(seed.kcal).toBeGreaterThan(maintenance);
  });

  it('honours the pace the user stored rather than assuming 1 lb/wk', () => {
    const base = {
      weightLbs: 180,
      goal: 'lose' as const,
      sex: 'male' as const,
      heightIn: MALE_IN,
      age: 30,
      activityLevel: 'moderate' as const,
    };
    const fast = onboardingSeed({ ...base, paceLbsPerWeek: 1.5 });
    const slow = onboardingSeed({ ...base, paceLbsPerWeek: 0.5 });
    expect(slow.kcal - fast.kcal).toBe(500);
  });

  it('respects a personal calorie floor above the default', () => {
    const seed = onboardingSeed({
      weightLbs: 150,
      goal: 'lose',
      sex: 'female',
      heightIn: FEMALE_IN,
      age: 30,
      activityLevel: 'light',
      calorieFloor: 1800,
    });
    expect(seed.kcal).toBe(1800);
    expect(seed.floorBinding).toBe(true);
  });

  it('rounds to 10 the way the heuristic always has', () => {
    const seed = onboardingSeed({
      weightLbs: 173,
      goal: 'maintain',
      sex: 'male',
      heightIn: 71,
      age: 41,
      activityLevel: 'moderate',
    });
    expect(seed.kcal % 10).toBe(0);
  });
});
