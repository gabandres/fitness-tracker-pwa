import { type DateKey, type DayBoundary, type LogEntry, dayKeyAt } from '@macrolog/core';

/**
 * Whether adding `entry` to today will be a moment — the protein ring closing
 * or the streak extending — predicted BEFORE the write lands.
 *
 * ## Why predict
 *
 * One logged meal used to fire three haptics: the save's success, the
 * protein ring's crossing (an effect on the new totals) and the streak chip's
 * bump (an effect on the new streak), a few hundred milliseconds apart
 * (UX_AUDIT Today review #7). The two effects cannot tell whether a save just
 * buzzed. The save can tell what its write is about to cause, so it plays the
 * ONE haptic as the celebration, and the effects call
 * `haptics.celebrateIfQuiet`, which stands down after any outcome haptic.
 *
 * ## What counts
 *
 * - **Streak**: the first food row of the day. The streak is consecutive
 *   logged days ending today or yesterday, so today's first row always moves
 *   it — 0 → 1 or N → N+1 — which is exactly when the chip's effect fires.
 * - **Protein**: the day's protein goes from under its target to at-or-over.
 *
 * An entry timestamped onto another day (the sheet's time field can move it)
 * changes neither ring nor streak on this screen, so it is never a moment.
 */
export function willCelebrate({
  entry,
  todayKey,
  boundary,
  todayFoodRows,
  proteinSoFar,
  proteinTarget,
}: {
  entry: Pick<LogEntry, 'calories' | 'protein' | 'timestamp'>;
  todayKey: DateKey;
  boundary: DayBoundary;
  /** Food rows (calories > 0) already on today. */
  todayFoodRows: number;
  proteinSoFar: number;
  /** 0 / undefined when there is no target. */
  proteinTarget: number | undefined;
}): boolean {
  if (entry.timestamp && dayKeyAt(entry.timestamp, boundary) !== todayKey) return false;
  if (todayFoodRows === 0 && entry.calories > 0) return true;
  const target = proteinTarget ?? 0;
  if (target <= 0) return false;
  return proteinSoFar < target && proteinSoFar + (entry.protein ?? 0) >= target;
}

/**
 * The day's kcal left after an add of `kcal`, for the receipt — or null when
 * the add is not on the day the hero describes, or there is no target.
 */
export function remainingAfterAdd({
  kcal,
  timestamp,
  todayKey,
  boundary,
  consumed,
  target,
}: {
  kcal: number;
  timestamp?: Date;
  todayKey: DateKey;
  boundary: DayBoundary;
  consumed: number;
  target: number | undefined;
}): number | null {
  if (!target || target <= 0) return null;
  if (timestamp && dayKeyAt(timestamp, boundary) !== todayKey) return null;
  return target - consumed - kcal;
}
