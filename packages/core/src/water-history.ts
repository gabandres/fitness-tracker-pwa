import type { DateKey } from './date';

/**
 * Water history — the fourteen-day window the Trends water card draws
 * (issue #115 §3).
 *
 * ## Why this is a third module and not a parameter on the other two
 *
 * `sleep-intake` and `fasting-history` compute the same *shape* — a strip, a
 * median, a coverage count — and the temptation is to write one generic
 * `scalarWindow`. It is the wrong economy. The three differ in exactly the
 * places that matter: sleep carries provenance (`source`) and pairs against
 * intake, fasting attributes by the day a fast ENDED and can hold two records
 * in one column, and water is a running total the user edits all day and can
 * only ever be one number per date key. A shared abstraction would have to
 * express all three and would end up parameterised on every line that carries
 * meaning — which is how one concept acquires two names and two concepts
 * acquire one, the failure `CONTEXT.md` opens by forbidding. Forty lines of
 * arithmetic is the cheaper price, the same call `fastHoursParts` already made
 * against `sleepHoursParts`.
 *
 * ## What the card is allowed to claim, and what it is not
 *
 * **No goal and no target.** Ignia has no daily water target, does not ask for
 * one, and must not imply one. That is not an omission to fill in later: the
 * product asserts no protocol for fasting either (ADR-0032), and a hydration
 * goal is exactly the forward-pressure mechanism `UX_AUDIT.md` §S12 rejects and
 * the Milestones work (#108) went on to ban in code. The reference line is the
 * user's OWN median, like both sibling cards.
 *
 * **No streak, no ring, no "you are behind".** A day with no water logged is a
 * day with no *record*, not a day someone did not drink — the app cannot tell
 * those apart and neither can this module. That distinction is the reason
 * {@link WaterDay.flOz} is nullable and is never zero-filled.
 *
 * ## The ceiling is fixed, and 128 was rejected on purpose
 *
 * {@link WATER_STRIP_CEILING_FLOZ} is fixed rather than the window's own
 * maximum, for the reason `SLEEP_STRIP_CEILING_HOURS` gives: a self-scaling
 * axis redraws a light week to look exactly like a heavy one, and the tallest
 * bar is always full height no matter what it holds.
 *
 * **The value was measured, not chosen.** Across all 43 accounts on 2026-08-30
 * (`scripts/trends-water-states.mjs`), a logged day ran min 2 · p50 48 · p90 72
 * · max 96 fl oz. So 100 clips nothing that has ever been logged, puts a
 * typical day near the middle of the strip, and lets a genuinely heavy day
 * clamp rather than rescaling everyone else's.
 *
 * **128 fl oz — one US gallon — is the obvious round number and is the one to
 * avoid.** "A gallon a day" is a fitness-culture target, and an axis topping out
 * there turns every honest bar into a shortfall against a goal this product does
 * not hold. A scale bound is not supposed to be a verdict. 100 carries no such
 * freight.
 */

/** Days of history the card draws. Fourteen, matching the sleep and fasting
 *  cards and the RecentLogs cache, so Trends never presents two windows of
 *  different lengths side by side and invites a comparison between them. */
export const WATER_WINDOW_DAYS = 14;

/**
 * Days with water logged before a CARD is drawn rather than a stub row.
 *
 * Three, matching `SLEEP_CARD_MIN_NIGHTS` and `FASTING_CARD_MIN_FASTS`. Below
 * it a strip holds one or two bars, which reads as a broken chart rather than
 * as a small amount of data.
 *
 * **This bar is the whole feature for most people, and that is measured.** Of
 * 43 accounts, 34 (79%) have no water in a fourteen-day window at all and 5 more
 * fall short of three days — so 91% meet a row, not a chart. Four accounts clear
 * it, which is twice the fasting card's audience on the same day.
 */
export const WATER_CARD_MIN_DAYS = 3;

/** Bar-height ceiling for the strip, in fl oz. See the header for why it is
 *  fixed, why it is 100, and why it is deliberately not 128. */
export const WATER_STRIP_CEILING_FLOZ = 100;

/** One column of the strip. `flOz` is null on a day with NO record — drawn as a
 *  hairline at the baseline, never as a zero and never interpolated. A zero
 *  would claim the user drank nothing, which is a claim about them rather than
 *  about the data. */
export interface WaterDay {
  readonly dateKey: DateKey;
  readonly flOz: number | null;
}

export interface WaterWindow {
  /** Oldest first, exactly {@link WATER_WINDOW_DAYS} long, gaps preserved. */
  readonly days: readonly WaterDay[];
  /** How many of `days` carry a record. The footer's "N of 14 days". */
  readonly daysLogged: number;
  /** Mean over the days that carry a record. 0 when there are none — callers
   *  gate on `daysLogged` first. */
  readonly meanFlOz: number;
  /** Median over the same days, and the line the strip draws. The user's OWN
   *  median, never a population or protocol figure. */
  readonly medianFlOz: number;
  /** The lightest logged day. 0 when there are none. */
  readonly lowestFlOz: number;
  /** The heaviest. 0 when there are none.
   *
   *  These two exist so the card can state a RANGE, which is the one
   *  descriptive thing worth saying about a set of days that are all roughly
   *  alike. The fasting card learned this the expensive way: a real 16:8 habit
   *  drew twelve bars between 65% and 73% of the strip and the variation was
   *  invisible, so the sentence had to carry the meaning and the strip had to
   *  make it checkable. Water is MORE prone to that, not less — a consistent
   *  drinker's fourteen bars are near-identical by definition. */
  readonly highestFlOz: number;
}

/**
 * The last N days of water, ready to draw.
 *
 * `dateKeys` is passed in rather than derived, so the caller owns the day
 * boundary and the clock — every other window on Trends works this way, and the
 * one that did not keyed the sleep card and the insight cards to two different
 * calendars.
 *
 * **The stored key is read, never re-derived.** `dailyWater/{dateKey}` is
 * written by the day the user was in when they logged it, so a boundary-aware
 * `dateKeys` and a boundary-aware writer already agree; recomputing a day here
 * would be inventing a second opinion about which day a glass of water belonged
 * to.
 *
 * A non-positive or non-finite stored value is a gap, not a zero: `setDailyWater`
 * clamps to a valid range, but a reader that trusts every historic document to
 * have been written by the current writer is a reader that can be surprised.
 */
export function waterWindow(
  waterByDay: Readonly<Record<string, number>>,
  dateKeys: readonly DateKey[],
): WaterWindow {
  const days: WaterDay[] = [];
  const amounts: number[] = [];

  for (const dateKey of dateKeys) {
    const stored = waterByDay[dateKey];
    const flOz = typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null;
    days.push({ dateKey, flOz });
    if (flOz != null) amounts.push(flOz);
  }

  return {
    days,
    daysLogged: amounts.length,
    meanFlOz: amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0,
    medianFlOz: medianOf(amounts),
    lowestFlOz: amounts.length ? Math.min(...amounts) : 0,
    highestFlOz: amounts.length ? Math.max(...amounts) : 0,
  };
}

/** A strip column's height as a 0..1 fraction of {@link WATER_STRIP_CEILING_FLOZ}. */
export function waterBarFraction(flOz: number | null): number {
  if (flOz == null || !Number.isFinite(flOz) || flOz <= 0) return 0;
  return Math.min(1, flOz / WATER_STRIP_CEILING_FLOZ);
}

function medianOf(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
