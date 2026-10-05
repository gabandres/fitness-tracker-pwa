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
  /**
   * Average (target − consumed) across logged days. Positive = under the
   * target, negative = over it.
   *
   * **This is NOT a deficit**, and it was called `avgDeficit` until
   * 2026-10-04. A deficit is measured against what you BURN; this is measured
   * against what you planned to EAT. The owner's account showed the gap on a
   * real device: maintenance 2,017, target 1,850, intake 1,849 — and the tile
   * read "−1 Avg deficit" while the real deficit was ~170 kcal a day. The
   * name invited exactly that reading, so the name went.
   */
  avgUnderTarget: number;
  /**
   * Average (maintenance − consumed) across logged days — the actual deficit
   * (positive) or surplus (negative) — or **null when no measured maintenance
   * was passed**.
   *
   * Null rather than computed against a formula or seed figure on purpose: a
   * Mifflin number is a population average, and "312 under maintenance"
   * against it would claim an observation the app has not made (the same rule
   * `maintenanceView` applies to Today). The caller decides what counts as
   * measured; this module only refuses to invent a baseline.
   */
  avgUnderMaintenance: number | null;
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

/**
 * Within this many kcal of a reference the honest word is "on" it, not "1
 * under". Twenty-five is a little over one percent of a typical target and
 * well inside the error of any food label, so a gap smaller than this is not
 * a behaviour worth naming — "1 kcal under target" reads as a finding and is
 * noise.
 */
export const ON_TARGET_BAND_KCAL = 25;

/** Which side of a reference an average sits on, after the dead band. */
export interface BalanceVerdict {
  kind: 'under' | 'over' | 'on';
  /** Absolute gap, rounded. 0 when `kind` is `'on'`. */
  kcal: number;
}

/**
 * Turn a signed "under by" figure (positive = under) into the words a sentence
 * needs, so no screen has to build "−312 Avg deficit" out of a sign glyph and
 * a noun again. Pure; the band is a parameter so a test can pin it.
 */
export function balanceVerdict(underBy: number, band = ON_TARGET_BAND_KCAL): BalanceVerdict {
  const kcal = Math.round(Math.abs(underBy));
  if (!Number.isFinite(underBy) || kcal <= band) return { kind: 'on', kcal: 0 };
  return { kind: underBy > 0 ? 'under' : 'over', kcal };
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
 *
 * `maintenanceKcal` — pass the MEASURED maintenance estimate (the number the
 * Trends hero shows) to get {@link WeeklyInsights.avgUnderMaintenance}; pass
 * null in formula/seed mode and that field stays null.
 */
export function computeWeeklyInsights(
  days: readonly DaySummary[],
  targetCalories: number,
  weightPoints: readonly WeightPoint[] = [],
  proteinTarget = 0,
  maintenanceKcal: number | null = null,
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
    avgUnderTarget: targetCalories - avgCalories,
    avgUnderMaintenance:
      maintenanceKcal != null && Number.isFinite(maintenanceKcal) && maintenanceKcal > 0
        ? Math.round(maintenanceKcal) - avgCalories
        : null,
    avgProtein,
    proteinGoalDays,
    bestDay: best,
    worstDay: worst,
    weightSlopeLbPerWeek: weightSlopeLbPerWeek(weightPoints),
  };
}
