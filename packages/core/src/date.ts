/**
 * Branded string type for local-timezone YYYY-MM-DD date keys.
 * Prevents accidentally passing UTC-derived strings (e.g. toISOString().slice(0,10))
 * where a local date key is expected. Use localDateKey() to create one.
 */
export type DateKey = string & { readonly __brand: 'DateKey' };

/**
 * Returns a YYYY-MM-DD string in the user's LOCAL timezone.
 * Use this everywhere calendar-day grouping is needed.
 * Do NOT use toISOString().slice(0,10) — that returns UTC date
 * which causes entries to land on the wrong day for users
 * west or east of UTC.
 */
export function localDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as DateKey;
}

/** Add `n` days to a date. Uses date arithmetic so DST transitions don't drift. */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Parse a YYYY-MM-DD key into a local-midnight Date. */
export function parseYmd(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** First day of the calendar month for `d` (local midnight). */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * 6×7 (42-cell) Sunday-first grid covering the month containing `d`.
 * Cells outside the month carry `inMonth: false`. Useful for calendar UIs.
 */
export function monthGrid(d: Date): { date: Date; inMonth: boolean; key: DateKey }[] {
  const first = startOfMonth(d);
  const start = addDays(first, -first.getDay());
  const cells: { date: Date; inMonth: boolean; key: DateKey }[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    cells.push({ date, inMonth: date.getMonth() === d.getMonth(), key: localDateKey(date) });
  }
  return cells;
}
