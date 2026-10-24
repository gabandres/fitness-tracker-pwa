/**
 * Complete day — whether a day's food diary is complete enough for its intake
 * to count toward the measured maintenance fit (owner decision, 2026-10-24;
 * ADR-0024 amendment, `CONTEXT.md` "Complete day").
 *
 * Stored as `users/{uid}/dailyLogged/{dateKey} = { complete, updatedAt }`,
 * written by the "Day fully logged?" control on Today. Tri-state: no doc =
 * unset, `complete: true` = "yes, that is everything I ate", `complete: false`
 * = "no, I missed things".
 */

/**
 * The per-day answers, `dateKey → complete`, as the ledger reads them. A day
 * with no answer is ABSENT from the map — never `undefined`, never a default.
 */
export type DayCompleteMap = Readonly<Record<string, boolean>>;

/** The answer in a `dailyLogged/{dateKey}` doc, or null when it holds none
 *  (no doc, or a doc without a boolean `complete`). */
export function readDayLogged(data: unknown): boolean | null {
  const complete = (data as { complete?: unknown } | null | undefined)?.complete;
  return typeof complete === 'boolean' ? complete : null;
}
