import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { DailyLog, LogEntry } from '@macrolog/core';

/**
 * A logged food entry's TIME is editable (2026-10-02).
 *
 * The report: 10-01's "Chocolate Chip Cookie Dough Flavored Bar" sits at
 * 12:00 PM — the noon a past-day add stamps — and was eaten ~4:15 PM. The
 * sheet could move an entry to another DAY but not to another time, so the
 * row could only be deleted and re-logged. Moving it must also re-file a
 * clock-defaulted slot (Lunch → Snack) and leave a hand-picked one alone.
 */

// iOS presents this sheet natively, through a route this test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

const cookie: DailyLog = {
  id: 'SKgG2Mu2NmmWpROsnrDB',
  date: new Date(2026, 9, 1, 12, 0, 0),
  calories: 150,
  mealLabel: 'Chocolate Chip Cookie Dough Flavored Bar',
  mealType: 'lunch',
};

async function open(editing: DailyLog) {
  const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
  const screen = await render(
    <EntrySheet visible editing={editing} onSave={onSave} onClose={jest.fn()} unitSystem="us" />,
  );
  return { screen, onSave };
}

async function press(screen: Awaited<ReturnType<typeof render>>, id: string, times: number) {
  for (let i = 0; i < times; i++) await fireEvent.press(screen.getByTestId(id));
}

it('moves the cookie bar 12:00 PM → 4:15 PM and re-files it from Lunch to Snack', async () => {
  const { screen, onSave } = await open(cookie);
  expect(screen.getByTestId('entry-time').props.children).toMatch(/12:00/);

  await press(screen, 'entry-time-plus-hour', 4);
  await press(screen, 'entry-time-plus-min', 3);
  expect(screen.getByTestId('entry-time').props.children).toMatch(/4:15/);
  // The chips follow, so the user sees the new slot before saving.
  expect(screen.getByTestId('meal-type-snack').props.accessibilityState).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const saved = onSave.mock.calls[0][0];
  expect(saved.timestamp).toEqual(new Date(2026, 9, 1, 16, 15, 0));
  expect(saved.mealType).toBe('snack');
  // Nothing else about the entry moved.
  expect(saved).toMatchObject({ calories: 150, mealLabel: cookie.mealLabel });
});

it('keeps a slot picked by hand in the sheet', async () => {
  const { screen, onSave } = await open(cookie);
  await fireEvent.press(screen.getByTestId('meal-type-dinner'));
  await press(screen, 'entry-time-plus-hour', 4);
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0]).toMatchObject({ mealType: 'dinner', timestamp: new Date(2026, 9, 1, 16, 0, 0) });
});

it('keeps a slot that already disagreed with its time (a noon snack stays a snack)', async () => {
  const { screen, onSave } = await open({ ...cookie, mealType: 'snack' });
  await press(screen, 'entry-time-plus-hour', 6);
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].mealType).toBe('snack');
});

it('does not leave the entry\'s day: an hour back from 00:30 stops at midnight', async () => {
  const { screen, onSave } = await open({ ...cookie, date: new Date(2026, 9, 1, 0, 30) });
  await press(screen, 'entry-time-minus-hour', 1);
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].timestamp).toEqual(new Date(2026, 9, 1, 0, 0, 0));
});
