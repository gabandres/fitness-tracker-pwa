import { dayKeyAt, dayRange, MIDNIGHT, type DayBoundary } from './day-boundary';
import type { DateKey } from './date';

/**
 * Fasting history — the two questions you can ask a set of completed fasts,
 * and why they are two functions rather than one (ADR-0032, issue #97).
 *
 * ## Why this module exists at all
 *
 * Until #97 a fast was one nullable field on the profile, `fastStartedAt`, and
 * `breakFast` wrote `null` over it. The duration was destroyed at the exact
 * moment it became final — there was nothing to aggregate, so there was nothing
 * for this module to do. `users/{uid}/fasts` is the archive that makes these
 * questions answerable, and this is where they are answered for BOTH
 * frontends, per the standing rule that cross-frontend domain math lives in
 * `packages/core`. That matters more than usual here: the web app is frozen
 * for features (ADR-0022), and pure shared math is what keeps a frozen
 * frontend correct with nobody porting to it.
 *
 * ## A fast is an interval, and that is the whole design
 *
 * A fast crosses midnight routinely — that is the *normal* case, not the edge
 * one. So the stored shape is `{ startedAt, endedAt }` with a generated id, not
 * a per-day scalar keyed by date. Which day a fast counts towards is an
 * attribution DECISION, and a day-keyed document would bake that decision into
 * an identifier where it could never be revised without a migration.
 *
 * Keeping it here instead means the two functions below can disagree with each
 * other — deliberately — and either can be changed later by editing one pure
 * function and its tests, with no migration and no data loss.
 *
 * ## The two questions are not the same question
 *
 * - `completedFastHours` — "how long was the fast I finished today?" Attributed
 *   to the day the fast ENDED. This is the headline number: the one that goes
 *   in a History row and in the CSV, and the one a person would say out loud
 *   ("I broke a 16-hour fast this morning").
 * - `fastingOverlapHours` — "how much of this day did I spend fasting?"
 *   Computed by intersecting each interval with the day, so it is bounded to
 *   [0, 24] by construction and an overnight fast marks BOTH days.
 *
 * **Do not "fix" one into the other.** They are both correct and they are
 * answers to different questions. `CONTEXT.md` opens by forbidding two names
 * for one concept; this is the opposite case, two concepts that must not
 * collapse into one name — which is why neither is called "fasting hours".
 *
 * ## Why end-day for the headline, when the market leader uses start-day
 *
 * Zero — the most mature product in the category — attributes to the start day,
 * and BodyFast does too, so this diverges from the research knowingly. The
 * reasons: end-day matches how a person narrates a fast, and it puts the number
 * on the screen on the day she is looking at it. She ends the fast at noon
 * Tuesday and Tuesday gains "16h" immediately, rather than a day already past
 * quietly gaining a number she may never scroll back to.
 *
 * Nothing is lost by the choice, either: under start-day attribution *both*
 * days still read 0h for the whole overnight fast, because the fast is not over
 * yet. The known cost is that the start day's row carries no headline number,
 * and ADR-0032 pays that in the calendar — where `fastingOverlapHours` marks
 * both days — rather than by fudging the headline.
 *
 * ## What this module deliberately does NOT do
 *
 * - **It does not discard a fast for being too short or too long.** Zero
 *   deletes fasts past 24 hours and Simple refuses to log one under 12; the
 *   review complaints ADR-0032 quotes are the result. Every fast the user ended
 *   is counted, however long. The 14-day ceiling in `firestore.rules` is a
 *   corruption guard on the write path, not a product opinion, and it is far
 *   outside any real fast.
 * - **It does not infer a fast from gaps between meals.** A number sourced from
 *   missing logs is still sourced from missing logs.
 * - **It does not know about goals, protocols or streaks.** Phase 1 is the
 *   record and the read. If a streak is ever wanted, ADR-0032 says to start
 *   from Zero's gap rule (no more than 24h between logged fasts) rather than
 *   inventing a per-day attainment rule, precisely because that sidesteps the
 *   attribution question this file is about.
 */

/**
 * One completed fast. A value of this shape exists ONLY for a fast that is
 * over — the in-progress fast stays on `Profile.fastStartedAt`, exactly where
 * it has always been, and contributes nothing to any number here until it ends.
 *
 * `source` distinguishes a fast the timer measured from one a person asserted
 * by hand, the same distinction `dailySleep.source` already makes. It is
 * optional because it is enumerated in rules rather than trusted, and a reader
 * must tolerate its absence.
 */
export interface Fast {
  /** Firestore document id. Absent on a value not yet written. */
  readonly id?: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly source?: FastSource;
}

export type FastSource = 'timer' | 'manual';

/**
 * The interval ceiling `firestore.rules` enforces, in milliseconds, exported so
 * the WRITERS can agree with it rather than discover it at commit time.
 *
 * This constant is load-bearing in a way a bounds constant usually is not.
 * `breakFast` is a batch — create the fast document, null `fastStartedAt`, one
 * atomic commit. A document the rules reject does not merely fail to save: it
 * fails the whole batch, so `fastStartedAt` stays set and the user's timer runs
 * forever with no way to stop it. A writer must therefore check this bound
 * ITSELF and drop the record rather than hand Firestore a write it will refuse.
 * `isStorableFast` is that check.
 */
export const MAX_FAST_MS = 14 * 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

function ms(d: Date): number {
  return d instanceof Date ? d.getTime() : NaN;
}

/**
 * Is this interval one `firestore.rules` will accept?
 *
 * Called by the write path BEFORE building the batch, which is the only place
 * it can do any good — see `MAX_FAST_MS`. It is deliberately the same three
 * conditions the rules check, in the same order, so the two can be read against
 * each other:
 *
 * - both instants are real dates,
 * - the fast ended strictly after it started (a zero-length or inverted
 *   interval is not a short fast, it is a corrupt one, and it would poison
 *   every average it ever entered),
 * - and it is under the 14-day corruption ceiling.
 *
 * A fast that fails this is dropped and the timer is cleared. That is a
 * deliberate choice of which failure to take: an interval this fails is a timer
 * someone left running for a fortnight or a clock that went backwards, and
 * refusing to clear it would leave the user stuck looking at a counter they
 * cannot stop — which is worse than losing a record that was never a fast.
 */
export function isStorableFast(startedAt: Date, endedAt: Date): boolean {
  const a = ms(startedAt);
  const b = ms(endedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b > a && b - a <= MAX_FAST_MS;
}

/** Length of one fast in hours, unrounded. Negative and non-finite intervals
 *  read as 0 so a corrupt row can never subtract from a total. */
export function fastLengthHours(fast: Fast): number {
  const a = ms(fast.startedAt);
  const b = ms(fast.endedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / HOUR_MS;
}

/**
 * **The headline number.** Total length of the fasts that ENDED on `dateKey`.
 *
 * One fast lands on exactly one day, so sums, averages and weekly figures over
 * this are correct by construction — there is no double counting to reason
 * about and no partial day to apportion. An in-progress fast contributes
 * nothing, because an in-progress fast has no document.
 *
 * Returns 0 when no fast ended that day. A caller that needs to distinguish
 * "no fast" from "a fast of zero length" should ask `fastsEndingOn(...).length`
 * — zero-length fasts cannot be stored, so in practice 0 means none, but the
 * distinction is the caller's to draw rather than this function's to encode as
 * a null.
 */
export function completedFastHours(
  fasts: readonly Fast[],
  dateKey: DateKey,
  boundary: DayBoundary = MIDNIGHT,
): number {
  let total = 0;
  for (const f of fasts) {
    if (!Number.isFinite(ms(f.endedAt))) continue;
    if (dayKeyAt(f.endedAt, boundary) !== dateKey) continue;
    total += fastLengthHours(f);
  }
  return total;
}

/** The fasts that ended on `dateKey`, in the order given. The list behind
 *  `completedFastHours`, for a caller that needs the intervals themselves
 *  rather than their sum — a History row that lists them, or an editor. */
export function fastsEndingOn(
  fasts: readonly Fast[],
  dateKey: DateKey,
  boundary: DayBoundary = MIDNIGHT,
): readonly Fast[] {
  return fasts.filter(
    (f) => Number.isFinite(ms(f.endedAt)) && dayKeyAt(f.endedAt, boundary) === dateKey,
  );
}

/**
 * **The calendar number, and NOT the headline one.** How many of `dateKey`'s
 * own hours were spent fasting, by intersecting each interval with the day.
 *
 * Bounded to [0, 24] by definition — it is a fraction of a day, not a duration
 * — so an 8pm→12pm fast contributes 4h to the first day and 12h to the second.
 * That is what makes it right for a month grid, where the question is "was I
 * fasting during this day" and an overnight fast should mark both, and wrong
 * for a History row, where a person expects to see the length of the fast she
 * finished rather than a slice of it.
 *
 * This is the rule LIFE Fasting Tracker documents — the only documented
 * attribution rule found anywhere in the category — and ADR-0032 adopts it
 * here, for the calendar, while deliberately NOT adopting it for the headline.
 *
 * Boundary-aware via `dayRange`, so on a 3 AM day boundary "this day" is
 * 03:00→03:00 and the intersection follows the user's day rather than the
 * calendar's.
 */
export function fastingOverlapHours(
  fasts: readonly Fast[],
  dateKey: DateKey,
  boundary: DayBoundary = MIDNIGHT,
): number {
  const { start, end } = dayRange(dateKey, boundary);
  const from = start.getTime();
  const to = end.getTime();
  let total = 0;
  for (const f of fasts) {
    const a = ms(f.startedAt);
    const b = ms(f.endedAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const overlap = Math.min(b, to) - Math.max(a, from);
    if (overlap > 0) total += overlap / HOUR_MS;
  }
  return total;
}

/** Sort newest-ended first — the order History reads in, and the order the
 *  bounded `orderBy('endedAt', 'desc')` subscription already delivers. Provided
 *  so a caller assembling fasts from more than one source does not re-derive
 *  the comparator and get it backwards. */
export function sortFastsByEndDesc(fasts: readonly Fast[]): Fast[] {
  return [...fasts].sort((a, b) => ms(b.endedAt) - ms(a.endedAt));
}

// ─────────────────────────── The Trends window ───────────────────────────
//
// Everything below is the read side of the fasting card (ADR-0034, issue #98).
// It is here rather than in a `fasting-trends.ts` because it is the same
// concept — a set of completed fasts, and which day each belongs to — and
// splitting it would put the attribution rule in one file and the only consumer
// of that rule in another.
//
// The gate is a pure function returning `null`, per ADR-0034 decision 3, so the
// component holds no thresholds and the whole card is testable without a
// renderer.

/** Days of history the card draws. Fourteen, matching the sleep card and the
 *  RecentLogs cache, so Trends does not present two windows of different
 *  lengths side by side and invite a comparison between them. */
export const FASTING_WINDOW_DAYS = 14;

/**
 * Completed fasts needed before a CARD is drawn rather than a stub row.
 *
 * Three, matching `SLEEP_CARD_MIN_NIGHTS`. Below it there is a strip with one
 * or two bars in it, which reads as a broken chart rather than as a small
 * amount of data — and ADR-0034's stub row can say the same thing honestly in
 * one sentence, with somewhere to go.
 */
export const FASTING_CARD_MIN_FASTS = 3;

/**
 * The strip's fixed ceiling, in hours.
 *
 * Fixed rather than the window's own maximum, for the reason
 * `SLEEP_STRIP_CEILING_HOURS` gives: a self-scaling axis redraws a week of
 * 13-hour fasts to look exactly like a week of 20-hour ones. A longer fast
 * clamps rather than rescaling everything around it.
 */
export const FASTING_STRIP_CEILING_HOURS = 24;

/** One column of the strip. `hours` is null when no fast ENDED that day — which
 *  is not the same as a zero-hour fast and must not be drawn as one. */
export interface FastingDay {
  readonly dateKey: DateKey;
  readonly hours: number | null;
}

export interface FastingWindow {
  readonly days: readonly FastingDay[];
  /** How many of `days` had a fast end on them. */
  readonly daysWithFast: number;
  /** Mean length of the fasts that ended in the window. 0 when there are none. */
  readonly meanHours: number;
  /** Median length, the reference line the card draws. The user's OWN median,
   *  never a 16:8 or OMAD standard — this product asserts no protocol. */
  readonly medianHours: number;
  /** The longest single fast in the window. 0 when there are none. */
  readonly longestHours: number;
  /** The shortest. 0 when there are none.
   *
   *  Exists so the card can state a RANGE, which is the one descriptive thing
   *  worth saying about a set of fasts that are all roughly the same length.
   *  A chart of twelve similar numbers against a fixed ceiling shows nothing —
   *  measured on a device with a real 16:8 habit, every bar landed between 65%
   *  and 73% of the strip and the variation was invisible. The sentence is
   *  what carries the meaning; the strip is what makes it checkable. */
  readonly shortestHours: number;
}

/**
 * The last N days of completed fasts, ready to draw.
 *
 * Uses `completedFastHours` per day, so it inherits the end-day attribution
 * rule and the guarantee that comes with it: **one fast contributes to exactly
 * one column**, so the strip cannot show the same fast twice and the mean is a
 * mean of fasts rather than of overlapping slices. Using
 * `fastingOverlapHours` here instead would draw a prettier, denser chart that
 * silently double-counts every overnight fast — which is the specific mistake
 * `fasting-history.test.ts` exists to make loud.
 *
 * `dateKeys` is passed in rather than derived, so the caller owns the boundary
 * and the clock. Every other window on Trends works this way.
 */
export function fastingWindow(
  fasts: readonly Fast[],
  dateKeys: readonly DateKey[],
  boundary: DayBoundary = MIDNIGHT,
): FastingWindow {
  const days: FastingDay[] = [];
  const lengths: number[] = [];
  for (const dateKey of dateKeys) {
    const ending = fastsEndingOn(fasts, dateKey, boundary);
    if (!ending.length) {
      days.push({ dateKey, hours: null });
      continue;
    }
    // Two fasts ending on one day sum into that column, matching
    // `completedFastHours`. Each still counts once toward the mean, because the
    // mean is over FASTS and the column is over DAYS — the two answer different
    // questions and the footer says which is which.
    const total = ending.reduce((sum, f) => sum + fastLengthHours(f), 0);
    days.push({ dateKey, hours: total });
    for (const f of ending) lengths.push(fastLengthHours(f));
  }
  return {
    days,
    daysWithFast: days.filter((d) => d.hours != null).length,
    meanHours: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
    medianHours: medianOf(lengths),
    longestHours: lengths.length ? Math.max(...lengths) : 0,
    shortestHours: lengths.length ? Math.min(...lengths) : 0,
  };
}

/** How many completed fasts fall in the window. The number the card gate and
 *  the footer both read — distinct from `daysWithFast`, because two fasts can
 *  end on one day. */
export function fastsInWindow(
  fasts: readonly Fast[],
  dateKeys: readonly DateKey[],
  boundary: DayBoundary = MIDNIGHT,
): number {
  let n = 0;
  for (const dateKey of dateKeys) n += fastsEndingOn(fasts, dateKey, boundary).length;
  return n;
}

/** A strip column's height as a 0..1 fraction of {@link FASTING_STRIP_CEILING_HOURS}. */
export function fastingBarFraction(hours: number | null): number {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return 0;
  return Math.min(1, hours / FASTING_STRIP_CEILING_HOURS);
}

/**
 * Split a duration into whole hours and minutes for display.
 *
 * Deliberately NOT `sleepHoursParts`, which is the same four lines. A fasting
 * card importing a function named for sleep is how one concept acquires two
 * names and two concepts acquire one — the failure `CONTEXT.md` opens by
 * forbidding. Four lines of arithmetic is a cheaper price than that.
 */
export function fastHoursParts(hours: number): { hours: number; minutes: number } {
  if (!Number.isFinite(hours) || hours <= 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.round(hours * 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function medianOf(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
