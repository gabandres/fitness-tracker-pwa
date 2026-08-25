import type { DailyLog } from './types';
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
  const cursor = opts?.today ? new Date(opts.today) : new Date();
  if (!dates.has(dayKeyAt(cursor, boundary))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(dayKeyAt(cursor, boundary))) return { streak: 0, freezeUsed: false };
  }

  while (true) {
    if (dates.has(dayKeyAt(cursor, boundary))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (maxGap === 0) break;
    let probe: Date | null = null;
    for (let i = 1; i <= maxGap; i++) {
      const c = new Date(cursor);
      c.setDate(c.getDate() - i);
      if (dates.has(dayKeyAt(c, boundary))) {
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
