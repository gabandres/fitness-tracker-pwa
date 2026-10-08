/**
 * Trends, S21 (2026-10-06) — the code-read and simulator reviews of HEAD.
 *
 * Pins: the hero's arithmetic in words; a young account opening on "All";
 * a skeleton instead of a spinner; the one segmented control (tablist, a real
 * 44/48 segment) for the range, macro and panel strips; locked weekly tiles and
 * an empty budget drawn as explicit placeholders; nice axis ticks and an
 * outlier day that no longer flattens the maintenance line; the carbs line's
 * contrast; and the recalibration card's old → new.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useScrollToTop: jest.fn(),
}));
jest.mock('@/lib/activity-suggestion', () => ({
  useActivitySuggestion: () => ({ suggestion: null, guidance: { kind: 'none' }, decline: jest.fn(), evidence: null }),
}));
jest.mock('@/hooks/useCountViewPerFocus', () => ({ useCountViewPerFocus: jest.fn() }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/components/WeeklyReportCard', () => ({ WeeklyReportCard: () => null }));
jest.mock('@/lib/reminders', () => ({ getTapeReminder: jest.fn(async () => null), setTapeReminder: jest.fn() }));

const mockTrends = jest.fn();
jest.mock('@/hooks/useTrends', () => ({ useTrends: (days: number, opts?: unknown) => mockTrends(days, opts) }));

let mockRecal: Record<string, unknown> = {};
jest.mock('@/hooks/useRecalibration', () => ({ useRecalibration: () => mockRecal }));

import React from 'react';
import { StyleSheet } from 'react-native';
import { type TdeeResult, type TdeeSeriesPoint, computeWeeklyInsights, type DaySummary } from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { palettes, TARGET } from '@/theme';
import Trends from '@/app/(app)/trends';
import { RecalibrationCard } from '@/components/RecalibrationCard';
import { fencesOf, niceTicks } from '@/components/charts/chart-geometry';
import { keepUnitsTogether, maintenanceBreakdown } from '@/components/charts/trend-copy';
import { fitsAllRange } from '@/components/charts/TrendsCharts';
import { en } from '@/i18n/en';
import type { TFn } from '@/i18n';

const MEASURED = {
  trueTdee: 2017,
  newDailyTarget: 1850,
  weightChangeTrend: -0.1,
  source: 'measured' as const,
  loggingCompletenessPct: 82,
  windowDays: 23,
  intakeDays: 21,
  spanDays: 28,
  reliable: true,
  outliersDropped: 0,
  measuredTdee: 2017,
  confidence: 1,
  avgDailyIntake: 1850,
  weightSlopeLbsPerDay: -0.0486,
  dailyDeficitAchieved: 170,
  ci95Tdee: 180,
};

function day(dateKey: string, totalCalories: number): DaySummary {
  return { dateKey, totalCalories, totalProtein: 120, totalCarbs: 0, totalFat: 0, mealCount: totalCalories > 0 ? 1 : 0, exercised: false, weightLb: null };
}

const KEYS = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(2026, 6, 7 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

function state(over: Record<string, unknown> = {}) {
  const series: TdeeSeriesPoint[] = KEYS.slice(-30).map((k, i) => ({ dateKey: k as never, kcal: 1990 + i, source: 'measured', ci95: 180, holding: false }));
  return {
    loading: false,
    error: null,
    insights: computeWeeklyInsights([day('a', 1849), day('b', 1849), day('c', 1849)], 1850, [], 120, 2017),
    loggedThisWeek: 3,
    proteinTarget: 120,
    tdee: MEASURED,
    targetCalories: 1850,
    budget: null,
    basalKcal: 0,
    activityLevel: null,
    sleep: { kind: 'pending' },
    fasting: { kind: 'pending' },
    water: { kind: 'pending' },
    composition: { enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false },
    chartKeys: KEYS,
    weightSeries: KEYS.map((k, i) => ({ dateKey: k, scale: i % 3 ? null : 180 - i * 0.02, trend: 180 - i * 0.02 })),
    intakeSeries: KEYS.map((_, i) => (i % 4 ? 1850 : null)),
    proteinSeries: KEYS.map((_, i) => (i % 4 ? 110 + (i % 20) : null)),
    carbsSeries: KEYS.map(() => 200),
    fatSeries: KEYS.map(() => 60),
    todayKey: KEYS[KEYS.length - 1],
    historyClip: null,
    insightWindow: { from: '2026-09-27', to: '2026-10-03' },
    streak: 0,
    settledKey: 0,
    expenditure: series,
    historyDays: 90,
    milestones: {},
    progress: null,
    ...over,
  };
}

const t = ((key: string, p: Record<string, unknown> = {}) =>
  String((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? `{${k}}`))) as unknown as TFn;
/** The breakdown glues numbers to units (U+00A0) and units to "/day" (U+2060);
 *  read it back as plain text. */
const plain = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ').replace(/\u2060/g, '');
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

beforeEach(() => {
  mockTrends.mockReset();
});

describe('why the maintenance number is what it is', () => {
  it('says the arithmetic in the user\'s unit — intake, trend, burn', () => {
    const b = maintenanceBreakdown(MEASURED as unknown as TdeeResult, 'us', t, 'en');
    expect(plain(b?.line)).toBe('You averaged 1,850 kcal/day while your trend moved −0.3 lb/wk — so you burn about 2,017 kcal/day.');
    expect(b?.blended).toBeNull();
    const kg = maintenanceBreakdown(MEASURED as unknown as TdeeResult, 'metric', t, 'en');
    expect(plain(kg?.line)).toMatch(/moved −0\.2 kg\/wk/);
  });

  it('cannot wrap inside "2,017 kcal/day" — no-break space and word joiners (S21 QA)', () => {
    const b = maintenanceBreakdown(MEASURED as unknown as TdeeResult, 'us', t, 'en');
    expect(b?.line).toContain('2,017\u00a0kcal\u2060/\u2060day.');
    expect(b?.line).toContain('0.3\u00a0lb\u2060/\u2060wk');
    // Every locale's units: "kcal/día", "kg/sem", "kcal/dia".
    expect(keepUnitsTogether('2.641 kcal/dia e 0,5 kg/sem')).toBe('2.641\u00a0kcal\u2060/\u2060dia e 0,5\u00a0kg\u2060/\u2060sem');
    expect(keepUnitsTogether('2,641 kcal/día')).toBe('2,641\u00a0kcal\u2060/\u2060día');
    // A word that merely starts like a unit is left alone.
    expect(keepUnitsTogether('3 kgs, 2 grams')).toBe('3 kgs, 2 grams');
  });

  it('says so when a thin record was blended toward the profile estimate', () => {
    const b = maintenanceBreakdown({ ...MEASURED, trueTdee: 2100, confidence: 0.7 } as unknown as TdeeResult, 'us', t, 'en');
    expect(plain(b?.blended)).toBe('While your record is still short, that is blended with your profile estimate: 2,100 kcal/day.');
  });

  it('is absent outside measured mode', () => {
    expect(maintenanceBreakdown({ source: 'formula', trueTdee: 2200 } as unknown as TdeeResult, 'us', t, 'en')).toBeNull();
  });

  it('renders under the hero, with the unit from i18n', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    expect(view.getByTestId('tdee-breakdown')).toHaveTextContent(/You averaged 1,850\skcal\u2060\/\u2060day/);
  });
});

describe('the first load and a young account', () => {
  it('loads into a skeleton shaped like the screen, not a spinner', async () => {
    mockTrends.mockReturnValue(state({ loading: true }));
    const view = await render(<Trends />);
    expect(view.getByTestId('trends-skeleton').props.accessibilityLabel).toBe('Loading trends');
  });

  it('opens on "All" under a month of history, and honours a chip tapped after', async () => {
    expect(fitsAllRange(12)).toBe(true);
    expect(fitsAllRange(30)).toBe(false);
    mockTrends.mockReturnValue(state({ historyDays: 12 }));
    const view = await render(<Trends />);
    expect(view.getByTestId('trend-range-all').props.accessibilityState).toEqual({ selected: true });
    expect(view.getByTestId('weight-trend-window')).toHaveTextContent('Last 12 days');
    await fireEvent.press(view.getByTestId('trend-range-1m'));
    expect(view.getByTestId('trend-range-1m').props.accessibilityState).toEqual({ selected: true });
  });
});

describe('one segmented control', () => {
  it('range, macro and panel strips are all tablists of real 44/48 pt tabs', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    for (const [list, tab] of [
      ['trend-range', 'trend-range-3m'],
      ['macro-tabs', 'macro-tab-carbs'],
      ['panel-tabs', 'panel-tab-budget'],
    ]) {
      expect(view.getByTestId(list).props.accessibilityRole).toBe('tablist');
      expect(view.getByTestId(tab).props.accessibilityRole).toBe('tab');
      expect(flat(view.getByTestId(tab).props.style).minHeight).toBe(TARGET);
    }
  });
});

describe('locked and empty, not loading', () => {
  it('a locked weekly tile says what unlocks it', async () => {
    mockTrends.mockReturnValue(state({ insights: null, loggedThisWeek: 1 }));
    const view = await render(<Trends />);
    expect(view.getAllByTestId('insights-locked')[0]).toHaveTextContent('Unlocks after 2 more logged days');
  });

  it('an empty budget draws seven dashed slots in a ≥3:1 colour', async () => {
    mockTrends.mockReturnValue(state({ budget: null }));
    const view = await render(<Trends />);
    await fireEvent.press(view.getByTestId('panel-tab-budget'));
    const bars = view.getAllByTestId('budget-placeholder-bar', { includeHiddenElements: true });
    expect(bars).toHaveLength(7);
    const s = flat(bars[0].props.style);
    expect(s.borderStyle).toBe('dashed');
    expect(s.borderColor).not.toBe(palettes.light.colors.line);
  });
});

describe('axes that read', () => {
  it('ticks are nice numbers — no more 16 / 86 / 155', () => {
    const { ticks, min, max } = niceTicks({ min: 16, max: 155 }, { floor: 0 });
    expect(min).toBeLessThanOrEqual(16);
    expect(max).toBeGreaterThanOrEqual(155);
    const step = ticks[1] - ticks[0];
    expect([1, 2, 2.5, 5]).toContain(step / 10 ** Math.floor(Math.log10(step)));
    ticks.forEach((v) => expect(v % step).toBeCloseTo(0));
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('a half-logged day is outside the fences, so it cannot stretch the maintenance axis', () => {
    const fence = fencesOf([1800, 1950, 2000, 2100, 2200, 2050, 200]);
    expect(fence).not.toBeNull();
    expect(200).toBeLessThan(fence!.min);
    expect(1800).toBeGreaterThanOrEqual(fence!.min);
  });

  it('weight ticks never need a second decimal', () => {
    const { ticks } = niceTicks({ min: 177.3, max: 178.1 });
    ticks.forEach((v) => expect(Math.round(v * 10)).toBeCloseTo(v * 10));
  });
});

describe('contrast — the carbs line', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  it('light draws carbs in `warn` (≥3:1 on card); dark keeps the ember', () => {
    expect(ratio(palettes.light.colors.habitFasting, palettes.light.colors.card)).toBeLessThan(3); // why it moved
    expect(ratio(palettes.light.colors.warn, palettes.light.colors.card)).toBeGreaterThanOrEqual(3);
    expect(ratio(palettes.dark.colors.habitFasting, palettes.dark.colors.card)).toBeGreaterThanOrEqual(3);
  });
});

describe('the recalibration card', () => {
  const digest = {
    available: true,
    trueTdee: 2380,
    calorieTarget: 1880,
    weightTrendLbPerWeek: -0.7,
    loggingCompletenessPct: 80,
    deltaSinceAck: -70,
    deltaVsFormula: -300,
    trend: 'metabolism-slowed',
    shouldSurface: true,
  };

  it('a drift shows old → new for maintenance and target, under a heading', async () => {
    mockRecal = { digest, acknowledge: jest.fn(), previous: { tdee: 2450, target: 1950 } };
    const view = await render(<RecalibrationCard recalibration={mockRecal as never} />);
    expect(view.getByText('Your target just recalibrated').props.accessibilityRole).toBe('header');
    const lines = view.getAllByTestId('recalibration-from-to');
    expect(lines[0]).toHaveTextContent('Maintenance: 2,450 → 2,380 kcal/day');
    expect(lines[1]).toHaveTextContent('Daily target: 1,950 → 1,880 kcal');
    // Calm, accurate wording — no "your metabolism has adapted".
    expect(view.queryByText(/metabolism has adapted/)).toBeNull();
    expect(flat(view.getByTestId('recalibration-ack').props.style).minHeight).toBe(TARGET);
  });

  it('a first showing names the profile estimate it replaces', async () => {
    mockRecal = { digest: { ...digest, deltaSinceAck: null }, acknowledge: jest.fn(), previous: null };
    const view = await render(<RecalibrationCard recalibration={mockRecal as never} />);
    expect(view.getByTestId('recalibration-from-to')).toHaveTextContent('Profile estimate 2,680 → measured 2,380 kcal/day');
  });
});
