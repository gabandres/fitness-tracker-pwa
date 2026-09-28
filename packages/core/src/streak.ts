import type { DailyLog } from './types';
import { addDays, calendarDateKey, parseYmd } from './date';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';

/**
 * Consecutive-day logging streak, counting back from today (or yesterday, so
 * the streak doesn't visibly drop to 0 until a full day is missed). Pure port
 * of the Angular TdeeCalculatorService.computeStreakWithFreeze.
 *
 * `freezeMaxGap > 0` tolerates up to that many missed days mid-streak (the
 * paid "streak freeze"); `freezeUsed` reports whether any gap was forgiven.
 * The default `freezeMaxGap = 0` breaks the streak on any missed day.
 *
 * Takes an optional `today` for deterministic testing (defaults to now), and an
 * optional `boundary` (ADR-0030) — omitted, the streak counts calendar days,
 * which is what it did before and what every account has today.
 */
export function computeStreak(
  logs: DailyLog[],
  opts?: { freezeMaxGap?: number; today?: Date; boundary?: DayBoundary },
): { streak: number; freezeUsed: boolean } {
  if (logs.length === 0) return { streak: 0, freezeUsed: false };
  const maxGap = Math.max(0, opts?.freezeMaxGap ?? 0);
  const boundary = opts?.boundary ?? MIDNIGHT;
  const dates = new Set(logs.map((l) => dayKeyAt(l.date, boundary)));

  let streak = 0;
  let freezeUsed = false;

  // Walk DAY KEYS, not instants. The anchor is the user's day (`dayKeyAt` of
  // `today`), and every step back from it is a plain calendar day off a
  // settled key — the same pattern `trailingDateKeys` uses (ADR-0030).
  //
  // Stepping a wall-clock instant back with `setDate(-1)` and re-deriving the
  // key each time was wrong across a boundary changeover: the changeover day
  // runs 27 hours, so `D+1 01:00` and `D 01:00` are BOTH day D, and the walk
  // counted D twice — a streak one longer than the days actually logged.
  const today = opts?.today ? new Date(opts.today) : new Date();
  const anchor = parseYmd(dayKeyAt(today, boundary));
  let offset = 0;
  const keyAt = (daysBack: number) => calendarDateKey(addDays(anchor, -daysBack));
  if (!dates.has(keyAt(0))) {
    offset = 1;
    if (!dates.has(keyAt(offset))) return { streak: 0, freezeUsed: false };
  }

  while (true) {
    if (dates.has(keyAt(offset))) {
      streak++;
      offset++;
      continue;
    }
    if (maxGap === 0) break;
    let probe: number | null = null;
    for (let i = 1; i <= maxGap; i++) {
      if (dates.has(keyAt(offset + i))) {
        probe = offset + i;
        break;
      }
    }
    if (probe == null) break;
    freezeUsed = true;
    offset = probe;
  }

  return { streak, freezeUsed };
}
