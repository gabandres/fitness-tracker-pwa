import { describe, expect, it } from 'vitest';
import { COMPLETE_DAY_MIN_KCAL, isCompleteDay, readDayLogged } from './complete-day';
import { PROFILE, incompleteLogger, keyAt, normalUser, row } from './complete-day.fixtures';
import { compositionMaintenance } from './composition-maintenance';
import { buildCsv } from './csv-export';
import { MIDNIGHT } from './day-boundary';
import { measurementProgress } from './measurement-progress';
import { calculateTdee, MEASURED_MIN_DAYS, type TdeeResult } from './tdee';
import { tdeeSeries } from './tdee-series';
import { recalibrationDigest } from './tdee-recalibration';
import { dailyTargets } from './targets';
import { asMeasured } from './tdee.test-utils';
import type { DailyLog, Profile } from './types';

/**
 * The complete-day rule (owner decision, 2026-10-24): a finished day counts
 * toward the maintenance fit at ≥ 1,000 kcal unless marked "not fully logged",
 * and under 1,000 only when marked "fully logged". Fewer than 14 complete days
 * → no measured estimate, and the result says why.
 */

const reason = (r: TdeeResult) => (r.source === 'measured' ? undefined : r.notEnoughCompleteDays);

/** A full Profile around the fixture's ProfileFields, for `dailyTargets`. */
const fullProfile = (over: Partial<Profile> = {}): Profile =>
  ({
    ...PROFILE,
    createdAt: new Date('2026-07-01'),
    lastSeenAt: new Date('2026-10-01'),
    profileCompleted: true,
    ...over,
  }) as Profile;

describe('isCompleteDay / readDayLogged', () => {
  it('is the owner\'s rule, exactly', () => {
    expect(COMPLETE_DAY_MIN_KCAL).toBe(1000);
    // unset: the 1,000 kcal bar alone
    expect(isCompleteDay(999, undefined)).toBe(false);
    expect(isCompleteDay(1000, undefined)).toBe(true);
    expect(isCompleteDay(1000, null)).toBe(true);
    // "fully logged" rescues a small day
    expect(isCompleteDay(900, true)).toBe(true);
    // "not fully logged" drops even a big one
    expect(isCompleteDay(2000, false)).toBe(false);
  });

  it('reads only a boolean answer', () => {
    expect(readDayLogged({ complete: true })).toBe(true);
    expect(readDayLogged({ complete: false })).toBe(false);
    expect(readDayLogged({ complete: 'true' })).toBeNull();
    expect(readDayLogged(undefined)).toBeNull();
    expect(readDayLogged(null)).toBeNull();
  });
});

describe('the account that prompted it: 42 days, 9 complete, flat weight', () => {
  const { logs, now, fullDays } = incompleteLogger();

  it('was a "measured" 864 kcal maintenance under the old rule (every day counted)', () => {
    // Marking every day fully logged IS the old rule — every row counts —
    // which pins the before number this change exists to remove.
    const everyDay = Object.fromEntries(logs.map((l, i) => [keyAt('2026-09-01', i), true]));
    const old = asMeasured(calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, everyDay));
    expect(old.trueTdee).toBe(864);
    expect(old.avgDailyIntake).toBe(866);
    expect(old.windowDays).toBe(42);
  });

  it('is NOT measured now: 9 complete days of 14, and the result says so', () => {
    expect(fullDays).toHaveLength(9);
    const r = calculateTdee(logs, PROFILE, MIDNIGHT, now);
    expect(r.source).toBe('formula');
    expect(reason(r)).toEqual({ valid: 9, needed: MEASURED_MIN_DAYS });
    // The formula's number, not a fit to half-logged days.
    expect(r.trueTdee).toBeGreaterThan(2000);
  });

  it('without a profile it is the seed — still with the reason', () => {
    const r = calculateTdee(logs, null, MIDNIGHT, now);
    expect(r.source).toBe('seed');
    expect(reason(r)).toEqual({ valid: 9, needed: 14 });
  });

  it('the target falls back to the manual/onboarding number, never the 864 fit', () => {
    const manual = dailyTargets(fullProfile({ manualCaloriesTarget: 1900 }), logs, {}, now);
    expect(manual.tdee.source).toBe('formula');
    expect(manual.calorieTarget).toBe(1900);
    const formulaOnly = dailyTargets(fullProfile(), logs, {}, now);
    expect(formulaOnly.calorieTarget).toBe(formulaOnly.tdee.newDailyTarget);
    // A user who typed their own number keeps it, exactly as before.
    const custom = dailyTargets(fullProfile({ targetMode: 'custom', manualCaloriesTarget: 1750 }), logs, {}, now);
    expect(custom.calorieTarget).toBe(1750);
    expect(custom.calorieSource).toBe('user');
  });

  it('the progress readout counts complete days and flags why', () => {
    const r = calculateTdee(logs, PROFILE, MIDNIGHT, now);
    const p = measurementProgress(r, logs, {});
    expect(p).toMatchObject({ loggedDays: 9, neededDays: 14, daysToGo: 5, notEnoughCompleteDays: true });
  });

  it('marking five more days fully logged opens measured mode', () => {
    const five = logs.map((_, i) => keyAt('2026-09-01', i)).filter((k) => !fullDays.includes(k)).slice(-5);
    const r = calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, Object.fromEntries(five.map((k) => [k, true])));
    expect(r.source).toBe('measured');
  });

  it('recalibration and the chart replay read the same rule', () => {
    expect(recalibrationDigest(fullProfile(), logs, {}, { now: now.getTime() }).available).toBe(false);
    const series = tdeeSeries(fullProfile(), logs, {}, { days: 1, now });
    expect(series[0].source).toBe('formula');
    const everyDay = Object.fromEntries(logs.map((_, i) => [keyAt('2026-09-01', i), true]));
    expect(tdeeSeries(fullProfile(), logs, {}, { days: 1, now, dayComplete: everyDay })[0].source).toBe('measured');
  });
});

describe('a normal, fully-logged user is unchanged', () => {
  // Pinned from `calculateTdee` at 9cacd2590 (before the rule), field for
  // field. Every day is ≥ 1,000 kcal, so nothing is left out and the result
  // must be byte-identical — with no answers, and with an empty map.
  const BEFORE = {
    trueTdee: 2201,
    newDailyTarget: 1701,
    weightChangeTrend: 2.38,
    source: 'measured',
    loggingCompletenessPct: 100,
    windowDays: 42,
    intakeDays: 42,
    spanDays: 42,
    reliable: true,
    outliersDropped: 0,
    measuredTdee: 2201,
    confidence: 1,
    avgDailyIntake: 1998,
    weightSlopeLbsPerDay: -0.05794,
    dailyDeficitAchieved: 203,
    seTdee: 22,
    ci95Tdee: 44,
    runsUsed: 1,
    estimateState: 'measuring',
    windowUsedDays: 42,
  };

  it('pins the before numbers', () => {
    const { logs, now } = normalUser();
    expect(calculateTdee(logs, PROFILE, MIDNIGHT, now)).toEqual(BEFORE);
    expect(calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, {})).toEqual(BEFORE);
  });

  it('answering "yes" on days that already count changes nothing', () => {
    const { logs, now } = normalUser();
    const yes = Object.fromEntries(logs.map((_, i) => [keyAt('2026-08-01', i), true]));
    expect(calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, yes)).toEqual(BEFORE);
  });
});

describe('the toggle, both ways', () => {
  /** 13 complete days at 2,000 kcal, flat weight, plus one more day of `kcal`. */
  function thirteenPlus(kcal: number): { logs: DailyLog[]; extraKey: string; now: Date } {
    const logs: DailyLog[] = [];
    for (let i = 0; i < 13; i++) logs.push(row(keyAt('2026-09-01', i), 2000, 180));
    const extraKey = keyAt('2026-09-01', 13);
    logs.push(row(extraKey, kcal, 180));
    return { logs, extraKey, now: new Date('2026-09-20T08:00:00') };
  }

  it('"fully logged" rescues a 900 kcal day', () => {
    const { logs, extraKey, now } = thirteenPlus(900);
    const unmarked = calculateTdee(logs, PROFILE, MIDNIGHT, now);
    expect(unmarked.source).toBe('formula');
    expect(reason(unmarked)).toEqual({ valid: 13, needed: 14 });
    const marked = asMeasured(calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, { [extraKey]: true }));
    expect(marked.windowDays).toBe(14);
    expect(marked.intakeDays).toBe(14);
  });

  it('"not fully logged" drops a 2,000 kcal day', () => {
    const { logs, extraKey, now } = thirteenPlus(2000);
    expect(calculateTdee(logs, PROFILE, MIDNIGHT, now).source).toBe('measured');
    const dropped = calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, { [extraKey]: false });
    expect(dropped.source).toBe('formula');
    expect(reason(dropped)).toEqual({ valid: 13, needed: 14 });
  });

  it('inside a long history, a rescued day enters the intake mean and a dropped one leaves it', () => {
    const { logs, now } = normalUser();
    const k = keyAt('2026-08-01', 50);
    const small = logs.map((l, i) => (i === 50 ? { ...l, calories: 900 } : l));
    const unmarked = asMeasured(calculateTdee(small, PROFILE, MIDNIGHT, now));
    const marked = asMeasured(calculateTdee(small, PROFILE, MIDNIGHT, now, undefined, { [k]: true }));
    expect(marked.intakeDays).toBe(42);
    expect(marked.avgDailyIntake).toBeLessThan(unmarked.avgDailyIntake);
    const no = asMeasured(calculateTdee(logs, PROFILE, MIDNIGHT, now, undefined, { [k]: false }));
    // 59 complete days remain; the window is still 42 of them, but not that one.
    expect(no.windowDays).toBe(42);
    expect(no.avgDailyIntake).not.toBe(1998);
  });
});

describe('what a left-out day keeps', () => {
  it('its weigh-in still reaches the trend', () => {
    // 40 days: even days 2,000 kcal with NO weigh-in, odd days 400 kcal (left
    // out) carrying every weigh-in, sliding 0.05 lb/day. If the left-out days'
    // scale readings were dropped there would be no trend at all.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 40; i++) {
      const key = keyAt('2026-08-01', i);
      logs.push(i % 2 === 0 ? row(key, 2000) : row(key, 400, 180 - i * 0.05));
    }
    const r = asMeasured(calculateTdee(logs, PROFILE, MIDNIGHT, new Date('2026-09-15T08:00:00')));
    expect(r.windowDays).toBe(20);
    expect(r.avgDailyIntake).toBe(2000);
    expect(r.weightSlopeLbsPerDay).toBeCloseTo(-0.05, 3);
  });

  it('the day in progress still counts as a row, as it always has', () => {
    // 13 finished complete days + 300 kcal so far today: 14, measured — the
    // rule judges FINISHED days; today's intake is zeroed regardless.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 13; i++) logs.push(row(keyAt('2026-09-01', i), 2000, 180));
    logs.push(row(keyAt('2026-09-01', 13), 300, 180));
    const r = calculateTdee(logs, PROFILE, MIDNIGHT, new Date(`${keyAt('2026-09-01', 13)}T18:00:00`));
    expect(r.source).toBe('measured');
  });

  it('a brand-new account with nothing left out carries no reason', () => {
    const logs = [row('2026-09-01', 2000, 180), row('2026-09-02', 1900, 180)];
    const r = calculateTdee(logs, PROFILE, MIDNIGHT, new Date('2026-09-03T08:00:00'));
    expect(r.source).toBe('formula');
    expect(reason(r)).toBeUndefined();
    expect(measurementProgress(r, logs, {})).toMatchObject({ loggedDays: 2, notEnoughCompleteDays: false });
  });
});

describe('CSV export', () => {
  it('exports one dayLogged row per answered day, in its own appended column', () => {
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
      dailyLogged: { '2026-10-24': true, '2026-10-23': false },
    });
    const [header, ...rows] = csv.split('\r\n');
    const cols = header.split(',');
    // Last, after the 2026-10-22 rirTarget: no column moved.
    expect(cols[cols.length - 1]).toBe('dayFullyLogged');
    expect(cols.indexOf('dayFullyLogged')).toBe(cols.indexOf('rirTarget') + 1);
    const answered = rows.filter((r) => r.startsWith('dayLogged,')).map((r) => r.split(','));
    expect(answered.map((r) => [r[cols.indexOf('date')], r[cols.indexOf('dayFullyLogged')]])).toEqual([
      ['2026-10-23', 'false'],
      ['2026-10-24', 'true'],
    ]);
  });

  it('a caller without answers exports no dayLogged rows', () => {
    const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {} });
    expect(csv.split('\r\n').some((r) => r.startsWith('dayLogged,'))).toBe(false);
  });
});

describe('composition-adjusted maintenance follows the same day rule', () => {
  it('leaves a day marked "not fully logged" out of its intake count', () => {
    // Enough tapes to pass every gate but intake: the status names the count.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 40; i++) logs.push(row(keyAt('2026-08-01', i), 2000));
    const measurements = [0, 14, 28, 39].map((d) => ({
      date: new Date(`${keyAt('2026-08-01', d)}T08:00:00`),
      waist: 34 - d * 0.02,
      neck: 15,
    }));
    const weights = Object.fromEntries([0, 14, 28, 39].map((d) => [keyAt('2026-08-01', d), 180 - d * 0.05]));
    const base = {
      logs,
      dailyWeights: weights,
      measurements: measurements as never,
      profile: { sex: 'male' as const, heightIn: 70 },
      now: new Date('2026-09-15T08:00:00'),
      draws: 50,
    };
    const all = compositionMaintenance(base);
    const answers = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [keyAt('2026-08-01', i), false]));
    const fewer = compositionMaintenance({ ...base, dayComplete: answers });
    expect(fewer.status).toBe('insufficient_logging');
    expect(all.status).not.toBe('insufficient_logging');
  });
});
