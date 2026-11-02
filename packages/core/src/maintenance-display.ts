/**
 * What the maintenance hero SHOWS, as distinct from what the estimator FOUND
 * (owner, 2026-10-30).
 *
 * The fit moves day to day with the scale; the shown number is the mean of the
 * fit's own daily values over {@link MAINTENANCE_SMOOTH_DAYS} days, with the
 * 95% range and the count of days behind it beside it. This is a READING of
 * `calculateTdee`, not a change to it: targets, recalibration and the stored
 * `maintenanceEstimate` keep reading the raw value, and nothing computes off
 * the displayed one.
 *
 * A travel hold is not smoothed. The held number is one value by definition
 * (`travel.ts`), so a mean over the days before it would show a figure the
 * estimator never held.
 *
 * Pure; no I/O, no clock.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import type { DailyTargetRecord } from './target-history';
import type { TdeeResult } from './tdee';

/** Days in the displayed mean, today included. */
export const MAINTENANCE_SMOOTH_DAYS = 7;

export interface MaintenanceDisplay {
  /** The estimator's value today (`trueTdee`). */
  raw: number;
  /** What the hero shows: the {@link MAINTENANCE_SMOOTH_DAYS}-day mean. */
  displayed: number;
  /** Displayed ± `ci95Tdee`. Absent when the run measured no interval. */
  range?: { low: number; high: number };
  /** Days with food in the fit (`intakeDays`). */
  validDays: number;
}

/**
 * The display values for today, or `null` when the number is not measured (a
 * formula or seed figure has no daily series worth averaging).
 *
 * @param records stored target records, any order. Only MEASURED days before
 *                `today` are read: today's value is the live one, so today's
 *                own record can never feed back into what gets written to it.
 */
export function maintenanceDisplay(
  tdee: TdeeResult,
  records: readonly Pick<DailyTargetRecord, 'date' | 'maintenanceEstimate' | 'maintenanceRaw' | 'maintenanceSource'>[],
  today: string,
): MaintenanceDisplay | null {
  if (tdee.source !== 'measured' || tdee.trueTdee <= 0) return null;
  const raw = tdee.trueTdee;
  const oldest = calendarDateKey(addDays(parseYmd(today), -(MAINTENANCE_SMOOTH_DAYS - 1)));
  const past = tdee.travelHold
    ? []
    : records
        .filter((r) => r.date >= oldest && r.date < today && r.maintenanceSource === 'measured')
        .map((r) => r.maintenanceRaw ?? r.maintenanceEstimate)
        .filter((v): v is number => v != null && v > 0);
  const displayed = Math.round([raw, ...past].reduce((a, b) => a + b, 0) / (past.length + 1));
  return {
    raw,
    displayed,
    ...(tdee.ci95Tdee != null ? { range: { low: displayed - tdee.ci95Tdee, high: displayed + tdee.ci95Tdee } } : {}),
    validDays: tdee.intakeDays,
  };
}
