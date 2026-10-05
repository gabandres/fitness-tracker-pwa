// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { SLEEP_WINDOW_DAYS, balanceVerdict, sleepWindow, type SleepEntry } from '@macrolog/core';
import { en } from '@/i18n/en';
import { ptBR } from '@/i18n/pt-BR';
import { esPR } from '@/i18n/es-PR';
import type { I18nKey, TFn } from '@/i18n';
import { TrendChart } from '@/components/charts/TrendChart';
import { domainOf, indexAtX, linePaths, xAt } from '@/components/charts/chart-geometry';
import { maintenanceLine, slopeLabel, targetLine } from '@/components/charts/trend-copy';
import {
  ExpenditureCard,
  ProteinTrendCard,
  rangeDays,
  rangesFor,
  trailingMean,
} from '@/components/charts/TrendsCharts';
import type { TdeeSeriesPoint } from '@macrolog/core';
import { SleepTrendsCard } from '@/components/SleepTrendsCard';
import type { SleepTrends } from '@/hooks/useSleepTrends';

/**
 * The Trends review of 2026-10-04: lines over time, the deficit against
 * maintenance, and charts a screen reader can step through. The arithmetic is
 * pinned in core (`tdee-series`, `weekly-insights`, `weekly-budget`); this is
 * the presentation contract.
 */

function tFor(dict: Record<string, string>): TFn {
  return ((key: I18nKey, params?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))) as TFn;
}

describe('slopeLabel', () => {
  it('uses the locale decimal, not toFixed — "0,5 kg/sem" in pt-BR', () => {
    // −1.1 lb/wk ≈ −0.5 kg/wk.
    expect(slopeLabel(-1.1, 'metric', tFor(ptBR), 'pt-BR')).toBe('−0,5 kg/sem');
    expect(slopeLabel(-1.1, 'metric', tFor(en), 'en')).toBe('−0.5 kg/wk');
    expect(slopeLabel(0.8, 'us', tFor(esPR), 'es-PR')).toBe('+0.8 lb/sem');
  });

  it('keeps the steady threshold in pounds', () => {
    expect(slopeLabel(0.05, 'metric', tFor(en), 'en')).toBe(en['body.holdingSteady']);
  });
});

describe('the deficit lines', () => {
  const t = tFor(en);

  // The owner's device: maintenance 2,017, target 1,850, intake 1,849.
  it('says "under maintenance" for the real deficit, and "on target" for a 1 kcal gap', () => {
    expect(maintenanceLine(balanceVerdict(168), t, 'en')).toBe('168 kcal/day under maintenance');
    expect(targetLine(balanceVerdict(1), t, 'en')).toBe('On target');
  });

  it('never prints a sign glyph glued to "deficit"', () => {
    expect(maintenanceLine(balanceVerdict(-312), t, 'en')).toBe('312 kcal/day over maintenance');
    expect(targetLine(balanceVerdict(-312), t, 'en')).toBe('312 kcal over target');
    expect(targetLine(balanceVerdict(1200), tFor(ptBR), 'pt-BR')).toBe('1.200 kcal abaixo da meta');
  });
});

describe('chart geometry', () => {
  const frame = { width: 110, height: 50, padL: 5, padR: 5, padT: 5, padB: 5 };

  it('keeps a missing day at its x position instead of closing the gap', () => {
    // Day 1 is missing: day 2 still sits at x of index 2, not index 1.
    const d = domainOf([[10, null, 20]])!;
    const { solid, bridges } = linePaths([10, null, 20], d, frame, { bridgeGaps: true });
    expect(solid).toBe(''); // no two ADJACENT readings
    expect(bridges).toContain(`L ${xAt(2, 3, frame).toFixed(2)}`);
    expect(xAt(2, 3, frame)).toBe(105);
  });

  it('draws formula days dashed and measured days solid', () => {
    const d = domainOf([[1, 2, 3, 4]])!;
    const p = linePaths([1, 2, 3, 4], d, frame, { dashedAt: (i) => i <= 2 });
    expect(p.dashed.split('M').length - 1).toBe(2);
    expect(p.solid.split('M').length - 1).toBe(1);
  });

  it('maps a touch to the nearest day, clamped', () => {
    expect(indexAtX(-40, 10, frame)).toBe(0);
    expect(indexAtX(500, 10, frame)).toBe(9);
    expect(indexAtX(xAt(4, 10, frame) + 2, 10, frame)).toBe(4);
  });

  it('"All" is the account history inside the 90-day cap, never under a week', () => {
    expect(rangeDays('1m', 200, 90)).toBe(30);
    expect(rangeDays('3m', 10, 90)).toBe(90);
    expect(rangeDays('all', 40, 90)).toBe(40);
    expect(rangeDays('all', 400, 90)).toBe(90);
    expect(rangeDays('all', 2, 90)).toBe(7);
  });

  it('reaches a year behind the Pro cap, with 6M/1Y chips only where the cap reaches them', () => {
    expect(rangeDays('6m', 400, 365)).toBe(182);
    expect(rangeDays('1y', 400, 365)).toBe(365);
    expect(rangeDays('all', 400, 365)).toBe(365);
    expect(rangeDays('1y', 400, 90)).toBe(90);
    expect(rangesFor(90)).toEqual(['1m', '3m', 'all']);
    expect(rangesFor(365)).toEqual(['1m', '3m', '6m', '1y', 'all']);
  });
});

describe('trailingMean (the protein line)', () => {
  it('averages the days that have a value, skipping gaps rather than counting them as zero', () => {
    expect(trailingMean([null, 100, null, 140], 7)).toEqual([null, 100, 100, 120]);
    expect(trailingMean([100, 200, 300], 2)).toEqual([100, 150, 250]);
  });
});

describe('TrendChart accessibility', () => {
  const keys = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const labels = ['Wed: 2,400', 'Thu: 2,410', 'Fri: 2,420'];

  async function renderChart(onOpen = jest.fn()) {
    const view = await render(
      <TrendChart
        dateKeys={keys}
        lines={[{ key: 'tdee', values: [2400, 2410, 2420], color: '#f00' }]}
        summary="Maintenance, last 3 days"
        pointLabels={labels}
        formatY={(v) => String(Math.round(v))}
        openDay={{ actionLabel: 'Open this day in History', onOpen }}
        testID="chart"
      />,
    );
    return { view, onOpen };
  }

  it('is one adjustable element: summary as label, the newest day as value', async () => {
    const { view } = await renderChart();
    const plot = view.getByTestId('chart-plot');
    expect(plot.props.accessible).toBe(true);
    expect(plot.props.accessibilityRole).toBe('adjustable');
    expect(plot.props.accessibilityLabel).toBe('Maintenance, last 3 days');
    expect(plot.props.accessibilityValue).toEqual({ text: 'Fri: 2,420' });
  });

  it('steps a day at a time and stops at the ends', async () => {
    const { view } = await renderChart();
    const act = (name: string) =>
      fireEvent(view.getByTestId('chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: name } });
    await act('decrement');
    expect(view.getByTestId('chart-plot').props.accessibilityValue).toEqual({ text: 'Thu: 2,410' });
    await act('decrement');
    await act('decrement');
    expect(view.getByTestId('chart-plot').props.accessibilityValue).toEqual({ text: 'Wed: 2,400' });
    await act('increment');
    expect(view.getByTestId('chart-plot').props.accessibilityValue).toEqual({ text: 'Thu: 2,410' });
  });

  it('offers "Open this day in History" as a custom action on the current day', async () => {
    const { view, onOpen } = await renderChart();
    const plot = view.getByTestId('chart-plot');
    expect(plot.props.accessibilityActions).toEqual(
      expect.arrayContaining([{ name: 'openDay', label: 'Open this day in History' }]),
    );
    await fireEvent(plot, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent(view.getByTestId('chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: 'openDay' } });
    expect(onOpen).toHaveBeenCalledWith('2026-10-02');
  });
});

describe('TrendChart, sighted', () => {
  const keys = ['2026-10-01', '2026-10-02', '2026-10-03'];

  it('labels the middle of the axis too, not only its ends', async () => {
    const view = await render(
      <TrendChart
        dateKeys={keys}
        lines={[{ key: 'tdee', values: [2000, 2100, 2200], color: '#f00' }]}
        summary="s"
        pointLabels={['a', 'b', 'c']}
        formatY={(v) => String(Math.round(v))}
        testID="chart"
      />,
    );
    // The plot has no width in jest, so no geometry and no ticks — but the
    // element exists once laid out. Lay it out.
    await fireEvent(view.getByTestId('chart-plot'), 'layout', { nativeEvent: { layout: { width: 300, height: 132 } } });
    expect(view.getByTestId('chart-tick-mid', { includeHiddenElements: true })).toHaveTextContent('2100');
  });
});

describe('the maintenance chart says what is actually drawn (review S20, bug 7)', () => {
  const keys = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const pt = (dateKey: string, kcal: number | null, source: TdeeSeriesPoint['source']): TdeeSeriesPoint =>
    ({ dateKey, kcal, source, ci95: null, holding: false }) as TdeeSeriesPoint;
  const base = {
    keys,
    intake: [1800, null, null],
    days: 3,
    milestones: {},
    range: '1m' as const,
    onRange: jest.fn(),
    cap: 365,
    onOpenDay: jest.fn(),
    t: tFor(en),
    locale: 'en' as const,
  };

  it('does not promise a target line when no target is drawn, and names a formula stretch', async () => {
    const series = [pt(keys[0], 2400, 'formula'), pt(keys[1], 2450, 'measured'), pt(keys[2], 2460, 'measured')];
    const view = await render(<ExpenditureCard {...base} series={series} target={0} />);
    const label = view.getByTestId('expenditure-chart-plot').props.accessibilityLabel as string;
    expect(label).toMatch(/Dashed stretches are formula estimates/);
    expect(label).not.toMatch(/daily target/);
  });

  it('a seed-only account hears "no estimate yet", not "formula estimate"', async () => {
    const series = keys.map((k) => pt(k, null, 'seed'));
    const view = await render(<ExpenditureCard {...base} series={series} target={1850} />);
    const label = view.getByTestId('expenditure-chart-plot').props.accessibilityLabel as string;
    expect(label).toMatch(/no estimate yet/);
    expect(label).not.toMatch(/formula/);
  });

  it('hints that a day can be opened until one has been', async () => {
    const series = keys.map((k) => pt(k, 2400, 'measured'));
    const onOpenDay = jest.fn();
    const view = await render(<ExpenditureCard {...base} onOpenDay={onOpenDay} series={series} target={1850} />);
    expect(view.getByTestId('trends-open-day-hint', { includeHiddenElements: true })).toHaveTextContent('Tap a day to open it in History. Touch and hold, then drag, to read each day.');
    await fireEvent(view.getByTestId('expenditure-chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: 'openDay' } });
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-03');
    expect(view.queryByTestId('trends-open-day-hint', { includeHiddenElements: true })).toBeNull();
  });
});

describe('the protein chart', () => {
  it('leaves today out (a lunchtime total is not a day) and counts target days on logged days', async () => {
    const keys = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const view = await render(
      <ProteinTrendCard
        keys={keys}
        protein={[150, null, 90, 20]}
        days={4}
        target={120}
        milestones={{}}
        onOpenDay={jest.fn()}
        t={tFor(en)}
        locale="en"
      />,
    );
    const plot = view.getByTestId('protein-trend-chart-plot');
    expect(plot.props.accessibilityLabel).toBe(
      'Protein over the last 4 days, 120 g a day on average on logged days. The dotted line is your 120 g target; you reached it on 1 of 2 logged days.',
    );
    // Today, the newest stop, is "in progress", not 20 g.
    expect(plot.props.accessibilityValue.text).toMatch(/today, still in progress/);
  });
});

describe('habit strips are adjustable too', () => {
  const key = (i: number) => `2026-03-${String(i + 1).padStart(2, '0')}`;
  const keys = Array.from({ length: SLEEP_WINDOW_DAYS }, (_, i) => key(i));

  it('the sleep strip reads a summary, then a night at a time', async () => {
    const sleepByDay: Record<string, SleepEntry> = {};
    for (let i = 0; i < 5; i++) sleepByDay[key(i)] = { hours: 6.5, source: 'import' };
    const state: SleepTrends = { kind: 'card', window: sleepWindow(sleepByDay, keys), contrast: null };
    const view = await render(<SleepTrendsCard sleep={state} />);
    const strip = view.getByTestId('sleep-strip');
    expect(strip.props.accessibilityRole).toBe('adjustable');
    expect(strip.props.accessibilityLabel).toMatch(/^Sleep, last 14 nights\. Median 6h 30m, 5 nights with a reading\.$/);
    // The newest night has no reading.
    expect(strip.props.accessibilityValue.text).toMatch(/: no reading$/);
    for (let i = 0; i < SLEEP_WINDOW_DAYS - 1; i++) {
      await fireEvent(view.getByTestId('sleep-strip'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    }
    expect(view.getByTestId('sleep-strip').props.accessibilityValue.text).toMatch(/: 6h 30m$/);
  });

  it('a night opens its day in History — by tap and by the rotor action — and the strip names its dates', async () => {
    mockPush.mockClear();
    const sleepByDay: Record<string, SleepEntry> = {};
    for (let i = 0; i < 5; i++) sleepByDay[key(i)] = { hours: 6.5, source: 'import' };
    const state: SleepTrends = { kind: 'card', window: sleepWindow(sleepByDay, keys), contrast: null };
    const view = await render(<SleepTrendsCard sleep={state} />);
    await fireEvent.press(view.getByTestId(`sleep-col-${key(2)}`));
    expect(mockPush).toHaveBeenCalledWith(`/history/${key(2)}`);
    const strip = view.getByTestId('sleep-strip');
    expect(strip.props.accessibilityActions).toEqual(expect.arrayContaining([{ name: 'openDay', label: 'Open this day in History' }]));
    await fireEvent(strip, 'accessibilityAction', { nativeEvent: { actionName: 'openDay' } });
    expect(mockPush).toHaveBeenLastCalledWith(`/history/${key(SLEEP_WINDOW_DAYS - 1)}`);
    expect(view.getByText('Mar 1', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByText('Mar 14', { includeHiddenElements: true })).toBeTruthy();
  });
});
