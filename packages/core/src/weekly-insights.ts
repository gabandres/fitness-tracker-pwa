/**
 * Weekly calorie insights. Pure: judges a window of DaySummary rows against
 * the calorie target. Ported from the Angular PWA's weekly-insights so the
 * Expo app and the PWA compute the same "best/worst day" + average deficit.
 */
import type { DaySummary } from './day-summary';
import { type WeightPoint, weightSlopeLbPerWeek } from './weight-projection';

/** A day judged against the calorie target. `delta` = consumed − target
 *  (negative = under target). */
export interface InsightDay {
  dateKey: string;
  calories: number;
  delta: number;
}

export interface WeeklyInsights {
  /** Days in the window with at least one calorie-carrying entry. */
  loggedDays: number;
  avgCalories: number;
  /** Average (target − consumed) across logged days. Positive = average
   *  deficit, negative = average surplus. */
  avgDeficit: number;
  /** Average protein (g) across logged days. */
  avgProtein: number;
  /** Logged days that met/exceeded the protein target (0 when no target). */
  proteinGoalDays: number;
  /** Logged day closest to target. */
  bestDay: InsightDay;
  /** Logged day furthest from target. Equal to bestDay when only one
   *  day is logged. */
  worstDay: InsightDay;
  /** Least-squares weight slope in lb/week, or null when there aren't
   *  enough weigh-ins to fit a line. */
  weightSlopeLbPerWeek: number | null;
}

/** Minimum calorie-logged days before insights are worth showing —
 *  below this, "best day" is just an echo of one or two entries. */
export const MIN_INSIGHT_DAYS = 3;

/**
 * Judge a week of `DaySummary` rows against the calorie target. Returns null
 * when there's nothing trustworthy to say: no positive target (profile
 * incomplete) or fewer than {@link MIN_INSIGHT_DAYS} calorie-logged days.
 * Weight slope is computed independently of the day gate — pass a longer
 * window of weigh-ins (14–28 d) than the 7-day summary window.
 */
export function computeWeeklyInsights(
  days: readonly DaySummary[],
  targetCalories: number,
  weightPoints: readonly WeightPoint[] = [],
  proteinTarget = 0,
): WeeklyInsights | null {
  if (targetCalories <= 0) return null;
  const logged = days.filter((d) => d.mealCount > 0 && d.totalCalories > 0);
  if (logged.length < MIN_INSIGHT_DAYS) return null;

  const judged: InsightDay[] = logged.map((d) => ({
    dateKey: d.dateKey,
    calories: d.totalCalories,
    delta: d.totalCalories - targetCalories,
  }));

  let best = judged[0];
  let worst = judged[0];
  for (const day of judged) {
    if (Math.abs(day.delta) < Math.abs(best.delta)) best = day;
    if (Math.abs(day.delta) > Math.abs(worst.delta)) worst = day;
  }

  const totalCalories = judged.reduce((s, d) => s + d.calories, 0);
  const avgCalories = Math.round(totalCalories / judged.length);
  const avgProtein = Math.round(logged.reduce((s, d) => s + d.totalProtein, 0) / logged.length);
  const proteinGoalDays = proteinTarget > 0 ? logged.filter((d) => d.totalProtein >= proteinTarget).length : 0;

  return {
    loggedDays: judged.length,
    avgCalories,
    avgDeficit: targetCalories - avgCalories,
    avgProtein,
    proteinGoalDays,
    bestDay: best,
    worstDay: worst,
    weightSlopeLbPerWeek: weightSlopeLbPerWeek(weightPoints),
  };
}
