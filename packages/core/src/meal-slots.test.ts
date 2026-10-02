import { describe, it, expect } from 'vitest';
import {
  groupByMealSlot,
  isMealRow,
  mealTypeAfterRetime,
  shiftTimeOfDay,
  slotForTime,
  withDefaultMealSlot,
} from './meal-slots';
import { toLogPatch, type DocCodec } from './firestore-writers';
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

describe('withDefaultMealSlot', () => {
  const noon = new Date(2026, 7, 9, 12, 0);

  it('slots an untagged meal from its own timestamp', () => {
    const out = withDefaultMealSlot(
      { calories: 500, timestamp: new Date(2026, 7, 1, 8, 15) },
      noon,
    );
    expect(out.mealType).toBe('breakfast');
  });

  it('slots a back-dated add by the entry time, not the clock', () => {
    // The History day-detail sheet: added at noon today, for 8pm three days ago.
    const out = withDefaultMealSlot(
      { calories: 700, timestamp: new Date(2026, 7, 6, 20, 0) },
      noon,
    );
    expect(out.mealType).toBe('dinner');
  });

  it('falls back to the given clock when the entry carries no timestamp', () => {
    expect(withDefaultMealSlot({ calories: 400 }, noon).mealType).toBe('lunch');
  });

  it('never overrides an explicit choice', () => {
    const out = withDefaultMealSlot(
      { calories: 400, mealType: 'snack', timestamp: new Date(2026, 7, 9, 8, 0) },
      noon,
    );
    expect(out.mealType).toBe('snack');
  });

  it('leaves the exercise marker row untagged', () => {
    const out = withDefaultMealSlot({ calories: 0, exerciseCompleted: true }, noon);
    expect(out.mealType).toBeUndefined();
    expect(isMealRow(out)).toBe(false);
  });

  it('leaves a weight-bearing row untagged', () => {
    expect(withDefaultMealSlot({ calories: 0, weight: 181.2 }, noon).mealType).toBeUndefined();
  });

  it('does not mutate the entry it was given', () => {
    const entry = { calories: 500, timestamp: new Date(2026, 7, 9, 8, 15) };
    withDefaultMealSlot(entry, noon);
    expect('mealType' in entry).toBe(false);
  });

  it('lands a same-minute pair in the same slot however it was added', () => {
    const a = withDefaultMealSlot({ calories: 300, timestamp: new Date(2026, 7, 9, 12, 52) }, noon);
    const b = withDefaultMealSlot({ calories: 300, timestamp: new Date(2026, 7, 9, 12, 54) }, noon);
    expect(a.mealType).toBe(b.mealType);
  });
});

describe('shiftTimeOfDay', () => {
  const now = new Date(2026, 9, 2, 13, 0, 30);

  it('moves within the day and drops seconds', () => {
    const at = new Date(2026, 9, 1, 12, 0, 0);
    expect(shiftTimeOfDay(at, 4 * 60 + 15, now)).toEqual(new Date(2026, 9, 1, 16, 15, 0));
    expect(shiftTimeOfDay(new Date(2026, 9, 1, 12, 21, 42), 5, now)).toEqual(new Date(2026, 9, 1, 12, 26, 0));
  });

  it('never leaves the calendar day (the date row moves days)', () => {
    expect(shiftTimeOfDay(new Date(2026, 9, 1, 23, 30), 60, now)).toEqual(new Date(2026, 9, 1, 23, 59));
    expect(shiftTimeOfDay(new Date(2026, 9, 1, 0, 30), -60, now)).toEqual(new Date(2026, 9, 1, 0, 0));
  });

  it('never moves into the future', () => {
    expect(shiftTimeOfDay(new Date(2026, 9, 2, 12, 30), 60, now)).toEqual(new Date(2026, 9, 2, 13, 0));
  });
});

describe('mealTypeAfterRetime', () => {
  const noon = new Date(2026, 9, 1, 12, 0);
  const afternoon = new Date(2026, 9, 1, 16, 15);

  it('a clock-defaulted slot follows the new time (10-01 cookie bar: lunch → snack)', () => {
    expect(mealTypeAfterRetime('lunch', noon, afternoon)).toBe('snack');
  });

  it('a slot that disagreed with its time was a choice and is kept', () => {
    expect(mealTypeAfterRetime('dinner', noon, afternoon)).toBe('dinner');
  });

  it('untagged stays untagged', () => {
    expect(mealTypeAfterRetime(undefined, noon, afternoon)).toBeUndefined();
  });
});

describe('a time edit re-sorts the day', () => {
  it('10-01: the cookie bar moved 12:00 → 16:15 leaves Lunch and lands in Snack, in time order', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 1, h, m);
    const row = (id: string, date: Date, mealType: MealType): DailyLog => ({ ...log(100, mealType), id, date });
    const day = [
      row('stack', at(8, 32), 'breakfast'),
      row('cookie', at(12, 0), 'lunch'),
      row('kirkland', at(12, 21), 'lunch'),
      row('casein', at(17, 47), 'dinner'),
      row('yogurt', at(16, 40), 'snack'),
    ];
    const before = day[1].date;
    const after = shiftTimeOfDay(before, 4 * 60 + 15, new Date(2026, 9, 2, 9, 0));
    const edited = day.map((l) =>
      l.id === 'cookie' ? { ...l, date: after, mealType: mealTypeAfterRetime(l.mealType, before, after) } : l,
    );
    // Today and the day-detail screen list a day oldest-first (`useToday`).
    const sorted = [...edited].sort((a, b) => a.date.getTime() - b.date.getTime());
    expect(sorted.map((l) => l.id)).toEqual(['stack', 'kirkland', 'cookie', 'yogurt', 'casein']);
    expect(groupByMealSlot(sorted).map((g) => [g.slot, g.entries.map((l) => l.id)])).toEqual([
      ['breakfast', ['stack']],
      ['lunch', ['kirkland']],
      ['dinner', ['casein']],
      ['snack', ['cookie', 'yogurt']],
    ]);
    // ...and the edit reaches the stored row: `updateLog` writes this patch.
    const codec: DocCodec<string> = { timestamp: (d) => d.toISOString(), remove: () => null };
    const cookie = edited.find((l) => l.id === 'cookie')!;
    const patch = toLogPatch({ calories: cookie.calories, mealType: cookie.mealType, timestamp: cookie.date }, codec);
    expect(patch).toMatchObject({ timestamp: after.toISOString(), mealType: 'snack' });
  });
});
