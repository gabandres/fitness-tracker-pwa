import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { DailyLog, LogEntry } from '@macrolog/core';

/**
 * 2026-10-03: a whole day logged at night.
 *
 * Breakfast eaten at 8:15 was entered at ~22:00. A today-add had no Time row,
 * so the row was stamped 22:00 and fixing it meant an add, an edit and 22
 * stepper taps. Now every form has the Time row, the time can be TYPED, and an
 * entry carries a note ("Weighed", "logged high"), which had nowhere to go.
 */

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import * as haptics from '@/lib/haptics';
import { EntrySheet } from '@/components/EntrySheet';
import { MealEntries } from '@/components/MealEntries';

const NOW = new Date(2026, 9, 3, 21, 58, 16);

beforeEach(() => {
  // Only the clock is faked; the renderer's timers stay real.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout',
      'setInterval', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance',
    ],
  });
  jest.mocked(haptics.warning).mockClear();
});
afterEach(() => jest.useRealTimers());

async function openAdd() {
  const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
  const screen = await render(
    <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} unitSystem="us" />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-label'), 'Scrambled eggs in bacon fat (3 medium)');
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '225');
  await fireEvent.changeText(screen.getByTestId('entry-protein'), '18');
  return { screen, onSave };
}

async function typeTime(screen: Awaited<ReturnType<typeof render>>, text: string) {
  await fireEvent.press(screen.getByTestId('entry-time-tap'));
  await fireEvent.changeText(screen.getByTestId('entry-time-input'), text);
  await fireEvent(screen.getByTestId('entry-time-input'), 'blur');
}

async function save(screen: Awaited<ReturnType<typeof render>>, onSave: jest.Mock) {
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0] as LogEntry;
}

it('a today-add shows the Time row, and a typed 8:15 stamps 8:15 today', async () => {
  const { screen, onSave } = await openAdd();
  expect(screen.queryByTestId('entry-date')).toBeNull(); // the date row stays a past-day/edit thing
  await typeTime(screen, '8:15');
  expect(screen.getByTestId('entry-time').props.children).toMatch(/8:15/);
  const saved = await save(screen, onSave);
  expect(saved.timestamp).toEqual(new Date(2026, 9, 3, 8, 15, 0));
  // Slot is left to the write path's clock default, which reads THIS time.
  expect(saved.mealType).toBeUndefined();
});

it('an untouched today-add still saves "now" (no timestamp), not the time the sheet opened', async () => {
  const { screen, onSave } = await openAdd();
  const saved = await save(screen, onSave);
  expect(saved.timestamp).toBeUndefined();
});

it('reads a 12-hour suffix, and never lands in the future', async () => {
  const { screen, onSave } = await openAdd();
  await typeTime(screen, '6:30pm');
  expect(screen.getByTestId('entry-time').props.children).toMatch(/6:30/);
  await typeTime(screen, '23:30'); // after 21:58 — clamps to now
  const saved = await save(screen, onSave);
  expect(saved.timestamp).toEqual(new Date(2026, 9, 3, 21, 58, 0));
});

it('unreadable text changes nothing and warns', async () => {
  const { screen, onSave } = await openAdd();
  await typeTime(screen, '8:15');
  await typeTime(screen, 'breakfast');
  expect(haptics.warning).toHaveBeenCalled();
  const saved = await save(screen, onSave);
  expect(saved.timestamp).toEqual(new Date(2026, 9, 3, 8, 15, 0));
});

it('typing a time on an edit re-files a clock-defaulted slot, like the steppers', async () => {
  const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
  const bar: DailyLog = { id: 'b', date: new Date(2026, 9, 1, 12, 0), calories: 150, mealLabel: 'David bar', mealType: 'lunch' };
  const screen = await render(<EntrySheet visible editing={bar} onSave={onSave} onClose={jest.fn()} unitSystem="us" />);
  await typeTime(screen, '16:15');
  const saved = await save(screen, onSave);
  expect(saved).toMatchObject({ timestamp: new Date(2026, 9, 1, 16, 15, 0), mealType: 'snack' });
});

it('saves a note, trimmed', async () => {
  const { screen, onSave } = await openAdd();
  await fireEvent.changeText(screen.getByTestId('entry-note'), '  1/4 of 12 eggs cooked in bacon fat  ');
  const saved = await save(screen, onSave);
  expect(saved.note).toBe('1/4 of 12 eggs cooked in bacon fat');
});

it('an edit opens on the stored note, and emptying it clears it', async () => {
  const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
  const pizza: DailyLog = { id: 'p', date: new Date(2026, 9, 3, 18, 30), calories: 760, protein: 26, mealLabel: 'Turabo pizza', mealType: 'dinner', note: 'Not weighed' };
  const screen = await render(<EntrySheet visible editing={pizza} onSave={onSave} onClose={jest.fn()} unitSystem="us" />);
  expect(screen.getByTestId('entry-note').props.value).toBe('Not weighed');
  await fireEvent.changeText(screen.getByTestId('entry-note'), '   ');
  const saved = await save(screen, onSave);
  // `note` absent on an edit = remove the stored one (`toLogPatch`).
  expect(saved.note).toBeUndefined();
  expect('note' in saved).toBe(true);
});

it('the day list shows a row\'s note under it, and nothing for a row without one', async () => {
  const logs: DailyLog[] = [
    { id: 'p', date: new Date(2026, 9, 3, 18, 30), calories: 760, mealLabel: 'Turabo pizza', mealType: 'dinner', note: 'Not weighed' },
    { id: 'c', date: new Date(2026, 9, 3, 18, 30), calories: 240, mealLabel: 'Pizza crust ends x2', mealType: 'dinner' },
  ];
  const screen = await render(<MealEntries logs={logs} onPress={jest.fn()} />);
  expect(screen.getByTestId('entry-note-p').props.children).toBe('Not weighed');
  expect(screen.queryByTestId('entry-note-c')).toBeNull();
});
