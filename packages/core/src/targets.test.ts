import { describe, expect, it } from 'vitest';
import { computeGoalProgress, currentWeight, dailyTargets } from './targets';
import { computeProtein } from './macro-heuristic';
import type { DailyLog, Profile } from './types';
import { asMeasured } from './tdee.test-utils';

function profile(p: Partial<Profile> = {}): Profile {
  return {
    email: 't@t.com',
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
    profileCompleted: true,
    ...p,
  };
}

function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return { calories, date: d, weight };
}

/** A profile with the five fields `toProfileFields` requires, so the TDEE
 *  chain reaches formula (or measured) mode instead of falling to seed. */
function fullProfile(p: Partial<Profile> = {}): Profile {
  return profile({
    heightIn: 70,
    age: 35,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 1.0,
    ...p,
  });
}

/** `n` consecutive days of logs ending today, losing `dropPerDay` lb/day. */
function series(n: number, calories: number, startWeight: number, dropPerDay = 0.1): DailyLog[] {
  return Array.from({ length: n }, (_, i) => {
    const daysAgo = n - 1 - i;
    return log(daysAgo, calories, startWeight - dropPerDay * (n - 1 - daysAgo));
  });
}

describe('currentWeight', () => {
  it('prefers the latest daily weight over log weights', () => {
    expect(currentWeight([log(0, 500, 200)], { '2026-06-29': 180 })).toBe(180);
  });
  it('falls back to the latest log weight when no daily weights', () => {
    expect(currentWeight([log(2, 500, 190), log(0, 500, 188)], {})).toBe(188);
  });
  it('returns null with no weight anywhere', () => {
    expect(currentWeight([log(0, 500)], {})).toBeNull();
  });
});

describe('computeGoalProgress', () => {
  it('computes cut progress from the oldest daily weight', () => {
    // start 200 (oldest), current 190 (latest), goal 180 → 10 of 20 lb = 50%.
    const gp = computeGoalProgress([], { '2026-06-01': 200, '2026-06-20': 190 }, 180);
    expect(gp).not.toBeNull();
    expect(gp!.startWeight).toBe(200);
    expect(gp!.currentWeight).toBe(190);
    expect(gp!.pct).toBe(50);
    expect(gp!.remaining).toBe(10);
  });

  it('computes bulk progress (current above start)', () => {
    const gp = computeGoalProgress([], { '2026-06-01': 150, '2026-06-20': 160 }, 170);
    expect(gp!.pct).toBe(50); // 10 of 20 lb gained
  });

  it('falls back to the oldest log weight when no daily weights', () => {
    const gp = computeGoalProgress([log(10, 500, 210), log(0, 500, 205)], {}, 200);
    expect(gp!.startWeight).toBe(210);
  });

  it('returns null with no goal, no weight, or start === goal', () => {
    expect(computeGoalProgress([], { '2026-06-01': 200 }, null)).toBeNull();
    expect(computeGoalProgress([], {}, 180)).toBeNull();
    expect(computeGoalProgress([], { '2026-06-01': 180 }, 180)).toBeNull();
  });
});

describe('dailyTargets', () => {
  it('uses the manual calorie target when present (pre-data)', () => {
    const t = dailyTargets(profile({ manualCaloriesTarget: 2100 }), [log(0, 500)], {});
    expect(t.calorieTarget).toBe(2100);
  });

  it('falls back to the TDEE seed target with no profile', () => {
    const t = dailyTargets(null, [], {});
    expect(t.calorieTarget).toBe(1800);
    expect(t.tdee.source).toBe('seed');
  });

  it('derives protein live from proteinPerKg + current weight', () => {
    const t = dailyTargets(profile({ proteinPerKg: 2.0 }), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(computeProtein(180, 2.0));
  });

  it('uses the manual protein snapshot when no perKg basis', () => {
    const t = dailyTargets(profile({ manualProteinTarget: 150 }), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(150);
  });

  it('defaults protein to the 1.6 g/kg floor off current weight', () => {
    const t = dailyTargets(profile(), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(computeProtein(180));
  });
});

/**
 * The calorie floor was clamped on exactly two code paths (tdee.ts measured
 * and formula). Every OTHER way a target can be produced — the manual
 * heuristic from onboarding-v2, and the seed fallback — returned a value that
 * had never seen `profile.calorieFloor`, so a user who raised their floor kept
 * being shown a target below it.
 */
describe('dailyTargets — calorie floor covers every branch', () => {
  it('clamps the manual heuristic target up to the configured floor', () => {
    const t = dailyTargets(
      profile({ manualCaloriesTarget: 1760, calorieFloor: 1850 }),
      [log(0, 500)],
      {},
    );
    expect(t.calorieTarget).toBe(1850);
  });

  it('leaves a manual target that already clears the floor untouched', () => {
    const t = dailyTargets(
      profile({ manualCaloriesTarget: 2100, calorieFloor: 1850 }),
      [log(0, 500)],
      {},
    );
    expect(t.calorieTarget).toBe(2100);
  });

  it('clamps the seed fallback target up to the configured floor', () => {
    const t = dailyTargets(profile({ calorieFloor: 1850 }), [], {});
    expect(t.tdee.source).toBe('seed');
    expect(t.calorieTarget).toBe(1850);
  });

  it('reads the floor even when onboarding is incomplete (no ProfileFields)', () => {
    // toProfileFields() returns null here — the five TDEE fields are absent —
    // so the floor must come off the raw profile, not the derived fields.
    const t = dailyTargets(
      profile({ manualCaloriesTarget: 1760, calorieFloor: 1850 }),
      [],
      {},
    );
    expect(t.calorieTarget).toBe(1850);
  });

  it('a measured-but-unreliable target comes from the ESTIMATOR, not the seed', () => {
    // 14 logged days spread over 40 calendar days: past MEASURED_MIN_DAYS, so
    // source is 'measured', but completeness is under RELIABLE_MIN_PCT.
    //
    // This used to route through the manual branch and assert 1850 (the floor
    // clamping a 1760 seed). That routing WAS the 70% cliff: three points of
    // completeness decided whether a stored onboarding seed or the estimator
    // governed the day. Since 2026-09-04 a measured estimate always governs
    // under 'auto', already damped toward the Mifflin anchor by `confidence`.
    const gappy = [
      ...[39, 38, 37, 36, 35, 34, 33, 32, 31, 30].map((d) => log(d, 2000, 200)),
      ...[3, 2, 1, 0].map((d) => log(d, 2000, 197)),
    ];
    const t = dailyTargets(
      fullProfile({ manualCaloriesTarget: 1760, calorieFloor: 1850 }),
      gappy,
      {},
    );
    expect(t.tdee.source).toBe('measured');
    expect(asMeasured(t.tdee).reliable).toBe(false);
    expect(t.calorieTarget).toBe(t.tdee.newDailyTarget);
    // The seed is ignored, not deleted — it survives on the profile, unused.
    expect(t.calorieTarget).not.toBe(1760);
  });

  it('still clamps that estimator target up to the floor', () => {
    // The floor has to cover the branch the line above newly routes through —
    // otherwise this change would have moved accounts onto an unclamped path.
    const gappy = [
      ...[39, 38, 37, 36, 35, 34, 33, 32, 31, 30].map((d) => log(d, 2000, 200)),
      ...[3, 2, 1, 0].map((d) => log(d, 2000, 197)),
    ];
    const t = dailyTargets(
      fullProfile({ manualCaloriesTarget: 1760, calorieFloor: 2500 }),
      gappy,
      {},
    );
    expect(t.tdee.source).toBe('measured');
    expect(asMeasured(t.tdee).reliable).toBe(false);
    expect(t.calorieTarget).toBe(2500);
  });

  it('applies MIN_DAILY_TARGET to a sub-1500 manual target when no floor is set', () => {
    const t = dailyTargets(profile({ manualCaloriesTarget: 1400 }), [log(0, 500)], {});
    expect(t.calorieTarget).toBe(1500);
  });

  it('does not disturb a reliable measured target (already clamped upstream)', () => {
    const t = dailyTargets(fullProfile(), series(20, 2000, 200), {});
    expect(t.tdee.source).toBe('measured');
    expect(asMeasured(t.tdee).reliable).toBe(true);
    expect(t.calorieTarget).toBe(t.tdee.newDailyTarget);
  });

  it('does not disturb a formula target (already clamped upstream)', () => {
    const t = dailyTargets(fullProfile({ calorieFloor: 1850 }), [log(0, 2000, 200)], {});
    expect(t.tdee.source).toBe('formula');
    expect(t.calorieTarget).toBe(t.tdee.newDailyTarget);
  });
});

/**
 * `targetMode: 'custom'` — the user's own numbers, not a starting point.
 *
 * Before it existed, `manualCaloriesTarget` was a SEED: used until the
 * estimator had enough data, then silently replaced. That is right for the
 * heuristic onboarding computes and wrong for a number a person typed, and
 * the gap is what a real user reported — a chosen target quietly becoming a
 * measured one with nothing saying why (UX_AUDIT, Abdiel Medina, 2026-08-21).
 *
 * The 'auto' cases below are the load-bearing half: this field is additive,
 * and every account that predates it has no `targetMode` at all.
 */
describe('dailyTargets — targetMode', () => {
  it("custom beats a reliable measured estimate", () => {
    const logs = series(20, 2000, 200);
    const auto = dailyTargets(fullProfile(), logs, {});
    expect(auto.tdee.source).toBe('measured');
    expect(asMeasured(auto.tdee).reliable).toBe(true);

    const custom = dailyTargets(
      fullProfile({ targetMode: 'custom', manualCaloriesTarget: 2000 }),
      logs,
      {},
    );
    // Same estimate underneath — the mode picks which number is USED, it does
    // not stop the estimator running. That is what keeps "we measure N"
    // truthful next to the user's own number.
    expect(custom.tdee.source).toBe('measured');
    expect(custom.calorieTarget).toBe(2000);
    expect(custom.calorieTarget).not.toBe(auto.calorieTarget);
  });

  it('omitted targetMode keeps the old seed behaviour exactly', () => {
    const logs = series(20, 2000, 200);
    const legacy = dailyTargets(fullProfile({ manualCaloriesTarget: 2000 }), logs, {});
    // No targetMode: the measured estimate still wins, as it always did.
    expect(legacy.calorieTarget).toBe(legacy.tdee.newDailyTarget);
    expect(legacy.calorieTarget).not.toBe(2000);
  });

  it("'auto' with a stored custom number ignores it — the number survives, unused", () => {
    // The whole point of an explicit mode: switching back to automatic must
    // not require destroying what the user typed.
    const logs = series(20, 2000, 200);
    const t = dailyTargets(
      fullProfile({ targetMode: 'auto', manualCaloriesTarget: 2000 }),
      logs,
      {},
    );
    expect(t.calorieTarget).toBe(t.tdee.newDailyTarget);
  });

  it('is per-field: custom calories leaves protein tracking body weight', () => {
    const logs = series(20, 2000, 200);
    const t = dailyTargets(
      fullProfile({ targetMode: 'custom', manualCaloriesTarget: 2000 }),
      logs,
      {},
    );
    expect(t.calorieTarget).toBe(2000);
    // No manualProteinTarget set, so protein is still derived from weight.
    expect(t.proteinTarget).toBe(computeProtein(t.currentWeight!));
  });

  it('custom protein outranks the g/kg basis', () => {
    const logs = series(20, 2000, 200);
    const t = dailyTargets(
      fullProfile({ targetMode: 'custom', manualProteinTarget: 190, proteinPerKg: 2.0 }),
      logs,
      {},
    );
    expect(t.proteinTarget).toBe(190);
  });

  it('still clamps a custom target up to the calorie floor', () => {
    // The mode says whose number it is, not whether the safety floor applies.
    const t = dailyTargets(
      fullProfile({ targetMode: 'custom', manualCaloriesTarget: 1300, calorieFloor: 1850 }),
      series(20, 2000, 200),
      {},
    );
    expect(t.calorieTarget).toBe(1850);
  });
});

/**
 * The 70% cliff, and the invariant that keeps it gone.
 *
 * `reliable = loggingCompletenessPct >= 70` used to decide whether the
 * estimator or a stored onboarding seed governed the day, so three points of
 * completeness could move a real user's target by ~140 kcal in one step. The
 * ramp that boundary wanted already lives in `measuredConfidence`; this pins
 * that nothing re-introduces a second one here.
 *
 * Stated as an invariant rather than a fixture on purpose: a fixture pins one
 * account, and the defect was structural.
 */
describe('dailyTargets — the seed cannot govern a measured account under auto', () => {
  /** 14 logged days over a 40-day span: measured, and firmly under 70%. */
  const gappy = [
    ...[39, 38, 37, 36, 35, 34, 33, 32, 31, 30].map((d) => log(d, 2000, 200)),
    ...[3, 2, 1, 0].map((d) => log(d, 2000, 197)),
  ];

  it('an unreliable measured account ignores the seed entirely', () => {
    const withSeed = dailyTargets(fullProfile({ manualCaloriesTarget: 1760 }), gappy, {});
    const without = dailyTargets(fullProfile(), gappy, {});

    expect(withSeed.tdee.source).toBe('measured');
    expect(asMeasured(withSeed.tdee).reliable).toBe(false);
    // The invariant: carrying a seed changes nothing once a measured estimate
    // exists. Restore `&& tdee.reliable` in targets.ts and this fails.
    expect(withSeed.calorieTarget).toBe(without.calorieTarget);
  });

  it('a reliable measured account ignores it too — same rule either side of 70%', () => {
    const logs = series(20, 2000, 200);
    const withSeed = dailyTargets(fullProfile({ manualCaloriesTarget: 1760 }), logs, {});
    const without = dailyTargets(fullProfile(), logs, {});

    expect(asMeasured(withSeed.tdee).reliable).toBe(true);
    expect(withSeed.calorieTarget).toBe(without.calorieTarget);
  });

  it('formula and seed modes still honour the seed — the branch is scoped', () => {
    // The half that must NOT change. Stripping the seed here drops the account
    // to SEED_RESULT.newDailyTarget (a hardcoded 1800), which on a 22-account
    // PROD replay moved 20 accounts by up to 1,720 kcal.
    const formula = dailyTargets(fullProfile({ manualCaloriesTarget: 1760 }), [log(0, 2000, 200)], {});
    expect(formula.tdee.source).toBe('formula');
    expect(formula.calorieTarget).toBe(1760);

    const seed = dailyTargets(profile({ manualCaloriesTarget: 1760 }), [], {});
    expect(seed.tdee.source).toBe('seed');
    expect(seed.calorieTarget).toBe(1760);
  });
});

/**
 * Protein had no floor concept at all. `proteinFloor` is opt-in: unset must
 * behave exactly as before, which is what the last two cases pin down.
 */
describe('dailyTargets — protein floor', () => {
  it('clamps the frozen manual protein snapshot up to the floor', () => {
    const t = dailyTargets(
      profile({ manualProteinTarget: 120, proteinFloor: 150 }),
      [],
      { '2026-06-29': 180 },
    );
    expect(t.proteinTarget).toBe(150);
  });

  it('clamps the perKg-derived protein target up to the floor', () => {
    const t = dailyTargets(
      profile({ proteinPerKg: 1.6, proteinFloor: 150 }),
      [],
      { '2026-06-29': 180 },
    );
    expect(computeProtein(180, 1.6)).toBeLessThan(150); // precondition
    expect(t.proteinTarget).toBe(150);
  });

  it('clamps the default 1.6 g/kg protein target up to the floor', () => {
    const t = dailyTargets(profile({ proteinFloor: 150 }), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(150);
  });

  it('leaves a protein target that already clears the floor untouched', () => {
    const t = dailyTargets(
      profile({ manualProteinTarget: 200, proteinFloor: 150 }),
      [],
      { '2026-06-29': 180 },
    );
    expect(t.proteinTarget).toBe(200);
  });

  it('is a no-op when proteinFloor is unset', () => {
    const t = dailyTargets(profile(), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(computeProtein(180));
  });
});

/**
 * A manual target outranking the formula result is INTENDED precedence here
 * (CONTEXT.md "TargetCalories", and the first case in the suite above) — the
 * bug was never in this module. It was that `saveOnboardingV2` could restore a
 * manual target onto a profile still stamped `targetsRefinedAt`, producing a
 * state the two writers are supposed to make impossible.
 *
 * That invariant is now owned and tested where it is enforced: see
 * `toOnboardingV2Patch` in ./firestore-writers.test.ts.
 */
