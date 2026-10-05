/**
 * Body re-score 3 (S20, 1.2.5 code, scored 82.8) — the verified bugs and gaps
 * that are JS and ship over the air:
 *
 * bug 2 (a context-menu Edit opened into the menu's dismissal), bug 3 (the
 * goal celebration on one scale reading), bug 4 (a caption for a dash not
 * drawn), bug 5 (an auto "All" that never fetched all), bug 6 (Undo of a
 * scale's weigh-in duplicating it in Health), and the gaps — Remove in the
 * edit sheets, tappable measurement trends, row previews, one sync-time
 * formatter, one success haptic per save and a "lowest since" receipt.
 *
 * FastSheet's bug 1 is pinned in `fast-sheet-native.test.tsx`; goal progress
 * on the trend in `use-body-rescore.test.tsx` and core's `weight-trend.test.ts`.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

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
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn(), ConfirmHost: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn(), selection: jest.fn() }));

let mockProfile: Record<string, unknown> = { sex: 'male', heightIn: 70 };
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: mockProfile }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: () => {},
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  router: { setParams: jest.fn(), push: jest.fn() },
}));

/** The iOS context menu, reduced to what the row hands it. */
const mockMenus: { title?: string; actions: { key: string; onPress: () => void }[]; preview?: unknown; onPreviewPress?: () => void }[] = [];
jest.mock('@/components/ContextMenu', () => ({
  CONTEXT_MENUS: false,
  ContextMenu: (p: { children: React.ReactNode; title?: string; actions: { key: string; onPress: () => void }[]; preview?: unknown; onPreviewPress?: () => void }) => {
    mockMenus.push(p);
    return p.children;
  },
}));

let mockState: Record<string, unknown> = {};
jest.mock('@/hooks/useBody', () => ({
  ...jest.requireActual('@/hooks/useBody'),
  useBody: () => mockState,
}));

import BodyScreen from '@/app/(app)/body';
import { HistoryRow } from '@/components/body/HistoryRow';
import { WeightChart } from '@/components/body/WeightChart';
import { siteRows } from '@/components/body/MeasurementSiteSheet';
import { rowPreviewHeight } from '@/components/body/RowPreview';
import { syncWhen } from '@/components/body/HealthFooter';
import * as hapticsModule from '@/lib/haptics';

const mockHaptics = hapticsModule as unknown as Record<'tap' | 'success' | 'warning' | 'selection', jest.Mock>;

const TODAY = '2026-10-05';
const mockSetWeight = jest.fn();
const mockDeleteWeighIn = jest.fn();
const mockDeleteMeasurement = jest.fn();

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
    setWeight: mockSetWeight,
    deleteWeighIn: mockDeleteWeighIn,
    measurements: [],
    bodyFat: null,
    bodyFatGap: 'measurement',
    bodyFatMissing: ['waist', 'neck'],
    bodyFatShown: null,
    addMeasurement: jest.fn(),
    updateMeasurement: jest.fn(),
    deleteMeasurement: mockDeleteMeasurement,
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
  mockSetWeight.mockReset();
  mockDeleteWeighIn.mockReset();
  mockDeleteMeasurement.mockReset();
  (['tap', 'success', 'warning', 'selection'] as const).forEach((k) => mockHaptics[k].mockClear());
  mockMenus.length = 0;
});

function lastToastText(): string {
  const calls = mockShowToast.mock.calls;
  return calls[calls.length - 1]?.[0] as string;
}

describe('bug 3 — the goal celebration waits for the trend', () => {
  it('a scale reading reaching the goal does not celebrate; the trend crossing does', async () => {
    const progress = (remaining: number) => ({ startWeight: 200, currentWeight: 180, goalWeight: 180, pct: 100, remaining });
    mockState = body({ goalProgress: progress(1), goalCrossed: false });
    const s = await render(<BodyScreen />);
    mockState = body({ goalProgress: progress(0), goalCrossed: false });
    await s.rerender(<BodyScreen />);
    expect(mockHaptics.success).not.toHaveBeenCalled();

    mockState = body({ goalProgress: progress(0), goalCrossed: true });
    await s.rerender(<BodyScreen />);
    await waitFor(() => expect(mockHaptics.success).toHaveBeenCalledTimes(1));
  });

  it('an already-crossed goal does not celebrate on every visit', async () => {
    mockState = body({ goalCrossed: true });
    await render(<BodyScreen />);
    expect(mockHaptics.success).not.toHaveBeenCalled();
  });
});

describe('bug 6 — Undo of a weigh-in that came from Health', () => {
  async function deleteAndUndo(fromHealth: boolean) {
    mockDeleteWeighIn.mockResolvedValue({ landed: Promise.resolve('saved'), fromHealth: Promise.resolve(fromHealth) });
    mockSetWeight.mockResolvedValue({ landed: Promise.resolve('saved'), trend: { beforeLb: null, afterLb: null } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId(`weighin-delete-${TODAY}-swipe`));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const opts = mockShowToast.mock.calls[0][1] as { action: { onPress: () => void } };
    await act(async () => opts.action.onPress());
    await waitFor(() => expect(mockSetWeight).toHaveBeenCalled());
  }

  it('a scale reading (no Ignia sample removed) goes back without a Health write', async () => {
    await deleteAndUndo(false);
    expect(mockSetWeight).toHaveBeenCalledWith(180, TODAY, { health: false });
  });

  it("Ignia's own sample, removed by the delete, goes back to Health", async () => {
    await deleteAndUndo(true);
    expect(mockSetWeight).toHaveBeenCalledWith(180, TODAY);
  });
});

describe('Delight — one success haptic, and "lowest since"', () => {
  it('a trend milestone pulses without a second success haptic', async () => {
    mockState = body({ startLb: 200 });
    mockProfile = { sex: 'male', heightIn: 70, goalDirection: 'lose' };
    mockSetWeight.mockResolvedValue({ landed: Promise.resolve('saved'), trend: { beforeLb: 195.2, afterLb: 194.8 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(lastToastText()).toMatch(/Trend down 5 lb/));
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
  });

  it('a weigh-in that beats two weeks of mornings says "lowest since"', async () => {
    mockState = body({ weights: { '2026-09-10': 179.2, '2026-09-20': 181.5, '2026-09-28': 180.4 } });
    mockProfile = { sex: 'male', heightIn: 70, goalDirection: 'lose' };
    mockSetWeight.mockResolvedValue({ landed: Promise.resolve('saved'), trend: { beforeLb: 180.6, afterLb: 180.5 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179.6');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(lastToastText()).toBe('Saved · lowest since Sep 10'));
  });

  it('a maintainer gets the plain trend receipt', async () => {
    mockState = body({ weights: { '2026-09-10': 179.2, '2026-09-28': 180.4 } });
    mockSetWeight.mockResolvedValue({ landed: Promise.resolve('saved'), trend: { beforeLb: 180.6, afterLb: 180.5 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '170');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(lastToastText()).toBe('Saved · trend −0.1 lb'));
  });
});

describe('Remove in the edit sheets', () => {
  it('the weigh-in sheet removes the day it is on, with the Undo receipt', async () => {
    mockDeleteWeighIn.mockResolvedValue({ landed: Promise.resolve('saved'), fromHealth: Promise.resolve(false) });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId(`weighin-${TODAY}`));
    await fireEvent.press(s.getByTestId('weight-delete'));
    await waitFor(() => expect(mockDeleteWeighIn).toHaveBeenCalledWith(TODAY));
    await waitFor(() => expect(lastToastText()).toBe('Weigh-in removed'));
  });

  it('a day with no weigh-in has nothing to remove', async () => {
    mockState = body({ weights: { '2026-09-20': 181.5 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    expect(s.queryByTestId('weight-delete')).toBeNull();
  });

  it('the measurement sheet removes the row it edits', async () => {
    const m = { id: 'm1', date: new Date(2026, 9, 1, 12), waist: 33 };
    mockState = body({ measurements: [m] });
    mockDeleteMeasurement.mockResolvedValue({ landed: Promise.resolve('saved') });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('measurement-m1'));
    await fireEvent.press(s.getByTestId('measure-delete'));
    await waitFor(() => expect(mockDeleteMeasurement).toHaveBeenCalledWith('m1'));
  });
});

describe('measurement trends open a per-site chart', () => {
  it('tapping a card opens that site with every reading, newest first', async () => {
    const measurements = [
      { id: 'b', date: new Date(2026, 9, 1, 12), waist: 33 },
      { id: 'a', date: new Date(2026, 8, 1, 12), waist: 34 },
    ];
    mockState = body({ measurements });
    const s = await render(<BodyScreen />);
    const card = s.getByTestId('measure-trend-waist');
    expect(card.props.accessibilityRole).toBe('button');
    await fireEvent.press(card);
    await waitFor(() => expect(s.getByTestId('measure-site-sheet')).toBeTruthy());
    expect(s.getByTestId('measure-site-row-2026-10-01')).toBeTruthy();
    expect(s.getByTestId('measure-site-row-2026-09-01')).toBeTruthy();
  });

  it('siteRows carries each reading with its change, newest first', () => {
    expect(siteRows([{ dateKey: '2026-09-01', weightLb: 34 }, { dateKey: '2026-10-01', weightLb: 33 }])).toEqual([
      { dateKey: '2026-10-01', value: 33, delta: -1 },
      { dateKey: '2026-09-01', value: 34, delta: null },
    ]);
  });
});

describe('bug 2 + previews — the row context menu', () => {
  it('Edit waits for the menu to finish closing; Remove does not', async () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    await render(
      <HistoryRow label="Mon, Oct 5 weigh-in" onEdit={onEdit} onDelete={onDelete} preview={<Text>p</Text>} previewSize={{ width: 300, height: 120 }}>
        <Text>row</Text>
      </HistoryRow>,
    );
    const menu = mockMenus[mockMenus.length - 1];
    jest.useFakeTimers();
    menu.actions.find((a) => a.key === 'edit')!.onPress();
    expect(onEdit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(onEdit).toHaveBeenCalledTimes(1);
    menu.actions.find((a) => a.key === 'delete')!.onPress();
    expect(onDelete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
    // The preview is handed through, and tapping it edits (the menu has
    // already closed by then — `onPreviewTappedAnimationCompleted`).
    expect(menu.preview).toBeTruthy();
    expect(menu.onPreviewPress).toBe(onEdit);
  });

  it('Body rows hand the menu a preview', async () => {
    await render(<BodyScreen />);
    expect(mockMenus.some((m) => m.title === 'Mon, Oct 5 weigh-in' && m.preview != null)).toBe(true);
  });

  it('the preview grows with the text, to its cap', () => {
    expect(rowPreviewHeight(true, 1)).toBe(2 * 24 + 20 + 52 + 24);
    expect(rowPreviewHeight(true, 1, 2)).toBe(Math.round((2 * 24 + 20 + 52 + 24) * 1.3));
    expect(rowPreviewHeight(false, 3)).toBe(2 * 24 + 20 + 3 * 24);
  });
});

describe('the weight chart', () => {
  const pts = (keys: string[]) => keys.map((dateKey, i) => ({ dateKey, weightLb: 180 - i * 0.2 }));
  const props = {
    todayKey: TODAY,
    goalLb: null,
    unitSystem: 'us' as const,
    onNeedAll: jest.fn(),
  };

  it('bug 4: the dash caption shows only on the ranges that draw the dash', async () => {
    const p = pts(['2026-09-28', '2026-10-01', '2026-10-05']);
    const s = await render(<WeightChart {...props} points={p} trend={p} slopeLbPerWeek={-1} hasOlderHistory={false} testID="wc" />);
    expect(s.getByTestId('wc-caption')).toBeTruthy();
    await fireEvent.press(s.getByTestId('weight-range-6M'));
    expect(s.queryByTestId('wc-caption')).toBeNull();
  });

  it('bug 5: an automatic "All" fetches all', async () => {
    const onNeedAll = jest.fn();
    // One reading in the last year → no range has two → the chart opens on All.
    const p = pts(['2024-03-01', '2026-10-05']);
    await render(<WeightChart {...props} onNeedAll={onNeedAll} points={p} trend={p} slopeLbPerWeek={null} hasOlderHistory />);
    await waitFor(() => expect(onNeedAll).toHaveBeenCalled());
  });
});

describe('one sync-time formatter', () => {
  it('today is the time alone; an earlier day carries its date', () => {
    const now = new Date(2026, 9, 5, 15, 0);
    expect(syncWhen(new Date(2026, 9, 5, 9, 41), 'en', now)).toBe('9:41 AM');
    expect(syncWhen(new Date(2026, 9, 3, 9, 41), 'en', now)).toBe('Oct 3 9:41 AM');
  });
});
