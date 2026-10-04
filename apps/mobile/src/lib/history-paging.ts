import { type DailyLog, type DayBoundary, LOG_WINDOW_ROWS, compareLogsOldestFirst, dayKeyAt } from '@macrolog/core';

/**
 * Paging the History calendar back past the 400-row window (UX_AUDIT S18-13).
 *
 * `useHistory` subscribes to the newest `LOG_WINDOW_ROWS` rows and the calendar
 * pages back forever, so a month older than the window rendered empty —
 * indistinguishable from a month with nothing logged. The fix is not a wider
 * listener (ADR-0016, and a listener over all time is exactly the cost the
 * window bounds): it is ONE bounded `getDocs` per month the user actually
 * looks at, merged into the screen's own view and remembered for the life of
 * the screen so paging back and forth does not re-query.
 *
 * Everything here is pure so the three decisions — *does this month need a
 * fetch*, *which rows end up on screen*, *never twice* — are testable without
 * Firestore. The hook owns the state; this module owns the rules.
 */

/** `YYYY-MM` of the month containing `d`. */
export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** First and last dateKey of a `YYYY-MM` month, inclusive. */
export function monthRange(monthKey: string): { fromKey: string; toKey: string } {
  const [y, m] = monthKey.split('-').map((s) => parseInt(s, 10));
  const last = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  return { fromKey: `${monthKey}-01`, toKey: `${monthKey}-${String(last).padStart(2, '0')}` };
}

/**
 * Does the viewed month reach past what the 400-row window loaded?
 *
 * The rule: when the window is FULL (there may be more rows behind it) and the
 * first day of the viewed month is older than the oldest row on hand, some of
 * that month is not loaded. A window with room to spare loaded everything, so
 * an empty old month is genuinely empty and nothing needs fetching.
 *
 * Takes the WINDOW's oldest key and row count — never the merged set. Once an
 * older month has been merged in, "oldest loaded" would move back past a gap
 * the window still has (the window's own partial first month), and the
 * predicate would go quiet on exactly the month it should fetch.
 */
export function olderThanLoaded(
  view: Date,
  oldestLoadedKey: string | null,
  loadedRows: number,
  windowRows: number = LOG_WINDOW_ROWS,
): boolean {
  if (oldestLoadedKey == null || loadedRows < windowRows) return false;
  return `${monthKeyOf(view)}-01` < oldestLoadedKey;
}

/** The oldest day key among the loaded rows, under the user's boundary. */
export function oldestLogKey(logs: readonly { date: Date }[], boundary: DayBoundary): string | null {
  let oldest: string | null = null;
  for (const l of logs) {
    const k = dayKeyAt(l.date, boundary);
    if (oldest == null || k < oldest) oldest = k;
  }
  return oldest;
}

/**
 * The one month to fetch for `view`, or `null` when nothing is needed: the
 * window already covers it, the window is not full (so everything is loaded),
 * or that month was already requested — in flight or done, both count, so a
 * re-render mid-fetch cannot fire a second query.
 */
export function monthToFetch(input: {
  view: Date;
  oldestWindowKey: string | null;
  windowRows: number;
  requested: ReadonlySet<string>;
  windowCapacity?: number;
}): string | null {
  const { view, oldestWindowKey, windowRows, requested, windowCapacity = LOG_WINDOW_ROWS } = input;
  if (!olderThanLoaded(view, oldestWindowKey, windowRows, windowCapacity)) return null;
  const key = monthKeyOf(view);
  return requested.has(key) ? null : key;
}

/**
 * The window's rows plus every fetched month, deduplicated by id, OLDEST FIRST
 * (the ledger seam's contract, which `summarizeDays` and the day detail rely
 * on). The window wins a collision: it is live, a fetched month is a snapshot
 * taken once — so an edit to a row that sits in both surfaces through the
 * listener, not the stale copy.
 */
export function mergeLogs(
  windowLogs: readonly DailyLog[],
  fetched: Readonly<Record<string, readonly DailyLog[]>>,
): DailyLog[] {
  const byId = new Map<string, DailyLog>();
  for (const rows of Object.values(fetched)) for (const l of rows) if (l.id) byId.set(l.id, l);
  for (const l of windowLogs) if (l.id) byId.set(l.id, l);
  // A row with no id cannot be deduplicated; keep it as-is (ledger rows always
  // carry one, so this is a type accommodation, not a real path).
  const out = [...byId.values(), ...windowLogs.filter((l) => !l.id)];
  return out.sort(compareLogsOldestFirst);
}
