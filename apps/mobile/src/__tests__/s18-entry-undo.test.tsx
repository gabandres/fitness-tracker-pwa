/**
 * Entry delete → Undo (UX_AUDIT S18-6), pinned on the History day screen.
 *
 * The property: a deleted row comes back EXACTLY — same id, same timestamp —
 * through `addLogWithId`, so Undo cannot duplicate it or move it to another
 * day. `entryFromLog` is the conversion; the render test drives the real
 * EntrySheet delete button and the toast action.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { type DailyLog, dayBoundaryOf } from '@macrolog/core';

const mockShow = jest.fn();
jest.mock('@/components/Toast', () => ({
  useToast: () => ({ show: mockShow }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ date: '2026-09-20' }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
const mockAddLogWithId = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/ledger', () => ({
  addLogWithId: (...a: unknown[]) => mockAddLogWithId(...a),
  // Reached transitively by the screen's other imports; none is exercised.
  recordMilestone: jest.fn(),
  subscribeMilestones: () => () => {},
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));
// EntrySheet → FoodSearch → firebase/functions; same seam the EntrySheet
// suites cut. `warmFoodIndex` must exist or the mount effect throws.
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
jest.mock('@/hooks/useDayFasts', () => ({
  useDayFasts: () => ({ dayFasts: [], fasts: [], addFast: jest.fn(), updateFast: jest.fn(), deleteFast: jest.fn() }),
}));

const mockLunch: DailyLog = {
  id: 'log-1',
  calories: 640,
  protein: 42,
  carbs: 55,
  fat: 20,
  mealLabel: 'Chicken bowl',
  mealType: 'lunch',
  date: new Date(2026, 8, 20, 12, 30),
};
const mockDeleteEntry = jest.fn().mockResolvedValue(undefined);
const mockBoundary = dayBoundaryOf(null);
jest.mock('@/hooks/useHistory', () => ({
  useHistory: () => ({
    loading: false,
    error: null,
    days: [],
    logs: [mockLunch],
    weights: {},
    presets: [],
    customFoods: [],
    boundary: mockBoundary,
    // The day is inside the window here; the month fetch is idle (S18-13).
    ensureMonthLoaded: jest.fn(),
    olderMonths: { loading: false, error: null },
    addEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: mockDeleteEntry,
    addPreset: jest.fn(),
    deletePreset: jest.fn(),
    addCustomFood: jest.fn(),
    deleteCustomFood: jest.fn(),
  }),
}));

import DayDetail, { entryFromLog } from '@/app/(app)/history/[date]';

beforeEach(() => {
  mockShow.mockClear();
  mockAddLogWithId.mockClear();
  mockDeleteEntry.mockClear();
});

describe('entryFromLog', () => {
  it('carries the note and the creation instant, so undo restores both (2026-10-03)', () => {
    const made = new Date(2026, 8, 20, 21, 0);
    expect(entryFromLog({ ...mockLunch, note: 'Weighed', createdAt: made })).toMatchObject({
      note: 'Weighed',
      createdAt: made,
    });
  });

  it('carries every submitted field and pins the timestamp to the original date', async () => {
    expect(entryFromLog(mockLunch)).toEqual({
      calories: 640,
      timestamp: mockLunch.date,
      weight: undefined,
      protein: 42,
      carbs: 55,
      fat: 20,
      exerciseCompleted: undefined,
      mealLabel: 'Chicken bowl',
      mealType: 'lunch',
      source: undefined,
    });
  });
});

describe('History day — delete with Undo', () => {
  it('deletes, offers a 5-second Undo, and Undo re-adds at the same id and time', async () => {
    const screen = await render(<DayDetail />);

    await fireEvent.press(screen.getByTestId('entry-log-1'));
    await waitFor(() => expect(screen.getByTestId('entry-delete')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('entry-delete'));

    await waitFor(() => expect(mockDeleteEntry).toHaveBeenCalledWith('log-1'));
    expect(mockShow).toHaveBeenCalledTimes(1);
    const [message, opts] = mockShow.mock.calls[0] as [string, { durationMs: number; action: { label: string; onPress: () => void } }];
    expect(message).toBe('Entry deleted');
    expect(opts.durationMs).toBe(5000);
    expect(opts.action.label).toBe('Undo');

    opts.action.onPress();
    expect(mockAddLogWithId).toHaveBeenCalledWith('u1', 'log-1', entryFromLog(mockLunch));
  });
});
