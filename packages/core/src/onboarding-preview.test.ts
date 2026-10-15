import { describe, expect, it } from 'vitest';
import { addDays, calendarDateKey } from './date';
import { goalWeightIssue, profileAfterOnboarding } from './onboarding-preview';
import { dailyTargets } from './targets';
import type { DailyLog, OnboardingV2Submission, Profile } from './types';

/**
 * The Redo-setup plan step shows what Save will do (2026-10-15). On the
 * owner's account it showed the onboarding seed — 2,110 kcal / 110 g — while
 * the save would have kept a measured 1,850 and his own 140 g.
 */

const NOW = new Date(2026, 9, 15, 9, 0, 0);

/** The owner's profile on 2026-10-15, before the fix. */
const OWNER = {
  heightIn: 68,
  age: 33,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.8,
  goalDirection: 'maintain',
  calorieFloor: 1850,
  targetMode: 'custom',
  manualProteinTarget: 140,
  proteinPerKg: 1.9,
  profileCompleted: true,
} as unknown as Profile;

function history(days: number) {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  for (let i = days; i >= 1; i--) {
    const day = addDays(NOW, -i);
    const n = days - i;
    logs.push({ date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), calories: 1860 + (((n * 37) % 7) - 3) * 40 });
    weights[calendarDateKey(day)] = Math.round((156 - n * 0.06) * 10) / 10;
  }
  return { logs, weights };
}

const redo = (over: Partial<OnboardingV2Submission>): OnboardingV2Submission => ({
  weightLbs: 153.6,
  goalDirection: 'lose',
  manualCaloriesTarget: 2110,
  manualProteinTarget: 110,
  sex: 'male',
  heightIn: 68,
  age: 33,
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.8,
  targetMode: 'auto',
  isRedo: true,
  edited: { kcal: false, protein: false },
  previousTargetMode: 'custom',
  ...over,
});

describe('profileAfterOnboarding', () => {
  const { logs, weights } = history(60);

  it('applies the save in memory: the goal moves, the user keeps their own targets', () => {
    const after = profileAfterOnboarding(OWNER, redo({}), NOW);
    expect(after.goalDirection).toBe('lose');
    expect(after.targetMode).toBe('custom');
    const t = dailyTargets(after, logs, weights, NOW);
    expect([t.proteinTarget, t.proteinSource]).toEqual([140, 'user']);
    // Calories were never typed on this profile, so they stay automatic.
    expect(t.calorieSource).toBe('auto');
    // ...and that is NOT the 2,110 seed the plan step used to show.
    expect(t.calorieTarget).not.toBe(2110);
  });

  it("the owner's run: typing 1,850 and 140 makes both his own", () => {
    const after = profileAfterOnboarding(
      OWNER,
      redo({ manualCaloriesTarget: 1850, manualProteinTarget: 140, targetMode: 'custom', edited: { kcal: true, protein: true } }),
      NOW,
    );
    const t = dailyTargets(after, logs, weights, NOW);
    expect([t.calorieTarget, t.calorieSource]).toEqual([1850, 'user']);
    expect([t.proteinTarget, t.proteinSource]).toEqual([140, 'user']);
    expect(after.goalDirection).toBe('lose');
    expect(after.targetPaceLbsPerWeek).toBe(0.8);
  });

  it('a field the save deletes is gone from the preview too', () => {
    const auto = { ...OWNER, targetMode: 'auto', manualProteinTarget: 110 } as Profile;
    const after = profileAfterOnboarding(
      auto,
      redo({ previousTargetMode: 'auto', targetMode: 'custom', manualCaloriesTarget: 1900, edited: { kcal: true, protein: false } }),
      NOW,
    );
    expect('manualProteinTarget' in after).toBe(false);
    expect(after.manualCaloriesTarget).toBe(1900);
  });

  it('no goal weight on a cut clears both legacy fields', () => {
    const withGoal = { ...OWNER, targetWeightLbs: 150, goalWeightLbs: 150 } as Profile;
    const after = profileAfterOnboarding(withGoal, redo({ targetWeightLbs: undefined }), NOW);
    expect(after.targetWeightLbs).toBeUndefined();
    expect(after.goalWeightLbs).toBeUndefined();
  });
});

describe('goalWeightIssue', () => {
  it('a loss goal must sit below the current weight', () => {
    expect(goalWeightIssue('lose', 153.6, 150)).toBeNull();
    expect(goalWeightIssue('lose', 153.6, 153.6)).toBe('notBelow');
    expect(goalWeightIssue('lose', 153.6, 160)).toBe('notBelow');
  });
  it('a build goal must sit above it', () => {
    expect(goalWeightIssue('gain', 153.6, 160)).toBeNull();
    expect(goalWeightIssue('gain', 153.6, 150)).toBe('notAbove');
  });
  it('says nothing without both numbers, or on maintain', () => {
    expect(goalWeightIssue('lose', null, 150)).toBeNull();
    expect(goalWeightIssue('lose', 153.6, null)).toBeNull();
    expect(goalWeightIssue('maintain', 153.6, 160)).toBeNull();
  });
});
