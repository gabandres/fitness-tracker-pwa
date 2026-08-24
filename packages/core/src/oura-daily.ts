/**
 * Oura daily summaries → the rows Ignia already stores (ADR-0026, `daily` scope).
 *
 * ## What this is for
 *
 * Ignia has stored daily **sleep hours**, **steps** and **active kcal** since the
 * Apple Health / Health Connect importer shipped — `setDailySleep`,
 * `setDailySteps`, `setDailyActiveEnergy` are all real writers with real
 * consumers. This module lets the Oura Cloud API reach those same rows, which
 * matters for two reasons the health-store route cannot fix:
 *
 * - **Android needs a binary for the store route and does not for this one.**
 *   The Health Connect read requires a new runtime permission, which moves the
 *   fingerprint — the reason cardio import reached Android testers a whole
 *   binary early by going through the Cloud API instead.
 * - **The store route can fail silently.** If workout/daily export is off in the
 *   Oura app, Ignia sees nothing and cannot tell that from a quiet week.
 *
 * ## The shape assumption, stated so it can be falsified
 *
 * Field names and units here are taken from Oura's published v2 schema:
 * `daily_activity` carries `steps` and `active_calories`; a sleep period carries
 * `total_sleep_duration` **in seconds**. **No record from a real ring has been
 * parsed by this module.** Every reader below therefore treats a missing or
 * malformed field as "no value" rather than coercing it, and
 * {@link parseOuraDaily} reports how many records it could not read so the UI
 * can say so out loud — the same contract `oura-workouts.ts` uses, for the same
 * reason: a wire-shape assumption that is wrong must fail loudly, not quietly
 * write zeroes over a user's day.
 */

/** A day's worth of imported totals. Every metric is optional because Oura may
 *  carry one and not the others, and a partial day is still worth writing. */
export interface OuraDailyRow {
  /** `YYYY-MM-DD`, taken from Oura's own `day` field — never recomputed from a
   *  timestamp, because the ring decides which day a night's sleep belongs to
   *  and re-deriving it in another timezone would move it. */
  dateKey: string;
  /** Hours slept, to the quarter hour. Absent when Oura reported no duration. */
  sleepHours?: number;
  steps?: number;
  activeKcal?: number;
}

export interface OuraDailyParse {
  rows: OuraDailyRow[];
  /** Records that carried no readable value at all. Surfaced, not swallowed. */
  skipped: number;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A finite, positive number, or undefined. Mirrors `positive()` in
 *  `oura-workouts.ts` — Oura uses `null` for "not measured", and `Number(null)`
 *  is `0`, which would write a real zero over a real day. */
function positive(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

/** Oura's `day` field, validated rather than trusted. */
function dayKey(raw: unknown): string | undefined {
  return typeof raw === 'string' && DAY_KEY.test(raw) ? raw : undefined;
}

/**
 * Seconds → hours, rounded to the quarter hour.
 *
 * A quarter is what `setDailySleep` stores and what the Health importer's own
 * tolerance uses (`sleep: 0.25`), so rounding here means an Oura-sourced night
 * and a Health-sourced one for the same date compare equal instead of
 * ping-ponging between two values that differ by seconds.
 */
export function sleepSecondsToHours(seconds: unknown): number | undefined {
  const s = positive(seconds);
  if (s === undefined) return undefined;
  const hours = Math.round((s / 3600) * 4) / 4;
  return hours > 0 ? hours : undefined;
}

/**
 * Fold Oura's `daily_activity` and sleep records into one row per day.
 *
 * Both collections are optional: a caller that could only fetch one (a 403 on
 * the other, say) still gets what it has. Multiple sleep periods on one day —
 * a nap plus a night — **sum**, which is what a daily total means and what the
 * Health importer's `preAggregated` folding already does for steps.
 */
export function parseOuraDaily(
  activity: readonly unknown[] = [],
  sleep: readonly unknown[] = [],
): OuraDailyParse {
  const byDay = new Map<string, OuraDailyRow>();
  let skipped = 0;

  const row = (key: string): OuraDailyRow => {
    const found = byDay.get(key);
    if (found) return found;
    const made: OuraDailyRow = { dateKey: key };
    byDay.set(key, made);
    return made;
  };

  for (const raw of activity) {
    const rec = raw as Record<string, unknown> | null;
    const key = dayKey(rec?.['day']);
    if (!key) {
      skipped++;
      continue;
    }
    const steps = positive(rec?.['steps']);
    const activeKcal = positive(rec?.['active_calories']);
    if (steps === undefined && activeKcal === undefined) {
      skipped++;
      continue;
    }
    const target = row(key);
    if (steps !== undefined) target.steps = Math.round(steps);
    if (activeKcal !== undefined) target.activeKcal = Math.round(activeKcal);
  }

  for (const raw of sleep) {
    const rec = raw as Record<string, unknown> | null;
    const key = dayKey(rec?.['day']);
    const hours = sleepSecondsToHours(rec?.['total_sleep_duration']);
    if (!key || hours === undefined) {
      skipped++;
      continue;
    }
    const target = row(key);
    // Sum rather than replace: a nap and a night are two records for one day,
    // and the row is a daily TOTAL.
    target.sleepHours = Math.round(((target.sleepHours ?? 0) + hours) * 4) / 4;
  }

  const rows = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { rows, skipped };
}
