/**
 * Oura Cloud API → {@link HealthWorkout} (issue #72, ADR-0026 Amendment 2).
 *
 * The parse-only half of the second cardio import transport. ADR-0026 chose
 * the OS health store because it is free and needs no secret; the owner then
 * overruled it, on the ground that the health path had never actually imported
 * a real Oura record. **Both paths now exist**, and this file is the one that
 * turns Oura's own wire shape into the shape the existing importer already
 * eats — so `toCardioModality`, `toCardioBlockFromHealth`, `importableWorkouts`
 * and `mergeImportedBlocks` are reused rather than reimplemented. There is no
 * second mapper; there is a second *reader*.
 *
 * ## Why this is in `packages/core` and not in `functions/`
 *
 * The fetch has to run server-side — the refresh token lives at
 * `users/{uid}/private/oura`, which matches no rule and is therefore denied to
 * every client. But the *parsing* is pure, and parsing is the half that can be
 * wrong. Putting it here means it is unit-testable with no ring, no OAuth and
 * no emulator, which matters because there is exactly one Oura ring available
 * to this project.
 *
 * ## Everything here is defensive, deliberately
 *
 * **No response from a real ring has ever been read.** The field list below is
 * corroborated by two independent third-party clients and Oura's published
 * examples, not by a captured payload. So every field is validated at the
 * boundary and a record that fails is DROPPED rather than coerced: importing a
 * run with a garbage duration is worse than not importing it, because it lands
 * in a training history the user trusts. {@link parseOuraWorkouts} therefore
 * never throws on a malformed record — it returns the ones it understood, and
 * says how many it did not.
 *
 * ## What Oura does NOT send, and what we refuse to invent
 *
 * - **No heart rate.** `avgHr` is absent from the workout record; the raw
 *   series is behind the `heartrate` scope, which ADR-0026's scope table
 *   declines. A cloud-imported block therefore has no HR where a health-store
 *   one may. That is a real difference and not a bug.
 * - **`intensity` is `easy | moderate | hard`** and is NOT mapped to
 *   {@link CardioBlock.rpe}. RPE is the user's own judgement of effort on a
 *   1-10 scale; Oura's intensity is an algorithm's label. Filling one from the
 *   other would put a number the user never gave into a field only they can
 *   answer, and it would then be indistinguishable from one they did.
 */
import type { CardioProvider } from './cardio';
import type { HealthWorkout } from './health-workouts';

/** One record of `GET /v2/usercollection/workout`'s `data` array. Every field
 *  optional except in spirit: this is a wire shape we have not seen. */
export interface OuraWorkout {
  id?: unknown;
  activity?: unknown;
  calories?: unknown;
  day?: unknown;
  distance?: unknown;
  end_datetime?: unknown;
  intensity?: unknown;
  label?: unknown;
  /** Oura's OWN provenance (`manual` / `autodetected` / `confirmed` / …) — who
   *  put the workout in THEIR system. Read and deliberately not used: it is a
   *  different question from our `CardioSource`, which is about which
   *  transport delivered the record to us, and every record from this endpoint
   *  arrives as `source: 'oura'` whatever this says. A workout the user typed
   *  into the Oura app is still their workout and is still imported. */
  source?: unknown;
  start_datetime?: unknown;
}

/** The multi-document envelope every v2 collection endpoint returns. */
export interface OuraWorkoutPage {
  data?: unknown;
  next_token?: unknown;
}

/** Oura is the only thing that can be on the far end of this transport. */
const OURA: CardioProvider = 'oura';

/**
 * A workout cannot be longer than a day.
 *
 * The same ceiling `cardio.ts` puts on `durationSec`, applied *here* as well
 * rather than left to the clamp downstream — because the failure this catches
 * is a parse error, not an unusual athlete. `end < start` and absurd spans are
 * how a timezone bug or a null-coerced date shows up, and the honest response
 * to a record we cannot read is to drop it.
 */
const MAX_SPAN_MS = 86_400_000;

/** ISO 8601 with an offset (`2021-01-01T01:30:00.000000+00:00`) — the format
 *  Oura documents. `Date.parse` handles the six-digit fractional seconds. */
function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** A finite non-negative number, or `undefined`. Never `0`-from-`null`:
 *  `Number(null)` is `0`, the same trap `clampRpe` documents. */
function positive(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * One Oura record → one {@link HealthWorkout}, or `null` if it cannot be read.
 *
 * Returns `null` — rather than a partial record — when the id, the activity or
 * either endpoint is missing or nonsensical. Those four are what make a
 * workout a workout; everything else is decoration that may legitimately be
 * absent (`distance` on a rowing machine, `calories` on a manual entry).
 */
export function toHealthWorkout(raw: OuraWorkout): HealthWorkout | null {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
  const activity = typeof raw.activity === 'string' && raw.activity ? raw.activity : null;
  const startMs = parseInstant(raw.start_datetime);
  const endMs = parseInstant(raw.end_datetime);
  if (id == null || activity == null || startMs == null || endMs == null) return null;

  const span = endMs - startMs;
  if (span <= 0 || span > MAX_SPAN_MS) return null;

  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;

  return {
    id,
    // `activity` alone, never the label. `toCardioModality` reads this string,
    // so folding a user's free text into it would break the mapping for a
    // workout that was perfectly placeable. The label travels in its own field
    // and is used only where the modality table has nothing — see
    // `toCardioBlockFromHealth`.
    activityType: activity,
    startMs,
    endMs,
    // Oura's `distance` is already METERS (13500.5 for a ride), the same unit
    // `CardioBlock.distanceM` stores — no conversion, and none wanted.
    distanceM: positive(raw.distance),
    kcal: positive(raw.calories),
    // No `avgHr`: see this file's header. Absent, not zero.
    provider: OURA,
    source: 'oura',
    // `fromUs` is the health store's re-import guard — Ignia writing a workout
    // into HealthKit and reading it back as cardio. Nothing we do reaches
    // Oura's cloud, so no record here can be ours. Always false, never a guess.
    fromUs: false,
    ...(label ? { label } : {}),
  };
}

/**
 * A page of Oura workouts → the records we understood.
 *
 * Never throws. A body that is not an object, a `data` that is not an array,
 * and a record that fails {@link toHealthWorkout} all degrade to "fewer
 * workouts", because the caller is a background import and the alternative is
 * a 500 that tells the user their ring is broken when it is our parser that
 * is.
 *
 * `skipped` is returned rather than logged so the caller can decide whether a
 * page that yielded nothing out of twenty is worth reporting. A silent zero
 * and a zero from twenty unparseable records look identical otherwise, and
 * they mean completely different things.
 */
export function parseOuraWorkouts(body: unknown): {
  workouts: HealthWorkout[];
  nextToken: string | null;
  skipped: number;
} {
  const page = (body ?? {}) as OuraWorkoutPage;
  const rows = Array.isArray(page.data) ? page.data : [];

  const workouts: HealthWorkout[] = [];
  let skipped = 0;
  for (const row of rows) {
    const w = row && typeof row === 'object' ? toHealthWorkout(row as OuraWorkout) : null;
    if (w) workouts.push(w);
    else skipped++;
  }

  const nextToken =
    typeof page.next_token === 'string' && page.next_token ? page.next_token : null;
  return { workouts, nextToken, skipped };
}

/**
 * `YYYY-MM-DD` in UTC, the format `start_date` / `end_date` take.
 *
 * UTC on purpose. The window is a coarse "roughly the last N days" filter
 * whose only job is to bound the request; the day a workout is FILED under is
 * decided later, from `startedAt` in the user's local zone, by the importer
 * that already does this for the health store. Computing the query bounds
 * locally would make the request non-deterministic by device without changing
 * which day anything lands on.
 */
export function ouraDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}
