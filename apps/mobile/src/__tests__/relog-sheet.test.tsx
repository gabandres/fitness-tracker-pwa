import React from 'react';
import type { DailyLog } from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});

import { RelogSheet, selectedLogs } from '@/components/RelogSheet';

/**
 * UX_AUDIT S24-16 (2026-11-19): pick several of a past day's entries and add
 * them to today in one go.
 */

const at = (h: number) => new Date(2026, 10, 17, h, 0, 0);
const log = (id: string, mealLabel: string, calories: number, hour: number): DailyLog =>
  ({ id, mealLabel, calories, date: at(hour), mealType: 'lunch' }) as unknown as DailyLog;
const LOGS = [log('a', 'Oats', 300, 8), log('b', 'Chicken bowl', 650, 13), log('c', 'Yogurt', 150, 16)];

describe('selectedLogs', () => {
  it('returns the picked rows in the day\'s order, whatever order they were picked in', () => {
    expect(selectedLogs(LOGS, new Set(['c', 'a'])).map((l) => l.id)).toEqual(['a', 'c']);
    expect(selectedLogs(LOGS, new Set())).toEqual([]);
  });
});

describe('RelogSheet', () => {
  it('starts with nothing picked, and its button says so and does nothing', async () => {
    const onConfirm = jest.fn();
    const ui = await render(<RelogSheet visible logs={LOGS} onClose={jest.fn()} onConfirm={onConfirm} />);
    const cta = ui.getByTestId('relog-confirm');
    expect(cta).toHaveTextContent('Pick what to add');
    await fireEvent.press(cta);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(ui.getByTestId('relog-row-0').props.accessibilityState).toEqual({ checked: false });
  });

  it('adds the picked entries, and the button says how many and what they come to', async () => {
    const onConfirm = jest.fn();
    const ui = await render(<RelogSheet visible logs={LOGS} onClose={jest.fn()} onConfirm={onConfirm} />);
    await fireEvent.press(ui.getByTestId('relog-row-2'));
    expect(ui.getByTestId('relog-confirm')).toHaveTextContent('Add 1 entry · 150 kcal');
    await fireEvent.press(ui.getByTestId('relog-row-0'));
    expect(ui.getByTestId('relog-row-0').props.accessibilityState).toEqual({ checked: true });
    expect(ui.getByTestId('relog-confirm')).toHaveTextContent('Add 2 entries · 450 kcal');
    await fireEvent.press(ui.getByTestId('relog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as DailyLog[]).map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('Select all picks every row, and the same button then clears them', async () => {
    const ui = await render(<RelogSheet visible logs={LOGS} onClose={jest.fn()} onConfirm={jest.fn()} />);
    await fireEvent.press(ui.getByTestId('relog-select-all'));
    expect(ui.getByTestId('relog-confirm')).toHaveTextContent('Add 3 entries · 1,100 kcal');
    await fireEvent.press(ui.getByTestId('relog-select-all'));
    expect(ui.getByTestId('relog-confirm')).toHaveTextContent('Pick what to add');
  });

  it('a row says its name and calories to a screen reader', async () => {
    const ui = await render(<RelogSheet visible logs={LOGS} onClose={jest.fn()} onConfirm={jest.fn()} />);
    expect(ui.getByTestId('relog-row-1').props.accessibilityLabel).toBe('Chicken bowl, 650 kcal');
    expect(ui.getByTestId('relog-row-1').props.accessibilityRole).toBe('checkbox');
  });
});
