/**
 * The windows every screen takes over logs and weights — named once, so the
 * three that CONTEXT.md distinguishes stop being bare integers.
 *
 * ## Why this exists
 *
 * [ADR-0004](../../../docs/adr/0004-log-window-typed-queries.md) established
 * that the windows over `DailyLog`s look alike and are NOT interchangeable, and
 * gave the Angular app typed queries to keep them apart. The Expo app was built
 * afterwards and inherited none of it: `LOG_WINDOW = 400` was declared
 * separately in `useToday`, `useHistory` and `useTrends`, and had already
 * drifted into a bare, unlabelled `400` in `useBody`.
 *
 * The window BUILDERS were duplicated the same way — the trailing-N-day key
 * series existed once per frontend, the 14-day weight line existed twice inside
 * the Expo app alone, and the Monday-start week key existed in both apps
 * comment-for-comment identical.
 *
 * ## Every builder takes `now`
 *
 * Never `new Date()` internally. A window is a claim about a specific instant,
 * and a screen that computes two windows a millisecond apart across local
 * midnight would otherwise disagree with itself. It also makes every case below
 * testable without faking the clock.
 */
import { addDays, localDateKey } from './date';

// ─── Named row windows ──────────────────────────────────────────

/**
 * The rolling row cache the logging tabs subscribe to — **rows, not days**.
 * A heavy logger sees fewer calendar days than a sparse one; that asymmetry is
 * the whole reason ADR-0004 exists.
 *
 * 400 is generous on purpose: measured-mode TDEE needs ≥14 distinct logged
 * days inside it (`calculateTdee`), and a 7-meals-a-day logger reaches that in
 * ~100 rows while a sparse one needs the room.
 */
export const LOG_WINDOW_ROWS = 400;

/** The 14-ROW window CONTEXT.md calls **RecentLogs** — today's totals, the
 *  recents row, the budget-crossed signal. Not 14 days. */
export const RECENT_LOGS_ROWS = 14;

// ─── Window builders ────────────────────────────────────────────

/** The trailing `n` dateKeys ending at `now`, OLDEST FIRST. */
export function trailingDateKeys(n: number, now: Date): string[] {
  return Array.from({ length: n }, (_, i) => localDateKey(addDays(now, i - (n - 1))));
}

/** One weight per day over the trailing `n` days, oldest first, **days with no
 *  weigh-in dropped** — a gap must not plot as a zero. */
export function weightSeriesForDays(
  weights: Readonly<Record<string, number>>,
  n: number,
  now: Date,
): number[] {
  const out: number[] = [];
  for (const key of trailingDateKeys(n, now)) {
    const v = weights[key];
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

/** A weigh-in and the day it belongs to. Matches what the projection and
 *  insight math consume. */
export interface DatedWeight {
  dateKey: string;
  weightLb: number;
}

/** The same window as {@link weightSeriesForDays}, but keeping each point's
 *  day — the trend fits need the x axis. */
export function weightPointsForDays(
  weights: Readonly<Record<string, number>>,
  n: number,
  now: Date,
): DatedWeight[] {
  const out: DatedWeight[] = [];
  for (const key of trailingDateKeys(n, now)) {
    const v = weights[key];
    if (typeof v === 'number') out.push({ dateKey: key, weightLb: v });
  }
  return out;
}

export interface IsoWeek {
  /** The seven Monday→Sunday dateKeys of the week containing `now`. */
  keys: string[];
  /** 1-based position of `now` in that week: Monday = 1, Sunday = 7. */
  daysElapsed: number;
}

/**
 * The local Monday-start week containing `now`.
 *
 * Monday-start, not the JS default Sunday-start: the weekly calorie budget is a
 * Mon→Sun allowance, and starting it on Sunday would move a weekend's eating
 * into the wrong bucket. Monday is at most 6 days back, so the row window
 * always covers the elapsed week.
 */
export function isoWeek(now: Date): IsoWeek {
  const daysSinceMonday = (now.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const monday = addDays(now, -daysSinceMonday);
  return {
    keys: Array.from({ length: 7 }, (_, i) => localDateKey(addDays(monday, i))),
    daysElapsed: daysSinceMonday + 1,
  };
}
