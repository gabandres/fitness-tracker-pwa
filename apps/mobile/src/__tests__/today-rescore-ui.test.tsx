/**
 * The Today re-score (2026-10-04), the component half: the row's "Move to…"
 * picker on both platforms, the rings as a button with Share in their panel,
 * and the receipt that no longer enters twice as a native sheet closes.
 */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import React from 'react';
import { ActionSheetIOS, Platform, Text } from 'react-native';
import type { DailyLog } from '@macrolog/core';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { HeroRings } from '@/components/HeroRings';
import { MealEntries } from '@/components/MealEntries';
import { ANNOUNCE_AFTER_SHEET_MS, ToastProvider, ToastSheetHost, useToast } from '@/components/Toast';
import { __resetSheetPortal, dismissSheet, registerPresenter } from '@/lib/sheet-portal';

const lunch: DailyLog = {
  id: 'l1',
  date: new Date(2026, 9, 4, 12, 30),
  calories: 450,
  mealLabel: 'Chicken bowl',
  mealType: 'lunch',
} as DailyLog;

const action = (actionName: string) => ({ nativeEvent: { actionName } });

describe('MealEntries — Move to… and Copy to today', () => {
  afterEach(() => jest.restoreAllMocks());

  it('iOS: asks with the system action sheet, listing only the other meals, and moves to the pick', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const onMove = jest.fn();
    const view = await render(<MealEntries logs={[lunch]} onPress={() => {}} onMove={onMove} onAddToSlot={() => {}} />);
    await fireEvent(view.getByTestId('entry-l1'), 'accessibilityAction', action('move'));
    expect(sheet).toHaveBeenCalledTimes(1);
    const [opts, pick] = sheet.mock.calls[0];
    expect(opts.title).toBe('Move to which meal?');
    expect(opts.options).toEqual(['Breakfast', 'Dinner', 'Snack', 'Cancel']);
    pick(1);
    expect(onMove).toHaveBeenCalledWith(lunch, 'dinner');
    // Cancel moves nothing.
    pick(3);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('Android: turns the row menu into the list of meals', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onMove = jest.fn();
    const view = await render(<MealEntries logs={[lunch]} onPress={() => {}} onMove={onMove} onAddToSlot={() => {}} />);
    await fireEvent(view.getByTestId('entry-l1'), 'accessibilityAction', action('move'));
    expect(view.getByText('Move to which meal?')).toBeTruthy();
    expect(view.queryByTestId('entry-move-lunch')).toBeNull();
    await fireEvent.press(view.getByTestId('entry-move-snack'));
    expect(onMove).toHaveBeenCalledWith(lunch, 'snack');
  });

  it('names Move and Copy as screen-reader actions only where the screen offers them', async () => {
    const onCopy = jest.fn();
    const view = await render(<MealEntries logs={[lunch]} onPress={() => {}} onMove={() => {}} onCopyToToday={onCopy} />);
    const row = view.getByTestId('entry-l1');
    const labels = (row.props.accessibilityActions as { label: string }[]).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(['Move to…', 'Copy to today']));
    await fireEvent(row, 'accessibilityAction', action('copyToday'));
    expect(onCopy).toHaveBeenCalledWith(lunch);

    const plain = await render(<MealEntries logs={[lunch]} onPress={() => {}} />);
    const names = (plain.getByTestId('entry-l1').props.accessibilityActions as { name: string }[]).map((a) => a.name);
    expect(names).not.toContain('move');
    expect(names).not.toContain('copyToday');
  });
});

describe('HeroRings — a button, with Share in the panel', () => {
  const base = { calConsumed: 1200, calTarget: 2000, protConsumed: 80, protTarget: 150, carbs: 100, fat: 40, maintenance: null };

  it('opens what the rings mean on a tap, and says so', async () => {
    const onPress = jest.fn();
    const view = await render(<HeroRings {...base} onPress={onPress} />);
    // The ring node hides its insides from the reader (it speaks one
    // sentence), which the query treats as hidden too.
    const rings = view.getByTestId('hero-rings-open', { includeHiddenElements: true });
    expect(rings.props.accessibilityRole).toBe('button');
    expect(rings.props.accessibilityHint).toBe('Explains what these numbers mean');
    await fireEvent.press(rings);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws Share only when given one, and marks it busy while a share runs', async () => {
    const onShare = jest.fn();
    const none = await render(<HeroRings {...base} />);
    expect(none.queryByTestId('share-progress')).toBeNull();
    const view = await render(<HeroRings {...base} onShare={onShare} sharing />);
    const share = view.getByTestId('share-progress');
    expect(share.props.accessibilityLabel).toBe('Share your progress');
    expect(share.props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
  });
});

describe('ToastSheetHost — one entrance per receipt', () => {
  beforeEach(() => __resetSheetPortal());
  // Near a sheet the announcement waits `ANNOUNCE_AFTER_SHEET_MS`; let it land
  // inside the test rather than after the environment has gone.
  afterEach(async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ANNOUNCE_AFTER_SHEET_MS + 50));
    });
  });

  function Fire() {
    const toast = useToast();
    return (
      <Text testID="fire" onPress={() => toast.show('Logged Oatmeal · 300 kcal')}>
        fire
      </Text>
    );
  }

  it('draws in the sheet while it is open', async () => {
    registerPresenter('sheet-a', { dismiss: () => {} });
    const view = await render(
      <ToastProvider>
        <Fire />
        <ToastSheetHost sheetId="sheet-a" />
      </ToastProvider>,
    );
    await fireEvent.press(view.getByTestId('fire'));
    expect(view.getAllByTestId('toast')).toHaveLength(1);
  });

  it('holds the receipt back while its sheet is dismissing, then the root draws it once', async () => {
    registerPresenter('sheet-a', { dismiss: () => {} });
    dismissSheet('sheet-a');
    const view = await render(
      <ToastProvider>
        <Fire />
        <ToastSheetHost sheetId="sheet-a" />
      </ToastProvider>,
    );
    await fireEvent.press(view.getByTestId('fire'));
    // Not at the top of the closing sheet…
    expect(view.queryByTestId('toast')).toBeNull();
    // …and once the route has gone, at the bottom — the one entrance.
    await act(async () => {
      view.rerender(
        <ToastProvider>
          <Fire />
        </ToastProvider>,
      );
    });
    expect(view.getAllByTestId('toast')).toHaveLength(1);
  });
});
