import type { ActivityLevel, DailyLog, ProfileFields } from './types';
import { localDateKey } from './date';

/**
 * TDEE (Total Daily Energy Expenditure) estimator — pure port of the
 * Angular `TdeeCalculatorService` algorithm, shared with the Expo app.
 *
 * Modes:
 *   - MEASURED (≥14 logged days): data-driven. Backs TDEE out of the
 *     observed weight trend (OLS slope) + observed average intake.
 *   - FORMULA (<14 days + profile): Mifflin-St Jeor BMR × activity factor.
 *   - SEED (<14 days + no profile): hardcoded fallback.
 *
 * `newDailyTarget` = trueTdee − (pace × 3500 / 7), clamped at the user's
 * configured `calorieFloor` (default MIN_DAILY_TARGET = 1500).
 *
 * NOTE: the canonical copy still lives in the Angular service. This is a
 * faithful duplicate for the mobile app; unifying both onto this module is
 * a documented follow-up (see docs/adr/0012).
 */
export interface TdeeResult {
  trueTdee: number;
  newDailyTarget: number;
  weightChangeTrend: number;
  source: 'measured' | 'formula' | 'seed';
  loggingCompletenessPct?: number;
  reliable?: boolean;
}

const KCAL_PER_POUND = 3500;
const MIN_DAILY_TARGET = 1500;
const DEFAULT_PACE_LBS_PER_WEEK = 1.0;
const MEASURED_MIN_DAYS = 14;
const MEASURED_WINDOW_DAYS = 28;
const RELIABLE_MIN_PCT = 70;
const RELIABLE_MIN_INTAKE_DAYS = 10;

const SEED_RESULT: TdeeResult = {
  trueTdee: 2450,
  newDailyTarget: 1800,
  weightChangeTrend: 0,
  source: 'seed',
};

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Mean after removing the single lowest and highest value. */
function trimmedMean(arr: number[]): number {
  if (arr.length < 3) return average(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return average(sorted.slice(1, sorted.length - 1));
}

/** Aggregate multiple log entries per day into one row per day. */
export function aggregateByDay(logs: DailyLog[]): DailyLog[] {
  const byDate = new Map<string, DailyLog>();
  for (const log of logs) {
    const key = localDateKey(log.date);
    const existing = byDate.get(key);
    if (!existing) {
      byDate.set(key, { ...log });
    } else {
      existing.calories += log.calories;
      existing.protein = (existing.protein ?? 0) + (log.protein ?? 0);
      if (existing.weight == null && log.weight != null) existing.weight = log.weight;
      if (log.exerciseCompleted) existing.exerciseCompleted = true;
      if (log.liftCompleted) existing.liftCompleted = true;
      if (log.cardioCompleted) existing.cardioCompleted = true;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Ordinary least-squares slope through the given points. */
function regressionSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/** Robust weight trend in lbs/day (OLS over weigh-ins). */
function weightTrendLbsPerDay(daily: DailyLog[]): number | null {
  const weighed = daily.filter((l): l is DailyLog & { weight: number } => l.weight != null);
  if (weighed.length < 2) return null;
  const t0 = weighed[0].date.getTime();
  const points = weighed.map((l) => ({
    x: (l.date.getTime() - t0) / 86_400_000,
    y: l.weight,
  }));
  return regressionSlope(points);
}

function calendarSpanDays(daily: DailyLog[]): number {
  if (daily.length === 0) return 1;
  const first = daily[0].date.getTime();
  const last = daily[daily.length - 1].date.getTime();
  return Math.round((last - first) / 86_400_000) + 1;
}

/** The daily-target safety floor: the user's configured `calorieFloor` when
 *  set to a sane positive value, else the hardcoded MIN_DAILY_TARGET. Keeps a
 *  water-suppressed measured TDEE from silently pushing the target below a
 *  level the user has deemed too aggressive. */
function calorieFloor(profile?: ProfileFields | null): number {
  const f = profile?.calorieFloor;
  return f != null && f > 0 ? f : MIN_DAILY_TARGET;
}

function mifflinStJeor(profile: ProfileFields, weightLbs: number): number {
  const weightKg = weightLbs * 0.453592;
  const heightCm = profile.heightIn * 2.54;
  const bmr = profile.sex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * profile.age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * profile.age - 161;
  return bmr * ACTIVITY_MULTIPLIERS[profile.activityLevel];
}

export function calculateTdee(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
  const daily = aggregateByDay(logs ?? []);

  // ── Measured mode: ≥14 logged days ──
  if (daily.length >= MEASURED_MIN_DAYS) {
    const window = daily.slice(-MEASURED_WINDOW_DAYS);
    const slope = weightTrendLbsPerDay(window);
    if (slope == null) return { ...SEED_RESULT };

    const intakeCals = window.map((l) => l.calories).filter((c) => c > 0);
    if (intakeCals.length === 0) return { ...SEED_RESULT };
    const avgDailyIntake = trimmedMean(intakeCals);

    const dailyDeficitAchieved = -slope * KCAL_PER_POUND;
    const trueTdee = Math.round(avgDailyIntake + dailyDeficitAchieved);

    const pace = profile?.targetPaceLbsPerWeek ?? DEFAULT_PACE_LBS_PER_WEEK;
    const targetDeficit = (pace * KCAL_PER_POUND) / 7;
    const floor = calorieFloor(profile);
    const newDailyTarget = Math.max(floor, Math.round(trueTdee - targetDeficit));

    const spanDays = calendarSpanDays(window);
    const loggingCompletenessPct = Math.min(100, Math.round((window.length / spanDays) * 100));
    const reliable =
      loggingCompletenessPct >= RELIABLE_MIN_PCT && intakeCals.length >= RELIABLE_MIN_INTAKE_DAYS;

    return {
      trueTdee,
      newDailyTarget,
      weightChangeTrend: round(-slope * (spanDays - 1), 2),
      source: 'measured',
      loggingCompletenessPct,
      reliable,
    };
  }

  // ── Formula mode: profile present, <14 days ──
  if (profile) {
    let latestWeight = profile.goalWeightLbs ?? 180;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (daily[i].weight != null) { latestWeight = daily[i].weight!; break; }
    }
    const trueTdee = Math.round(mifflinStJeor(profile, latestWeight));
    const pace = profile.targetPaceLbsPerWeek;
    const targetDeficit = (pace * KCAL_PER_POUND) / 7;
    const floor = calorieFloor(profile);
    const newDailyTarget = Math.max(floor, Math.round(trueTdee - targetDeficit));
    return { trueTdee, newDailyTarget, weightChangeTrend: 0, source: 'formula' };
  }

  // ── Seed fallback ──
  return { ...SEED_RESULT };
}
