import type { DaySummary } from './day-summary';

/**
 * Weekly calorie budget / banking — the "spread your deficit across the
 * week" view. Pure and dependency-free (ADR-0003 sibling of
 * `weekly-insights` / `summarizeDay`): all the budget arithmetic and the
 * pace calculation live here, so this one interface is the whole test
 * surface. The component supplies the ISO-local week's day summaries and
 * how many of those days have elapsed; this module never reads a clock.
 *
 * "Banking" is the idea that an under-target Monday leaves headroom for a
 * heavier Saturday: rather than judging each day in isolation, the week
 * gets one shared budget (`dailyTarget × 7`) and the remaining days share
 * whatever is left.
 */

/** One day's bar in the week strip. */
export interface DayBudgetBar {
  readonly dateKey: string;
  /** Calories logged that day (0 for unlogged or future days). */
  readonly calories: number;
  /** True for days up to and including today — distinguishes a real
   *  zero-calorie day from a not-yet-arrived one in the UI. */
  readonly elapsed: boolean;
}

export interface WeeklyBudget {
  /** dailyTarget × 7 — the whole week's allowance. */
  readonly weeklyBudget: number;
  /** Daily target, echoed for the bar baseline. */
  readonly dailyTarget: number;
  /** Calories logged across the elapsed days of the week. */
  readonly consumed: number;
  /** weeklyBudget − consumed. Negative once the week is overspent. */
  readonly remaining: number;
  /** Elapsed days of the week, 1–7 (today's 1-based position). */
  readonly daysElapsed: number;
  /** Days left after today, 0–6. */
  readonly daysRemaining: number;
  /** Calories per remaining day that keep the week on budget, or null on
   *  the last day of the week (nothing left to spread over). Signed:
   *  negative means the week is already overspent and every remaining day
   *  is borrowed against. */
  readonly pacePerRemainingDay: number | null;
  /** Full week, Monday→Sunday, for the bar strip. */
  readonly bars: readonly DayBudgetBar[];
}

const DAYS_IN_WEEK = 7;

/**
 * Compute the weekly calorie budget from the ISO-local week's summaries.
 *
 * `weekDays` must be the seven Monday→Sunday `DaySummary` rows for the
 * current week (future days carry zero totals); `daysElapsed` is today's
 * 1-based position in that week (Monday = 1 … Sunday = 7). Returns null
 * when there's nothing trustworthy to show: no positive target (profile
 * incomplete) or a malformed week. Unlogged elapsed days count as zero
 * consumed — the bar strip makes the gaps visible.
 */
export function computeWeeklyBudget(
  weekDays: readonly DaySummary[],
  daysElapsed: number,
  dailyTarget: number,
): WeeklyBudget | null {
  if (dailyTarget <= 0) return null;
  if (weekDays.length !== DAYS_IN_WEEK) return null;
  const elapsed = Math.min(Math.max(Math.trunc(daysElapsed), 1), DAYS_IN_WEEK);

  const weeklyBudget = dailyTarget * DAYS_IN_WEEK;
  let consumed = 0;
  for (let i = 0; i < elapsed; i++) consumed += weekDays[i].totalCalories;

  const remaining = weeklyBudget - consumed;
  const daysRemaining = DAYS_IN_WEEK - elapsed;
  const pacePerRemainingDay =
    daysRemaining > 0 ? Math.round(remaining / daysRemaining) : null;

  const bars: DayBudgetBar[] = weekDays.map((d, i) => ({
    dateKey: d.dateKey,
    calories: d.totalCalories,
    elapsed: i < elapsed,
  }));

  return {
    weeklyBudget,
    dailyTarget,
    consumed,
    remaining,
    daysElapsed: elapsed,
    daysRemaining,
    pacePerRemainingDay,
    bars,
  };
}
