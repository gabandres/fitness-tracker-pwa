/**
 * Returns a YYYY-MM-DD string in the user's LOCAL timezone.
 * Use this everywhere calendar-day grouping is needed.
 * Do NOT use toISOString().slice(0,10) — that returns UTC date
 * which causes entries to land on the wrong day for users
 * west or east of UTC.
 */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
