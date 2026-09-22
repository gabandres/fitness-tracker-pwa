import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * A one-tap relog from Recent must copy the WHOLE row.
 *
 * The recents branch of `browseRows` passed only kcal and protein while the My
 * Foods branch twelve lines below it passed all four macros. A recent row IS a
 * `DailyLog` and carries carbs and fat, so the tap wrote a row the user
 * believed was a copy of the original: Today's carb and fat rings under-
 * reported, and `addEntry` mirrored the same gap into Apple Health. Found by
 * the 2026-09-22 code review.
 */

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

const bowl = {
  id: 'r1',
  calories: 640,
  protein: 45,
  carbs: 68,
  fat: 18,
  mealLabel: 'Chicken bowl',
  date: new Date('2026-09-21T12:00:00Z'),
};

it('relogs every macro the recent row carries, not just kcal and protein', async () => {
  const onSave = jest.fn();
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={onSave}
      onClose={jest.fn()}
      unitSystem="us"
      recentEntries={[bowl]}
    />,
  );

  await fireEvent.press(screen.getByTestId('recent-r1'));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ calories: 640, protein: 45, carbs: 68, fat: 18, mealLabel: 'Chicken bowl' }),
  );
});

it('leaves a macro the row genuinely lacks undefined rather than zero', async () => {
  const onSave = jest.fn();
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={onSave}
      onClose={jest.fn()}
      unitSystem="us"
      recentEntries={[{ id: 'r2', calories: 200, protein: 10, mealLabel: 'Apple', date: bowl.date }]}
    />,
  );

  await fireEvent.press(screen.getByTestId('recent-r2'));

  const entry = onSave.mock.calls[0][0];
  expect(entry.carbs).toBeUndefined();
  expect(entry.fat).toBeUndefined();
});
