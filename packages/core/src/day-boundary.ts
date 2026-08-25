import { addDays, calendarDateKey, parseYmd, type DateKey } from './date';

/**
 * When does a day start? (ADR-0030)
 *
 * Ignia had no answer to that question: `dateKey` was the local calendar date
 * at midnight, derived independently in ~155 places, and configurable nowhere.
 * That is fine for someone who eats between waking and midnight and wrong for
 * someone who does not — silently, because nothing errors.
 *
 * The visible symptom is a meal logged at 00:30 landing on tomorrow's ring. The
 * one that matters is invisible: the measured TDEE estimator fits a per-day
 * intake series against a weight trend, so a late meal makes one day read
 * under-eaten and the next over-eaten, injecting a sawtooth into the input that
 * cannot be told apart from real behaviour. That is the product's differentiator
 * being fed distorted data.
 *
 * This module is the derivation and nothing else. It is deliberately the FIRST
 * thing built (ADR-0030's recommendation): shipping a settings toggle before the
 * derivation is unified would fix Today and leave the estimator wrong, which is
 * the worst available outcome because it would look fixed.
 *
 * ## Why a history of changes rather than one number
 *
 * ADR-0030 asked whether changing the boundary rewrites history, proposed
 * "forward only", and concluded that would force the boundary to be stored
 * **per day** or history would silently reinterpret itself.
 *
 * Per-day storage is not necessary and it is not the cheapest correct answer. A
 * boundary is a *temporal* setting — a value with a validity range — so it is
 * stored as the short list of times it changed. One profile field, no
 * duplication onto every day document, and past days keep the boundary they
 * were logged under because the rule that governed them is still on file.
 *
 * A user who never touches the setting stores nothing at all: {@link MIDNIGHT}
 * is the empty list, and {@link dayKeyAt} under it is byte-for-byte
 * `calendarDateKey`. That equivalence is asserted in the tests, and it is what
 * makes adopting this at a call site a no-op until someone opts in.
 */

/**
 * Hours past local midnight at which a day begins.
 *
 * Capped at 6 because past roughly 6am a "day start" begins colliding with
 * breakfast, and a boundary that lands mid-meal is worse than no boundary.
 */
export const MAX_DAY_START_HOUR = 6;

/** One change to the boundary: day `from`, and every later day, start at `hour`. */
export interface DayBoundaryChange {
  /** First day governed by `hour`. Days before this keep the previous rule. */
  readonly from: DateKey;
  /** Hours past local midnight, 0..{@link MAX_DAY_START_HOUR}. */
  readonly hour: number;
}

/**
 * The boundary's full history, oldest first. Empty means "always midnight",
 * which is what every account has today and what the app did before ADR-0030.
 */
export type DayBoundary = readonly DayBoundaryChange[];

/** No boundary has ever been set: local midnight, forever. */
export const MIDNIGHT: DayBoundary = [];

/** Whether `hour` is a boundary this module will accept. */
export function isValidDayStartHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= MAX_DAY_START_HOUR;
}

/**
 * The boundary in force on a given calendar day.
 *
 * Selection is by the change's own `from` key, so this is a plain lookup and
 * not a function of any timestamp — which is what keeps it total and cheap.
 */
export function boundaryHourOn(key: DateKey, boundary: DayBoundary): number {
  let hour = 0;
  for (const change of boundary) {
    if (change.from <= key) hour = change.hour;
    else break;
  }
  return hour;
}

/**
 * Which day does this instant belong to?
 *
 * The replacement for `calendarDateKey(new Date())` wherever the answer means "the
 * user's day" rather than "the calendar date". Pass {@link MIDNIGHT} and it IS
 * `calendarDateKey` — see the note above.
 *
 * ## The transition, and why the changeover day is longer
 *
 * Moving the boundary from 0 to 3 on day D would, applied naively, push
 * instants in D's 00:00-03:00 window back onto D-1 — a day that is already
 * closed, already fed to the estimator, and whose ring the user has already
 * seen. Re-bucketing a past day is exactly what "forward only" exists to
 * prevent.
 *
 * So the changeover window keeps the OLD rule: day D runs from D 00:00 to
 * D+1 03:00, i.e. 27 hours, and every day after it runs the usual 24. This is
 * the only shape where no instant is lost, none is counted twice, and no day
 * before D moves — which the tests assert directly by sweeping every hour
 * across a change and checking the mapping is a partition.
 */
export function dayKeyAt(at: Date, boundary: DayBoundary): DateKey {
  const calendarKey = calendarDateKey(at);
  const hour = boundaryHourOn(calendarKey, boundary);
  if (hour === 0) return calendarKey;

  const shifted = new Date(at);
  shifted.setHours(shifted.getHours() - hour);
  const shiftedKey = calendarDateKey(shifted);

  // The changeover window: shifting would land on a day governed by an OLDER
  // rule, i.e. a day that is already closed. Keep the instant where the old
  // rule put it.
  if (boundaryHourOn(shiftedKey, boundary) !== hour) return calendarKey;

  return shiftedKey;
}

/**
 * Record a boundary change, taking effect on `from` and never before it.
 *
 * Rejects an invalid hour and rejects a `from` that is not after every change
 * already on file — rewriting or reordering history is precisely the thing this
 * shape exists to make impossible, so it is an error rather than a silent
 * re-sort. A change to the hour already in force is a no-op and returns the
 * same list, so a settings screen can call this unconditionally.
 */
export function setDayStartHour(
  boundary: DayBoundary,
  from: DateKey,
  hour: number,
): DayBoundary {
  if (!isValidDayStartHour(hour)) {
    throw new RangeError(`day start hour must be an integer 0..${MAX_DAY_START_HOUR}, got ${hour}`);
  }
  const last = boundary[boundary.length - 1];
  if (last && from <= last.from) {
    throw new RangeError(`day boundary changes are forward-only: ${from} is not after ${last.from}`);
  }
  if (boundaryHourOn(from, boundary) === hour) return boundary;
  return [...boundary, { from, hour }];
}

/**
 * The instant a day begins.
 *
 * Not simply "midnight plus the hour in force": on a changeover day the early
 * window keeps the OLD rule (see {@link dayKeyAt}), so the day begins at
 * midnight and runs long. Deriving this from the hour alone was the first
 * version of this file and the partition test caught it — `dayRange` claimed a
 * changeover day started at 03:00 while `dayKeyAt` was already assigning
 * 00:30 to it, so an instant sat outside the range of its own day.
 */
function dayStartsAt(key: DateKey, boundary: DayBoundary): Date {
  const hour = boundaryHourOn(key, boundary);
  const prevKey = calendarDateKey(addDays(parseYmd(key), -1));
  const start = parseYmd(key);
  if (boundaryHourOn(prevKey, boundary) === hour) start.setHours(start.getHours() + hour);
  return start;
}

/**
 * The half-open instant range `[start, end)` that a day key covers.
 *
 * Exported because "which logs belong to this day" is a query, and a query
 * written from `parseYmd(key)` plus 24 hours is wrong the moment a boundary
 * exists. Days are not all 24 hours long here: raising the boundary makes the
 * changeover day longer, lowering it makes the day before the change shorter,
 * and in both cases the timeline stays exactly covered.
 */
export function dayRange(key: DateKey, boundary: DayBoundary): { start: Date; end: Date } {
  const nextKey = calendarDateKey(addDays(parseYmd(key), 1));
  return { start: dayStartsAt(key, boundary), end: dayStartsAt(nextKey, boundary) };
}

/**
 * The boundary a profile is on.
 *
 * The seam between the pure derivation above and the two frontends. It is
 * deliberately **structurally typed** rather than taking `ProfileFields`: the
 * field does not exist on the profile yet (ADR-0030 step 3 — `ProfileFields`,
 * the Firestore mapper, and the `firestore.rules` validation that must be
 * deployed BEFORE any client writes it), and typing it structurally means this
 * function, its call sites, and the tests around them can all land first and
 * keep working unchanged the day the field appears.
 *
 * Until then every account reads {@link MIDNIGHT}, which {@link dayKeyAt} makes
 * byte-for-byte identical to the calendar date — so adopting this at a call
 * site changes nobody's numbers.
 */
export function dayBoundaryOf(
  profile: { readonly dayBoundary?: DayBoundary | null } | null | undefined,
): DayBoundary {
  return profile?.dayBoundary ?? MIDNIGHT;
}
