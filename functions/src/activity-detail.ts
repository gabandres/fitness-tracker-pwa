/**
 * One line describing a `dailyLogs` row for the admin Activity feed.
 *
 * A `dailyLogs` row is not always a meal. The "I trained today" toggle and the
 * end-of-workout completion both write a MARKER row — `{ calories: 0,
 * exerciseCompleted: true }` with no `mealLabel` — so the streak can count the
 * day (`apps/mobile/src/lib/ledger.ts`, `withDefaultMealSlot`). The feed used
 * to print those as "Entry · 0 kcal", which read as a user submitting an empty
 * meal; the owner asked what it meant on 2026-09-08. Name what the row is.
 *
 * Pure so it can be unit-tested without the emulator.
 */
export interface LogRowFields {
  calories?: number;
  mealLabel?: string;
  weight?: number;
  exerciseCompleted?: boolean;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
}

export function describeLogRow(row: LogRowFields): string {
  const kcal = typeof row.calories === "number" ? row.calories : 0;
  if (row.mealLabel) return `${row.mealLabel} · ${kcal} kcal`;

  const done: string[] = [];
  if (row.liftCompleted) done.push("lift");
  if (row.cardioCompleted) done.push("cardio");
  if (done.length === 0 && row.exerciseCompleted) done.push("exercise");
  if (done.length > 0) return `Marked ${done.join(" + ")} done · streak marker, not a meal`;

  if (kcal === 0 && typeof row.weight === "number") return `Weigh-in · ${row.weight}`;
  return `Entry · ${kcal} kcal`;
}
