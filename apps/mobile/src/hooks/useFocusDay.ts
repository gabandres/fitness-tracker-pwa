import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { type DayBoundary, dayKeyAt } from '@macrolog/core';

/**
 * A `Date` that is "now" as of the last time the screen was FOCUSED, and that
 * only changes identity when the user's DAY has changed under `boundary`.
 *
 * Every trailing window on Trends was `useMemo(() => trailingDateKeys(N, new
 * Date(), boundary), [boundary])`, with a comment saying the screen "re-derives
 * on refocus anyway". It does not: a refocus re-opens listeners, but a memo
 * keyed on `boundary` alone never recomputes — and for every account on the
 * default boundary `dayBoundaryOf` returns the shared `MIDNIGHT` constant, so
 * `boundary` never changes reference either. expo-router keeps a visited tab
 * mounted and RN processes live for days, so after a night in the background
 * the sleep, water and fasting cards kept the mount day's window: last night's
 * sleep, today's water and a fast that just ended sat outside it until a cold
 * restart.
 *
 * Returning the same `Date` while the day key is unchanged is what keeps this
 * cheap: the state bails out, no memo downstream recomputes, and no listener
 * re-opens. A changed day is the one case where re-opening the `since`-bounded
 * query is exactly the point.
 */
export function useFocusDay(boundary: DayBoundary): Date {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow((prev) => {
        const next = new Date();
        return dayKeyAt(prev, boundary) === dayKeyAt(next, boundary) ? prev : next;
      });
    }, [boundary]),
  );
  return now;
}
