/**
 * The third Today re-score (2026-10-05): water taps that no longer lose an
 * increment to a stale prop (B3), the + menu's Scan waiting out the menu's
 * dismissal (B1), and the History day's target line, Magic Tap Undo and
 * loading shape (Usability 4, Accessibility 8, Visual 14).
 */
import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { type DailyLog, dayBoundaryOf } from '@macrolog/core';

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockAct = jest.fn(() => true);
let mockProfile: Record<string, unknown> | null = null;
let mockLoading = false;
let mockMenuActions: { key: string; onPress: () => void }[] = [];

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/components/Toast', () => ({
  ToastSheetHost: () => null,
  useToast: () => ({ show: jest.fn(), act: mockAct }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
// The + button's iOS branch: the native menu, reduced to its actions.
jest.mock('@/components/ContextMenu', () => ({
  CONTEXT_MENUS: true,
  ContextMenu: ({ children, actions }: { children: React.ReactNode; actions: { key: string; onPress: () => void }[] }) => {
    mockMenuActions = actions;
    return children;
  },
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: (...a: unknown[]) => mockNavigate(...a) },
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: mockSetParams }),
  useLocalSearchParams: () => ({ date: '2026-09-20' }),
  Stack: { Screen: ({ options }: { options?: { headerTitle?: () => React.ReactNode } }) => options?.headerTitle?.() ?? null },
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }),
}));
jest.mock('@/lib/ledger', () => ({
  addLogWithId: jest.fn(),
  recordMilestone: jest.fn(),
  subscribeMilestones: () => () => {},
}));
jest.mock('@/lib/pending-logs', () => ({ undoAdds: jest.fn(), addLogDurably: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
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
  mealLabel: 'Chicken bowl',
  mealType: 'lunch',
  date: new Date(2026, 8, 20, 12, 30),
};
const mockBoundary = dayBoundaryOf(null);
jest.mock('@/hooks/useHistory', () => ({
  useHistory: () => ({
    loading: mockLoading,
    error: null,
    days: [],
    logs: [mockLunch],
    weights: {},
    presets: [],
    customFoods: [],
    boundary: mockBoundary,
    ensureMonthLoaded: jest.fn(),
    olderMonths: { loading: false, error: null },
    addEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    addPreset: jest.fn(),
    deletePreset: jest.fn(),
    addCustomFood: jest.fn(),
    deleteCustomFood: jest.fn(),
  }),
}));

import DayDetail from '@/app/history/[date]';
import { DailyMetrics, nextPendingWater, waterBase } from '@/components/DailyMetrics';
import { LogSpeedDial } from '@/components/LogSpeedDial';

beforeEach(() => {
  mockNavigate.mockClear();
  mockAct.mockClear();
  mockProfile = null;
  mockLoading = false;
});

describe('waterBase — a tap adds to the newest total written (B3)', () => {
  it('uses the prop when nothing is pending, or the pending record has expired', () => {
    expect(waterBase(16, null, 0)).toBe(16);
    expect(waterBase(16, { stale: [16], latest: 24, at: 0 }, 10_000)).toBe(16);
  });

  it('builds on the pending total while the prop still shows a value it wrote over', () => {
    // 16 → +8 written; the snapshot has not re-rendered yet.
    const p1 = nextPendingWater(16, null, 16, 24, 0);
    expect(p1).toEqual({ stale: [16], latest: 24, at: 0 });
    expect(waterBase(16, p1, 100)).toBe(24);
    // A second tap before any snapshot: 24 → 32, and 24 joins the stale set,
    // so the echo of the FIRST write cannot become the base either.
    const p2 = nextPendingWater(16, p1, 24, 32, 100);
    expect(p2.stale).toEqual([16, 24]);
    expect(waterBase(24, p2, 200)).toBe(32);
  });

  it('lets the prop win once it moves anywhere the component did not write', () => {
    const p = { stale: [16], latest: 24, at: 0 };
    // Another device set 40.
    expect(waterBase(40, p, 100)).toBe(40);
    expect(nextPendingWater(40, p, 40, 48, 100)).toEqual({ stale: [40], latest: 48, at: 100 });
  });

  it('two quick taps on the same stale prop both land', async () => {
    const onAddWater = jest.fn();
    const view = await render(
      <DailyMetrics
        water={16}
        sleep={null}
        fastStartedAt={null}
        onAddWater={onAddWater}
        onSetSleep={() => {}}
        onStartFast={() => {}}
        onBreakFast={() => {}}
      />,
    );
    await fireEvent.press(view.getByTestId('water-plus-8'));
    await fireEvent.press(view.getByTestId('water-plus-8'));
    expect(onAddWater.mock.calls.map((c) => c[0])).toEqual([24, 32]);
  });
});

describe('History day — re-score 3', () => {
  it('holds the calorie total against the target, read in the same stop', async () => {
    mockProfile = { targetMode: 'custom', manualCaloriesTarget: 2100, profileCompleted: true };
    const view = await render(<DayDetail />);
    expect(view.getByTestId('day-calorie-target')).toHaveTextContent('of 2,100');
    expect(view.getByLabelText('Calories, 640 of 2,100')).toBeTruthy();
  });

  it('shows no target before the profile is there — never the seed', async () => {
    const view = await render(<DayDetail />);
    expect(view.queryByTestId('day-calorie-target')).toBeNull();
    expect(view.getByLabelText('Calories, 640')).toBeTruthy();
  });

  it('runs the live toast action on Magic Tap', async () => {
    const view = await render(<DayDetail />);
    await fireEvent(view.getByTestId('day-detail'), 'magicTap');
    expect(mockAct).toHaveBeenCalledTimes(1);
  });

  it('loads into the day’s shape, announced once, not a bare spinner', async () => {
    mockLoading = true;
    const view = await render(<DayDetail />);
    const skeleton = view.getByTestId('day-skeleton');
    expect(skeleton.props.accessibilityLabel).toBe('Loading this day');
    expect(skeleton.props.accessibilityState).toEqual({ busy: true });
  });
});

// Last in the file: its fake timers outlive `useRealTimers` for the
// provider-wrapped renders that follow.
describe('LogSpeedDial — the native menu (B1)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Scan waits for the menu to finish closing before presenting /scan', async () => {
    await render(<LogSpeedDial />);
    const scan = mockMenuActions.find((a) => a.key === 'scan');
    expect(scan).toBeTruthy();
    scan!.onPress();
    expect(mockNavigate).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/scan');
  });
});
