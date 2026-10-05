import type { ChartDescriptor } from '../../../modules/chart-accessibility';

/**
 * Builds the `AXChartDescriptor` JSON (`AccessibleChart`'s `descriptor`) for a
 * per-day chart from the same arrays the chart already draws.
 *
 * `useAdjustableDays` and `TrendChart` both noted that their per-day strings
 * were "exactly the input an `AXChartDescriptor` needs"; this is that seam.
 * Pure and dependency-free so it is tested without a device, and so the two
 * chart families (Trends' `TrendChart`, Body's `WeightChart`) describe
 * themselves identically.
 *
 * Decisions, each a thing VoiceOver would otherwise get wrong:
 *
 * - **Dates are categories, not numbers.** A numeric x axis would be read as
 *   "x 23"; a categorical one reads the date the sighted user sees.
 * - **Category labels are made unique.** `categoryOrder` is matched by string,
 *   so two days both labelled "Oct 4" (a year apart on a 1Y range) would merge
 *   into one stop. A repeat gets its ordinal appended.
 * - **Gaps stay gaps.** `null` passes through as `y: null` — silence in the
 *   audio graph — never as a zero, which would play as a plunge.
 * - **The y range is the data's own** (min..max over every finite value), so
 *   the pitch spans exactly what the chart's own axis spans.
 * - **The per-day sentence rides on the FIRST series only**, as each point's
 *   label: it already narrates every series for that day, and repeating it per
 *   series would read the same sentence twice at every stop.
 * - **No finite value anywhere → `null`.** An audio graph of nothing is a
 *   silent rotor item, worse than none.
 */
export interface AudioGraphSeries {
  name: string;
  values: readonly (number | null)[];
  /** A line (true, default) or separate readings (false). */
  continuous?: boolean;
}

export interface AudioGraphInput {
  title: string;
  summary: string;
  xTitle: string;
  /** One label per index — the date as the chart prints it. */
  xLabels: readonly string[];
  yTitle: string;
  unit?: string;
  /** Decimal places VoiceOver reads y values to (kcal 0, weight 1). */
  decimals?: number;
  series: readonly AudioGraphSeries[];
  /** One sentence per index; becomes each point's label on the first series. */
  pointLabels?: readonly string[];
}

/** Disambiguate repeated labels so `categoryOrder` keeps every stop. */
export function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n === 1 ? l : `${l} (${n})`;
  });
}

export function audioGraphDescriptor(input: AudioGraphInput): ChartDescriptor | null {
  const n = input.xLabels.length;
  if (n === 0 || input.series.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const s of input.series) {
    for (const v of s.values) {
      if (v == null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const labels = uniqueLabels(input.xLabels);
  return {
    title: input.title,
    summary: input.summary,
    xAxis: { title: input.xTitle, labels },
    yAxis: { title: input.yTitle, range: { min, max }, unit: input.unit, decimals: input.decimals ?? 0 },
    series: input.series.map((s, si) => ({
      name: s.name,
      continuous: s.continuous ?? true,
      values: labels.map((x, i) => {
        const raw = s.values[i];
        const y = raw == null || !Number.isFinite(raw) ? null : raw;
        const label = si === 0 ? input.pointLabels?.[i] : undefined;
        return label ? { x, y, label } : { x, y };
      }),
    })),
  };
}
