import { describe, expect, it } from 'vitest';
import { addDays, calendarDateKey } from './date';
import { measurementProgress } from './measurement-progress';
import { dailyTargets } from './targets';
import { tdeeSeries } from './tdee-series';
import type { DailyLog, Profile } from './types';

/**
 * A weigh-in counts toward the weight trend the moment it is taken, with or
 * without food logged that day (owner, 2026-10-15). Only INTAKE waits for
 * food: a day with no food entry is left out of the intake average, and the
 * day in progress stays out until it closes.
 *
 * Before this, `mergeDailyWeights` could only lay a weight onto an existing
 * log row, so the morning weigh-in did nothing until breakfast was logged.
 */

const NOW = new Date(2026, 9, 15, 8, 0, 0); // 08:00, nothing eaten yet
const TODAY = calendarDateKey(NOW);

const PROFILE = {
  heightIn: 68,
  age: 33,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.8,
  goalDirection: 'lose',
  calorieFloor: 1500,
  profileCompleted: true,
} as unknown as Profile;

/** Logged days ending `endDaysAgo` days before NOW, one weigh-in per day. */
function history(days: number, endDaysAgo = 1) {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  for (let i = days + endDaysAgo - 1; i >= endDaysAgo; i--) {
    const day = addDays(NOW, -i);
    const n = days + endDaysAgo - 1 - i;
    logs.push({ date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), calories: 1900 + (((n * 37) % 7) - 3) * 40 });
    weights[calendarDateKey(day)] = Math.round((160 - n * 0.07 + (((n * 13) % 5) - 2) * 0.2) * 10) / 10;
  }
  return { logs, weights };
}

const measured = (t: ReturnType<typeof dailyTargets>) =>
  t.tdee as typeof t.tdee & {
    weightSlopeLbsPerDay: number;
    avgDailyIntake: number;
    intakeDays: number;
    windowDays: number;
    loggingCompletenessPct: number;
  };

describe('morning weigh-in with no food logged', () => {
  it('updates the trend at once; the intake average is unchanged', () => {
    const { logs, weights } = history(40);
    const before = measured(dailyTargets(PROFILE, logs, weights, NOW));
    // A clearly low reading this morning, and no food row for today at all.
    const after = measured(dailyTargets(PROFILE, logs, { ...weights, [TODAY]: 155 }, NOW));

    expect(before.source).toBe('measured');
    expect(after.weightSlopeLbsPerDay).toBeLessThan(before.weightSlopeLbsPerDay);

    expect(after.avgDailyIntake).toBe(before.avgDailyIntake);
    expect(after.intakeDays).toBe(before.intakeDays);
    // Not a logged day: the window and completeness describe intake records.
    expect(after.windowDays).toBe(before.windowDays);
    expect(after.loggingCompletenessPct).toBe(before.loggingCompletenessPct);
  });

  it('logging breakfast afterwards keeps the weigh-in; only the intake average still waits for the day to close', () => {
    const { logs, weights } = history(40);
    const w = { ...weights, [TODAY]: 155 };
    const weighedOnly = measured(dailyTargets(PROFILE, logs, w, NOW));
    const breakfast: DailyLog = { date: new Date(2026, 9, 15, 8, 30), calories: 450 };
    const withFood = measured(dailyTargets(PROFILE, [...logs, breakfast], w, new Date(2026, 9, 15, 9)));
    expect(withFood.weightSlopeLbsPerDay).toBe(weighedOnly.weightSlopeLbsPerDay);
    expect(withFood.avgDailyIntake).toBe(weighedOnly.avgDailyIntake);
  });
});

describe('weigh-ins on other days with no food', () => {
  it('a skipped-food day inside a logging run still contributes its weigh-in', () => {
    const { logs, weights } = history(40);
    const skip = calendarDateKey(addDays(NOW, -10));
    const noFood = logs.filter((l) => calendarDateKey(l.date) !== skip);
    const lowWeigh = { ...weights, [skip]: weights[skip] - 3 };
    const without = measured(dailyTargets(PROFILE, noFood, weights, NOW));
    const withLow = measured(dailyTargets(PROFILE, noFood, lowWeigh, NOW));
    expect(withLow.weightSlopeLbsPerDay).not.toBe(without.weightSlopeLbsPerDay);
    expect(withLow.avgDailyIntake).toBe(without.avgDailyIntake);
  });

  it('a weigh-in inside a long break (> 3 days with no logging) joins no run', () => {
    // 40 logged days ending 8 days ago, then nothing logged — a weigh-in 4
    // days after the last log sits in unknown intake on both sides.
    const { logs, weights } = history(40, 8);
    const gapDay = calendarDateKey(addDays(NOW, -4));
    const a = measured(dailyTargets(PROFILE, logs, weights, NOW));
    const b = measured(dailyTargets(PROFILE, logs, { ...weights, [gapDay]: 150 }, NOW));
    expect(b.trueTdee).toBe(a.trueTdee);
    expect(b.weightSlopeLbsPerDay).toBe(a.weightSlopeLbsPerDay);
  });

  it('a weigh-in dated after today is ignored', () => {
    const { logs, weights } = history(40);
    const tomorrow = calendarDateKey(addDays(NOW, 1));
    const a = dailyTargets(PROFILE, logs, weights, NOW);
    const b = dailyTargets(PROFILE, logs, { ...weights, [tomorrow]: 150 }, NOW);
    expect(b.tdee.trueTdee).toBe(a.tdee.trueTdee);
  });

  it('formula mode (<14 logged days) uses a weight-only reading as the latest weight', () => {
    const { logs, weights } = history(5);
    const a = dailyTargets(PROFILE, logs, weights, NOW);
    const b = dailyTargets(PROFILE, logs, { ...weights, [TODAY]: 140 }, NOW);
    expect(a.tdee.source).toBe('formula');
    expect(b.tdee.trueTdee).toBeLessThan(a.tdee.trueTdee);
  });

  it('the progress readout counts a weight-only weigh-in toward the trend', () => {
    const { logs } = history(5);
    const one = { [calendarDateKey(addDays(NOW, -5))]: 160 };
    const t = dailyTargets(PROFILE, logs, one, NOW);
    expect(measurementProgress(t.tdee, logs, one)!.weighIns).toBe(1);
    const plusToday = { ...one, [TODAY]: 159.4 };
    expect(measurementProgress(t.tdee, logs, plusToday)!.weighIns).toBe(2);
  });
});

describe('the Trends replay', () => {
  it("a past day's point does not see the next morning's weigh-in", () => {
    const { logs, weights } = history(40);
    const w = { ...weights, [TODAY]: 155 };
    const series = tdeeSeries(PROFILE, logs, w, { days: 2, now: NOW });
    const yesterdayKey = calendarDateKey(addDays(NOW, -1));
    // Yesterday, as it stood at the end of yesterday: today's reading absent.
    const asOfYesterday = dailyTargets(PROFILE, logs, weights, new Date(2026, 9, 15, 0, 0, 0));
    const point = series.find((p) => p.dateKey === yesterdayKey)!;
    expect(point.kcal).toBe(asOfYesterday.tdee.trueTdee);
    // Today's point is the live call, and it does see it.
    const today = series.find((p) => p.dateKey === TODAY)!;
    expect(today.kcal).toBe(dailyTargets(PROFILE, logs, w, NOW).tdee.trueTdee);
  });
});
