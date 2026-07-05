import { Injectable } from '@angular/core';
import { DailyLog, ProfileFields } from './firebase.service';
import { localDateKey } from '../utils/date';
import { calculateTdee, aggregateByDay, type TdeeResult } from '@macrolog/core/tdee';

// The TDEE algorithm is single-sourced in `@macrolog/core/tdee` (shared with
// the Expo app so both frontends compute the same calorie target — ADR-0012).
// Re-exported here so existing `import { TdeeResult } from
// './tdee-calculator.service'` sites keep working.
export type { TdeeResult };

/**
 * Angular seam over the shared TDEE core. `calculate` / `aggregateByDay`
 * delegate to `@macrolog/core/tdee` (the canonical, unit-tested
 * implementation); the weekly-envelope, streak, weekly-summary, EMA, and
 * regression helpers below are the derivation math the FitnessStore hub wires
 * into its signals. See `@macrolog/core/tdee` for the mode/clamp docs.
 */
@Injectable({ providedIn: 'root' })
export class TdeeCalculatorService {
  /**
   * Aggregate multiple log entries per day into one row per day.
   * Delegates to the shared core so both frontends group identically.
   */
  aggregateByDay(logs: DailyLog[]): DailyLog[] {
    return aggregateByDay(logs);
  }

  /** Total Daily Energy Expenditure — delegates to the shared core. */
  calculate(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
    return calculateTdee(logs, profile);
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
   * Ordinary least-squares slope (Δy per Δx) through the given points.
   * Returns null when there are fewer than 2 points or no spread in x
   * (every weigh-in on the same day — nothing to fit a rate against).
   */
  regressionSlope(points: { x: number; y: number }[]): number | null {
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

  /**
   * Robust weight trend in lbs/day for a window of daily rows.
   *
   * Fits an ordinary least-squares slope through every weigh-in, plotted
   * against its real day offset (so a logging gap stretches the x-axis
   * rather than inflating the rate). OLS is itself the optimal noise-robust
   * linear-rate estimator: it uses all points and lets symmetric water-weight
   * wobble average out, unlike endpoint or two-week-block subtraction which
   * over-weight the noisy boundary days. Negative = losing weight.
   * Returns null when fewer than 2 weigh-ins exist.
   *
   * NB: we deliberately do NOT pre-smooth the series with an EMA first.
   * Smoothing-then-differencing attenuates the fitted slope (benchmarked at a
   * systematic ~130 kcal/day downward TDEE bias) — the long window already
   * supplies the stability, so plain OLS stays unbiased AND robust.
   */
  weightTrendLbsPerDay(daily: DailyLog[]): number | null {
    const weighed = daily.filter((l): l is DailyLog & { weight: number } => l.weight != null);
    if (weighed.length < 2) return null;
    const t0 = weighed[0].date.getTime();
    const points = weighed.map((l) => ({
      x: (l.date.getTime() - t0) / 86_400_000, // days since the first weigh-in
      y: l.weight,
    }));
    return this.regressionSlope(points);
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
