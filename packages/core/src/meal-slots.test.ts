import { describe, it, expect } from 'vitest';
import { groupByMealSlot } from './meal-slots';
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
