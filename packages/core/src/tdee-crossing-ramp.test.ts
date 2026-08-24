import { describe, it, expect } from 'vitest';
import { calculateTdee } from './tdee';
import { dailyTargets } from './targets';
import { asMeasured } from './tdee.test-utils';
import type { DailyLog, Profile, ProfileFields } from './types';

/**
 * The `formula` → `measured` crossing, pinned as a RAMP rather than a cliff.
 *
 * ## What this is about
 *
 * Measured 2026-08-24 by walking a clean 120-day history one day at a time and
 * recomputing the target exactly as the app does: it moved **−449 kcal between
 * day 13 and day 14**. That is the mode boundary, not the data — an order of
 * magnitude past the 18 kcal mean per-day move once measured mode is running,
 * and by far the largest single-day change the estimator could produce. It
 * landed on the user who had logged *perfectly* for two weeks, because
 * `measuredConfidence`'s two original ratios both saturate by then.
 *
 * A third ratio on evidence quantity now takes confidence from 0 at
 * `MEASURED_MIN_DAYS` to 1 at `RAMP_TO_FULL_DAYS`, which makes the crossing
 * continuous by construction: at exactly 14 days the blend is 100% anchor, and
 * the anchor is the same Mifflin number `formula` mode returned the day before.
 *
 * ## Why the ramp is not just conservatism
 *
 * The tempting shorter ramp is wrong, and a noiseless fixture hides why. With
 * clean input the measured estimate is exact from day 14, so any ramp looks
 * like serving a number you know is wrong. With realistic noise it reads
 * **2,828 against a true 2,350 at day 14** — worse than the formula anchor it
 * would replace — and only comes inside `CI95_CEILING_KCAL` at ~28 days. The
 * table lives on `RAMP_TO_FULL_DAYS`.
 *
 * These tests therefore pin BOTH halves: the crossing is smooth, AND a
 * fully-evidenced account is not damped at all.
 */

const PROFILE = {
  heightIn: 70,
  age: 34,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1,
  goalDirection: 'lose',
  calorieFloor: 1500,
} as unknown as Profile;

/** The same profile, typed for `calculateTdee` — it takes `ProfileFields`,
 *  while `dailyTargets` takes the full `Profile`. */
const FIELDS = PROFILE as unknown as ProfileFields;

const KEY = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `n` consecutive days of clean logging with a real 0.1 lb/day loss. */
function history(n: number): { logs: DailyLog[]; weights: Record<string, number> } {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  const day0 = new Date('2026-06-01T12:00:00');
  for (let i = 0; i < n; i++) {
    const d = new Date(day0);
    d.setDate(d.getDate() + i);
    const weight = Math.round((185 - i * 0.1) * 10) / 10;
    logs.push({ date: d, calories: 2000, weight });
    weights[KEY(d)] = weight;
  }
  return { logs, weights };
}

const targetAt = (n: number) => {
  const { logs, weights } = history(n);
  return dailyTargets(PROFILE, logs, weights).calorieTarget;
};

describe('the formula → measured crossing', () => {
  it('does not step when the mode changes', () => {
    // The regression this file exists for. Day 13 is `formula`, day 14 is
    // `measured`; the delivered target must barely notice.
    const before = targetAt(13);
    const after = targetAt(14);
    expect(asMeasured(calculateTdee(history(14).logs, FIELDS)).source).toBe('measured');
    expect(Math.abs(after - before)).toBeLessThan(50);
  });

  it('is fully anchored the day measured mode opens', () => {
    const r = asMeasured(calculateTdee(history(14).logs, FIELDS));
    expect(r.confidence).toBe(0);
    // The estimator still computes and reports its own answer — it is simply
    // not yet trusted. Losing this would make the ramp indistinguishable from
    // "measured mode starts later".
    expect(r.measuredTdee).toBeGreaterThan(2250);
    expect(r.measuredTdee).toBeLessThan(2450);
  });

  it('reaches full trust at 28 logged days and is undamped beyond', () => {
    expect(asMeasured(calculateTdee(history(28).logs, FIELDS)).confidence).toBe(1);
    expect(asMeasured(calculateTdee(history(42).logs, FIELDS)).confidence).toBe(1);
    // Undamped means the delivered number IS the measurement.
    const r = asMeasured(calculateTdee(history(35).logs, FIELDS));
    expect(r.trueTdee).toBe(r.measuredTdee);
  });

  it('climbs monotonically in between, and never overshoots either end', () => {
    let prev = -1;
    for (let n = 14; n <= 28; n++) {
      const r = asMeasured(calculateTdee(history(n).logs, FIELDS));
      expect(r.confidence).toBeGreaterThanOrEqual(prev);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      // The blend is a weighted average, so the result is bracketed by its two
      // inputs. On this fixture the anchor is high and the measurement low.
      expect(r.trueTdee).toBeGreaterThanOrEqual(r.measuredTdee);
      prev = r.confidence;
    }
  });

  it('bounds the largest single-day move across the whole ramp', () => {
    const targets: number[] = [];
    for (let n = 12; n <= 34; n++) targets.push(targetAt(n));
    const steps = targets.slice(1).map((t, i) => Math.abs(t - targets[i]));
    // Was 449 before the ramp. The ceiling is set well clear of what this
    // fixture produces so ordinary drift does not fail the build, while a
    // regression that restores the cliff does.
    expect(Math.max(...steps)).toBeLessThan(120);
  });
});
