/**
 * Daily steps (2026-11-06): the usual count, the 7-day average, when a day is
 * final, which days an import may rewrite, and a trip's day list.
 *
 * **Steps are activity only.** Nothing here feeds maintenance, targets or the
 * deficit — the activity-level correction reads `activeKcal`, never steps
 * (ADR-0024: the device's activity is a seed-only prior), and this module is
 * display and export alone.
 *
 * A day's total is HealthKit's own de-duplicated `cumulativeSum` over one local
 * calendar day (`health.ts`), so a recorded walk is already inside it: nothing
 * here adds cardio blocks on top.
 *
 * Pure; no I/O.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import type { ActivitySource, DailyActivity } from './daily-scalars';
import { isTravelDay, type TravelPeriod } from './travel';

/** Days before today that the usual count reads. */
export const USUAL_STEPS_WINDOW_DAYS = 28;
/** Fewer days with steps than this and there is no usual count. */
export const USUAL_STEPS_MIN_DAYS = 7;
/** The Trends average: the last 7 COMPLETE days (today is still counting). */
export const STEPS_AVERAGE_DAYS = 7;
/** A day's total is final at this local hour of the NEXT day: a watch away
 *  from its phone syncs late, and the importer re-reads the last days anyway
 *  (`OVERLAP_DAYS` in mobile `health-sync.ts`). */
export const STEPS_FINAL_HOUR = 3;

type StepsByDay = Readonly<Record<string, Pick<DailyActivity, 'steps'> | undefined>>;

const shiftKey = (key: string, n: number) => calendarDateKey(addDays(parseYmd(key), n));
const stepsOn = (activity: StepsByDay, key: string): number | null => {
  const s = activity[key]?.steps;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
};

/**
 * The user's usual daily steps: the MEDIAN of the {@link USUAL_STEPS_WINDOW_DAYS}
 * days before today, travel days left out (a trip is the thing being compared
 * against it), rounded to 100. Median, not mean: one 25k hiking day must not
 * move "usual". Null with fewer than {@link USUAL_STEPS_MIN_DAYS} days.
 */
export function usualSteps(activity: StepsByDay, todayKey: string, periods: readonly TravelPeriod[] = []): number | null {
  const values: number[] = [];
  for (let i = 1; i <= USUAL_STEPS_WINDOW_DAYS; i++) {
    const key = shiftKey(todayKey, -i);
    if (isTravelDay(key, periods)) continue;
    const s = stepsOn(activity, key);
    if (s != null) values.push(s);
  }
  if (values.length < USUAL_STEPS_MIN_DAYS) return null;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  return Math.round(median / 100) * 100;
}

/** The mean over the last `days` COMPLETE days (yesterday back), over the days
 *  that have a count. Null when none does. */
export function stepsAverage(
  activity: StepsByDay,
  todayKey: string,
  days: number = STEPS_AVERAGE_DAYS,
): { mean: number; days: number; window: number } | null {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= days; i++) {
    const s = stepsOn(activity, shiftKey(todayKey, -i));
    if (s != null) {
      sum += s;
      n++;
    }
  }
  return n ? { mean: Math.round(sum / n), days: n, window: days } : null;
}

/** True once `now` is past {@link STEPS_FINAL_HOUR} on the day after `dateKey`
 *  (device-local). */
export function isStepDayFinal(dateKey: string, now: Date): boolean {
  const next = addDays(parseYmd(dateKey), 1);
  next.setHours(STEPS_FINAL_HOUR, 0, 0, 0);
  return now.getTime() >= next.getTime();
}

/**
 * The imported days an import may write, given what is stored.
 *
 * HealthKit buckets every day at midnight in the device's CURRENT zone. After
 * a flight across zones the next import would re-bucket days already counted
 * where they were lived — so a FINAL day ({@link isStepDayFinal}) stored with
 * a different zone is kept as it was. Days not yet final, days stored before
 * zones were recorded, and every day when the zone is unknown are written as
 * before. Same zone: written (a late watch sync still lands).
 */
export function stepDaysToWrite<T>(
  apply: Readonly<Record<string, T>>,
  stored: Readonly<Record<string, Pick<DailyActivity, 'tz'> | undefined>>,
  deviceTz: string | undefined,
  now: Date,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(apply)) {
    const tz = stored[key]?.tz;
    if (deviceTz && tz && tz !== deviceTz && isStepDayFinal(key, now)) continue;
    out[key] = v;
  }
  return out;
}

export interface TripStepDay {
  dateKey: string;
  /** Null: no count for that day (not zero). */
  steps: number | null;
  /** Today — still counting. */
  today: boolean;
}

/** The trip's days from its start to today (or its end, if earlier), each
 *  with its count — the travel summary's list. Future days are not listed. */
export function tripStepDays(period: Pick<TravelPeriod, 'start' | 'end'>, activity: StepsByDay, todayKey: string): TripStepDay[] {
  const last = period.end < todayKey ? period.end : todayKey;
  const out: TripStepDay[] = [];
  for (let key = period.start; key <= last; key = shiftKey(key, 1)) {
    out.push({ dateKey: key, steps: stepsOn(activity, key), today: key === todayKey });
    if (out.length > 400) break;
  }
  return out;
}

/** The export's `source` column. */
export function activitySourceLabel(source: ActivitySource | undefined): string {
  switch (source) {
    case 'healthkit': return 'HealthKit';
    case 'healthconnect': return 'Health Connect';
    case 'oura': return 'Oura';
    default: return '';
  }
}
