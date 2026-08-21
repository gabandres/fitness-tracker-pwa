/**
 * The "maintenance" line for Today — the one number that answers *am I above
 * or below my own burn today*, as opposed to above or below my target.
 *
 * ## Why this is a separate thing from the target
 *
 * Ignia already shows maintenance as the hero on Trends, which is the detail
 * screen. What it never showed was the number on the screen people actually
 * open. That is the shape the category settled on: MacroFactor puts an
 * Expenditure widget on the dashboard and opens a dedicated Expenditure screen
 * when you tap it, and pairs it with an Energy Balance widget that reads intake
 * against expenditure rather than against the target. Ignia had the detail half
 * and was missing the dashboard half.
 *
 * The distinction matters because a target can be clamped by a floor while
 * maintenance is not: a user whose floor sits above their measured burn is at
 * their target and at maintenance simultaneously, losing nothing, with no
 * screen saying so.
 *
 * ## No math is invented here
 *
 * Every number below already existed — `calculateTdee` produced the
 * maintenance figure and the day summary produced the intake. This module only
 * decides *whether it is honest to show them together*, which is a rule worth
 * having in one place rather than in two view layers.
 */
import type { TdeeResult } from './tdee';

export interface MaintenanceView {
  /** Measured maintenance (kcal/day). */
  maintenance: number;
  /** Today's consumed kcal. */
  consumed: number;
  /**
   * `consumed - maintenance` — negative is a deficit, positive a surplus — or
   * **null before anything has been logged today**.
   *
   * Null rather than the arithmetic answer because the arithmetic answer is
   * useless: at 8am it reads "2,143 under your burn", which is true, says
   * nothing, and would greet the user every single morning. Caught by looking
   * at the rendered screen rather than at the function. The maintenance figure
   * still shows — that part is worth seeing on an empty day.
   */
  delta: number | null;
  /**
   * Whether the estimate met the logging-completeness bar. False does NOT mean
   * hide it — it means present it softly. The number is still derived from this
   * user's own data; it is just built on a patchier record.
   */
  reliable: boolean;
  /** Logged days the estimate was built from, and the calendar span they are
   *  spread across. Present so an unreliable reading can say WHY it is rough
   *  instead of just that it is: "28 of 49 days". Null when the TDEE result
   *  did not carry a completeness figure. */
  loggedDays: number | null;
  spanDays: number | null;
  /**
   * Weigh-ins the estimate threw away as implausible, or null when the TDEE
   * result did not report a count.
   *
   * Surfaced because a non-zero count is the one warning that fires while
   * everything else looks fine. Measured: a two-week break with a real 4 lb
   * gain makes the robust guard discard **all seven** post-break weigh-ins —
   * the step looks exactly like seven bad readings against a window that is
   * mostly the old plateau — and the result still reports `reliable: true`.
   * The number was already computed and displayed nowhere.
   *
   * It does NOT mean the estimate is wrong. It means the estimate is not
   * describing the last three weeks, which is a different and more useful
   * thing to be able to say.
   */
  weighInsDropped: number | null;
  /**
   * True when the target derived from this maintenance figure was deliberately
   * held back — `confidence < 1`, so part of the estimate is the formula anchor
   * rather than this user's own measurement.
   *
   * Distinct from `reliable`, and the difference is the whole point of having
   * both. `reliable` says *the record behind this number is patchy*.
   * `provisional` says *and we therefore did not act on it at full strength*.
   * Until 2026-08-19 only the first was true: the app said the estimate was
   * rough and then shipped the rough number as the day's food anyway.
   */
  provisional: boolean;
  /** 0..1. How much of the estimate is this user's own data; the remainder is
   *  the formula anchor. 1 ⇒ nothing was held back. */
  confidence: number;
  /**
   * True when the estimate's 95% interval is too wide to treat as a fresh
   * measurement, even after the window widened to look at more days.
   *
   * Stronger than {@link reliable} and than {@link provisional}, and it
   * subsumes both: those describe how patchy the RECORD is, this describes how
   * wide the ANSWER is. An account can log every single day and still land here
   * if the scale is noisy enough, which is why completeness could never have
   * caught it — `confidence` read 0.957 on the account that reported 2,509 off
   * an interval of 1,775..3,242.
   */
  holding: boolean;
}

/**
 * The maintenance line, or `null` when there is nothing honest to show.
 *
 * Gated on `source === 'measured'` on purpose. A `formula` figure is a
 * population average wearing this user's height and weight, and a `seed` figure
 * is the hardcoded 2,450 that stands in before there is any data at all.
 * Either would read on Today as *observed*, which is exactly the claim it
 * cannot support — and this app's whole pitch for the number is that it is
 * measured rather than assumed.
 *
 * `consumed` comes from the day summary; a day with nothing logged yet still
 * returns a view, because "0 against 1,870" is a true and useful statement at
 * 8am.
 */
export function maintenanceView(tdee: TdeeResult, consumedKcal: number): MaintenanceView | null {
  if (tdee.source !== 'measured' || tdee.trueTdee <= 0) return null;
  const consumed = Math.max(0, Math.round(consumedKcal));
  return {
    maintenance: tdee.trueTdee,
    consumed,
    delta: consumed > 0 ? consumed - tdee.trueTdee : null,
    // No `=== true` / `?? null` guards below: the early return above narrows
    // `tdee` to `MeasuredTdee`, where every one of these is REQUIRED. They were
    // defences against a shape that can no longer exist — a formula or seed
    // result reaching this line — and the compiler now rules that out instead.
    reliable: tdee.reliable,
    // The counts, not the percentage: "28 of 49 days" tells a user that three
    // weeks of eating are missing from the number and that every missing day
    // drags it DOWN. "57%" tells them nothing they can act on.
    loggedDays: tdee.windowDays,
    spanDays: tdee.spanDays,
    weighInsDropped: tdee.outliersDropped,
    confidence: tdee.confidence,
    provisional: tdee.confidence < 1,
    // Still optional WITHIN measured mode — a run with no widening pass does
    // not compute it — and an absent state reads as NOT holding: a run that did
    // not measure the interval is not evidence that it was wide.
    holding: tdee.estimateState === 'holding',
  };
}
