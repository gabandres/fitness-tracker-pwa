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
  /** `consumed - maintenance`. Negative is a deficit, positive a surplus. */
  delta: number;
  /**
   * Whether the estimate met the logging-completeness bar. False does NOT mean
   * hide it — it means present it softly. The number is still derived from this
   * user's own data; it is just built on a patchier record.
   */
  reliable: boolean;
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
    delta: consumed - tdee.trueTdee,
    reliable: tdee.reliable === true,
  };
}
