/**
 * Body re-score (S20, 2026-10-04, scored 81) — the verified bugs and gaps.
 *
 * `body-review.test.tsx` pins the first review's fixes; this pins the second
 * reviewer's list: the goal that was never "reached" once passed (bug 1), the
 * two-tap outlier save (2), deleted weigh-ins returning after "All" (3), the
 * sliding milestone start (4), the chart memo (5), the sheet hand-off race
 * (6), locale prefills (8), the method-chip discard guard (9), and the gaps —
 * a 7-day average, measurement trends, an adjustable day, a body-fat profile
 * gap with somewhere to go, row labels that do not repeat their hint, and an
 * Android long-press.
 */
import React from 'react';
import { Platform } from 'react-native';
import type { Measurement } from '@macrolog/core';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { mergeOlderWeights } from '@/hooks/useBody';
import { measurementSeries } from '@/components/body/MeasurementTrends';
import { dotsPath, weightChartGeometry } from '@/components/body/weight-chart-geometry';

jest.mock('@/lib/ledger', () => ({
  recordMilestone: jest.fn(),
  switchToMaintenance: jest.fn(),
  subscribeMilestones: () => () => {},
}));
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
  ToastSheetHost: () => null,
}));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (o: unknown) => mockConfirm(o),
  ConfirmHost: () => null,
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));

let mockProfile: Record<string, unknown> = { sex: 'male', heightIn: 70 };
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: mockProfile }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useFocusEffect: () => {},
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({}),
    router: { setParams: jest.fn(), push: jest.fn() },
  };
});

/** The portal's "is a native sheet still up?" — driven per test. */
let mockSheetActive = false;
let mockIdle: (() => void) | null = null;
jest.mock('@/lib/sheet-portal', () => ({
  ...jest.requireActual('@/lib/sheet-portal'),
  isAnySheetActive: () => mockSheetActive,
  onSheetsIdle: (cb: () => void) => {
    mockIdle = cb;
    return () => {
      mockIdle = null;
    };
  },
}));

/** The chart, reduced to a prop recorder: bug 5 is about its props. */
const mockChartProps: Record<string, unknown>[] = [];
jest.mock('@/components/body/WeightChart', () => ({
  WeightChart: (p: Record<string, unknown>) => {
    mockChartProps.push(p);
    return null;
  },
}));

const mockSetWeight = jest.fn();
let mockState: Record<string, unknown> = {};
jest.mock('@/hooks/useBody', () => ({
  ...jest.requireActual('@/hooks/useBody'),
  useBody: () => mockState,
}));

import BodyScreen from '@/app/(app)/body';
import { BodyFatCard } from '@/components/body/BodyFatCard';
import { MeasurementSheet } from '@/components/body/MeasurementSheet';

const TODAY = '2026-09-28';
const loadAll = jest.fn();

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
    loadAllHistory: loadAll,
    setWeight: mockSetWeight,
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

beforeEach(() => {
  jest.useRealTimers();
  mockProfile = { sex: 'male', heightIn: 70 };
  mockState = body();
  mockShowToast.mockClear();
  mockConfirm.mockClear();
  mockPush.mockClear();
  mockChartProps.length = 0;
  mockSheetActive = false;
  mockIdle = null;
  mockSetWeight.mockReset();
  mockSetWeight.mockResolvedValue({ landed: Promise.resolve('saved'), trend: { beforeLb: 180.4, afterLb: 180.2 } });
});

type Screen = Awaited<ReturnType<typeof render>>;
const titleOf = (s: Screen) => String(s.getByTestId('weight-title').props.children);

describe('bug 1 — a goal passed in its own direction is reached', () => {
  // The arithmetic itself is core's (`computeGoalProgress`, targets.test.ts).
  it('the hero says "Goal reached" once remaining is 0', async () => {
    mockState = body({ goalProgress: { startWeight: 200, currentWeight: 178, goalWeight: 180, pct: 100, remaining: 0 } });
    const s = await render(<BodyScreen />);
    expect(s.getByText('Goal reached 🎉')).toBeTruthy();
  });
});

describe('bug 3 — the "All" fetch never resurrects a recent day', () => {
  it('takes only days older than the window from the one-time fetch', () => {
    const older = { '2024-01-01': 200, '2026-09-01': 185, '2026-09-10': 184 };
    // Sep 10 was deleted after the fetch: the live snapshot no longer has it.
    const snap = { '2026-09-01': 185 };
    expect(mergeOlderWeights(older, snap, '2025-08-24')).toEqual({ '2024-01-01': 200, '2026-09-01': 185 });
  });
});

describe('bug 4 — milestones measure from the stable start', () => {
  it('"since you started" is measured from startLb, not the oldest loaded trend point', async () => {
    mockProfile = { sex: 'male', heightIn: 70, goalDirection: 'lose' };
    mockState = body({
      startLb: 200,
      // The sliding window's oldest reading — the old, wrong start.
      trendPoints: [{ dateKey: '2026-09-20', weightLb: 190 }],
    });
    mockSetWeight.mockResolvedValueOnce({ landed: Promise.resolve('saved'), trend: { beforeLb: 195.2, afterLb: 194.9 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179.6');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Trend down 5 lb since you started 🎉', expect.anything()),
    );
  });
});

describe('bug 5 — the chart gets a stable loader, not a fresh closure', () => {
  it('passes loadAllHistory itself, the same reference on every render', async () => {
    mockState = body({
      weightPoints: [
        { dateKey: '2026-09-20', weightLb: 181.5 },
        { dateKey: TODAY, weightLb: 180 },
      ],
    });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('measure-how-toggle'));
    expect(mockChartProps.length).toBeGreaterThanOrEqual(2);
    for (const p of mockChartProps) expect(p.onNeedAll).toBe(loadAll);
  });
});

describe('bug 6 — the history sheet hands off to the editor once it has gone', () => {
  const many = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`2026-09-${String(10 + i).padStart(2, '0')}`, 180 + i / 10]),
  );

  it('waits for the portal to go idle while a native sheet is still up', async () => {
    mockState = body({ weights: many });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('weighins-show-all'));
    mockSheetActive = true;
    await fireEvent.press(s.getByTestId('weighin-2026-09-10'));
    // Nothing opens on a timer while the history sheet is still dismissing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(s.queryByTestId('weight-title')).toBeNull();
    expect(mockIdle).not.toBeNull();
    await act(async () => mockIdle!());
    await waitFor(() => expect(titleOf(s)).toBe('Edit weigh-in · Sep 10'));
  });
});

describe('bug 8 — prefills are written in the user\'s decimal mark', () => {
  it('a Brazilian kilogram user opens on "81,6", and it is still not a change', async () => {
    mockProfile = { sex: 'male', heightIn: 70, unitSystem: 'metric', preferredLocale: 'pt-BR' };
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await waitFor(() => expect(s.getByTestId('weight-input').props.value).toBe('81,6'));
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(s.queryByTestId('weight-input')).toBeNull());
    expect(mockSetWeight).not.toHaveBeenCalled();
  });

  it('a measurement edit prefills "84,6" for a metric pt-BR user', async () => {
    mockProfile = { sex: 'male', heightIn: 70, preferredLocale: 'pt-BR' };
    const row: Measurement = { id: 'm1', date: new Date(2026, 8, 20, 12), waist: 33.3 };
    const s = await render(
      <MeasurementSheet visible initial={row} latest={[row]} todayKey={TODAY} onSave={jest.fn()} onClose={jest.fn()} unitSystem="metric" />,
    );
    expect(s.getByTestId('measure-waist').props.value).toBe('84,6');
  });
});

describe('bug 9 — changing only the body-fat method still asks before discarding', () => {
  it('a backdrop tap after flipping the method raises the discard confirm', async () => {
    const row: Measurement = { id: 'm1', date: new Date(2026, 8, 20, 12), waist: 33, bodyFatPct: 18, bodyFatMethod: 'dxa' };
    const onClose = jest.fn();
    const s = await render(
      <MeasurementSheet
        visible
        showBodyFat
        initial={row}
        latest={[row]}
        todayKey={TODAY}
        onSave={jest.fn()}
        onClose={onClose}
        unitSystem="us"
      />,
    );
    await fireEvent.press(s.getByTestId('measure-bf-other'));
    await fireEvent.press(s.getByTestId('measure-sheet-backdrop'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Discard' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('gaps', () => {
  it('a 7-day average sits beside the pace', async () => {
    mockState = body({ weekAverage: { avgLb: 180.44, count: 3 } });
    const s = await render(<BodyScreen />);
    const chip = s.getByTestId('week-average');
    const text = (chip.props.children as unknown[]).flat(3).map((c) => (typeof c === 'string' ? c : '')).join('');
    expect(text).toContain('7-day avg');
    expect(s.getByText(/180\.4/)).toBeTruthy();
  });

  it('a site with two readings gets a trend card with one spoken sentence', async () => {
    const rows: Measurement[] = [
      { id: 'b', date: new Date(2026, 8, 20, 12), waist: 33 },
      { id: 'a', date: new Date(2026, 7, 2, 12), waist: 34, neck: 15 },
    ];
    mockState = body({ measurements: rows });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('measure-trend-waist').props.accessibilityLabel).toBe('Waist 33 in, down 1.0 in since Aug 2');
    // One neck reading is not a trend.
    expect(s.queryByTestId('measure-trend-neck')).toBeNull();
  });

  it('the day in the weigh-in sheet is adjustable to a screen reader', async () => {
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    const day = s.getByTestId('weight-day');
    expect(day.props.accessibilityRole).toBe('adjustable');
    expect(day.props.accessibilityValue).toEqual({ text: 'Today' });
    await fireEvent(day, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await waitFor(() => expect(titleOf(s)).toBe('Log weigh-in · Sep 27'));
    // Today is the ceiling, for the rotor too.
    await fireEvent(s.getByTestId('weight-day'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(s.getByTestId('weight-day'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await waitFor(() => expect(titleOf(s)).toBe('Update today\'s weight'));
  });

  it('rows are named by what they are; the hint says what a tap does', async () => {
    const s = await render(<BodyScreen />);
    const row = s.getByTestId(`weighin-${TODAY}`);
    expect(row.props.accessibilityLabel).toBe('Mon, Sep 28 weigh-in');
    expect(row.props.accessibilityHint).toBe('Opens it to edit. Remove is in the actions.');
  });

  it('a missing sex/height offers the way to set it', async () => {
    const s = await render(<BodyFatCard shown={null} navyPct={null} gap="profile" missing={[]} />);
    expect(s.getByTestId('bodyfat-source').props.children).toBe('Needs your sex and height');
    await fireEvent.press(s.getByTestId('bodyfat-set-profile'));
    expect(mockPush).toHaveBeenCalledWith('/refine-targets');
  });

  it('the measurement gap has no profile button', async () => {
    const s = await render(<BodyFatCard shown={null} navyPct={null} gap="measurement" missing={['waist']} />);
    expect(s.queryByTestId('bodyfat-set-profile')).toBeNull();
  });

  describe('Android long-press', () => {
    const original = Platform.OS;
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    });
    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
    });

    it('opens a menu with the same two actions as the iOS context menu', async () => {
      const del = jest.fn().mockResolvedValue({ landed: Promise.resolve('saved'), fromHealth: Promise.resolve(false) });
      mockState = body({ deleteWeighIn: del });
      const s = await render(<BodyScreen />);
      await fireEvent(s.getByTestId(`weighin-${TODAY}`), 'longPress');
      await waitFor(() => expect(s.getByTestId(`weighin-${TODAY}-menu`)).toBeTruthy());
      await fireEvent.press(s.getByTestId(`weighin-delete-${TODAY}-menu`));
      await waitFor(() => expect(del).toHaveBeenCalledWith(TODAY));
    });
  });
});

describe('pure helpers', () => {
  it('measurementSeries keeps one reading per day, oldest first', () => {
    const rows: Measurement[] = [
      { id: 'c', date: new Date(2026, 8, 20, 18), waist: 32.5 },
      { id: 'b', date: new Date(2026, 8, 20, 8), waist: 33 },
      { id: 'a', date: new Date(2026, 7, 2, 12), waist: 34 },
      { id: 'z', date: new Date(2026, 7, 1, 12), neck: 15 },
    ];
    expect(measurementSeries(rows, 'waist')).toEqual([
      { dateKey: '2026-08-02', weightLb: 34 },
      { dateKey: '2026-09-20', weightLb: 32.5 },
    ]);
  });

  it('dotsPath draws every reading as two arcs in ONE path', () => {
    const d = dotsPath([10, 20], [5, 6], 2);
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.match(/ a /g)).toHaveLength(4);
    expect(d.startsWith('M 8.00 5.00 a 2.00 2.00 0 1 0 4.00 0')).toBe(true);
    expect(dotsPath([], [], 2)).toBe('');
  });

  it('the geometry names its middle value and middle day', () => {
    const pts = [
      { dateKey: '2026-09-01', weightLb: 190 },
      { dateKey: '2026-09-11', weightLb: 180 },
    ];
    const g = weightChartGeometry(pts, pts, { width: 200, height: 100, padL: 0, padR: 0, padT: 0, padB: 0 })!;
    expect(g.midLb).toBe(185);
    expect(g.midY).toBe(50);
    expect(g.midDateKey).toBe('2026-09-06');
    const one = weightChartGeometry([pts[0]], [pts[0]], { width: 200, height: 100, padL: 0, padR: 0, padT: 0, padB: 0 })!;
    expect(one.midDateKey).toBeNull();
  });
});
