import { dotsPath, nearestIndex, weightChartGeometry } from '@/components/body/weight-chart-geometry';

/**
 * The Body chart's geometry (Body review, U4 / V1) — the one part of a chart
 * a unit test can see. RNTL runs no layout and no gesture, so the scrub and
 * the drawing are proven on a device; where each reading LANDS is proven here.
 */

const frame = { width: 300, height: 140, padL: 0, padR: 0, padT: 0, padB: 0 };
const pts = (rows: [string, number][]) => rows.map(([dateKey, weightLb]) => ({ dateKey, weightLb }));

it('spaces readings by DATE, so a gap reads as a gap', () => {
  const p = pts([['2026-09-01', 180], ['2026-09-02', 179], ['2026-09-11', 178]]);
  const g = weightChartGeometry(p, p, frame)!;
  expect(g.xs[0]).toBe(0);
  expect(g.xs[1]).toBeCloseTo(30, 5); // 1 day of 10
  expect(g.xs[2]).toBe(300);
});

it('a single reading sits in the middle, with a span floor instead of a divide by zero', () => {
  const p = pts([['2026-09-01', 180]]);
  const g = weightChartGeometry(p, p, frame)!;
  expect(g.xs[0]).toBe(150);
  expect(g.ys[0]).toBe(70);
  expect(g.maxLb - g.minLb).toBe(2);
});

it('draws the goal only when it is near enough not to flatten the line', () => {
  const p = pts([['2026-09-01', 182], ['2026-09-10', 180]]);
  expect(weightChartGeometry(p, p, frame, { goalLb: 179 })!.goalY).not.toBeNull();
  expect(weightChartGeometry(p, p, frame, { goalLb: 150 })!.goalY).toBeNull();
});

it('stretches the x axis to hold the forecast dash', () => {
  const p = pts([['2026-09-01', 182], ['2026-09-11', 180]]);
  const g = weightChartGeometry(p, p, frame, { slopeLbPerWeek: -1, forecastDays: 10 })!;
  expect(g.forecastPath).not.toBe('');
  expect(g.xs[1]).toBeCloseTo(150, 5); // the last reading is now mid-axis
});

it('nothing to draw → null', () => {
  expect(weightChartGeometry([], [], frame)).toBeNull();
  expect(weightChartGeometry(pts([['2026-09-01', 1]]), [], { ...frame, width: 0 })).toBeNull();
});

it('nearestIndex finds the closest reading to the finger', () => {
  const xs = [0, 30, 300];
  expect(nearestIndex(xs, 10)).toBe(0);
  expect(nearestIndex(xs, 20)).toBe(1);
  expect(nearestIndex(xs, 200)).toBe(2);
  expect(nearestIndex([], 5)).toBe(-1);
});

it('dotsPath thins dots closer than minGap to the last one drawn (re-score 3, Pf)', () => {
  const xs = [0, 0.5, 1.0, 1.6, 10];
  const ys = [5, 5, 5, 5, 5];
  const count = (d: string) => (d.match(/M /g) ?? []).length;
  expect(count(dotsPath(xs, ys, 1))).toBe(5);
  // Measured from the last DRAWN dot: 0 → (0.5, 1.0 skipped) → 1.6 → 10.
  expect(count(dotsPath(xs, ys, 1, 1.5))).toBe(3);
});

describe('round axis ticks (S21 QA: "184.6 / 181.0 / 177.5")', () => {
  const p = pts([['2026-07-12', 184.6], ['2026-08-02', 181], ['2026-08-22', 177.5]]);

  it('snaps the domain to round pounds, one tick per gridline, top first', () => {
    const g = weightChartGeometry(p, p, frame, { axisUnitLb: 1 })!;
    expect(g.ticks.map((tk) => tk.value)).toEqual([185, 180, 175]);
    expect(g.minLb).toBe(175);
    expect(g.maxLb).toBe(185);
    // The bottom tick has its line: it sits on the plot's bottom edge.
    expect(g.ticks[2].y).toBe(frame.height);
    expect(g.ticks[0].y).toBe(0);
  });

  it('rounds in KILOGRAMS for a metric user, never 2.5 steps', () => {
    const kg = 2.20462;
    const g = weightChartGeometry(p, p, frame, { axisUnitLb: kg })!;
    for (const tk of g.ticks) expect(Number.isInteger(tk.value * 2)).toBe(true);
    const step = g.ticks[0].value - g.ticks[1].value;
    expect([0.5, 1, 2, 5, 10]).toContain(step);
    expect(g.minLb / kg).toBeLessThanOrEqual(177.5 / kg);
    expect(g.maxLb / kg).toBeGreaterThanOrEqual(184.6 / kg);
  });

  it('a narrow range gets half-unit steps', () => {
    // The 2 lb span floor makes this 179.5–181.5.
    const q = pts([['2026-09-01', 180], ['2026-09-05', 181]]);
    const g = weightChartGeometry(q, q, frame, { axisUnitLb: 1 })!;
    expect(g.ticks.map((tk) => tk.value)).toEqual([181.5, 181, 180.5, 180, 179.5]);
  });

  it('no ticks, and the data domain, when not asked (the measurement sparklines)', () => {
    const g = weightChartGeometry(p, p, frame)!;
    expect(g.ticks).toEqual([]);
    expect(g.maxLb).toBe(184.6);
  });
});
