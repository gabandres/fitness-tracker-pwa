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
  /**
   * Epoch ms of the LATEST `bedtime_end` folded into `sleepHours` — i.e. when
   * the ring says the sleeper woke.
   *
   * Carried purely so the import guard can ask whether this night could also
   * have been typed under the previous day's key on a non-midnight boundary
   * (issue #80, `manualNightKeys`). **It is never stored**: `dailySleep` holds
   * `hours` and `source` and the rules reject a third field. Absent when no
   * sleep period on the day carried a parseable `bedtime_end`, which is the
   * case the guard treats as "unknown" rather than guessing.
   */
  wakeMs?: number;
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
 * Oura's `bedtime_end` → epoch ms, or undefined.
 *
 * Published as an ISO 8601 string **with an offset**, which `Date.parse`
 * handles; anything else — a null, a number, a shape this module has not seen —
 * is "unknown", never a coerced zero. As with every other reader here, no
 * record from a real ring has been parsed, so a wrong assumption must degrade
 * to "we do not know" and not to a confident wrong instant.
 */
function instantMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Seconds → hours, rounded to the quarter hour.
 *
 * **The quarter is NOT what gets stored, and a comment here claimed it was
 * until 2026-08-25.** `clampSleepHours` snaps to the HALF hour
 * (`Math.round(hours * 2) / 2`, `health-mapping.ts`), so an Oura night of
 * 7h45m quarter-rounds to 7.75 here and is then stored as 8.0. This step is
 * therefore precision that never survives the write.
 *
 * It is kept anyway, and the real reason is the weaker one: it collapses the
 * seconds, so two sources reporting the same night agree *before* the clamp
 * rather than relying on the clamp to agree for them. The equality the old
 * comment claimed does hold — both paths land on halves — but it is
 * `clampSleepHours` that makes it hold, not this function. Do not "fix" the
 * Health importer's `sleep: 0.25` tolerance to match this; that tolerance is
 * compared against stored values, which are halves.
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
    // Latest wake wins, for the same reason `latestSampleEndByDay` takes the
    // max: the period that ends last is the one that ends when the sleeper got
    // up. See {@link OuraDailyRow.wakeMs}.
    const wake = instantMs(rec?.['bedtime_end']);
    if (wake !== undefined && (target.wakeMs === undefined || wake > target.wakeMs)) {
      target.wakeMs = wake;
    }
  }

  const rows = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { rows, skipped };
}
