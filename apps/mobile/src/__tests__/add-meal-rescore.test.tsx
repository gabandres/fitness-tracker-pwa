import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { CustomFood, DailyLog, MealPreset } from '@macrolog/core';
import { settleWithin } from '@/lib/entry-input';

/**
 * The add-meal re-score (S20, second pass), pinned where a regression would be
 * silent:
 *
 * - Bug 4: the form's Add waits a bounded time for the write, then lets go.
 * - Bug 5: protein in the browse list is written the locale's way (12,5 g).
 * - Bug 6: an unnamed recent is inert in Manage mode instead of a dead button.
 * - Multi-add: "Keep open" keeps the sheet up after an add, counts the adds,
 *   is remembered, and Done closes.
 * - "Edit before logging" reaches the review form from a recent, a My Foods
 *   row and a Quick add chip (a screen-reader action here; the iOS context
 *   menu and Android long-press call the same function).
 * - The date steppers name the day they move to.
 */

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
let mockLocale: string | undefined;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockLocale ? { preferredLocale: mockLocale } : null }),
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
  ToastSheetHost: () => null,
}));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) }));
jest.mock('@/lib/haptics', () => ({
  tap: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  selection: jest.fn(),
  tapThenOutcome: jest.fn(),
  removed: jest.fn(),
}));

import { EntrySheet } from '@/components/EntrySheet';
import { PortionPicker } from '@/components/FoodSearch';

const at = new Date('2026-10-03T12:00:00');
const bowl: DailyLog = { id: 'r1', calories: 640, protein: 12.5, carbs: 68, fat: 18, mealLabel: 'Chicken bowl', date: at };
const unnamed: DailyLog = { id: 'r2', calories: 150, date: at };
const yogurt: CustomFood = {
  id: 'f1',
  name: 'Greek yogurt',
  servingSize: 170,
  servingUnit: 'g',
  calories: 100,
  protein: 17,
  source: 'text',
  createdAt: new Date('2026-09-01'),
};
const shake: MealPreset = { id: 'p1', name: 'Shake', calories: 300, protein: 40, carbs: 10, fat: 5 };

beforeEach(async () => {
  mockLocale = undefined;
  mockShowToast.mockClear();
  mockConfirm.mockClear();
  await AsyncStorage.clear();
});

function sheet(props: Partial<React.ComponentProps<typeof EntrySheet>> = {}) {
  return (
    <EntrySheet
      visible
      editing={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
      unitSystem="us"
      recentEntries={[bowl]}
      {...props}
    />
  );
}

describe('settleWithin', () => {
  it('hands back a write that answers in time, and says so when it does not', async () => {
    await expect(settleWithin(Promise.resolve(7), 50)).resolves.toEqual({ settled: true, value: 7 });
    await expect(settleWithin(new Promise(() => {}), 10)).resolves.toEqual({ settled: false });
  });

  it('throws a failure that arrives inside the window', async () => {
    await expect(settleWithin(Promise.reject(new Error('nope')), 50)).rejects.toThrow('nope');
  });
});

describe('the form Add closes at dispatch (bug 4; perf 2026-10-08)', () => {
  it('closes at once while the write is still out', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn(() => new Promise<void>(() => {}));
    const screen = await render(sheet({ onSave, onClose }));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '420');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a write that fails after the sheet let go, with Retry', async () => {
    const onClose = jest.fn();
    let fail: (e: Error) => void = () => {};
    const onSave = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)))
      .mockResolvedValue(undefined);
    const screen = await render(sheet({ onSave, onClose }));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-label'), 'Soup');
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '220');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 4000 });
    await act(async () => fail(new Error('late')));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [msg, opts] = mockShowToast.mock.calls[0] as [string, { action: { onPress: () => void } }];
    expect(msg).toMatch(/Soup/);
    await act(async () => opts.action.onPress());
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('reports a write that fails at once the same way, after the close', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockRejectedValue(new Error('nope'));
    const screen = await render(sheet({ onSave, onClose }));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '420');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  });
});

describe('browse list details', () => {
  it('writes protein the locale’s way (bug 5)', async () => {
    mockLocale = 'pt-BR';
    const screen = await render(sheet());
    expect(screen.getByTestId('recent-r1').props.accessibilityLabel).toMatch(/12,5 g/);
    expect(screen.getByText('12,5 g de proteína')).toBeTruthy();
  });

  it('makes an unnamed recent inert while managing, not a dead button (bug 6)', async () => {
    const screen = await render(sheet({ recentEntries: [bowl, unnamed], onHideRecent: jest.fn() }));
    await fireEvent.press(screen.getByTestId('manage-recents'));
    expect(screen.getByTestId('recent-r2').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('recent-r1').props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('Edit before logging', () => {
  it('opens a recent on the review form instead of logging it', async () => {
    const onSave = jest.fn();
    const screen = await render(sheet({ onSave }));
    const row = screen.getByTestId('recent-r1');
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toContain('editFirst');
    await act(async () => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'editFirst' } }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('entry-calories').props.value).toBe('640');
    expect(screen.getByTestId('entry-label').props.value).toBe('Chicken bowl');
  });

  it('brings a My Foods row with its weight, so the grams field can rescale it', async () => {
    const screen = await render(sheet({ recentEntries: [], customFoods: [yogurt] }));
    const row = screen.getByTestId('customfood-f1');
    await act(async () => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'editFirst' } }));
    expect(screen.getByTestId('entry-calories').props.value).toBe('100');
    expect(screen.getByTestId('entry-grams').props.value).toBe('170');
  });

  it('opens a Quick add chip on the form too', async () => {
    const screen = await render(sheet({ presets: [shake], onDeletePreset: jest.fn() }));
    const chip = screen.getByTestId('preset-p1');
    await act(async () => chip.props.onAccessibilityAction({ nativeEvent: { actionName: 'editFirst' } }));
    expect(screen.getByTestId('entry-calories').props.value).toBe('300');
    expect(screen.getByTestId('entry-protein').props.value).toBe('40');
  });
});

describe('multi-add — keep open after adding', () => {
  it('stays open, counts the adds, and closes on Done', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const screen = await render(sheet({ onSave, onClose, presets: [shake] }));
    const toggle = screen.getByTestId('entry-keep-open');
    expect(toggle.props.accessibilityRole).toBe('switch');
    await fireEvent.press(toggle);
    expect(screen.getByTestId('entry-keep-open').props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(screen.getByTestId('recent-r1'));
    await fireEvent.press(screen.getByTestId('preset-p1'));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('entry-added-count').props.children).toBe('Added 2');
    expect(screen.getByLabelText('2 added this time, 940 calories')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('entry-added-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('comes back to the search after the review form’s Add', async () => {
    const onClose = jest.fn();
    const screen = await render(sheet({ onClose }));
    await fireEvent.press(screen.getByTestId('entry-keep-open'));
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '420');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(screen.getByTestId('entry-added-bar')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('entry-calories')).toBeNull();
  });

  it('is remembered for the next sheet, and off by default', async () => {
    const first = await render(sheet());
    expect(first.getByTestId('entry-keep-open').props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(first.getByTestId('entry-keep-open'));
    first.unmount();
    expect(await AsyncStorage.getItem('ignia.entry.keepOpen.v1')).toBe('1');

    const second = await render(sheet());
    await waitFor(() =>
      expect(second.getByTestId('entry-keep-open').props.accessibilityState).toMatchObject({ checked: true }),
    );
  });

  it('still closes after a one-tap log when it is off', async () => {
    const onClose = jest.fn();
    const screen = await render(sheet({ onClose }));
    await fireEvent.press(screen.getByTestId('recent-r1'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('stepper names', () => {
  it('the date steppers say which day they move to', async () => {
    const screen = await render(sheet({ dateKey: '2026-10-01' }));
    await fireEvent.press(screen.getByTestId('open-manual'));
    expect(screen.getByTestId('entry-date-prev').props.accessibilityLabel).toBe('Previous day');
    expect(screen.getByTestId('entry-date-next').props.accessibilityLabel).toBe('Next day');
  });

  it('the portion steppers say servings, not "Lower"/"Raise"', async () => {
    const screen = await render(
      <PortionPicker
        title="Banana"
        servings={[{ label: '1 medium', grams: 118, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, kind: 'portion' }]}
        backLabel="Results"
        onBack={jest.fn()}
        context={{ source: 'text' }}
        onPick={jest.fn()}
      />,
    );
    expect(screen.getByTestId('food-qty-minus').props.accessibilityLabel).toBe('Fewer servings');
    expect(screen.getByTestId('food-qty-plus').props.accessibilityLabel).toBe('More servings');
  });
});
