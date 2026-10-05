// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/lib/activity-suggestion', () => ({
  useActivitySuggestion: () => ({ suggestion: null, guidance: { kind: 'none' }, decline: jest.fn(), evidence: null }),
}));
jest.mock('@/hooks/useCountViewPerFocus', () => ({ useCountViewPerFocus: jest.fn() }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
// Both reach `lib/ledger` (firebase/firestore, untranspiled ESM). Neither is
// what this file is about.
jest.mock('@/components/WeeklyReportCard', () => ({ WeeklyReportCard: () => null }));
jest.mock('@/lib/reminders', () => ({ getTapeReminder: jest.fn(async () => null), setTapeReminder: jest.fn() }));

const mockTrends = jest.fn();
jest.mock('@/hooks/useTrends', () => ({ useTrends: (days: number) => mockTrends(days) }));

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeWeeklyBudget,
  computeWeeklyInsights,
  type DaySummary,
  type TdeeSeriesPoint,
} from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import Trends from '@/app/(app)/trends';
import { openingTags } from './jsx-scan';

/** Same rule as `a11y-roles.test.ts` (not imported: importing a test file
 *  re-registers its suites here). */
const TOUCHABLES = ['TouchableOpacity', 'Pressable', 'PressScale', 'AnimatedPressable'];
const HIDDEN = ['accessible={false}', 'accessibilityElementsHidden', 'importantForAccessibility'];
function findRoleless(source: string): number[] {
  return openingTags(source, TOUCHABLES)
    .filter((tag) => !tag.attrs.includes('accessibilityRole') && !HIDDEN.some((h) => tag.attrs.includes(h)))
    .map((tag) => tag.line);
}

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
  outliersDropped: 2,
  measuredTdee: 2017,
  confidence: 1,
  avgDailyIntake: 1850,
  weightSlopeLbsPerDay: -0.0486,
  dailyDeficitAchieved: 170,
  ci95Tdee: 180,
};

/**
 * The Trends screen against a stubbed `useTrends` — the wiring the review of
 * 2026-10-04 asked for, rendered: the deficit against maintenance (the owner's
 * device: maintenance 2,017, target 1,850, intake 1,849), the hero's
 * uncertainty, the honest window labels and the budget's new arithmetic.
 */

function day(dateKey: string, totalCalories: number): DaySummary {
  return { dateKey, totalCalories, totalProtein: 120, totalCarbs: 0, totalFat: 0, mealCount: totalCalories > 0 ? 1 : 0, exercised: false, weightLb: null };
}

const KEYS = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(2026, 6, 7 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

function state(over: Record<string, unknown> = {}) {
  const week = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  const tdee = MEASURED;
  const series: TdeeSeriesPoint[] = KEYS.slice(-30).map((k, i) => ({ dateKey: k as never, kcal: 1990 + i, source: 'measured', ci95: 180, holding: false }));
  return {
    loading: false,
    error: null,
    insights: computeWeeklyInsights([day('a', 1849), day('b', 1849), day('c', 1849)], 1850, [], 120, 2017),
    loggedThisWeek: 3,
    proteinTarget: 120,
    tdee,
    targetCalories: 1850,
    // Thursday: Monday unlogged, Tue 1,900, Wed 2,000, Thu 600 so far.
    budget: computeWeeklyBudget(week.map((k, i) => day(k, [0, 1900, 2000, 600][i] ?? 0)), 4, 1850),
    basalKcal: 0,
    activityLevel: null,
    sleep: { kind: 'pending' },
    fasting: { kind: 'pending' },
    water: { kind: 'pending' },
    composition: { enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false },
    chartKeys: KEYS,
    weightSeries: KEYS.map((k, i) => ({ dateKey: k, scale: i % 3 ? null : 180 - i * 0.02, trend: 180 - i * 0.02 })),
    intakeSeries: KEYS.map((_, i) => (i % 4 ? 1850 : null)),
    expenditure: series,
    historyDays: 90,
    milestones: {},
    progress: null,
    ...over,
  };
}

beforeEach(() => {
  mockPush.mockClear();
  mockNavigate.mockClear();
  mockTrends.mockReset();
});

describe('the last-7-days tile', () => {
  it('leads with the deficit against MEASURED maintenance, and calls a 1 kcal gap "on target"', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    const tile = view.getByTestId('insights-intake');
    expect(tile).toHaveTextContent(/168 kcal\/day under maintenance/);
    expect(tile).toHaveTextContent(/On target/);
    expect(tile).not.toHaveTextContent(/deficit/i);
  });

  it('falls back to a labelled vs-target line without a measured maintenance', async () => {
    mockTrends.mockReturnValue(
      state({ insights: computeWeeklyInsights([day('a', 1700), day('b', 1700), day('c', 1700)], 1850, [], 120, null) }),
    );
    const view = await render(<Trends />);
    const tile = view.getByTestId('insights-intake');
    expect(tile).toHaveTextContent(/150 kcal under target/);
    expect(tile).not.toHaveTextContent(/maintenance/);
  });

  it('names its window honestly: "Last 7 days", not "This week"', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    expect(view.getByTestId('panel-tab-week')).toHaveTextContent('Last 7 days');
  });
});

describe('the hero', () => {
  it('is one element for a screen reader, with the interval, and opens Body', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    const top = view.getByTestId('tdee-open-body');
    expect(top.props.accessibilityLabel).toBe('Maintenance estimate, Measured, 2,017 kcal, plus or minus 180');
    expect(view.getByTestId('tdee-ci')).toHaveTextContent('±180 kcal, 95% range');
    expect(view.getByTestId('tdee-outliers')).toHaveTextContent(/2 weigh-ins ignored/);
    await fireEvent.press(top);
    expect(mockNavigate).toHaveBeenCalledWith('/body');
  });

  it('says how far a formula estimate is from being measured', async () => {
    mockTrends.mockReturnValue(
      state({
        tdee: { trueTdee: 2500, newDailyTarget: 2000, weightChangeTrend: 0, source: 'formula' },
        insights: null,
        progress: { loggedDays: 9, neededDays: 14, daysToGo: 5, weighIns: 2, neededWeighIns: 2, weighInsToGo: 0, fraction: 9 / 14 },
      }),
    );
    const view = await render(<Trends />);
    expect(view.getByTestId('tdee-progress')).toHaveTextContent(/Log 5 more/);
  });
});

describe('the charts', () => {
  it('draws the expenditure history and the weight trend, and asks for the 30-day range by default', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    expect(view.getByTestId('expenditure-chart')).toBeTruthy();
    expect(view.getByTestId('weight-trend-chart')).toBeTruthy();
    expect(mockTrends).toHaveBeenCalledWith(30);
    expect(view.getByTestId('expenditure-chart-plot').props.accessibilityLabel).toMatch(
      /Maintenance estimate over the last 30 days, from 1,990 to 2,019 kcal/,
    );
  });

  it('a placeholder holds the space while the series is still being computed', async () => {
    mockTrends.mockReturnValue(state({ expenditure: null }));
    const view = await render(<Trends />);
    expect(view.getByTestId('expenditure-pending')).toBeTruthy();
  });
});

describe('the budget face', () => {
  it('counts an unlogged day at the target and says so; per-day includes today', async () => {
    mockTrends.mockReturnValue(state());
    const view = await render(<Trends />);
    await fireEvent.press(view.getByTestId('panel-tab-budget'));
    expect(view.getByTestId('budget-assumed')).toHaveTextContent('1 unlogged day counted at your target');
    // 12,950 − 4,500 logged − 1,850 assumed = 6,600 over Thu..Sun (4 days).
    expect(view.getByTestId('budget-per-day')).toHaveTextContent('1,650 kcal');
    expect(view.getByText('4,500 of 12,950 kcal')).toBeTruthy();
    expect(view.getByTestId('budget-strip').props.accessibilityRole).toBe('adjustable');
  });
});

describe('every pressable on Trends announces a role', () => {
  const SRC = join(__dirname, '..');
  it.each([
    'app/(app)/trends.tsx',
    'components/charts/TrendChart.tsx',
    'components/charts/TrendsCharts.tsx',
    'components/SleepTrendsCard.tsx',
    'components/FastingTrendsCard.tsx',
    'components/WaterTrendsCard.tsx',
  ])('%s', (file) => {
    // The budget columns are `accessible={false}` (they live inside one
    // adjustable element), which the scan treats as hidden.
    expect(findRoleless(readFileSync(join(SRC, file), 'utf8'))).toEqual([]);
  });
});
