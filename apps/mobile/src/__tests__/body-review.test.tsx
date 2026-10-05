/**
 * Body review (2026-10-04, scored 71/100) — the screen-level fixes.
 *
 * The data half lives in `pending-body.test.ts` (offline durability),
 * `health-import-overrides.test.ts` (deleted weigh-ins stay deleted) and
 * `packages/core/src/weight-trend.test.ts` (the trend math). These pin what
 * the person holding the phone sees: the right day named, an unchanged value
 * left unchanged, a typo questioned, a save that closes even when the server
 * never answers, and the receipts that say what happened.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

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
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));

let mockProfile: Record<string, unknown> = { sex: 'male', heightIn: 70 };
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: mockProfile }),
}));

const mockSetWeight = jest.fn();
let mockState: Record<string, unknown> = {};
jest.mock('@/hooks/useBody', () => ({ useBody: () => mockState }));

import BodyScreen from '@/app/(app)/body';

const TODAY = '2026-09-28';

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
    hasOlderHistory: false,
    loadAllHistory: jest.fn(),
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
  mockProfile = { sex: 'male', heightIn: 70 };
  mockState = body();
  mockShowToast.mockClear();
  mockSetWeight.mockReset();
  mockSetWeight.mockResolvedValue({
    landed: Promise.resolve('saved'),
    trend: { beforeLb: 180.4, afterLb: 180.2 },
  });
});

type Screen = Awaited<ReturnType<typeof render>>;
const noteOf = (s: Screen) => String(s.getByTestId('weight-note').props.children);
const titleOf = (s: Screen) => String(s.getByTestId('weight-title').props.children);

describe('the weigh-in sheet names the day it writes (bug 4, C3, U2)', () => {
  it('a past row is "Edit weigh-in · Sep 20", and its note never says Today', async () => {
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('weighin-2026-09-20'));
    await waitFor(() => expect(titleOf(s)).toBe('Edit weigh-in · Sep 20'));
    expect(noteOf(s)).toBe('Was 181.5 lb');
  });

  it('a missed day is reachable with the day stepper, and saves to THAT day', async () => {
    mockState = body({ weights: { '2026-09-20': 181.5 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await waitFor(() => expect(titleOf(s)).toBe('Log weight'));
    // Today is the ceiling — nobody weighed themselves tomorrow.
    expect(s.getByTestId('weight-day-next').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(s.getByTestId('weight-day-prev'));
    await waitFor(() => expect(titleOf(s)).toBe('Log weigh-in · Sep 27'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '181');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(mockSetWeight).toHaveBeenCalledWith(181, '2026-09-27'));
  });
});

describe('display precision (bug 3)', () => {
  it('an untouched kilogram prefill is not a change — no preview, no write', async () => {
    mockProfile = { sex: 'male', heightIn: 70, unitSystem: 'metric' };
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await waitFor(() => expect(s.getByTestId('weight-input').props.value).toBe('81.6'));
    expect(noteOf(s)).not.toContain('→');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(s.queryByTestId('weight-input')).toBeNull());
    // Saving 81.6 used to rewrite 180 lb as 179.897.
    expect(mockSetWeight).not.toHaveBeenCalled();
  });
});

describe('the outlier check (U7)', () => {
  it('asks once before saving a weight 12 lb from the previous weigh-in', async () => {
    mockState = body({ weights: { '2026-09-20': 181.5 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '193.5');
    expect(noteOf(s)).toBe("That's 12 lb from your Sep 20 weigh-in. If it's right, tap Save anyway.");
    await fireEvent.press(s.getByTestId('weight-save'));
    expect(mockSetWeight).not.toHaveBeenCalled();
    expect(s.getByText('Save anyway')).toBeTruthy();
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(mockSetWeight).toHaveBeenCalledWith(193.5, TODAY));
  });
});

describe('saving closes on the local write (bug 2) and says how the trend moved (D3)', () => {
  it('closes even while the server has not answered', async () => {
    mockSetWeight.mockResolvedValueOnce({ landed: new Promise(() => {}), trend: { beforeLb: null, afterLb: null } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179.6');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(s.queryByTestId('weight-input')).toBeNull());
  });

  it('the receipt names the trend move', async () => {
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179.6');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Saved · trend −0.2 lb', expect.anything()));
  });

  it('a queued save says it will sync', async () => {
    mockSetWeight.mockResolvedValueOnce({ landed: Promise.resolve('queued'), trend: { beforeLb: 180, afterLb: 180 } });
    const s = await render(<BodyScreen />);
    await fireEvent.press(s.getByTestId('log-weight'));
    await fireEvent.changeText(s.getByTestId('weight-input'), '179.6');
    await fireEvent.press(s.getByTestId('weight-save'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Saved offline — syncs when you reconnect.', expect.anything()),
    );
  });
});

describe('the hero says what it is showing (bug 5, U3, D1, A10)', () => {
  it('no weight: an empty state, not "Most recent weight" over a dash', async () => {
    mockState = body({ weights: {}, currentWeight: null });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('hero-caption').props.children).toBe('No weigh-ins yet — log one to start your trend.');
  });

  it('latest not today: names its date', async () => {
    mockState = body({ weights: { '2026-09-20': 181.5 } });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('hero-caption').props.children).toBe('Most recent · Sep 20');
  });

  it('shows the trend weight beside the scale weight, and the weigh-in count', async () => {
    mockState = body({
      trendWeight: 180.64,
      weightPoints: [
        { dateKey: '2026-09-20', weightLb: 181.5 },
        { dateKey: TODAY, weightLb: 180 },
      ],
      trendPoints: [
        { dateKey: '2026-09-20', weightLb: 181.5 },
        { dateKey: TODAY, weightLb: 180.64 },
      ],
      consistency: { logged: 12, days: 14 },
    });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('trend-weight').props.accessibilityLabel).toBe('Trend weight 180.6 lb');
    expect(s.getByTestId('weigh-in-consistency').props.children).toBe('Weighed in 12 of the last 14 days');
  });

  it('the goal bar is a progress bar to assistive tech', async () => {
    mockState = body({ goalProgress: { startWeight: 190, currentWeight: 180, goalWeight: 170, pct: 50, remaining: 10 } });
    const s = await render(<BodyScreen />);
    const bar = s.getByTestId('goal-progress');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual(expect.objectContaining({ min: 0, max: 100, now: 50 }));
  });
});

describe('copy', () => {
  it('the empty measurements line names THIS user\'s missing inputs and unit (bug 8)', async () => {
    mockProfile = { sex: 'female', heightIn: 64, unitSystem: 'metric' };
    mockState = body({ bodyFatMissing: ['waist', 'neck', 'hip'] });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('no-measurements').props.children).toBe(
      'No measurements yet. Tape your waist, neck and hip (centimeters) to estimate body fat.',
    );
  });

  it('every row carries its change from the previous weigh-in (U6)', async () => {
    mockState = body({
      weighIns: [
        { dateKey: TODAY, weight: 180, deltaLb: -1.5 },
        { dateKey: '2026-09-20', weight: 181.5, deltaLb: null },
      ],
    });
    const s = await render(<BodyScreen />);
    expect(s.getByTestId(`weighin-${TODAY}`).props.accessibilityValue).toEqual({ text: '180 lb, down 1.5 lb' });
  });

  it('the Save buttons are buttons (A2)', async () => {
    const s = await render(<BodyScreen />);
    expect(s.getByTestId('log-weight').props.accessibilityRole).toBe('button');
    await fireEvent.press(s.getByTestId('log-weight'));
    expect(s.getByTestId('weight-save').props.accessibilityRole).toBe('button');
  });
});
