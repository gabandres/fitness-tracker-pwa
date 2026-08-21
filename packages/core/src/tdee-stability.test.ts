import { describe, it, expect } from 'vitest';
import { calculateTdee, calorieFloor } from './tdee';
import { dailyTargets, finalCalorieTarget } from './targets';
import { buildCoachSystemInstruction } from './coach-prompt';
import { buildWeeklyReportPayload } from './weekly-report-prompt';
import { recalibrationDigest } from './tdee-recalibration';
import type { DailyLog, Profile, ProfileFields } from './types';
import { asMeasured } from './tdee.test-utils';

/**
 * Locking tests for the 2026-08-19 target-stability work.
 *
 * The fixtures are one real account's actual rows, read from Firestore the day
 * the defect was found. Synthetic data would not have caught this: the bug is
 * a 2 lb overnight reading at the end of a short post-break run, and it only
 * bites because of where in the baseline it sits.
 */

/** [localDateKey, kcal, weight | null] */
type Row = [string, number, number | null];

/** The account's last 28 LOGGED days as of 2026-08-19. Note 08-19 = 156.0 lb,
 *  a 2 lb overnight drop from 08-18's 158.0 — the reading that was worth 287
 *  kcal of daily target. Note also the 07-11 → 08-02 break. */
const WINDOW: Row[] = [
  ['2026-07-02', 1545, 159.6], ['2026-07-03', 1859, 159.2], ['2026-07-04', 2020, 160],
  ['2026-07-05', 1765, 159.6], ['2026-07-06', 1810, 158.8], ['2026-07-07', 1805, 158.2],
  ['2026-07-08', 1965, 158.18], ['2026-07-09', 1887, 158.6], ['2026-07-10', 1612, 159],
  ['2026-07-11', 1850, 159.4], ['2026-08-02', 250, null], ['2026-08-03', 1845, null],
  ['2026-08-04', 1898, 161.2], ['2026-08-05', 1860, 160.2], ['2026-08-06', 2040, 160.4],
  ['2026-08-07', 1902, 159.6], ['2026-08-08', 1901, null], ['2026-08-09', 2179, 159.6],
  ['2026-08-10', 1835, 160.2], ['2026-08-11', 1882, 159.6], ['2026-08-12', 1852, 158.2],
  ['2026-08-13', 1876, 158], ['2026-08-14', 1936, 158], ['2026-08-15', 2057, 158.2],
  ['2026-08-16', 1710, 158], ['2026-08-17', 1745, 159.2], ['2026-08-18', 1822, 158],
  ['2026-08-19', 2104, 156],
];

/** The same account's last gap-free 28 logged days (2026-06-14 → 07-11), the
 *  tail of a 97-day unbroken run. Used for the convergence check. */
const GAP_FREE: Row[] = [
  ['2026-06-14', 2910, 159.8], ['2026-06-15', 2251, 161.6], ['2026-06-16', 1940, 162.2],
  ['2026-06-17', 1852, 160.2], ['2026-06-18', 2474, 159.4], ['2026-06-19', 2120, 160.2],
  ['2026-06-20', 1861, 160.4], ['2026-06-21', 1815, 160.4], ['2026-06-22', 1870, null],
  ['2026-06-23', 1860, 160.4], ['2026-06-24', 1817, 160], ['2026-06-25', 2048, 161.2],
  ['2026-06-26', 2261, 161], ['2026-06-27', 1900, 160], ['2026-06-28', 1943, 160],
  ['2026-06-29', 2020, 159.4], ['2026-06-30', 1865, 161], ['2026-07-01', 1790, 160.2],
  ['2026-07-02', 1545, 159.6], ['2026-07-03', 1859, 159.2], ['2026-07-04', 2020, 160],
  ['2026-07-05', 1765, 159.6], ['2026-07-06', 1810, 158.8], ['2026-07-07', 1805, 158.2],
  ['2026-07-08', 1965, 158.18], ['2026-07-09', 1887, 158.6], ['2026-07-10', 1612, 159],
  ['2026-07-11', 1850, 159.4],
];

const toLogs = (rows: Row[]): DailyLog[] =>
  rows.map(([k, calories, weight]) => ({
    date: new Date(`${k}T12:00:00`),
    calories,
    ...(weight == null ? {} : { weight }),
  }));

/** The account's real profile fields. floor 1850, pace 0.9 lb/wk. */
const PROFILE: ProfileFields = {
  heightIn: 68, age: 33, sex: 'male', activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.9, calorieFloor: 1850,
};
const FLOOR = 1850;
const PACE_DEFICIT = (0.9 * 3500) / 7; // 450

/**
 * The UNCLAMPED target. Every leverage assertion below uses this, not the
 * clamped one.
 *
 * With this account's 1,850 floor most of these scenarios land ON the floor, so
 * asserting "the target moved less than 100 kcal" against the clamped value
 * would pass at Δ0 while the estimator underneath swung 500. That is
 * floor-masking: it measures the clamp, not the fix. The clamped value is
 * asserted separately, for what it is actually evidence of.
 */
const unclamped = (logs: DailyLog[]): number =>
  Math.round(calculateTdee(logs, PROFILE).trueTdee - PACE_DEFICIT);

/**
 * The last 42 logged days of the same account's 97-day gap-free run — i.e. a
 * PERFECT record, which is what makes `confidence` 1 and takes the formula
 * anchor out of the answer entirely.
 */
const GAP_FREE_42: Row[] = [
  ['2026-05-31', 2110, 163.2], ['2026-06-01', 1947, 162.4], ['2026-06-02', 1789, 161.8],
  ['2026-06-03', 1975, 163], ['2026-06-04', 1962, 162.6], ['2026-06-05', 1945, 162],
  ['2026-06-06', 2072, 161.8], ['2026-06-07', 2160, 161.4], ['2026-06-08', 2005, 162.2],
  ['2026-06-09', 2057, 160.4], ['2026-06-10', 2210, 160.8], ['2026-06-11', 1920, 160],
  ['2026-06-12', 2220, 161], ['2026-06-13', 2240, 159.6], ['2026-06-14', 2910, 159.8],
  ['2026-06-15', 2251, 161.6], ['2026-06-16', 1940, 162.2], ['2026-06-17', 1852, 160.2],
  ['2026-06-18', 2474, 159.4], ['2026-06-19', 2120, 160.2], ['2026-06-20', 1861, 160.4],
  ['2026-06-21', 1815, 160.4], ['2026-06-22', 1870, null], ['2026-06-23', 1860, 160.4],
  ['2026-06-24', 1817, 160], ['2026-06-25', 2048, 161.2], ['2026-06-26', 2261, 161],
  ['2026-06-27', 1900, 160], ['2026-06-28', 1943, 160], ['2026-06-29', 2020, 159.4],
  ['2026-06-30', 1865, 161], ['2026-07-01', 1790, 160.2], ['2026-07-02', 1545, 159.6],
  ['2026-07-03', 1859, 159.2], ['2026-07-04', 2020, 160], ['2026-07-05', 1765, 159.6],
  ['2026-07-06', 1810, 158.8], ['2026-07-07', 1805, 158.2], ['2026-07-08', 1965, 158.18],
  ['2026-07-09', 1887, 158.6], ['2026-07-10', 1612, 159], ['2026-07-11', 1850, 159.4],
];

describe('MEASURED_WINDOW_DAYS = 42 (2026-08-19)', () => {
  const perfect = toLogs(GAP_FREE_42);

  it('better logging must not LOWER the TDEE — the perverse incentive is gone', () => {
    // The defect this constant moved for. At a 28-day window a complete record
    // returned 2,211 while a 57%-complete one returned 2,271, because the
    // window error was low and the activity anchor was high and the two
    // cancelled only while the user logged badly. Both must now be in range.
    const r = asMeasured(calculateTdee(perfect, PROFILE));
    expect(r.reliable).toBe(true);
    expect(r.confidence).toBe(1);           // anchor fully out of the answer
    expect(r.trueTdee).toBe(r.measuredTdee); // nothing damped
    expect(r.trueTdee).toBeGreaterThanOrEqual(2250);
    expect(r.trueTdee).toBeLessThanOrEqual(2350);
  });

  it('actually uses 42 logged days when they exist', () => {
    // Guards the constant itself: at 28 this reads 28 and the test above would
    // fail for a reason that looks like an estimator bug.
    const r = asMeasured(calculateTdee(perfect, PROFILE));
    expect(r.windowDays).toBe(42);
  });

  it('tracks its own window plain-OLS benchmark within 1%', () => {
    // Benchmark = plain energy balance over these exact 42 rows: 2,279.
    // The point of this assertion is that the estimator is NOT the source of
    // the residual gap to the 97-day figure (2,385) — the window length is.
    const r = asMeasured(calculateTdee(perfect, PROFILE));
    expect(Math.abs(r.measuredTdee / 2279 - 1)).toBeLessThan(0.01);
  });
});

describe('endpoint leverage — one weigh-in cannot move the target (2026-08-19)', () => {
  const all = toLogs(WINDOW);

  it('1. dropping the most recent weigh-in moves the target under 100 kcal', () => {
    // Before this work: 484 kcal unclamped, 287 kcal clamped.
    const without = toLogs(WINDOW.map((r, i) =>
      i === WINDOW.length - 1 ? [r[0], r[1], null] : r,
    ));
    const delta = Math.abs(unclamped(all) - unclamped(without));
    expect(delta).toBeLessThan(100);
  });

  it('2. a synthetic -2.0 lb single-day water drop moves the target under 100 kcal', () => {
    // The final reading is already a 2 lb drop; take it down another 2 to model
    // the spike arriving on an otherwise flat run.
    const spiked = toLogs(WINDOW.map((r, i) =>
      i === WINDOW.length - 1 && r[2] != null ? [r[0], r[1], r[2] - 2.0] : r,
    ));
    const delta = Math.abs(unclamped(all) - unclamped(spiked));
    expect(delta).toBeLessThan(100);
  });

  it('a spike cannot STEEPEN the trend, only flatten it', () => {
    // The asymmetry in `corroboratedSlope`, stated as behaviour: a fresh low
    // reading may not increase the implied deficit on its own.
    const spiked = toLogs(WINDOW.map((r, i) =>
      i === WINDOW.length - 1 && r[2] != null ? [r[0], r[1], r[2] - 2.0] : r,
    ));
    expect(calculateTdee(spiked, PROFILE).trueTdee)
      .toBeLessThanOrEqual(calculateTdee(all, PROFILE).trueTdee + 1);
  });

  it('does not blunt a real, sustained loss', () => {
    // 28 days of steady 0.5 lb/wk against 2,000 kcal. The rate is present with
    // or without the last morning, so corroboration is inert and the estimate
    // still reads the loss: 2000 + 0.0714 lb/day x 3500 = ~2250.
    const steady = toLogs(Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      return [k, 2000, 180 - i * (0.5 / 7)] as Row;
    }));
    const r = asMeasured(calculateTdee(steady, PROFILE));
    expect(r.measuredTdee).toBeGreaterThan(2200);
    expect(r.measuredTdee).toBeLessThan(2300);
  });
});

describe('3. convergence against the plain-OLS benchmark', () => {
  it('lands within 5% of OLS over the same gap-free days it actually sees', () => {
    // The benchmark is plain energy balance over these exact 28 rows: 2232.
    // (Over the FULL 97-day gap-free run it is 2385, but `MEASURED_WINDOW_DAYS`
    // is 28 LOGGED days, so the estimator structurally never sees the other 69.
    // That gap is a window-length policy question, not an estimator error.)
    const r = asMeasured(calculateTdee(toLogs(GAP_FREE), PROFILE));
    expect(r.source).toBe('measured');
    expect(Math.abs(r.measuredTdee / 2232 - 1)).toBeLessThan(0.05);
  });

  it('leaves a complete window undamped — reliable ⇒ confidence 1', () => {
    // The property that keeps every good logger's number byte-identical.
    const r = asMeasured(calculateTdee(toLogs(GAP_FREE), PROFILE));
    expect(r.reliable).toBe(true);
    expect(r.confidence).toBe(1);
    expect(r.trueTdee).toBe(r.measuredTdee);
  });
});

describe('4. the floor holds on every call path', () => {
  const suppressed = toLogs(WINDOW);
  const profile: Profile = { ...PROFILE, calorieFloor: FLOOR, createdAt: new Date('2026-04-05'), lastSeenAt: new Date('2026-08-19'), profileCompleted: true };

  it('dailyTargets never returns below the floor', () => {
    expect(dailyTargets(profile, suppressed, {}).calorieTarget).toBeGreaterThanOrEqual(FLOOR);
  });

  it('finalCalorieTarget never returns below the floor', () => {
    const tdee = calculateTdee(suppressed, PROFILE);
    expect(finalCalorieTarget(tdee, profile)).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the coach prompt never states a target below the floor', () => {
    const tdee = calculateTdee(suppressed, PROFILE);
    const text = buildCoachSystemInstruction({ logs: suppressed, tdee, profile: PROFILE });
    const stated = Number(/- Daily target: (\d+) kcal\/day/.exec(text)?.[1]);
    expect(stated).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the weekly report prompt never states a target below the floor', () => {
    const tdee = calculateTdee(suppressed, PROFILE);
    const { systemInstruction } = buildWeeklyReportPayload({ logs: suppressed, tdee, profile: PROFILE });
    const stated = Number(/- Daily target: (\d+) kcal\/day/.exec(systemInstruction)?.[1]);
    expect(stated).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the recalibration digest never reports a target below the floor', () => {
    const d = recalibrationDigest(profile, suppressed, {}, { now: Date.parse('2026-08-19T12:00:00Z') });
    if (d.available) expect(d.calorieTarget).toBeGreaterThanOrEqual(FLOOR);
  });
});

describe('5. seed state — the hardcoded 1800 cannot escape the floor', () => {
  // Fewer than MEASURED_MIN_DAYS logged days and no profile ⇒ SEED_RESULT,
  // whose newDailyTarget is a hardcoded 1800. Against an 1850 floor every one
  // of these paths used to be able to report 1800.
  const thin = toLogs(WINDOW.slice(0, 5));
  const profile: Profile = { calorieFloor: FLOOR, createdAt: new Date('2026-04-05'), lastSeenAt: new Date('2026-08-19'), profileCompleted: true };

  it('the seed target itself is below the floor — the premise of this block', () => {
    expect(calculateTdee(thin, null).source).toBe('seed');
    expect(calculateTdee(thin, null).newDailyTarget).toBe(1800);
    expect(1800).toBeLessThan(FLOOR);
  });

  it('every call path lifts it to the floor', () => {
    const tdee = calculateTdee(thin, null);
    expect(finalCalorieTarget(tdee, profile)).toBe(FLOOR);
    expect(dailyTargets(profile, thin, {}).calorieTarget).toBeGreaterThanOrEqual(FLOOR);

    const coach = buildCoachSystemInstruction({ logs: thin, tdee, profile: null });
    expect(Number(/- Daily target: (\d+) kcal\/day/.exec(coach)?.[1])).toBe(1800);
    // ^ profile is null here, so there is no floor to apply and 1800 is
    //   correct. The interesting case is a floor that EXISTS:
    const coachWithFloor = buildCoachSystemInstruction({
      logs: thin, tdee, profile: { ...PROFILE } as ProfileFields,
    });
    expect(Number(/- Daily target: (\d+) kcal\/day/.exec(coachWithFloor)?.[1]))
      .toBeGreaterThanOrEqual(FLOOR);
  });

  it('calorieFloor defaults to 1500 and is NOT changed by this work', () => {
    expect(calorieFloor(null)).toBe(1500);
    expect(calorieFloor({})).toBe(1500);
    expect(calorieFloor({ calorieFloor: 1850 })).toBe(1850);
  });
});
