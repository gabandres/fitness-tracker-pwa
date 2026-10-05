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
  /** A PAST day of this week with nothing logged — counted at the daily
   *  target in the arithmetic (see {@link WeeklyBudget.unloggedDays}), so the
   *  strip should draw it as "assumed", not as an empty column. Today is
   *  never `assumed`: it is still in progress. */
  readonly assumed: boolean;
}

export interface WeeklyBudget {
  /** dailyTarget × 7 — the whole week's allowance. */
  readonly weeklyBudget: number;
  /** Daily target, echoed for the bar baseline. */
  readonly dailyTarget: number;
  /** Calories actually logged across the elapsed days of the week. What the
   *  "used" line shows — never inflated by the assumed days below. */
  readonly consumed: number;
  /**
   * Past days of this week (before today) with no calories logged.
   *
   * ## Why they count at the target, not at zero
   *
   * Until 2026-10-04 an unlogged Monday counted as **0 eaten**, so skipping
   * the app for a day banked a whole day's allowance — the "room left" grew
   * by ~2,000 kcal for doing nothing, and the per-day figure invited the user
   * to eat it on Saturday. Ignia cannot tell a day nobody logged from a day
   * nobody ate, and the zero picks the reading that is almost never true.
   *
   * The target is the neutral assumption: such a day neither banks nor
   * borrows. It is still SAID — the card names the count — because an
   * assumption the user cannot see is the same bug in a quieter form.
   */
  readonly unloggedDays: number;
  /** weeklyBudget − consumed − unloggedDays × dailyTarget. Negative once the
   *  week is overspent. */
  readonly remaining: number;
  /** Elapsed days of the week, 1–7 (today's 1-based position). */
  readonly daysElapsed: number;
  /** Days left after today, 0–6. */
  readonly daysRemaining: number;
  /** Days still open INCLUDING today, 1–7 — the divisor of
   *  {@link perDayInclToday}. */
  readonly daysLeftInclToday: number;
  /**
   * Calories per day — today and each day after it — that land the week on
   * budget. Signed: negative means the week is already overspent.
   *
   * **Today is in the divisor because today's intake is already in
   * `remaining`.** This was `remaining / daysAfterToday` until 2026-10-04,
   * which divided what was left of TODAY's allowance across the other days
   * too: at breakfast on a Wednesday it promised ~2,550 a day for four days
   * when the honest answer was ~2,040 for five. On Sunday it is simply what
   * is left today, where it used to be null.
   */
  readonly perDayInclToday: number;
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
 * incomplete) or a malformed week. Past days with nothing logged count at
 * the daily target ({@link WeeklyBudget.unloggedDays} says why), and
 * today is always in progress — never "unlogged", whatever it holds.
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
  const todayIdx = elapsed - 1;
  const isAssumed = (i: number) => i < todayIdx && !(weekDays[i].totalCalories > 0);
  let consumed = 0;
  let unloggedDays = 0;
  for (let i = 0; i < elapsed; i++) {
    if (isAssumed(i)) unloggedDays++;
    else consumed += Math.max(0, weekDays[i].totalCalories);
  }

  const remaining = weeklyBudget - consumed - unloggedDays * dailyTarget;
  const daysRemaining = DAYS_IN_WEEK - elapsed;
  const daysLeftInclToday = daysRemaining + 1;
  const perDayInclToday = Math.round(remaining / daysLeftInclToday);

  const bars: DayBudgetBar[] = weekDays.map((d, i) => ({
    dateKey: d.dateKey,
    calories: d.totalCalories,
    elapsed: i < elapsed,
    assumed: isAssumed(i),
  }));

  return {
    weeklyBudget,
    dailyTarget,
    consumed,
    unloggedDays,
    remaining,
    daysElapsed: elapsed,
    daysRemaining,
    daysLeftInclToday,
    perDayInclToday,
    bars,
  };
}
