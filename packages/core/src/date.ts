/**
 * Branded string type for local-timezone YYYY-MM-DD date keys.
 * Prevents accidentally passing UTC-derived strings (e.g. toISOString().slice(0,10))
 * where a local date key is expected. Use calendarDateKey() to create one.
 */
export type DateKey = string & { readonly __brand: 'DateKey' };

/**
 * The CALENDAR date of `d`, as YYYY-MM-DD in the user's LOCAL timezone.
 *
 * Do NOT use `toISOString().slice(0,10)` — that returns the UTC date, which
 * lands entries on the wrong day for everyone west or east of UTC.
 *
 * ## This is not always the day the user means (ADR-0030)
 *
 * This function was called `localDateKey` until 2026-08-25 and was reached in
 * ~155 places, which made "the calendar date" and "the user's day" the same
 * answer by default and configurable nowhere. They are not the same answer: a
 * meal logged at 00:30 belongs to the night before for most people, and the
 * measured TDEE estimator fits per-day intake against a weight trend, so
 * mis-bucketing one late meal makes one day read under-eaten and the next
 * over-eaten — a sawtooth in the estimator's input that cannot be told apart
 * from real behaviour.
 *
 * The rename exists so that no call site can pick between the two by accident.
 * Use {@link dayKeyAt} — never this — whenever the answer means "which of the
 * user's days does this instant belong to".
 *
 * **The rule, and it is mechanical:** this is correct only when `d` was
 * *synthesized* from a key that is already settled — `parseYmd(key)`, or
 * `addDays` off one. When `d` is a real wall-clock instant (`new Date()`, a
 * log's `date`, a HealthKit sample's `endDate`, a Firestore timestamp), the
 * answer is {@link dayKeyAt} and this function is a latent bug.
 */
export function calendarDateKey(d: Date): DateKey {
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
    cells.push({ date, inMonth: date.getMonth() === d.getMonth(), key: calendarDateKey(date) });
  }
  return cells;
}
