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
import { rangeDays } from '@/components/charts/TrendsCharts';
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
        openDay={{ label: (k) => `Open ${k}`, actionLabel: 'Open this day in History', closeLabel: 'Close', onOpen }}
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
});
