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

/**
 * Every dot of one series as ONE filled path: a circle is two arcs. On 1Y the
 * three Trends charts drew a `<Circle>` per day — over a thousand SVG nodes
 * for three cards (re-score 3, Pf1). One node per series draws the same
 * pixels.
 */
export function dotsPath(pts: readonly { x: number; y: number }[], r: number): string {
  const d = fmt(2 * r);
  return pts.map((p) => `M ${fmt(p.x - r)} ${fmt(p.y)} a ${fmt(r)} ${fmt(r)} 0 1 0 ${d} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 -${d} 0`).join(' ');
}

/**
 * Which days get a date under the axis: `count` evenly spaced indices, always
 * the first and the last. First-and-last alone left a 90-day axis to
 * guesswork (re-score 3, V3); Health labels its weeks and months.
 */
export function xTickIndices(n: number, count: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const c = Math.max(2, Math.min(count, n));
  const out: number[] = [];
  for (let i = 0; i < c; i++) {
    const idx = Math.round((i * (n - 1)) / (c - 1));
    if (out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

/** Rough advance width of a short label at `fontSize` — tabular numerals and
 *  short words; deliberately generous (a gutter a few dp too wide is harmless,
 *  one too narrow lets the label touch the data again). */
export function labelWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.62) + 4;
}

export interface LabelBox {
  /** Distance from the plot's left edge. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the reference line's label goes. It used to sit opaque, right-aligned,
 * directly ABOVE the line — over the newest days, which on an intake chart
 * cluster at the target by design, and over the endpoint dot for anyone whose
 * target is their maintenance (re-score 3, B1). Now four candidates — right
 * above, right below, left above, left below — are scored by how many points
 * fall inside each box, and the emptiest wins (ties keep that order, so an
 * empty chart reads exactly as before). `points` are in plot coordinates;
 * `minLeft` keeps the left candidates out of the tick gutter.
 */
export function placeRefLabel(opts: {
  refY: number;
  labelW: number;
  labelH: number;
  width: number;
  height: number;
  minLeft: number;
  points: readonly { x: number; y: number }[];
  /** Points that cost more to cover (the endpoint the line exists to show). */
  heavy?: readonly { x: number; y: number }[];
  pad?: number;
}): LabelBox {
  const { refY, labelW, labelH, width, height, minLeft, points, heavy = [], pad = 3 } = opts;
  const clampTop = (t: number) => Math.max(0, Math.min(height - labelH, t));
  const right = Math.max(minLeft, width - labelW - 2);
  const candidates: LabelBox[] = [
    { left: right, top: clampTop(refY - labelH), width: labelW, height: labelH },
    { left: right, top: clampTop(refY + 1), width: labelW, height: labelH },
    { left: minLeft, top: clampTop(refY - labelH), width: labelW, height: labelH },
    { left: minLeft, top: clampTop(refY + 1), width: labelW, height: labelH },
  ];
  const inside = (b: LabelBox, p: { x: number; y: number }) =>
    p.x >= b.left - pad && p.x <= b.left + b.width + pad && p.y >= b.top - pad && p.y <= b.top + b.height + pad;
  let best = candidates[0];
  let bestScore = Infinity;
  for (const b of candidates) {
    let score = 0;
    for (const p of points) if (inside(b, p)) score++;
    for (const p of heavy) if (inside(b, p)) score += 100;
    if (score < bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}
