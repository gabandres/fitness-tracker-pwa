import type { DailyLog, MealType } from './types';

/** A diary slot: the four meal types plus `other` for untagged entries. */
export type MealSlot = MealType | 'other';

export interface MealGroup {
  slot: MealSlot;
  entries: DailyLog[];
  /** Sum of calories across the group's entries. */
  totalCalories: number;
}

/** Fixed diary order; untagged entries fall into `other` last. */
const SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

/**
 * Group day entries into diary slots (breakfast → lunch → dinner → snack →
 * other) with per-slot calorie subtotals, in fixed order. Entries keep their
 * given order within a slot. Empty slots are omitted. Pure port of the Angular
 * ui-day-summary `mealGroups`.
 */
export function groupByMealSlot(logs: DailyLog[]): MealGroup[] {
  const buckets = new Map<MealSlot, DailyLog[]>();
  for (const l of logs) {
    const slot: MealSlot = l.mealType ?? 'other';
    const arr = buckets.get(slot);
    if (arr) arr.push(l);
    else buckets.set(slot, [l]);
  }
  const groups: MealGroup[] = [];
  for (const slot of SLOT_ORDER) {
    const entries = buckets.get(slot);
    if (entries && entries.length > 0) {
      groups.push({ slot, entries, totalCalories: entries.reduce((s, l) => s + l.calories, 0) });
    }
  }
  return groups;
}
