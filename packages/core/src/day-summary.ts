import type { DailyLog } from './types';
import { localDateKey } from './date';

/**
 * Single-day rollup of food + exercise + weight, keyed by a local
 * timezone YYYY-MM-DD date. This is the canonical shape the rest of the
 * app should consume — UI cards, weekly-report builders, CSV export,
 * milestone calc, etc. — so per-meal aggregation logic lives in exactly
 * one place.
 *
 * `mealCount` mirrors the legacy `count` field returned by
 * `FitnessStore.summaryFor()`; callers that depend on the old name should
 * read `count` from the store wrapper, which aliases it.
 */
export interface DaySummary {
  readonly dateKey: string;
  readonly totalCalories: number;
  readonly totalProtein: number;
  /** Grams. Zero when no entry on the day carried the field — carbs/fat
   *  are optional on `DailyLog` (added 2026-06; older rows lack them). */
  readonly totalCarbs: number;
  readonly totalFat: number;
  readonly mealCount: number;
  /** True when ANY DailyLog on this day has `exerciseCompleted` (or the
   *  legacy `liftCompleted` / `cardioCompleted` flags) set. Matches the
   *  detection used by FitnessStore and the weekly-report prompt. */
  readonly exercised: boolean;
  /** Weight in pounds from the `dailyWeights` map for this date key, or
   *  null when the user didn't weigh in. Independent of whether any
   *  meals were logged. */
  readonly weightLb: number | null;
}

function exercisedFlag(l: DailyLog): boolean {
  return !!(l.exerciseCompleted || l.liftCompleted || l.cardioCompleted);
}

function weightFor(
  dateKey: string,
  dailyWeights: Record<string, number> | undefined,
): number | null {
  if (!dailyWeights) return null;
  const w = dailyWeights[dateKey];
  return typeof w === 'number' ? w : null;
}

/**
 * Aggregate all `DailyLog` rows that fall on `dateKey` (local timezone),
 * optionally including the weight for that day. Pure — no signals, no
 * Firestore reads. The single source of truth for daily totals.
 *
 * Protein is rounded to the nearest gram to match the legacy
 * `FitnessStore.summaryFor()` behavior; calories pass through as-is.
 * Returns zero totals + `exercised=false` + `mealCount=0` when no logs
 * match — callers that need null-on-empty (e.g. the v2 day-summary card
 * which hides itself entirely on empty days) should check `mealCount`.
 */
export function summarizeDay(
  dateKey: string,
  logs: readonly DailyLog[],
  dailyWeights?: Record<string, number>,
): DaySummary {
  let totalCalories = 0;
  let proteinSum = 0;
  let carbsSum = 0;
  let fatSum = 0;
  let mealCount = 0;
  let exercised = false;
  for (const l of logs) {
    if (localDateKey(l.date) !== dateKey) continue;
    totalCalories += l.calories || 0;
    if (l.protein != null) proteinSum += l.protein;
    if (l.carbs != null) carbsSum += l.carbs;
    if (l.fat != null) fatSum += l.fat;
    mealCount += 1;
    if (!exercised && exercisedFlag(l)) exercised = true;
  }
  return {
    dateKey,
    totalCalories,
    totalProtein: Math.round(proteinSum),
    totalCarbs: Math.round(carbsSum),
    totalFat: Math.round(fatSum),
    mealCount,
    exercised,
    weightLb: weightFor(dateKey, dailyWeights),
  };
}

/**
 * Build summaries for many days at once. Iterates `logs` ONCE,
 * bucketing by `localDateKey`, so a 90-day report doesn't do 90×N
 * filters. Returns one entry per `dateKeys` element in the order given;
 * days with no matching logs return zero totals.
 */
export function summarizeDays(
  dateKeys: readonly string[],
  logs: readonly DailyLog[],
  dailyWeights?: Record<string, number>,
): DaySummary[] {
  // Pre-allocate buckets so the single log pass can find them in O(1)
  // and days with no logs still emit a zero row.
  const buckets = new Map<
    string,
    { totalCalories: number; proteinSum: number; carbsSum: number; fatSum: number; mealCount: number; exercised: boolean }
  >();
  for (const k of dateKeys) {
    buckets.set(k, { totalCalories: 0, proteinSum: 0, carbsSum: 0, fatSum: 0, mealCount: 0, exercised: false });
  }
  for (const l of logs) {
    const key = localDateKey(l.date);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.totalCalories += l.calories || 0;
    if (l.protein != null) bucket.proteinSum += l.protein;
    if (l.carbs != null) bucket.carbsSum += l.carbs;
    if (l.fat != null) bucket.fatSum += l.fat;
    bucket.mealCount += 1;
    if (!bucket.exercised && exercisedFlag(l)) bucket.exercised = true;
  }
  return dateKeys.map((dateKey) => {
    const b = buckets.get(dateKey)!;
    return {
      dateKey,
      totalCalories: b.totalCalories,
      totalProtein: Math.round(b.proteinSum),
      totalCarbs: Math.round(b.carbsSum),
      totalFat: Math.round(b.fatSum),
      mealCount: b.mealCount,
      exercised: b.exercised,
      weightLb: weightFor(dateKey, dailyWeights),
    };
  });
}
