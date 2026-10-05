/**
 * Pure geometry for the Trends charts — scales, paths and the x → day lookup
 * the scrub gesture runs on the UI thread.
 *
 * ## The one rule: a day keeps its x position
 *
 * The first sparkline here filtered nulls out of the series before laying it
 * out, so a fortnight with five weigh-ins drew five evenly spaced points — the
 * time axis silently squeezed, and a three-day gap looked like one day. Every
 * function below takes the FULL per-day array, nulls included, and positions
 * by index. A missing day is a break in the line (or a faint bridge, when the
 * caller asks for one), never a closed-up gap.
 *
 * Kept free of React so the scrub maths can run inside a worklet
 * ({@link indexAtX} is marked) and so the a11y/label logic is testable without
 * rendering SVG.
 */

export interface Frame {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export interface Domain {
  min: number;
  max: number;
}

/** x of the i-th of `n` evenly spaced days. One day sits in the middle. */
export function xAt(i: number, n: number, f: Frame): number {
  'worklet';
  const plotW = Math.max(0, f.width - f.padL - f.padR);
  if (n <= 1) return f.padL + plotW / 2;
  return f.padL + (i * plotW) / (n - 1);
}

/** Nearest day index to a touch x, clamped to the series. */
export function indexAtX(x: number, n: number, f: Frame): number {
  'worklet';
  if (n <= 1) return 0;
  const plotW = Math.max(1, f.width - f.padL - f.padR);
  const i = Math.round(((x - f.padL) / plotW) * (n - 1));
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/**
 * The y range that holds every finite value in every series, padded by
 * `padFrac` of the span on both sides. A flat series gets a ±`minSpan / 2`
 * window so it draws as a line across the middle rather than dividing by
 * zero. Null when there is nothing finite to draw.
 */
export function domainOf(
  series: readonly (readonly (number | null | undefined)[])[],
  opts: { padFrac?: number; minSpan?: number } = {},
): Domain | null {
  const { padFrac = 0.08, minSpan = 1 } = opts;
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const v of s) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) return null;
  let span = max - min;
  if (span < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
    span = minSpan;
  }
  return { min: min - span * padFrac, max: max + span * padFrac };
}

export function yAt(v: number, d: Domain, f: Frame): number {
  'worklet';
  const plotH = Math.max(0, f.height - f.padT - f.padB);
  const span = d.max - d.min || 1;
  return f.padT + plotH - ((v - d.min) / span) * plotH;
}

/** Each day's y, or null for a gap — the arrays the cursor dot reads. */
export function ysOf(values: readonly (number | null | undefined)[], d: Domain, f: Frame): (number | null)[] {
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? yAt(v, d, f) : null));
}

const fmt = (n: number) => n.toFixed(2);

export interface LinePaths {
  /** Segments whose END day is styled solid. */
  solid: string;
  /** Segments whose END day is styled dashed (a formula prior, a projection). */
  dashed: string;
  /** Faint bridges across gaps, when `bridgeGaps` was asked for. */
  bridges: string;
}

/**
 * SVG path data for one per-day series.
 *
 * A segment from day i−1 to day i takes day i's style, so a run that turns
 * from formula to measured changes style exactly where the source changed.
 * A null breaks the line; with `bridgeGaps` the two sides are joined by a
 * separate path the caller draws faint and dashed — "no reading here", stated
 * rather than hidden, and never mistaken for data.
 */
export function linePaths(
  values: readonly (number | null | undefined)[],
  d: Domain,
  f: Frame,
  opts: { dashedAt?: (i: number) => boolean; bridgeGaps?: boolean } = {},
): LinePaths {
  const n = values.length;
  const solid: string[] = [];
  const dashed: string[] = [];
  const bridges: string[] = [];
  let prev: { x: number; y: number } | null = null;
  let lastSeen: { x: number; y: number } | null = null;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      prev = null;
      continue;
    }
    const pt = { x: xAt(i, n, f), y: yAt(v, d, f) };
    if (prev) {
      const seg = `M ${fmt(prev.x)} ${fmt(prev.y)} L ${fmt(pt.x)} ${fmt(pt.y)}`;
      (opts.dashedAt?.(i) ? dashed : solid).push(seg);
    } else if (lastSeen && opts.bridgeGaps) {
      bridges.push(`M ${fmt(lastSeen.x)} ${fmt(lastSeen.y)} L ${fmt(pt.x)} ${fmt(pt.y)}`);
    }
    prev = pt;
    lastSeen = pt;
  }
  return { solid: solid.join(' '), dashed: dashed.join(' '), bridges: bridges.join(' ') };
}

/** The last finite value's index, or -1. */
export function lastIndexWithValue(values: readonly (number | null | undefined)[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) return i;
  }
  return -1;
}
