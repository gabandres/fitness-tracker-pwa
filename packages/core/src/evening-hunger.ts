/**
 * Evening hunger — one 0–10 rating per day (0 = full, 10 = starving), typed on
 * Today beside Sleep and read back on Trends as a 7-day average (owner
 * request, 2026-10-20, for a target checkpoint on 10-25).
 *
 * **Display and tracking only.** Nothing here feeds a target, the maintenance
 * estimate or any nudge: the rule text "avg ≥ 7 → consider raising the target"
 * is a sentence the user reads and acts on by hand, never a write. A caller
 * that wants the suggested number gets it from {@link hungerRaiseTarget}, which
 * is arithmetic on the target the screen already shows.
 *
 * Stored as `users/{uid}/dailyHunger/{dateKey} = { level }`, an integer in
 * [0, 10] (`firestore.rules` enforces the same range).
 */

export const HUNGER_MIN = 0;
export const HUNGER_MAX = 10;
/** The trailing window Trends averages over, today included. */
export const HUNGER_WINDOW_DAYS = 7;
/** A 7-day average at or above this reads "consider raising the target". */
export const HUNGER_RAISE_AT = 7;
/** How far the rule suggests raising the target, in kcal. */
export const HUNGER_RAISE_KCAL = 100;

/** A whole number in [0, 10] — the only values the rules accept. */
export function isStorableHunger(level: unknown): level is number {
  return typeof level === 'number' && Number.isInteger(level) && level >= HUNGER_MIN && level <= HUNGER_MAX;
}

/** The rating from a `dailyHunger/{dateKey}` doc, or null when it holds none. */
export function readEveningHunger(data: unknown): number | null {
  const level = (data as { level?: unknown } | null | undefined)?.level;
  return isStorableHunger(level) ? level : null;
}

export interface HungerWeek {
  /** Mean of the rated days in the window, or null when none is rated. */
  average: number | null;
  /** How many of the window's days carry a rating. */
  ratedDays: number;
  /** The window length the average was taken over. */
  windowDays: number;
  /** True when {@link average} is at or above {@link HUNGER_RAISE_AT}. */
  raise: boolean;
}

/**
 * The average over `dateKeys` (the trailing window, oldest first — pass
 * `trailingDateKeys(HUNGER_WINDOW_DAYS, …)`). Unrated days are left out, not
 * counted as 0: a 0 is "full", and a day nobody rated is not a full day.
 */
export function hungerWeek(byDay: Readonly<Record<string, number>>, dateKeys: readonly string[]): HungerWeek {
  const levels = dateKeys.map((k) => byDay[k]).filter(isStorableHunger);
  const average = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null;
  return {
    average,
    ratedDays: levels.length,
    windowDays: dateKeys.length,
    raise: average != null && average >= HUNGER_RAISE_AT,
  };
}

/** The target the rule suggests: today's target + {@link HUNGER_RAISE_KCAL},
 *  to the nearest 50 kcal (1,850 → 1,950). Null without a target. */
export function hungerRaiseTarget(targetKcal: number | null | undefined): number | null {
  if (targetKcal == null || !Number.isFinite(targetKcal) || targetKcal <= 0) return null;
  return Math.round((targetKcal + HUNGER_RAISE_KCAL) / 50) * 50;
}
