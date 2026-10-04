import type { DailyLog, LogEntry } from '@macrolog/core';

/**
 * The `LogEntry` that re-creates a row byte-for-byte — the Undo of a delete
 * (re-added at the row's ORIGINAL id and timestamp, so it lands on the same
 * day, in the same slot, and a second tap cannot duplicate it: `setDoc` is
 * idempotent) and the Undo of an edit (patched back to exactly this).
 *
 * Lived on the History route until 2026-10-04, imported from there by Today.
 */
export function entryFromLog(log: DailyLog): LogEntry {
  return {
    calories: log.calories,
    timestamp: log.date,
    weight: log.weight,
    protein: log.protein,
    carbs: log.carbs,
    fat: log.fat,
    exerciseCompleted: log.exerciseCompleted,
    mealLabel: log.mealLabel,
    mealType: log.mealType,
    source: log.source,
    note: log.note,
    // Undo puts the row back where it was among same-minute rows.
    createdAt: log.createdAt,
  };
}

/**
 * Whether saving `entry` over `before` changes nothing the user can see — the
 * sheet's Save on an untouched form. Such a save writes nothing and gets no
 * "Updated · Undo" receipt for a change that did not happen.
 */
export function isNoopEdit(before: DailyLog, entry: LogEntry): boolean {
  const ts = entry.timestamp ?? before.date;
  return (
    entry.calories === before.calories &&
    (entry.protein ?? null) === (before.protein ?? null) &&
    (entry.carbs ?? null) === (before.carbs ?? null) &&
    (entry.fat ?? null) === (before.fat ?? null) &&
    (entry.mealLabel || null) === (before.mealLabel || null) &&
    (entry.mealType ?? null) === (before.mealType ?? null) &&
    (entry.note || null) === (before.note || null) &&
    ts.getTime() === before.date.getTime()
  );
}
