/**
 * The Today re-score (2026-10-04), the History day half: previous/next day in
 * the header, the totals and the Fasting heading as single screen-reader
 * stops, the weight line from one template, "Copy to today" on a past day's
 * row, and the + lifted clear of the home indicator.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { type DailyLog, dayBoundaryOf } from '@macrolog/core';

const mockSetParams = jest.fn();
const mockShow = jest.fn();
// iOS presents this sheet natively, through a route this test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/components/Toast', () => ({
  ToastSheetHost: () => null,
  useToast: () => ({ show: mockShow }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: mockSetParams }),
  useLocalSearchParams: () => ({ date: '2026-09-20' }),
  // The day sets its native header through `Stack.Screen`, which needs a
  // navigator this test does not mount; its title row is drawn in place.
  Stack: { Screen: ({ options }: { options?: { headerTitle?: () => React.ReactNode } }) => options?.headerTitle?.() ?? null },
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
// The add receipt's Undo (`useAddReceipt`) reaches firebase through here.
const mockAddLogDurably = jest.fn().mockResolvedValue('logged');
jest.mock('@/lib/pending-logs', () => ({
  undoAdds: jest.fn(),
  addLogDurably: (...a: unknown[]) => mockAddLogDurably(...a),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
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
    weights: { '2026-09-20': 180 },
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

import DayDetail, { adjacentDays } from '@/app/history/[date]';

beforeEach(() => {
  mockShow.mockClear();
  mockSetParams.mockClear();
});

describe('adjacentDays', () => {
  it('steps either way and stops at today', () => {
    expect(adjacentDays('2026-10-02', '2026-10-04')).toEqual({ prev: '2026-10-01', next: '2026-10-03' });
    expect(adjacentDays('2026-10-04', '2026-10-04')).toEqual({ prev: '2026-10-03', next: null });
    // Across a month and a year boundary.
    expect(adjacentDays('2026-01-01', '2026-10-04')).toEqual({ prev: '2025-12-31', next: '2026-01-02' });
  });
});

describe('History day — re-score', () => {
  it('steps to the previous and next day in place, by the route param', async () => {
    const screen = await render(<DayDetail />);
    await fireEvent.press(screen.getByTestId('day-prev'));
    expect(mockSetParams).toHaveBeenLastCalledWith({ date: '2026-09-19' });
    await fireEvent.press(screen.getByTestId('day-next'));
    expect(mockSetParams).toHaveBeenLastCalledWith({ date: '2026-09-21' });
    expect(screen.getByLabelText('Previous day')).toBeTruthy();
    expect(screen.getByLabelText('Next day')).toBeTruthy();
  });

  it('reads each total as one stop and the Fasting title as a heading', async () => {
    const screen = await render(<DayDetail />);
    expect(screen.getByLabelText('Calories, 640')).toBeTruthy();
    expect(screen.getByLabelText('Protein, 42 g')).toBeTruthy();
    const fasting = screen.getByText('Fasting');
    expect(fasting.props.accessibilityRole).toBe('header');
  });

  it('prints the weight from one template, not a label and a hardcoded colon', async () => {
    const screen = await render(<DayDetail />);
    expect(screen.getByText(/^Weight: 180/)).toBeTruthy();
  });

  it("offers a past day's row as Copy to today", async () => {
    const screen = await render(<DayDetail />);
    const row = screen.getByTestId('entry-log-1');
    const names = (row.props.accessibilityActions as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['move', 'copyToday']));
  });

  it('lifts the + by the home-indicator inset', async () => {
    const screen = await render(<DayDetail />);
    const fab = screen.getByTestId('add-food-day');
    const flat = Object.assign({}, ...[fab.props.style].flat(Infinity).filter(Boolean));
    // The test safe-area provider reports a bottom inset; the + sits above it.
    expect(typeof flat.bottom).toBe('number');
    expect(flat.bottom).toBeGreaterThanOrEqual(16);
  });
});
