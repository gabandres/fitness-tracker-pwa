import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { CustomFood, DailyLog, LogEntry } from '@macrolog/core';

/**
 * The add-meal re-score, third pass (S20) — the items that live in the add
 * sheet, the search and the pure helpers behind them:
 *
 * - bug 2: a FAST server refusal kept the sheet's close path and threw the
 *   typed entry away; a reopened draft dropped its note and time.
 * - bug 4: a time set on an abandoned form stamped the next pick.
 * - gap 2: quick add by typed number is in the placeholder, not only the hint.
 * - gap 3: the photo-scan door waits for the sheet to leave before presenting.
 * - gap 8: Android rows carry a ⋯ that opens the platform menu.
 * - gap 15: "Last time · 255 g" on a weighed pick seen before.
 */

const mockNavigate = jest.fn();
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => mockNavigate(...a) } }));
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
// The binary's native menu module, present — what an Android 1.2.5 install
// has. The stub draws one button per action so a pick can be driven.
jest.mock('@/components/MenuButton', () => {
  const { Text: T, TouchableOpacity: Touch, View: V } = require('react-native');
  return {
    hasNativeMenuButton: true,
    MenuButton: ({
      actions,
      testID,
      accessibilityLabel,
    }: {
      actions: { key: string; title: string; onPress: () => void }[];
      testID: string;
      accessibilityLabel: string;
    }) => (
      <V testID={testID} accessibilityLabel={accessibilityLabel}>
        {actions.map((a) => (
          <Touch key={a.key} testID={`${testID}-${a.key}`} onPress={a.onPress}>
            <T>{a.title}</T>
          </Touch>
        ))}
      </V>
    ),
  };
});

import { EntrySheet } from '@/components/EntrySheet';
import { lastTimeGrams, moveToDay } from '@/lib/entry-input';
import { parseEntryPrefill } from '@/lib/entry-prefill';
import { clearSheetActive, markSheetActive, __resetSheetPortal } from '@/lib/sheet-portal';
import { formatTime } from '@/lib/date-format';

beforeEach(() => {
  mockNavigate.mockClear();
  __resetSheetPortal();
});

function sheet(props: Partial<React.ComponentProps<typeof EntrySheet>> = {}) {
  return (
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" {...props} />
  );
}

describe('lastTimeGrams', () => {
  const basis = { grams: 170, kcal: 100 };
  it('reads the last kcal back through the basis into grams', () => {
    expect(lastTimeGrams(basis, 150, 170)).toBe(255);
  });
  it('offers nothing when the form is already at it, or nothing can be read', () => {
    expect(lastTimeGrams(basis, 100, 170)).toBeNull();
    expect(lastTimeGrams(basis, undefined, 170)).toBeNull();
    expect(lastTimeGrams(basis, 0, 170)).toBeNull();
    expect(lastTimeGrams({ grams: 170, kcal: 0 }, 150, 170)).toBeNull();
    // Past what the grams field accepts.
    expect(lastTimeGrams({ grams: 100, kcal: 1 }, 100, 100)).toBeNull();
  });
});

describe('moveToDay', () => {
  const now = new Date(2026, 9, 5, 9, 0);
  it('takes the day and keeps the time of day', () => {
    const out = moveToDay(new Date(2026, 9, 4, 13, 30), new Date(2026, 9, 1, 0, 0), now);
    expect([out.getDate(), out.getHours(), out.getMinutes()]).toEqual([1, 13, 30]);
  });
  it('never lands in the future', () => {
    const out = moveToDay(new Date(2026, 9, 4, 13, 30), new Date(2026, 9, 5), now);
    expect(out.getTime()).toBe(now.getTime());
  });
});

describe('parseEntryPrefill', () => {
  it('round-trips a note and a time, and drops junk', () => {
    expect(parseEntryPrefill(JSON.stringify({ calories: 300, note: 'with butter', at: 1_000 }))).toEqual({
      calories: 300,
      note: 'with butter',
      at: 1_000,
    });
    expect(parseEntryPrefill(JSON.stringify({ calories: 300, note: '  ', at: 'soon' }))).toEqual({ calories: 300 });
  });
});

describe('a refused Add (bug 2)', () => {
  it('keeps the form open, holding the entry, when the refusal is fast', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn(async () => ({ outcome: 'rejected' as const }));
    const screen = await render(sheet({ onSave, onClose }));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-label'), 'Oatmeal');
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(screen.getByTestId('entry-form-error')).toBeTruthy());
    expect(screen.getByTestId('entry-form-error').props.children).toMatch(/refused/);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('entry-calories').props.value).toBe('300');
  });

  it('a draft that comes back keeps its note and its time', async () => {
    const at = new Date();
    at.setHours(8, 15, 0, 0);
    const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
    const screen = await render(
      sheet({ onSave, initialPrefill: { calories: 300, mealLabel: 'Toast', note: 'with butter', at: at.getTime() } }),
    );
    expect(screen.getByTestId('entry-note').props.value).toBe('with butter');
    expect(screen.getByTestId('entry-time').props.children).toBe(formatTime(at, 'en'));
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const entry = onSave.mock.calls[0][0];
    expect(entry.timestamp?.getTime()).toBe(at.getTime());
    expect(entry.note).toBe('with butter');
  });
});

describe('the time of an abandoned form (bug 4)', () => {
  it('does not carry into the next form', async () => {
    const screen = await render(sheet());
    await fireEvent.press(screen.getByTestId('open-manual'));
    const opened = screen.getByTestId('entry-time').props.children;
    await fireEvent.press(screen.getByTestId('entry-time-minus-hour'));
    const moved = screen.getByTestId('entry-time').props.children;
    expect(moved).not.toBe(opened);
    await fireEvent.press(screen.getByTestId('custom-back'));
    await fireEvent.press(screen.getByTestId('open-manual'));
    expect(screen.getByTestId('entry-time').props.children).not.toBe(moved);
  });

  it('does carry with keep-open on — a multi-add is one meal', async () => {
    const screen = await render(sheet());
    await fireEvent.press(screen.getByTestId('entry-keep-open'));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.press(screen.getByTestId('entry-time-minus-hour'));
    const moved = screen.getByTestId('entry-time').props.children;
    await fireEvent.press(screen.getByTestId('custom-back'));
    await fireEvent.press(screen.getByTestId('open-manual'));
    expect(screen.getByTestId('entry-time').props.children).toBe(moved);
  });
});

describe('search placeholder (gap 2)', () => {
  it('says a typed number logs kcal', async () => {
    const screen = await render(sheet());
    expect(screen.getByTestId('food-search-input').props.placeholder).toBe('Search foods or type kcal (350)');
  });
});

describe('photo-scan door (gap 3)', () => {
  it('waits for the native sheet to be gone before presenting the scan screen', async () => {
    const onClose = jest.fn();
    // A presented native sheet, as the portal counts it.
    markSheetActive('entry');
    const screen = await render(sheet({ onClose }));
    await fireEvent.press(screen.getByTestId('open-more'));
    await fireEvent.press(screen.getByTestId('open-scan'));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => clearSheetActive('entry'));
    expect(mockNavigate).toHaveBeenCalledWith('/scan');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

const bowl: DailyLog = { id: 'r1', calories: 640, protein: 45, carbs: 68, fat: 18, mealLabel: 'Chicken bowl', date: new Date() };

describe('Android ⋯ on a food row (gap 8)', () => {
  it('opens the same commands as the iOS context menu, named for the food', async () => {
    const onHideRecent = jest.fn();
    const screen = await render(sheet({ recentEntries: [bowl], onHideRecent }));
    const more = screen.getByTestId('recent-r1-more');
    expect(more.props.accessibilityLabel).toBe('More for Chicken bowl');
    expect(screen.getByTestId('recent-r1-more-log')).toBeTruthy();
    expect(screen.getByTestId('recent-r1-more-remove')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recent-r1-more-edit'));
    expect(screen.getByTestId('entry-label').props.value).toBe('Chicken bowl');
    expect(screen.getByTestId('entry-calories').props.value).toBe('640');
  });

  it('steps aside in Manage mode, where the row is the remove button', async () => {
    const screen = await render(sheet({ recentEntries: [bowl], onHideRecent: jest.fn() }));
    await fireEvent.press(screen.getByTestId('manage-recents'));
    expect(screen.queryByTestId('recent-r1-more')).toBeNull();
  });
});

describe('"Last time" portion (gap 15)', () => {
  const yogurt: CustomFood = {
    id: 'f1',
    name: 'Greek yogurt',
    servingSize: 170,
    servingUnit: 'g',
    calories: 100,
    protein: 17,
    carbs: 6,
    fat: 0,
    source: 'manual',
    createdAt: new Date(),
  };
  const lastTime: DailyLog = { id: 'r9', calories: 150, protein: 25.5, mealLabel: 'Greek yogurt', date: new Date() };

  it('offers the weight last time implies, and one tap applies it', async () => {
    const screen = await render(sheet({ customFoods: [yogurt], recentEntries: [lastTime] }));
    await fireEvent(screen.getByTestId('customfood-f1'), 'accessibilityAction', {
      nativeEvent: { actionName: 'editFirst' },
    });
    const chip = screen.getByTestId('entry-usual-portion');
    expect(chip.props.accessibilityLabel).toBe('Use the amount from last time, 255 grams, 150 calories');
    await fireEvent.press(chip);
    expect(screen.getByTestId('entry-calories').props.value).toBe('150');
    expect(screen.getByTestId('entry-grams').props.value).toBe('255');
    // At it now — nothing left to offer.
    expect(screen.queryByTestId('entry-usual-portion')).toBeNull();
  });

  it('is not offered for a food never logged before', async () => {
    const screen = await render(sheet({ customFoods: [yogurt] }));
    await fireEvent(screen.getByTestId('customfood-f1'), 'accessibilityAction', {
      nativeEvent: { actionName: 'editFirst' },
    });
    expect(screen.getByTestId('entry-grams')).toBeTruthy();
    expect(screen.queryByTestId('entry-usual-portion')).toBeNull();
  });
});
