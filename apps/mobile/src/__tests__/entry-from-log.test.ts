import type { DailyLog } from '@macrolog/core';
import { entryFromLog, isNoopEdit } from '@/lib/entry-from-log';

/**
 * Edit receipts (2026-10-04): an untouched Save writes nothing and gets no
 * "Updated · Undo"; any visible change does. `entryFromLog` is what the
 * edit's Undo patches back.
 */
const row: DailyLog = {
  id: 'r1',
  date: new Date(2026, 9, 4, 8, 0),
  calories: 300,
  protein: 20,
  mealLabel: 'Oatmeal',
  mealType: 'breakfast',
  note: 'with berries',
  grams: 80,
};

describe('isNoopEdit', () => {
  it('is true for the form saved untouched', () => {
    expect(isNoopEdit(row, entryFromLog(row))).toBe(true);
  });

  it.each([
    ['calories', { calories: 350 }],
    ['protein', { protein: 25 }],
    ['label', { mealLabel: 'Porridge' }],
    ['slot', { mealType: 'snack' as const }],
    ['note cleared', { note: undefined }],
    ['weight', { grams: 100 }],
    ['weight cleared', { grams: undefined }],
    ['time', { timestamp: new Date(2026, 9, 4, 9, 0) }],
  ])('is false when the %s changes', (_n, change) => {
    expect(isNoopEdit(row, { ...entryFromLog(row), ...change })).toBe(false);
  });
});
