/**
 * History calendar — UX_AUDIT S18-7 (Retry) and S18-13 (the 400-row window).
 *
 * The calendar pages back forever while `useHistory` holds only the newest
 * `LOG_WINDOW_ROWS` rows, so an old month rendered empty whether or not
 * anything was logged. The predicate below is what decides when to say so,
 * and the render test pins that the note appears only once the viewed month
 * reaches past the oldest loaded row — and never when the window has room.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { type DailyLog, dayBoundaryOf } from '@macrolog/core';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
// `useHistory` reaches `@/lib/ledger` → firebase's untranspiled ESM; the hook
// is the seam this screen reads through, so it is what gets replaced.
const mockHistory = {
  loading: false,
  error: null as Error | null,
  days: [] as never[],
  logs: [] as DailyLog[],
  weights: {},
  presets: [],
  customFoods: [],
  boundary: dayBoundaryOf(null),
};
const mockUseHistory = jest.fn(() => mockHistory);
jest.mock('@/hooks/useHistory', () => ({ useHistory: () => mockUseHistory() }));
jest.mock('@/lib/use-unit-system', () => ({ useUnitSystem: () => 'us' }));

import HistoryCalendar, { oldestLogKey, olderThanLoaded } from '@/app/(app)/history/index';

/** `n` rows, one per day, newest first, ending on `oldest` (inclusive). */
function rows(n: number, oldest: Date): DailyLog[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    calories: 500,
    date: new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate() + (n - 1 - i), 12),
  }));
}

beforeEach(() => {
  mockUseHistory.mockClear();
  mockHistory.error = null;
  mockHistory.logs = [];
});

describe('olderThanLoaded', () => {
  const view = (y: number, m: number) => new Date(y, m - 1, 15);

  it('is false while the window has room — everything is loaded', async () => {
    expect(olderThanLoaded(view(2020, 1), '2026-09-01', 399, 400)).toBe(false);
  });

  it('is false with nothing loaded at all', async () => {
    expect(olderThanLoaded(view(2020, 1), null, 0, 400)).toBe(false);
  });

  it('is false for a month that starts on or after the oldest loaded row', async () => {
    expect(olderThanLoaded(view(2026, 9), '2026-09-01', 400, 400)).toBe(false);
    expect(olderThanLoaded(view(2026, 10), '2026-09-01', 400, 400)).toBe(false);
  });

  it('is true when the viewed month starts before the oldest loaded row and the window is full', async () => {
    expect(olderThanLoaded(view(2026, 8), '2026-09-01', 400, 400)).toBe(true);
    // The oldest row's OWN month is partial too when it does not start on the 1st.
    expect(olderThanLoaded(view(2026, 9), '2026-09-14', 400, 400)).toBe(true);
  });
});

describe('oldestLogKey', () => {
  it('returns the earliest day key under the boundary, or null', async () => {
    expect(oldestLogKey([], dayBoundaryOf(null))).toBeNull();
    const logs = rows(3, new Date(2026, 8, 10));
    expect(oldestLogKey(logs, dayBoundaryOf(null))).toBe('2026-09-10');
  });
});

describe('History calendar', () => {
  it('shows the older-not-loaded note only once the view pages past the window', async () => {
    // A full window whose oldest row is the 1st of the current month.
    const now = new Date();
    mockHistory.logs = rows(400, new Date(now.getFullYear(), now.getMonth(), 1));
    const screen = await render(<HistoryCalendar />);

    expect(screen.queryByTestId('history-older-not-loaded')).toBeNull();
    await fireEvent.press(screen.getByTestId('month-prev'));
    expect(screen.getByTestId('history-older-not-loaded')).toBeTruthy();
  });

  it('never shows the note when the window is not full', async () => {
    mockHistory.logs = rows(5, new Date(2026, 8, 1));
    const screen = await render(<HistoryCalendar />);
    await fireEvent.press(screen.getByTestId('month-prev'));
    await fireEvent.press(screen.getByTestId('month-prev'));
    expect(screen.queryByTestId('history-older-not-loaded')).toBeNull();
  });

  it('Retry remounts the screen so the feed re-opens', async () => {
    mockHistory.error = new Error('offline');
    const screen = await render(<HistoryCalendar />);
    const before = mockUseHistory.mock.calls.length;

    await fireEvent.press(screen.getByTestId('retry'));

    // A fresh mount re-runs the hook (and therefore re-opens its listeners);
    // the same instance re-rendering would not.
    expect(mockUseHistory.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('labels calendar cells with the date and what the dots mean', async () => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    mockHistory.logs = rows(1, new Date(now.getFullYear(), now.getMonth(), 1));
    (mockHistory as { days: unknown[] }).days = [
      { dateKey: key, totalCalories: 500, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 1, weightLb: 180, exercised: false },
    ];
    const screen = await render(<HistoryCalendar />);
    const cell = screen.getByTestId(`day-${key}`);
    expect(cell.props.accessibilityRole).toBe('button');
    expect(cell.props.accessibilityLabel).toContain('logged');
    expect(cell.props.accessibilityLabel).toContain('weigh-in');
  });
});
