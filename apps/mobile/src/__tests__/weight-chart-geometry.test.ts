import { nearestIndex, weightChartGeometry } from '@/components/body/weight-chart-geometry';

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
