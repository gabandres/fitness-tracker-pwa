import type { DaySummary } from './day-summary';

/**
 * Sleep against intake — one honest comparison, and the arithmetic behind it
 * (ADR-0033, issue #81).
 *
 * ## The claim, and the claims this refuses to make
 *
 * **On your shorter nights, did you eat more?** That is the whole question.
 * The answer is a paired contrast between the user's own days: two group means
 * and their difference, in the units they already read. It is arithmetic they
 * could redo from the CSV export, which is the test ADR-0033 uses for whether a
 * claim is honest.
 *
 * There is deliberately **no score, no correlation coefficient, no p-value, no
 * R², and no causal sentence.** Every scored sleep app builds its number from
 * independent sensor signals Ignia does not have — Oura's seven contributors,
 * Apple's three components, Fitbit's sleeping heart rate — and what is left
 * without the sensors is duration, which is the one thing `dailySleep` stores.
 * A 0–100 from a single duration implies sub-components that do not exist. This
 * is written here as a rule rather than in a commit message so the next reader
 * does not "improve" the card by adding one.
 *
 * **Nothing here reaches a target.** No export of this module is read by
 * `dailyTargets`, `tdee`, `weekly-insights` or `day-summary`, and
 * `sleep-target-independence.test.ts` fails the build if that changes. Same
 * seam ADR-0026 decision 5 draws for imported energy and ADR-0024 for the
 * activity multiplier, drawn in advance because the plausible optimisation is
 * already obvious: *we can see they slept badly, so soften the target.* There
 * is no evidence base for it, and a correction applied to a number the user
 * cannot audit is exactly the silent degradation ADR-0030 was written about.
 *
 * ## One window, so the picture is the sentence
 *
 * ADR-0033 shipped with decision 3 naming a 60-day window and decision 4
 * drawing a 14-night strip whose highlighted bars are "*exactly* the nights the
 * sentence is about". **Those cannot both hold**, and the conflict was resolved
 * by the owner on 2026-08-25 in favour of one window of
 * {@link SLEEP_WINDOW_DAYS} days for both. Three things pointed the same way:
 * the mockup's own numbers (5 short + 6 longest out of 13 drawn) only close at
 * 14; the "highlighted bars ARE the claim" property is the strongest idea in
 * the design and it is false the moment the windows differ; and ADR-0033 §1
 * records that the importers fetch **14 days by default**, so a 60-day window
 * would mostly be empty.
 *
 * The gate moved 14 → {@link SLEEP_MIN_NIGHTS} in the same decision. At a
 * 14-day window a 14-night gate means a *complete* fortnight with no gaps,
 * which the mockup's own State 1 ("13 of 14 nights", sentence shown) is not.
 * Twelve is that state's number, not an invented one.
 */

/**
 * The window everything here runs over, in days.
 *
 * A UI choice and a data fact at once: `fetchOuraDaily` defaults to 14 days and
 * the health importer's first pass is the same order, so a wider window would
 * be describing history that was never fetched. See the module note.
 */
export const SLEEP_WINDOW_DAYS = 14;

/**
 * Nights (with a reading AND a fully-logged day) needed before the comparison
 * sentence renders.
 *
 * Below a fortnight the split groups are single-digit and one bad night moves
 * the answer. Twelve rather than fourteen leaves room for the gaps a real
 * importer produces without abandoning the fortnight.
 */
export const SLEEP_MIN_NIGHTS = 12;

/** Nights each side of the median split must have. A 4-night group's mean is a
 *  coin flip. */
export const SLEEP_MIN_GROUP = 5;

/**
 * How far apart the two group means must be, in kcal, before the difference is
 * worth stating.
 *
 * **This is the softest number in ADR-0033 and it is unvalidated — say so, do
 * not quietly rely on it.** The reasoning: portion-estimate error on a single
 * logged day is plausibly ±200 kcal, a 6-day group mean shrinks that to roughly
 * ±80, and 150 is about two standard errors. Defensible, and not measured. The
 * owner's call on 2026-08-25 was to ship this value and calibrate it against
 * real history later, which is why it is one named constant rather than a
 * literal inside the gate.
 */
export const SLEEP_MIN_KCAL_GAP = 150;

/**
 * Nights below which there is no card at all — one row instead (ADR-0033
 * decision 6).
 *
 * Most users have nothing, and a permanently empty widget on a screen that
 * already carries a hero, an activity correction, This Week, Budget and Coach
 * is the generic-dashboard failure. From the third night the card is present
 * and never changes shape again; what arrives at the evidence bar is one
 * sentence.
 */
export const SLEEP_CARD_MIN_NIGHTS = 3;

/** Bar-height ceiling for the strip, in hours. Fixed, not the user's max: a
 *  self-scaling chart makes a bad week look like a good one. */
export const SLEEP_STRIP_CEILING_HOURS = 10;

/** One night's stored number, as the ledger holds it. */
export interface SleepEntry {
  hours: number;
  /** Absent on every document written before 2026-08-24; those read `manual`
   *  (`readSleepSource`). */
  source: 'manual' | 'import';
}

/** One column of the strip. `hours: null` is a night with NO reading — drawn as
 *  a hairline at the baseline, never as a zero and never interpolated. */
export interface SleepNight {
  dateKey: string;
  hours: number | null;
}

/** Where the window's numbers came from, at window level. Deliberately not
 *  per-provider: `dailySleep` has no `provider` field, so a card cannot
 *  honestly say "via Oura" the way a cardio block can (ADR-0033 §1). */
export type SleepProvenance = 'imported' | 'typed' | 'both';

export interface SleepWindow {
  /** Oldest first, exactly {@link SLEEP_WINDOW_DAYS} long, gaps included. */
  nights: readonly SleepNight[];
  /** How many of those carry a reading. The footer's "N of 14 nights". */
  nightsWithReading: number;
  /** Mean of the readings. `0` when there are none — callers gate on
   *  `nightsWithReading` first. */
  meanHours: number;
  /** Median of the readings, and the line the strip draws. */
  medianHours: number;
  /** Null when there are no readings at all. */
  provenance: SleepProvenance | null;
}

export interface SleepContrast {
  /** Nights strictly below the median. */
  shortCount: number;
  /** Nights strictly above it. */
  longCount: number;
  /** Mean logged calories on the days paired with each group, rounded. */
  shortMeanKcal: number;
  longMeanKcal: number;
  /** `shortMeanKcal − longMeanKcal`. Positive means more was eaten after the
   *  shorter nights. Signed on purpose — the card's copy branches on it, and a
   *  magnitude alone would let it say "more" when the truth is "less". */
  differenceKcal: number;
  /** The keys in the SHORT group. The strip tints exactly these, which is what
   *  makes the chart the claim drawn rather than decoration beside it. */
  shortKeys: readonly string[];
  /** The split point, for the reference line. */
  medianHours: number;
}

/**
 * The window the card draws: one column per day, oldest first, gaps preserved.
 *
 * `dateKeys` is passed in rather than derived so the caller owns the day
 * boundary — this module never asks what today is. ADR-0033 decision 5: **the
 * card reads whatever `dateKey` is stored and never re-derives it.** A night is
 * filed by the day the sleeper woke, by all three importers and by the manual
 * writer alike, so the night and the eating day that follows it already share a
 * key at every supported boundary. There is no lag term here because there does
 * not need to be one.
 */
export function sleepWindow(
  sleepByDay: Readonly<Record<string, SleepEntry>>,
  dateKeys: readonly string[],
): SleepWindow {
  const nights: SleepNight[] = [];
  const readings: number[] = [];
  let imported = 0;
  let typed = 0;

  for (const dateKey of dateKeys) {
    const entry = sleepByDay[dateKey];
    const hours = entry != null && Number.isFinite(entry.hours) && entry.hours > 0
      ? entry.hours
      : null;
    nights.push({ dateKey, hours });
    if (hours == null) continue;
    readings.push(hours);
    if (entry?.source === 'import') imported++;
    else typed++;
  }

  return {
    nights,
    nightsWithReading: readings.length,
    meanHours: readings.length === 0 ? 0 : sum(readings) / readings.length,
    medianHours: median(readings),
    provenance:
      readings.length === 0 ? null : imported && typed ? 'both' : imported ? 'imported' : 'typed',
  };
}

/**
 * The comparison, or `null` when the evidence does not support one.
 *
 * Every gate in ADR-0033 decision 3 lives here rather than in the component, so
 * the card has no thresholds in it and the bar is testable without a renderer.
 * A caller that gets `null` renders the card without its sentence — the
 * headline, the strip and the footer are unchanged, which is the only way a
 * binary claim can approximate `measuredConfidence`'s ramp: **the layout never
 * jumps, only the paragraph arrives.**
 *
 * The four gates, in the order they are cheapest to fail:
 *
 * 1. **The day paired with a night must be fully logged** — `mealCount > 0 &&
 *    totalCalories > 0`, the same predicate `loggedThisWeek` already uses. An
 *    unlogged day contributes a zero that is not a measurement of anything.
 * 2. **At least {@link SLEEP_MIN_NIGHTS} such nights.**
 * 3. **At least {@link SLEEP_MIN_GROUP} nights each side of the median.**
 * 4. **The two means at least {@link SLEEP_MIN_KCAL_GAP} apart.**
 *
 * **The split is at the user's own median and ties are dropped.** A night equal
 * to the median joins neither group, so the two groups cannot share a value and
 * "shorter" means shorter than *this person's* normal — never shorter than a
 * population 7- or 8-hour standard, which Ignia has no authority to assert.
 */
export function sleepIntakeContrast(
  sleepByDay: Readonly<Record<string, SleepEntry>>,
  days: readonly DaySummary[],
): SleepContrast | null {
  // Only nights whose own day is fully logged: the pairing is the claim, and
  // half a pair is not evidence.
  const paired: { dateKey: string; hours: number; kcal: number }[] = [];
  for (const day of days) {
    if (!(day.mealCount > 0) || !(day.totalCalories > 0)) continue;
    const entry = sleepByDay[day.dateKey];
    if (entry == null || !Number.isFinite(entry.hours) || entry.hours <= 0) continue;
    paired.push({ dateKey: day.dateKey, hours: entry.hours, kcal: day.totalCalories });
  }
  if (paired.length < SLEEP_MIN_NIGHTS) return null;

  const mid = median(paired.map((p) => p.hours));
  const short = paired.filter((p) => p.hours < mid);
  const long = paired.filter((p) => p.hours > mid);
  if (short.length < SLEEP_MIN_GROUP || long.length < SLEEP_MIN_GROUP) return null;

  const shortMeanKcal = Math.round(sum(short.map((p) => p.kcal)) / short.length);
  const longMeanKcal = Math.round(sum(long.map((p) => p.kcal)) / long.length);
  const differenceKcal = shortMeanKcal - longMeanKcal;
  if (Math.abs(differenceKcal) < SLEEP_MIN_KCAL_GAP) return null;

  return {
    shortCount: short.length,
    longCount: long.length,
    shortMeanKcal,
    longMeanKcal,
    differenceKcal,
    shortKeys: short.map((p) => p.dateKey),
    medianHours: mid,
  };
}

/**
 * Hours as a whole number of hours and minutes, for a duration headline.
 *
 * Split here rather than formatted here because the separator and the unit
 * abbreviations are translated — `6h 39m` in en, and neither `h` nor `m` is
 * safe to hard-code for es-PR or pt-BR. Rounds to the nearest minute and
 * carries 60 up, so 6.999 h is `7h 0m` and never `6h 60m`.
 */
export function sleepHoursParts(hours: number): { hours: number; minutes: number } {
  if (!Number.isFinite(hours) || hours <= 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.round(hours * 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/**
 * A strip column's height as a 0..1 fraction of {@link SLEEP_STRIP_CEILING_HOURS}.
 *
 * The ceiling is fixed rather than the window's own maximum, deliberately: a
 * self-scaling axis redraws a four-hour week to look exactly like an eight-hour
 * one, which is the opposite of what a chart beside an honest sentence is for.
 * A night above the ceiling clamps rather than rescaling everything else.
 */
export function sleepBarFraction(hours: number | null): number {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return 0;
  return Math.min(1, hours / SLEEP_STRIP_CEILING_HOURS);
}

function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

/** Median of a list, 0 for empty. Copies before sorting — callers pass arrays
 *  they still own. */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
