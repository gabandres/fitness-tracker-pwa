import { describe, expect, it } from 'vitest';
import {
  AGGRESSIVE_DEFICIT_PCT,
  TARGET_KCAL_CEILING,
  validateCalorieTarget,
  validateProteinTarget,
} from './target-input';

/**
 * The promise this file exists to keep: **the number you type is the number
 * you get.** `dailyTargets` clamps every path with
 * `Math.max(calorieFloor(profile), …)`, so any input rule looser than that
 * floor would store one number and display another — reintroducing the silent
 * override that `targetMode` was built to remove.
 */
describe('validateCalorieTarget', () => {
  it('refuses a value under the DEFAULT floor of 1500', () => {
    const v = validateCalorieTarget(1300);
    expect(v.ok).toBe(false);
    expect(v.issue).toEqual({ kind: 'belowFloor', floor: 1500 });
  });

  it("refuses a value under the user's OWN raised floor", () => {
    // The case that makes an input-only minimum wrong: 1,600 clears the
    // built-in 1,500 and would still be clamped up to 1,850 on display.
    const v = validateCalorieTarget(1600, { profile: { calorieFloor: 1850 } });
    expect(v.ok).toBe(false);
    expect(v.issue).toEqual({ kind: 'belowFloor', floor: 1850 });
  });

  it('accepts a value that lowering the floor has made legal', () => {
    expect(validateCalorieTarget(1300, { profile: { calorieFloor: 1200 } }).ok).toBe(true);
  });

  it('refuses a fat-fingered ceiling breach', () => {
    const v = validateCalorieTarget(20000);
    expect(v.ok).toBe(false);
    expect(v.issue).toEqual({ kind: 'aboveCeiling', ceiling: TARGET_KCAL_CEILING });
  });

  it('refuses junk and zero', () => {
    for (const bad of [null, undefined, 0, -100, Number.NaN]) {
      expect(validateCalorieTarget(bad).ok).toBe(false);
    }
  });

  it('warns without blocking when the target is a steep cut', () => {
    // 1800 against a measured 2600 is 30.8% under.
    const v = validateCalorieTarget(1800, { measuredTdee: 2600 });
    expect(v.ok).toBe(true);
    expect(v.issue).toEqual({ kind: 'aggressive', measured: 2600, pctUnder: 31 });
  });

  it('stays quiet just under the advisory threshold', () => {
    const measured = 2600;
    const justInside = Math.ceil(measured * (1 - (AGGRESSIVE_DEFICIT_PCT - 1) / 100));
    expect(validateCalorieTarget(justInside, { measuredTdee: measured }).issue).toBeNull();
  });

  it('says nothing about a new account with no measured estimate', () => {
    // Nothing to compare against — a new user must not be nagged.
    expect(validateCalorieTarget(1600, { measuredTdee: null }).issue).toBeNull();
    expect(validateCalorieTarget(1600).issue).toBeNull();
  });

  it('blocks before it advises when both apply', () => {
    // 1000 is below the floor AND far under measured; the blocking issue is
    // the one worth saying.
    expect(validateCalorieTarget(1000, { measuredTdee: 2600 }).issue).toEqual({
      kind: 'belowFloor',
      floor: 1500,
    });
  });
});

describe('validateProteinTarget', () => {
  it('accepts an ordinary target', () => {
    expect(validateProteinTarget(150)).toEqual({ ok: true, issue: null });
  });
  it('refuses out-of-band values', () => {
    expect(validateProteinTarget(10).ok).toBe(false);
    expect(validateProteinTarget(500).ok).toBe(false);
    expect(validateProteinTarget(null).ok).toBe(false);
  });
});
