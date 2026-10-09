/**
 * S21 — the screen-level fixes: a History day that failed to load says so
 * (with Retry) instead of drawing an empty diary, and the add sheet's More
 * ways folds away once a search is typed and is gone on the next open.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { dayBoundaryOf } from '@macrolog/core';

// iOS presents sheets natively, through a route these tests do not mount.
// The per-day target record hooks (2026-10-08) open their own focus-gated
// listeners; these screens are tested without a navigator, so they read none.
jest.mock('@/hooks/useTargetHistory', () => ({
  useTargetHistory: () => ({ notice: null, ack: jest.fn() }),
}));
jest.mock('@/hooks/useDayTargetRecord', () => ({ useDayTargetRecord: () => null }));

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/components/Toast', () => ({
  ToastSheetHost: () => null,
  showToast: jest.fn(),
  useToast: () => ({ show: jest.fn(), act: jest.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() }),
  useLocalSearchParams: () => ({ date: '2026-09-20' }),
  Stack: { Screen: ({ options }: { options?: { headerTitle?: () => React.ReactNode } }) => options?.headerTitle?.() ?? null },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/ledger', () => ({
  addLogWithId: jest.fn(),
  recordMilestone: jest.fn(),
  subscribeMilestones: () => () => {},
}));
jest.mock('@/lib/pending-logs', () => ({ undoAdds: jest.fn(), addLogDurably: jest.fn() }));
jest.mock('@/lib/haptics', () => ({
  tap: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  selection: jest.fn(),
  tapThenOutcome: jest.fn(),
  removed: jest.fn(),
}));
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn(async () => []),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
jest.mock('@/hooks/useDayFasts', () => ({
  useDayFasts: () => ({ dayFasts: [], fasts: [], addFast: jest.fn(), updateFast: jest.fn(), deleteFast: jest.fn() }),
}));

const mockHistory = {
  loading: false,
  error: null as Error | null,
  olderMonths: { loading: false, error: null as Error | null },
  logs: [] as unknown[],
};
const mockHistoryMounts = jest.fn();
const mockBoundary = dayBoundaryOf(null);
jest.mock('@/hooks/useHistory', () => ({
  useHistory: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(() => {
      mockHistoryMounts();
    }, []);
    return {
      loading: mockHistory.loading,
      error: mockHistory.error,
      days: [],
      logs: mockHistory.logs,
      weights: {},
      presets: [],
      customFoods: [],
      boundary: mockBoundary,
      ensureMonthLoaded: jest.fn(),
      olderMonths: mockHistory.olderMonths,
      addEntry: jest.fn(),
      updateEntry: jest.fn(),
      deleteEntry: jest.fn(),
      addPreset: jest.fn(),
      deletePreset: jest.fn(),
      addCustomFood: jest.fn(),
      deleteCustomFood: jest.fn(),
    };
  },
}));

import DayDetail from '@/app/history/[date]';
import { EntrySheet } from '@/components/EntrySheet';

beforeEach(() => {
  mockHistory.error = null;
  mockHistory.olderMonths = { loading: false, error: null };
  mockHistoryMounts.mockClear();
});

describe('History day — a failed load is said, not drawn as an empty day', () => {
  it('a loaded empty day draws its diary, with no error', async () => {
    const screen = await render(<DayDetail />);
    expect(screen.queryByTestId('day-error')).toBeNull();
    expect(screen.getByTestId('slot-add-breakfast')).toBeTruthy();
  });

  it('a failed feed shows the error and Retry in place of the empty diary', async () => {
    mockHistory.error = new Error('offline');
    const screen = await render(<DayDetail />);
    expect(screen.getByTestId('day-error')).toBeTruthy();
    expect(screen.getByText("Couldn't load this day. Check your connection, then tap Retry.")).toBeTruthy();
    // The four empty meal slots would read as a real, empty day.
    expect(screen.queryByTestId('slot-add-breakfast')).toBeNull();
  });

  it('a failed month fetch counts too', async () => {
    mockHistory.olderMonths = { loading: false, error: new Error('offline') };
    const screen = await render(<DayDetail />);
    expect(screen.getByTestId('day-error')).toBeTruthy();
  });

  it('Retry remounts the screen, which reopens every listener', async () => {
    mockHistory.error = new Error('offline');
    const screen = await render(<DayDetail />);
    expect(mockHistoryMounts).toHaveBeenCalledTimes(1);
    mockHistory.error = null;
    await fireEvent.press(screen.getByTestId('day-retry'));
    expect(mockHistoryMounts).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('day-error')).toBeNull();
  });
});

describe('add sheet — More ways never buries the search', () => {
  const sheet = (visible: boolean) => (
    <EntrySheet visible={visible} editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" />
  );

  it('folds away as soon as a search is typed', async () => {
    const screen = await render(sheet(true));
    await fireEvent.press(screen.getByTestId('open-more'));
    expect(screen.getByTestId('open-recipe')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'greek');
    expect(screen.queryByTestId('open-recipe')).toBeNull();
    expect(screen.getByTestId('open-more').props.accessibilityState).toMatchObject({ expanded: false });
  });

  it('is closed, and the search empty, on the next open', async () => {
    const screen = await render(sheet(true));
    await fireEvent.press(screen.getByTestId('open-more'));
    expect(screen.getByTestId('open-recipe')).toBeTruthy();
    // A dismissal by swipe is the owner flipping `visible` off.
    await screen.rerender(sheet(false));
    await screen.rerender(sheet(true));
    expect(screen.queryByTestId('open-recipe')).toBeNull();
    expect(screen.getByTestId('food-search-input').props.value ?? '').toBe('');
  });
});
