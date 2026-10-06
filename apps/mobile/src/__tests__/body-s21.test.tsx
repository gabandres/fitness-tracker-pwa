/**
 * Body, S21 (2026-10-06) — the code-read and simulator reviews of HEAD.
 *
 * Pins: the range control is the shared segmented control (tablist/tab with
 * `selected`, a real 44/48 segment) and remembers the pick; the "?" in the
 * header opens a glossary that defines Trend; the dots/line legend is on every
 * range; latest == trend is not printed twice; pull-to-refresh calls the hook;
 * an odd count of tape cards keeps its columns and each card names its range;
 * and the two goal cards' buttons are real targets under a heading.
 */
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DatedWeight, Measurement } from '@macrolog/core';
import { palettes } from '@/theme';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

jest.mock('@/lib/ledger', () => ({
  recordMilestone: jest.fn(),
  switchToMaintenance: jest.fn(),
  subscribeMilestones: () => () => {},
}));
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/components/Toast', () => ({ showToast: jest.fn(), ToastSheetHost: () => null }));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn(), ConfirmHost: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: () => {},
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useScrollToTop: jest.fn(),
  router: { setParams: jest.fn(), push: jest.fn() },
}));

let mockState: Record<string, unknown> = {};
jest.mock('@/hooks/useBody', () => ({
  ...jest.requireActual('@/hooks/useBody'),
  useBody: () => mockState,
}));

import BodyScreen from '@/app/(app)/body';
import { WeightChart } from '@/components/body/WeightChart';
import { MaintenanceSwitchCard } from '@/components/MaintenanceSwitchCard';
import { TOUCH_TARGET } from '@/components/charts/SegmentedControl';

const TODAY = '2026-10-05';

function body(over: Record<string, unknown> = {}) {
  const weights = (over.weights as Record<string, number>) ?? { [TODAY]: 180, '2026-09-20': 181.5 };
  const keys = Object.keys(weights).sort().reverse();
  return {
    loading: false,
    error: null,
    currentWeight: keys.length ? weights[keys[0]] : null,
    currentWeightDateKey: keys[0] ?? null,
    todayWeight: weights[TODAY] ?? null,
    todayKey: TODAY,
    trendWeight: null,
    weighIns: keys.map((dateKey) => ({ dateKey, weight: weights[dateKey] })),
    weights,
    weightPoints: [],
    trendPoints: [],
    consistency: null,
    weekAverage: null,
    startLb: null,
    hasOlderHistory: false,
    loadAllHistory: jest.fn(),
    setWeight: jest.fn(),
    deleteWeighIn: jest.fn(),
    measurements: [],
    bodyFat: null,
    bodyFatGap: 'measurement',
    bodyFatMissing: ['waist', 'neck'],
    bodyFatShown: null,
    addMeasurement: jest.fn(),
    updateMeasurement: jest.fn(),
    deleteMeasurement: jest.fn(),
    restoreMeasurement: jest.fn(),
    projection: null,
    goalCrossed: false,
    weightSeries: [],
    projectedSeries: [],
    goalProgress: null,
    goalWeight: null,
    ...over,
  };
}

const pts = (keys: string[], w = 180): DatedWeight[] => keys.map((dateKey, i) => ({ dateKey, weightLb: w - i * 0.3 }));
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

beforeEach(() => {
  mockState = body();
});

describe('the weight chart range control', () => {
  const props = { todayKey: TODAY, goalLb: null, unitSystem: 'us' as const, onNeedAll: jest.fn(), slopeLbPerWeek: null, hasOlderHistory: false };

  it('is a tablist of tabs with `selected` — the same semantics as Trends', async () => {
    const p = pts(['2026-09-28', '2026-10-01', '2026-10-05']);
    const s = await render(<WeightChart {...props} points={p} trend={p} testID="wc" />);
    expect(s.getByTestId('weight-range').props.accessibilityRole).toBe('tablist');
    const chip = s.getByTestId('weight-range-1M');
    expect(chip.props.accessibilityRole).toBe('tab');
    expect(chip.props.accessibilityState).toEqual({ selected: true });
    expect(chip.props.accessibilityLabel).toBe('1 month');
  });

  it('is a real 44 pt / 48 dp segment, not a 32 pt face with slop', async () => {
    const p = pts(['2026-09-28', '2026-10-01', '2026-10-05']);
    const s = await render(<WeightChart {...props} points={p} trend={p} />);
    const style = flat(s.getByTestId('weight-range-3M').props.style);
    expect(style.minHeight).toBe(TOUCH_TARGET);
    expect(TOUCH_TARGET).toBe(Platform.OS === 'android' ? 48 : 44);
  });

  it('remembers the pick across mounts (persisted, like the Trends range)', async () => {
    const p = pts(['2026-05-01', '2026-07-01', '2026-09-28', '2026-10-01', '2026-10-05']);
    const first = await render(<WeightChart {...props} points={p} trend={p} />);
    await fireEvent.press(first.getByTestId('weight-range-6M'));
    expect(first.getByTestId('weight-range-6M').props.accessibilityState).toEqual({ selected: true });
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith('body.range', '6M'));
    // A fresh mount (re-render resets nothing — a new tree does).
    const second = await render(<WeightChart key="again" {...props} points={p} trend={p} />);
    expect(second.getByTestId('weight-range-6M').props.accessibilityState).toEqual({ selected: true });
  });

  it('says what the dots and the line are on a range with no dash', async () => {
    const p = pts(['2026-09-28', '2026-10-01', '2026-10-05']);
    const s = await render(<WeightChart {...props} points={p} trend={p} testID="wc" />);
    await fireEvent.press(s.getByTestId('weight-range-1Y'));
    expect(s.getByTestId('wc-caption')).toHaveTextContent('Dots are weigh-ins, the line is your trend');
  });
});

describe('the Body header and hero', () => {
  it('has a "?" that opens a glossary defining Trend', async () => {
    const s = await render(<BodyScreen />);
    const help = s.getByTestId('body-glossary-open');
    expect(help.props.accessibilityRole).toBe('button');
    expect(help.props.accessibilityLabel).toBe('What these numbers mean');
    await fireEvent.press(help);
    expect(s.getByTestId('body-glossary-title')).toHaveTextContent('Your weight, explained');
    expect(s.getByText(/A smoothed weight that follows every weigh-in/)).toBeTruthy();
    expect(s.getByText('Why the two differ')).toBeTruthy();
  });

  it('does not print the same number twice when the scale is on the trend', async () => {
    const p = pts(['2026-10-01', TODAY]);
    mockState = body({ weights: { [TODAY]: 177.5, '2026-10-01': 178 }, trendWeight: 177.5, weightPoints: p, trendPoints: p });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('trend-weight')).toHaveTextContent('Right on your trend');
    expect(s.getByTestId('trend-weight')).not.toHaveTextContent(/177/);
  });

  it('still prints the trend when it differs from the weigh-in', async () => {
    const p = pts(['2026-10-01', TODAY]);
    mockState = body({ weights: { [TODAY]: 177.5, '2026-10-01': 178 }, trendWeight: 178.1, weightPoints: p, trendPoints: p });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('trend-weight')).toHaveTextContent('Trend 178.1 lb');
  });

  it('pull-to-refresh runs the hook\'s refresh and lets go when it settles', async () => {
    const refresh = jest.fn(async () => {});
    mockState = body({ refresh });
    const s = await render(<BodyScreen />);
    await act(async () => {
      s.getByTestId('body-scroll').props.refreshControl.props.onRefresh();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(s.getByTestId('body-scroll').props.refreshControl.props.refreshing).toBe(false));
  });
});

describe('the tape cards', () => {
  const rows: Measurement[] = [
    { id: 'b', date: new Date(2026, 8, 20, 12), waist: 33, neck: 15, chest: 40 },
    { id: 'a', date: new Date(2026, 7, 2, 12), waist: 34, neck: 15.5, chest: 41 },
  ];

  it('an odd count keeps every card in its column, and each names its range', async () => {
    mockState = body({ measurements: rows });
    const s = await render(<BodyScreen />);
    const grid = s.getByTestId('measure-trends');
    // Three cards + one invisible spacer, so the lone last card is half width.
    expect(grid.props.children.flat().filter(Boolean)).toHaveLength(4);
    expect(s.getByTestId('measure-trend-range-waist')).toHaveTextContent('Range 33.0–34.0 in');
  });
});

describe('the maintenance-switch card', () => {
  it('has a heading and two real targets', async () => {
    const s = await render(<MaintenanceSwitchCard visible onSwitch={async () => {}} />);
    expect(s.getByText('Switch to maintenance?').props.accessibilityRole).toBe('header');
    expect(flat(s.getByTestId('maintenance-switch-yes').props.style).minHeight).toBe(TOUCH_TARGET);
    expect(flat(s.getByTestId('maintenance-switch-no').props.style).minHeight).toBe(TOUCH_TARGET);
  });
});

describe('contrast — the goal-progress fill', () => {
  // The review flagged light `ring` (2.54:1 on light CARD) as the goal fill.
  // The fill sits on the hero panel, which is dark in BOTH themes (ADR-0014):
  // measured where it is drawn, it clears 3:1 in both.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  it.each(['light', 'dark'] as const)('%s: ring on the hero track is ≥ 3:1', (scheme) => {
    const c = palettes[scheme].colors;
    expect(ratio(c.ring, c.heroTrack)).toBeGreaterThanOrEqual(3);
  });
});
