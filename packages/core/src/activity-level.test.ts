import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MIN_USABLE_DAYS,
  activityGuidance,
  activityWindowRange,
  classifyActivityWindow,
  deriveActivityLevel,
  impliedMultiplier,
  reduceActivityWindow,
  snapMultiplier,
  suggestActivityLevel,
} from './activity-level';
import type { ActivityLevel } from './types';

describe('reduceActivityWindow', () => {
  it('averages the days that carry activity', () => {
    // 300 + 500 + 400 = 1200 over 3 days.
    expect(reduceActivityWindow([300, 500, 400])).toEqual({ mean: 400, usableDays: 3 });
  });

  it('treats a stored 0 as absence — excluded from BOTH the mean and the count', () => {
    // #29: activeKcal === 0 means "the OS reported nothing", not "burned
    // nothing". Averaging it in would drag every sedentary-looking week down.
    expect(reduceActivityWindow([300, 0, 500, 0, 400])).toEqual({ mean: 400, usableDays: 3 });
  });

  it('reports an empty window as zero usable days', () => {
    expect(reduceActivityWindow([])).toEqual({ mean: 0, usableDays: 0 });
  });

  it('reports an all-zero window as zero usable days', () => {
    expect(reduceActivityWindow([0, 0, 0])).toEqual({ mean: 0, usableDays: 0 });
  });

  it('ignores negative values the same way it ignores zeros', () => {
    expect(reduceActivityWindow([-50, 600, 200])).toEqual({ mean: 400, usableDays: 2 });
  });
});

describe('impliedMultiplier', () => {
  it('divides by (1 − TEF) so the thermic effect of food sits in the denominator', () => {
    // #22 worked example: 600 kcal/day of active energy on a 1800 kcal basal.
    // Mifflin's multiplier scales a TDEE that ALREADY contains ~10% TEF, so
    // the activity-only ratio (1 + 600/1800 = 1.3333) must be grossed up by
    // /0.90 before it can be compared against the bucket ladder.
    expect(impliedMultiplier(600, 1800)).toBeCloseTo(1.4815, 4);
  });

  it('is exactly 1/0.90 for a zero-activity window', () => {
    expect(impliedMultiplier(0, 1800)).toBeCloseTo(1.1111, 4);
  });

  it('never divides by a zero or missing basal', () => {
    expect(impliedMultiplier(600, 0)).toBe(0);
  });
});

describe('snapMultiplier', () => {
  it('returns the bucket a multiplier sits exactly on', () => {
    expect(snapMultiplier(1.2)).toBe('sedentary');
    expect(snapMultiplier(1.375)).toBe('light');
    expect(snapMultiplier(1.55)).toBe('moderate');
    expect(snapMultiplier(1.725)).toBe('active');
    expect(snapMultiplier(1.9)).toBe('very_active');
  });

  it('snaps to the nearest bucket on either side of a midpoint', () => {
    // sedentary|light midpoint is 1.2875.
    expect(snapMultiplier(1.28)).toBe('sedentary');
    expect(snapMultiplier(1.3)).toBe('light');
    // active|very_active midpoint is 1.8125.
    expect(snapMultiplier(1.8)).toBe('active');
    expect(snapMultiplier(1.83)).toBe('very_active');
  });

  it('clamps outside the ladder instead of extrapolating', () => {
    expect(snapMultiplier(0.5)).toBe('sedentary');
    expect(snapMultiplier(3.4)).toBe('very_active');
  });

  it('breaks an exact tie toward the lower bucket', () => {
    // A dead-on midpoint must not inflate the user's TDEE.
    expect(snapMultiplier(1.2875)).toBe('sedentary');
    expect(snapMultiplier(1.4625)).toBe('light');
  });
});

describe('deriveActivityLevel', () => {
  it('lands one bucket higher than a TEF-blind calculation would', () => {
    // 600 kcal/day active on a 1800 kcal basal. Without the /0.90 the ratio is
    // 1.3333 → 'light'; with TEF it is 1.4815 → 'moderate'. This fixture is
    // the regression guard for #22.
    expect(deriveActivityLevel(600, 1800)).toBe('moderate');
    expect(snapMultiplier(1 + 600 / 1800)).toBe('light');
  });

  it('reads a near-zero burn as sedentary', () => {
    expect(deriveActivityLevel(40, 1800)).toBe('sedentary');
  });

  it('reads a heavy endurance burn as very_active', () => {
    // 1300 kcal/day active on a 1800 basal → (1 + 0.722)/0.9 = 1.914.
    expect(deriveActivityLevel(1300, 1800)).toBe('very_active');
  });
});

describe('classifyActivityWindow', () => {
  const days = (n: number, kcal = 500) => Array.from({ length: n }, () => kcal);

  it('gates at 21 usable days out of the 28-day window', () => {
    // 21/28 is four clean weeks minus one, which makes weekend-blindness
    // arithmetically impossible.
    expect(ACTIVITY_MIN_USABLE_DAYS).toBe(21);
  });

  it('reports a window with nothing at all as none', () => {
    expect(classifyActivityWindow({ activeKcals: [] })).toBe('none');
    expect(classifyActivityWindow({ activeKcals: [0, 0, 0], steps: [] })).toBe('none');
  });

  it('reports steps without active energy as steps-only', () => {
    // A bare phone in a pocket logs steps but no activeKcal. Display-only this
    // release — it selects no branch (#23 §6).
    expect(classifyActivityWindow({ activeKcals: [0, 0], steps: [4000, 6000] })).toBe('steps-only');
  });

  it('reports some-but-too-few active days as insufficient', () => {
    expect(classifyActivityWindow({ activeKcals: days(20) })).toBe('insufficient');
  });

  it('reports a window at the gate as sufficient', () => {
    expect(classifyActivityWindow({ activeKcals: days(21) })).toBe('sufficient');
  });

  it('counts only the > 0 days toward the gate', () => {
    // 21 real days padded with 7 absences still clears; 20 real does not.
    expect(classifyActivityWindow({ activeKcals: [...days(21), ...days(7, 0)] })).toBe('sufficient');
    expect(classifyActivityWindow({ activeKcals: [...days(20), ...days(8, 0)] })).toBe('insufficient');
  });
});

describe('activityGuidance', () => {
  const days = (n: number, kcal = 500) => Array.from({ length: n }, () => kcal);
  const base = {
    enabled: true,
    healthAvailable: true,
    connected: true,
    activeKcals: [] as number[],
    suggestion: null as ActivityLevel | null,
  };

  it('says nothing when the kill-switch is off, even with a live suggestion', () => {
    // One flag has to be able to silence every surface at once.
    expect(
      activityGuidance({ ...base, enabled: false, activeKcals: days(28), suggestion: 'moderate' }),
    ).toEqual({ kind: 'none' });
  });

  it('says nothing when the device has no health store to connect to', () => {
    // Nagging someone to connect Health on a device that has none is pure noise.
    expect(activityGuidance({ ...base, healthAvailable: false, connected: false })).toEqual({
      kind: 'none',
    });
  });

  it('asks an unconnected user to connect', () => {
    expect(activityGuidance({ ...base, connected: false })).toEqual({ kind: 'connect' });
  });

  it('prefers a ready suggestion over every other prompt', () => {
    expect(
      activityGuidance({ ...base, activeKcals: days(28), suggestion: 'active' }),
    ).toEqual({ kind: 'suggestion', bucket: 'active' });
  });

  it('says nothing when the window is full but the suggestion was withheld', () => {
    // Deadband / decline / already-on-that-bucket all land here. A "21 of 21
    // days" line under a card that will never appear reads as a broken promise.
    expect(activityGuidance({ ...base, activeKcals: days(28), suggestion: null })).toEqual({
      kind: 'none',
    });
  });

  it('shows accrual progress once at least one day has landed', () => {
    expect(activityGuidance({ ...base, activeKcals: days(14) })).toEqual({
      kind: 'progress',
      usableDays: 14,
      needed: 21,
    });
    expect(activityGuidance({ ...base, activeKcals: days(1) })).toEqual({
      kind: 'progress',
      usableDays: 1,
      needed: 21,
    });
  });

  it('counts progress the way the gate does — zeros are absence', () => {
    expect(activityGuidance({ ...base, activeKcals: [...days(5), ...days(10, 0)] })).toEqual({
      kind: 'progress',
      usableDays: 5,
      needed: 21,
    });
  });

  it('calls out a steps-only device instead of showing 0 progress', () => {
    // Steps but no active energy is not "keep waiting" — it is a source
    // problem the user has to fix (an Android watch app writing nothing).
    expect(activityGuidance({ ...base, activeKcals: [0, 0], steps: [6000, 7000] })).toEqual({
      kind: 'steps-only',
    });
  });

  it('stays quiet for a connected user with nothing imported at all', () => {
    // Just connected, or a device that reports neither: there is nothing to
    // report and nothing to fix, so say nothing rather than "0 of 21".
    expect(activityGuidance({ ...base, activeKcals: [], steps: [] })).toEqual({ kind: 'none' });
  });
});

describe('activityWindowRange', () => {
  it('spans [today − 28, today − 1] — today is excluded unconditionally', () => {
    // Today is still accruing (the watch syncs all day), so including it would
    // read as a low day every morning (#23).
    expect(activityWindowRange(new Date(2026, 6, 24))).toEqual({
      from: '2026-06-26',
      to: '2026-07-23',
    });
  });

  it('covers exactly 28 calendar days', () => {
    const { from, to } = activityWindowRange(new Date(2026, 6, 24));
    const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1;
    expect(spanDays).toBe(28);
  });

  it('crosses a year boundary', () => {
    expect(activityWindowRange(new Date(2026, 0, 5))).toEqual({
      from: '2025-12-08',
      to: '2026-01-04',
    });
  });
});

describe('suggestActivityLevel', () => {
  const BASAL = 1800;
  /** A full window of `n` usable days at the burn implying `multiplier`. */
  const windowFor = (multiplier: number, n = 28) =>
    Array.from({ length: n }, () => BASAL * (multiplier * 0.9 - 1));

  it('suggests nothing below the 21-day gate, and suggests at it', () => {
    const burn = windowFor(1.55, 20);
    expect(
      suggestActivityLevel({ activeKcals: burn, basalKcal: BASAL, currentBucket: 'sedentary' }),
    ).toBeNull();
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.55, 21),
        basalKcal: BASAL,
        currentBucket: 'sedentary',
      }),
    ).toBe('moderate');
  });

  it('does not count stored zeros toward the gate', () => {
    // 20 real days + 8 absences reads as 20, not 28 (#29).
    const burn = [...windowFor(1.55, 20), 0, 0, 0, 0, 0, 0, 0, 0];
    expect(
      suggestActivityLevel({ activeKcals: burn, basalKcal: BASAL, currentBucket: 'sedentary' }),
    ).toBeNull();
  });

  it('holds the current bucket inside the deadband', () => {
    // Implied 1.37 vs the stored sedentary 1.2 → a 0.17 delta. Bare snapping
    // would already say 'light'; the deadband keeps it put so the card cannot
    // flap around the 1.2875 midpoint.
    expect(snapMultiplier(1.37)).toBe('light');
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.37),
        basalKcal: BASAL,
        currentBucket: 'sedentary',
      }),
    ).toBeNull();
  });

  it('suggests once the delta clears a full bucket', () => {
    // Implied 1.38 vs 1.2 → a 0.18 delta, past the 0.175 threshold.
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.38),
        basalKcal: BASAL,
        currentBucket: 'sedentary',
      }),
    ).toBe('light');
  });

  it('skips the deadband at seed, when there is no bucket to compare against', () => {
    // Refine Targets pre-fill: no stored activityLevel yet, so a 0.17-delta
    // window still yields the bucket it implies.
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.37),
        basalKcal: BASAL,
        currentBucket: null,
      }),
    ).toBe('light');
  });

  it('stays silent about a bucket the user already declined', () => {
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.55),
        basalKcal: BASAL,
        currentBucket: 'sedentary',
        declinedBucket: 'moderate',
      }),
    ).toBeNull();
  });

  it('still suggests a DIFFERENT bucket than the declined one', () => {
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.55),
        basalKcal: BASAL,
        currentBucket: 'sedentary',
        declinedBucket: 'very_active',
      }),
    ).toBe('moderate');
  });

  it('never suggests the bucket the user is already on', () => {
    expect(
      suggestActivityLevel({
        activeKcals: windowFor(1.55),
        basalKcal: BASAL,
        currentBucket: 'moderate',
      }),
    ).toBeNull();
  });

  it('suggests nothing for an empty or all-zero window', () => {
    expect(
      suggestActivityLevel({ activeKcals: [], basalKcal: BASAL, currentBucket: 'moderate' }),
    ).toBeNull();
    expect(
      suggestActivityLevel({
        activeKcals: Array(28).fill(0),
        basalKcal: BASAL,
        currentBucket: null,
      }),
    ).toBeNull();
  });

  it('suggests nothing without a usable basal', () => {
    // Refine Targets can call this mid-form, before height/age are filled in.
    expect(
      suggestActivityLevel({ activeKcals: windowFor(1.55), basalKcal: 0, currentBucket: null }),
    ).toBeNull();
  });
});
