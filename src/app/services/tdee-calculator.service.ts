import { Injectable } from '@angular/core';
import { DailyLog, ProfileFields, ActivityLevel } from './firebase.service';
import { localDateKey } from '../utils/date';

export interface TdeeResult {
  trueTdee: number;
  newDailyTarget: number;
  /** Pounds lost (positive) or gained (negative) across the 14-day window. */
  weightChangeTrend: number;
  /** Where the number came from — lets the UI label it honestly. */
  source: 'measured' | 'formula' | 'seed';
}

/**
 * TDEE = Total Daily Energy Expenditure.
 *
 * Two modes:
 *   - MEASURED (logs >= 14): purely data-driven. Uses the observed
 *     weight trend + observed average intake to back out TDEE.
 *     Profile is ignored.
 *   - FORMULA (logs < 14 AND profile available): Mifflin-St Jeor BMR
 *     multiplied by the user's activity factor, using the most recent
 *     logged weight (or a reasonable proxy if no logs yet).
 *   - SEED (logs < 14 AND no profile): hardcoded fallback, used only
 *     if profile gate fails somehow.
 *
 * In every mode `newDailyTarget` = trueTdee − (chosen pace × 3500 / 7),
 * clamped at the 1500 kcal safety floor.
 */
@Injectable({ providedIn: 'root' })
export class TdeeCalculatorService {
  private static readonly KCAL_PER_POUND = 3500;
  private static readonly MIN_DAILY_TARGET = 1500;
  private static readonly DEFAULT_PACE_LBS_PER_WEEK = 1.5;

  private static readonly SEED_RESULT: TdeeResult = {
    trueTdee: 2450,
    newDailyTarget: 1800,
    weightChangeTrend: 0,
    source: 'seed',
  };

  private static readonly ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  /**
   * Aggregate multiple log entries per day into one row per day.
   * Sums calories/protein, takes first non-null weight, ORs exercise booleans.
   */
  aggregateByDay(logs: DailyLog[]): DailyLog[] {
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

  calculate(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
    // Aggregate to one row per day before computing TDEE.
    const daily = this.aggregateByDay(logs ?? []);

    // ── Measured mode: ≥14 days ─────────────────────────────────
    if (daily.length >= 14) {
      const window = daily.slice(-14);
      const week1 = window.slice(0, 7);
      const week2 = window.slice(7, 14);

      const week1Weights = week1.map((l) => l.weight).filter((w): w is number => w != null);
      const week2Weights = week2.map((l) => l.weight).filter((w): w is number => w != null);
      if (week1Weights.length === 0 || week2Weights.length === 0) {
        return { ...TdeeCalculatorService.SEED_RESULT };
      }
      const week1Avg = this.average(week1Weights);
      const week2Avg = this.average(week2Weights);
      const weightChange = week1Avg - week2Avg; // + = lost

      const avgDailyIntake = this.trimmedMean(window.map((l) => l.calories));
      const dailyDeficitAchieved =
        (weightChange * TdeeCalculatorService.KCAL_PER_POUND) / 7;

      const trueTdee = Math.round(avgDailyIntake + dailyDeficitAchieved);
      const pace = profile?.targetPaceLbsPerWeek ?? TdeeCalculatorService.DEFAULT_PACE_LBS_PER_WEEK;
      const targetDeficit = (pace * TdeeCalculatorService.KCAL_PER_POUND) / 7;
      const newDailyTarget = Math.max(
        TdeeCalculatorService.MIN_DAILY_TARGET,
        Math.round(trueTdee - targetDeficit),
      );

      return {
        trueTdee,
        newDailyTarget,
        weightChangeTrend: this.round(weightChange, 2),
        source: 'measured',
      };
    }

    // ── Formula mode: profile present, < 14 days of data ────────
    if (profile) {
      // Use the most recent non-null weight, else fall back to goal weight.
      let latestWeight = profile.goalWeightLbs ?? 180;
      for (let i = daily.length - 1; i >= 0; i--) {
        if (daily[i].weight != null) { latestWeight = daily[i].weight!; break; }
      }

      const trueTdee = Math.round(this.mifflinStJeor(profile, latestWeight));
      const pace = profile.targetPaceLbsPerWeek;
      const targetDeficit = (pace * TdeeCalculatorService.KCAL_PER_POUND) / 7;
      const newDailyTarget = Math.max(
        TdeeCalculatorService.MIN_DAILY_TARGET,
        Math.round(trueTdee - targetDeficit),
      );

      return {
        trueTdee,
        newDailyTarget,
        weightChangeTrend: 0,
        source: 'formula',
      };
    }

    // ── Seed fallback: no profile, no data ──────────────────────
    return { ...TdeeCalculatorService.SEED_RESULT };
  }

  /**
   * Mifflin-St Jeor TDEE estimate (BMR × activity multiplier).
   * Inputs come in imperial; converted to metric internally.
   */
  private mifflinStJeor(profile: ProfileFields, weightLbs: number): number {
    const weightKg = weightLbs * 0.453592;
    const heightCm = profile.heightIn * 2.54;

    const bmr = profile.sex === 'male'
      ? 10 * weightKg + 6.25 * heightCm - 5 * profile.age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * profile.age - 161;

    return bmr * TdeeCalculatorService.ACTIVITY_MULTIPLIERS[profile.activityLevel];
  }

  /**
   * Exponential Moving Average for weight trend smoothing.
   * Smoothing factor α = 2/(N+1) where N = span (default 7 days).
   * Returns an array the same length as input with the EMA at each point.
   */
  ema(values: number[], span = 7): number[] {
    if (values.length === 0) return [];
    const alpha = 2 / (span + 1);
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
    }
    return result;
  }

  /**
   * Weekly Calorie Envelope: rolling 7-day budget showing how
   * much surplus/deficit has accumulated and how much daily
   * adjustment is needed over the remaining days to stay on track.
   */
  weeklyEnvelope(logs: DailyLog[], dailyTarget: number): WeeklyEnvelope | null {
    if (logs.length === 0 || dailyTarget <= 0) return null;

    // Look at the last 7 calendar days (including today).
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const thisWeekLogs = logs.filter((l) => l.date >= sevenDaysAgo);
    if (thisWeekLogs.length === 0) return null;

    const weeklyBudget = dailyTarget * 7;
    const consumed = thisWeekLogs.reduce((s, l) => s + l.calories, 0);
    const surplus = consumed - (dailyTarget * thisWeekLogs.length);
    // How many days remain (including today if not logged, or tomorrow..next Sun)
    const dayOfWeek = now.getDay(); // 0=Sun
    const daysElapsed = thisWeekLogs.length;
    const daysRemaining = Math.max(1, 7 - daysElapsed);
    // Adjusted daily target for remaining days to hit the weekly budget
    const budgetRemaining = weeklyBudget - consumed;
    const adjustedDailyTarget = Math.max(
      1200, // hard floor — never suggest less than 1200 for remaining days
      Math.round(budgetRemaining / daysRemaining),
    );

    return {
      weeklyBudget,
      consumed,
      surplus: Math.round(surplus),
      daysLogged: daysElapsed,
      daysRemaining,
      adjustedDailyTarget,
      dailyTarget,
    };
  }

  /**
   * Compute streak: number of consecutive days (ending today or
   * yesterday) that have at least one log entry.
   */
  computeStreak(logs: DailyLog[], opts?: { freezeMaxGap?: number }): number {
    return this.computeStreakWithFreeze(logs, opts).streak;
  }

  /**
   * Streak counter with optional gap-tolerance ("streak freeze"). When
   * `freezeMaxGap > 0`, up to that many consecutive missed days are
   * tolerated mid-streak — the walk-back keeps going as long as a future
   * logged day appears within the gap window. Returns `freezeUsed = true`
   * if any tolerated gap was consumed (used by the UI to render a
   * "protected by Pro" indicator).
   *
   * `freezeMaxGap = 0` (default) preserves the legacy "any gap breaks the
   * streak" behavior for free users.
   */
  computeStreakWithFreeze(
    logs: DailyLog[],
    opts?: { freezeMaxGap?: number },
  ): { streak: number; freezeUsed: boolean } {
    if (logs.length === 0) return { streak: 0, freezeUsed: false };
    const maxGap = Math.max(0, opts?.freezeMaxGap ?? 0);

    const dates = new Set(logs.map((l) => localDateKey(l.date)));

    let streak = 0;
    let freezeUsed = false;
    const cursor = new Date();
    const todayStr = localDateKey(cursor);
    if (!dates.has(todayStr)) {
      cursor.setDate(cursor.getDate() - 1);
      if (!dates.has(localDateKey(cursor))) return { streak: 0, freezeUsed: false };
    }

    // Walk backwards counting consecutive days; tolerate up to `maxGap`
    // missing days as long as another logged day exists further back.
    while (true) {
      if (dates.has(localDateKey(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      if (maxGap === 0) break;
      // Probe up to `maxGap` further-back days; if any is logged,
      // skip the gap and resume counting from there.
      let probe: Date | null = null;
      for (let i = 1; i <= maxGap; i++) {
        const c = new Date(cursor);
        c.setDate(c.getDate() - i);
        if (dates.has(localDateKey(c))) {
          probe = c;
          break;
        }
      }
      if (!probe) break;
      freezeUsed = true;
      cursor.setTime(probe.getTime());
    }
    return { streak, freezeUsed };
  }

  /**
   * Weekly summary: averages and totals over the last 7 *days* of logged
   * data (not the last 7 entries). Aggregates first so three meals on a
   * single day count as one day, one calorie total, one protein total —
   * prior behaviour divided a single-day intake across N entries and
   * published a badly-low "avg kcal / day".
   */
  weeklySummary(logs: DailyLog[], targetCalories: number): WeeklySummary | null {
    if (logs.length === 0) return null;
    const daily = this.aggregateByDay(logs);
    const last7 = daily.slice(-7);
    if (last7.length === 0) return null;

    const weights = last7.map((d) => d.weight).filter((w): w is number => w != null);
    const cals = last7.map((d) => d.calories);
    const proteins = last7.filter((d) => d.protein != null).map((d) => d.protein!);

    const avgWeight = weights.length > 0 ? this.round(this.average(weights), 1) : 0;
    const avgCalories = Math.round(this.average(cals));
    const avgProtein = proteins.length > 0 ? Math.round(this.average(proteins)) : null;
    const weightDelta = weights.length >= 2
      ? this.round(weights[weights.length - 1] - weights[0], 1)
      : 0;
    // Adherence: % of days within ±100 kcal of target
    const adherentDays = cals.filter((c) => Math.abs(c - targetCalories) <= 100).length;
    const adherencePct = Math.round((adherentDays / last7.length) * 100);

    return {
      days: last7.length,
      avgWeight,
      avgCalories,
      avgProtein,
      weightDelta,
      adherencePct,
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, v) => a + v, 0) / values.length;
  }

  /** Mean after removing the single lowest and highest value.
   *  Protects the 14-day calorie average from one-off outlier days (hospital, travel).
   *  Falls back to plain average when fewer than 3 values. */
  private trimmedMean(arr: number[]): number {
    if (arr.length < 3) return this.average(arr);
    const sorted = [...arr].sort((a, b) => a - b);
    return this.average(sorted.slice(1, sorted.length - 1));
  }

  private round(value: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  }
}

export interface WeeklySummary {
  days: number;
  avgWeight: number;
  avgCalories: number;
  avgProtein: number | null;
  weightDelta: number;
  adherencePct: number;
}

export interface WeeklyEnvelope {
  weeklyBudget: number;      // dailyTarget * 7
  consumed: number;           // total cals consumed this rolling week
  surplus: number;            // + = over budget, - = under budget
  daysLogged: number;
  daysRemaining: number;
  adjustedDailyTarget: number; // what to aim for each remaining day
  dailyTarget: number;         // the original daily target for comparison
}
