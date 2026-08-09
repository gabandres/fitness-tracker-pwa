import { describe, it, expect } from 'vitest';
import { groupByMealSlot, slotForTime } from './meal-slots';
import type { DailyLog, MealType } from './types';

function log(calories: number, mealType?: MealType): DailyLog {
  return { calories, date: new Date(2026, 5, 30, 12), mealType };
}

describe('groupByMealSlot', () => {
  it('orders slots breakfast→lunch→dinner→snack→other with subtotals', () => {
    const groups = groupByMealSlot([
      log(200, 'dinner'),
      log(100, 'breakfast'),
      log(150, 'breakfast'),
      log(50), // untagged → other
    ]);
    expect(groups.map((g) => g.slot)).toEqual(['breakfast', 'dinner', 'other']);
    expect(groups[0].totalCalories).toBe(250);
    expect(groups[0].entries.length).toBe(2);
    expect(groups[2].slot).toBe('other');
  });

  it('omits empty slots and returns [] for no logs', () => {
    expect(groupByMealSlot([])).toEqual([]);
    const g = groupByMealSlot([log(300, 'lunch')]);
    expect(g).toHaveLength(1);
    expect(g[0].slot).toBe('lunch');
  });
});

/**
 * `mealType` was optional and every add surface left it undefined, so untagged
 * entries piled into `other` — two entries two minutes apart landing in
 * different buckets because one had the field tapped. Reported 2026-08-08.
 */
describe('slotForTime', () => {
  const at = (h: number, m = 0) => new Date(2026, 7, 8, h, m, 0);

  it.each([
    [6, 0, 'breakfast'],
    [10, 29, 'breakfast'],
    [10, 30, 'lunch'],
    [12, 52, 'lunch'],
    [12, 54, 'lunch'],
    [14, 29, 'lunch'],
    [14, 30, 'snack'],
    [15, 19, 'snack'],
    [17, 29, 'snack'],
    [17, 30, 'dinner'],
    [20, 23, 'dinner'],
    [21, 29, 'dinner'],
    [21, 30, 'snack'],
    [23, 59, 'snack'],
    [0, 15, 'breakfast'],
  ])('%i:%i → %s', (h, m, expected) => {
    expect(slotForTime(at(h, m))).toBe(expected);
  });

  it('puts the two entries that started this in the SAME slot', () => {
    // The actual bug: 12:52 PM was tagged Lunch by hand, 12:54 PM fell to Other.
    expect(slotForTime(at(12, 52))).toBe(slotForTime(at(12, 54)));
  });

  it('never returns other — that stays reserved for genuinely untagged rows', () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 29, 30, 31, 59]) {
        expect(['breakfast', 'lunch', 'dinner', 'snack']).toContain(slotForTime(at(h, m)));
      }
    }
  });
});
