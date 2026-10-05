// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import React from 'react';
import type { TdeeSeriesPoint, WeightSeriesPoint } from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';
import type { I18nKey, TFn } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { parseYmd } from '@macrolog/core';
import { TrendChart } from '@/components/charts/TrendChart';
import { dotsPath, placeRefLabel, xTickIndices } from '@/components/charts/chart-geometry';
import { chartDate, chartNumber, signedNumber } from '@/components/charts/chart-format';
import { ExpenditureCard, ProteinTrendCard, WeightTrendCard, liveIndex } from '@/components/charts/TrendsCharts';

/**
 * Trends re-score 3, the presentation: nothing drawn over the data (B1/V1),
 * no reserved bubble band (V2), more than two dates (V3), one path per dot
 * series (Pf1), a visible change readout (U1), the range on every card (U4),
 * carbs and fat over time (U3), the live day by the user's boundary (B4/B6),
 * a seed-only account's words in sight (C2) and the formula→measured mark.
 */

function tFor(dict: Record<string, string>): TFn {
  return ((key: I18nKey, params?: Record<string, string | number>) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))) as TFn;
}

const t = tFor(en);

function keysEnding(last: string, n: number): string[] {
  const end = parseYmd(last);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (n - 1 - i));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}

const pt = (dateKey: string, kcal: number | null, source: TdeeSeriesPoint['source']): TdeeSeriesPoint =>
  ({ dateKey, kcal, source, ci95: null, holding: false }) as TdeeSeriesPoint;

describe('geometry', () => {
  it('xTickIndices: evenly spaced, always first and last, never more than there are days', () => {
    expect(xTickIndices(30, 4)).toEqual([0, 10, 19, 29]);
    expect(xTickIndices(3, 5)).toEqual([0, 1, 2]);
    expect(xTickIndices(1, 4)).toEqual([0]);
    expect(xTickIndices(0, 4)).toEqual([]);
  });

  it('dotsPath: one subpath per point, a circle in two arcs', () => {
    const d = dotsPath([{ x: 10, y: 20 }, { x: 30, y: 40 }], 2);
    expect(d.match(/M /g)).toHaveLength(2);
    expect(d.startsWith('M 8.00 20.00 a 2.00 2.00 0 1 0 4.00 0')).toBe(true);
  });

  it('placeRefLabel: above the line at the right by default, elsewhere when that covers the data', () => {
    const base = { refY: 60, labelW: 80, labelH: 16, width: 300, height: 132, minLeft: 34 };
    expect(placeRefLabel({ ...base, points: [] })).toEqual({ left: 218, top: 44, width: 80, height: 16 });
    // The newest days sit just above the target, under the default box.
    const crowded = [250, 260, 270, 280, 290].map((x) => ({ x, y: 52 }));
    expect(placeRefLabel({ ...base, points: crowded })).toEqual({ left: 218, top: 61, width: 80, height: 16 });
    // The endpoint dot outweighs any number of plain points.
    const endpoint = [{ x: 294, y: 66 }];
    const box = placeRefLabel({ ...base, points: crowded, heavy: endpoint });
    expect(box.left).toBe(34);
  });
});

describe('cached formatting matches the shared helpers exactly', () => {
  it.each(['en', 'es-PR', 'pt-BR'] as const)('%s', (locale) => {
    expect(chartNumber(12345.6, locale)).toBe(formatNumber(12345.6, locale));
    expect(chartNumber(81.25, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe(
      formatNumber(81.25, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    );
    expect(chartDate('2026-10-04', locale, 'short')).toBe(formatDate(parseYmd('2026-10-04'), locale, { month: 'short', day: 'numeric' }));
    expect(chartDate('2026-10-04', locale, 'long')).toBe(
      formatDate(parseYmd('2026-10-04'), locale, { weekday: 'short', month: 'short', day: 'numeric' }),
    );
  });

  it('signs a change with a real minus, and leaves zero unsigned', () => {
    expect(signedNumber(70, 'en')).toBe('+70');
    expect(signedNumber(-1200, 'pt-BR')).toBe('−1.200');
    expect(signedNumber(0.04, 'en', { maximumFractionDigits: 1 })).toBe('0');
  });
});

describe('liveIndex (B4)', () => {
  it('is the user’s day, not the last calendar key, and -1 outside the window', () => {
    const k = ['2026-10-03', '2026-10-04', '2026-10-05'];
    expect(liveIndex(k, '2026-10-04')).toBe(1);
    expect(liveIndex(k, undefined)).toBe(2);
    expect(liveIndex(k, '2026-09-01')).toBe(-1);
  });
});

describe('TrendChart, sighted', () => {
  const keys = keysEnding('2026-10-04', 30);
  const values = keys.map((_, i) => 2000 + i * 5);

  async function laidOut(extra: Partial<React.ComponentProps<typeof TrendChart>> = {}) {
    const view = await render(
      <TrendChart
        dateKeys={keys}
        lines={[{ key: 'tdee', values, color: '#f00' }]}
        dots={[{ key: 'intake', values: keys.map((_, i) => (i % 2 ? 1800 : null)), color: '#999' }]}
        reference={{ value: 2100, label: 'Target 2,100' }}
        summary="s"
        pointLabels={keys}
        formatY={(v) => String(Math.round(v))}
        xTickLabel={(k) => k.slice(5)}
        testID="chart"
        {...extra}
      />,
    );
    await fireEvent(view.getByTestId('chart-plot'), 'layout', { nativeEvent: { layout: { width: 320, height: 132 } } });
    return view;
  }

  it('labels three to five dates under the axis, first and last included', async () => {
    const view = await laidOut();
    const shown = keys.filter((k) => view.queryByText(k.slice(5), { includeHiddenElements: true }));
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(5);
    expect(shown[0]).toBe(keys[0]);
    expect(shown[shown.length - 1]).toBe(keys[keys.length - 1]);
  });

  it('draws a dot series as one path, not a Circle per day', async () => {
    const view = await laidOut();
    const types = new Set<string>();
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { type?: string; children?: unknown };
      if (node.type) types.add(node.type);
      walk(node.children);
    };
    walk(view.toJSON());
    expect([...types].some((ty) => /path/i.test(ty))).toBe(true);
    expect([...types].some((ty) => /circle/i.test(ty))).toBe(false);
  });

  it('labels the reference line without an opaque box, and marks an annotated day', async () => {
    const view = await laidOut({ annotations: [{ index: 10, label: 'Measured' }] });
    const label = view.getByTestId('chart-ref-label', { includeHiddenElements: true });
    const flat = Object.assign({}, ...[label.props.style].flat(3).filter(Boolean));
    expect(flat.backgroundColor).toBeUndefined();
    expect(view.getByTestId('chart-annotation', { includeHiddenElements: true })).toHaveTextContent('Measured');
  });
});

describe('the maintenance card', () => {
  const keys = keysEnding('2026-10-04', 5);
  const base = {
    keys,
    intake: [1800, 1900, null, 2000, 400],
    days: 5,
    target: 1850,
    milestones: {},
    range: '1m' as const,
    onRange: jest.fn(),
    cap: 365,
    onOpenDay: jest.fn(),
    t,
    locale: 'en' as const,
  };

  it('shows the change over the range in sight, and marks where the estimate turned measured', async () => {
    const series = [pt(keys[0], 2300, 'formula'), pt(keys[1], 2310, 'formula'), pt(keys[2], 2380, 'measured'), pt(keys[3], 2420, 'measured'), pt(keys[4], 2450, 'measured')];
    const view = await render(<ExpenditureCard {...base} series={series} />);
    expect(view.getByTestId('expenditure-readout', { includeHiddenElements: true })).toHaveTextContent('2,380 → 2,450 kcal (+70)');
    await fireEvent(view.getByTestId('expenditure-chart-plot'), 'layout', { nativeEvent: { layout: { width: 320, height: 132 } } });
    expect(view.getByTestId('expenditure-chart-annotation', { includeHiddenElements: true })).toHaveTextContent('Measured');
    // The flip day's sentence says so.
    const plot = view.getByTestId('expenditure-chart-plot');
    for (let i = 0; i < 2; i++) await fireEvent(view.getByTestId('expenditure-chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(view.getByTestId('expenditure-chart-plot').props.accessibilityValue.text).toMatch(/measured from your own data from here on/);
    expect(plot).toBeTruthy();
  });

  it('a seed-only account with nothing logged reads its sentence instead of an empty box (C2)', async () => {
    const series = keys.map((k) => pt(k, null, 'seed'));
    const view = await render(<ExpenditureCard {...base} intake={[null, null, null, null, null]} target={0} series={series} />);
    expect(view.getByTestId('expenditure-readout', { includeHiddenElements: true })).toHaveTextContent(/no estimate yet/);
    expect(view.queryByTestId('expenditure-chart')).toBeNull();
  });

  it('the live day is the user’s day: its intake reads "so far", and the empty calendar day after it is not today (B4/B6)', async () => {
    const series = keys.map((k) => pt(k, 2400, 'measured'));
    // 01:00 with a 03:00 day start: the live day is keys[3], keys[4] is empty.
    const view = await render(<ExpenditureCard {...base} intake={[1800, 1900, null, 600, null]} todayKey={keys[3]} series={series} />);
    await fireEvent(view.getByTestId('expenditure-chart-plot'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(view.getByTestId('expenditure-chart-plot').props.accessibilityValue.text).toMatch(/logged 600 kcal so far/);
  });
});

describe('the weight card', () => {
  const keys = keysEnding('2026-10-04', 10);
  const series: WeightSeriesPoint[] = keys.map((dateKey, i) => ({ dateKey, scale: i % 2 ? null : 180 - i * 0.3, trend: 180 - i * 0.3 }) as WeightSeriesPoint);

  it('states the trend’s change in sight, and changes the shared range from its caption (U1/U4)', async () => {
    const onRange = jest.fn();
    const view = await render(
      <WeightTrendCard
        keys={keys}
        series={series}
        days={10}
        unitSystem="us"
        milestones={{}}
        onOpenBody={jest.fn()}
        onOpenDay={jest.fn()}
        range="1m"
        onRange={onRange}
        cap={90}
        t={t}
        locale="en"
      />,
    );
    expect(view.getByTestId('weight-trend-readout', { includeHiddenElements: true })).toHaveTextContent('Trend −2.7 lb');
    expect(view.getByTestId('weight-trend-window')).toHaveTextContent('Last 10 days');
    // No native menu in jest: the caption steps to the next range.
    const menu = view.getByTestId('weight-trend-window-menu');
    expect(menu.props.accessibilityLabel).toBe('Chart range, Last 10 days');
    await fireEvent.press(menu);
    expect(onRange).toHaveBeenCalledWith('3m');
  });
});

describe('the macro card (U3)', () => {
  const keys = keysEnding('2026-10-04', 4);

  it('switches from protein to carbs and fat, and keeps today out', async () => {
    const view = await render(
      <ProteinTrendCard
        keys={keys}
        protein={[150, null, 90, 20]}
        carbs={[200, null, 180, 50]}
        fat={[70, null, null, 10]}
        days={4}
        target={120}
        milestones={{}}
        onOpenDay={jest.fn()}
        t={t}
        locale="en"
      />,
    );
    expect(view.getByTestId('protein-trend-readout', { includeHiddenElements: true })).toHaveTextContent('Avg 120 g a day · target on 1 of 2 days');
    await fireEvent.press(view.getByTestId('macro-tab-carbs'));
    const plot = view.getByTestId('protein-trend-chart-plot');
    expect(plot.props.accessibilityLabel).toBe('Carbs over the last 4 days, 190 g a day on average on logged days.');
    expect(view.getByTestId('macro-tab-carbs').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(view.getByTestId('macro-tab-fat'));
    expect(view.getByTestId('protein-trend-chart-plot').props.accessibilityValue.text).toMatch(/today, still in progress/);
    // Back to protein so the persisted choice does not leak into other tests.
    await fireEvent.press(view.getByTestId('macro-tab-protein'));
  });

  it('has the new copy in every locale', () => {
    const keysUsed = [
      'trends.chart.expChange', 'trends.chart.ateSoFar', 'trends.chart.measuredMark', 'trends.chart.measuredFrom',
      'trends.chart.weightChange', 'trends.chart.weightSteady', 'trends.chart.macroAvgShort', 'trends.chart.macroHitShort',
      'trends.chart.carbsName', 'trends.chart.fatName', 'trends.chart.macroPoint', 'trends.chart.bubbleMacro',
      'trends.chart.macroSummary', 'trends.chart.macroEmpty', 'trends.legendDaily', 'trends.chart.rangeMenuTitle',
      'trends.chart.rangeMenuA11y', 'trends.chart.rangeMenuHint', 'trends.budgetUsedAssumedValue',
    ] as const;
    for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
      for (const k of keysUsed) expect(dict[k]).toBeTruthy();
    }
    // Same placeholders across locales, so no `{var}` is left unfilled.
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keysUsed) {
      expect(vars((esPR as Record<string, string>)[k])).toBe(vars((en as Record<string, string>)[k]));
      expect(vars((ptBR as Record<string, string>)[k])).toBe(vars((en as Record<string, string>)[k]));
    }
  });
});
