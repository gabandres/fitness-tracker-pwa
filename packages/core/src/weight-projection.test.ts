import { describe, expect, it } from 'vitest';
import { projectWeight, weightSlopeLbPerWeek } from './weight-projection';

describe('weightSlopeLbPerWeek', () => {
  it('fits a least-squares slope in lb/week', () => {
    const points = [
      { dateKey: '2026-06-01', weightLb: 180 },
      { dateKey: '2026-06-04', weightLb: 179.5 },
      { dateKey: '2026-06-08', weightLb: 179 },
    ];
    expect(weightSlopeLbPerWeek(points)).toBeCloseTo(-1, 1);
  });

  it('returns null for too few points or too short a span', () => {
    expect(weightSlopeLbPerWeek([])).toBeNull();
    expect(
      weightSlopeLbPerWeek([
        { dateKey: '2026-06-01', weightLb: 180 },
        { dateKey: '2026-06-08', weightLb: 179 },
      ]),
    ).toBeNull();
    expect(
      weightSlopeLbPerWeek([
        { dateKey: '2026-06-01', weightLb: 180 },
        { dateKey: '2026-06-02', weightLb: 179.8 },
        { dateKey: '2026-06-03', weightLb: 179.6 },
      ]),
    ).toBeNull(); // 3 points but only a 2-day span
  });

  it('is robust to noisy daily fluctuation around a real trend', () => {
    const points = [
      { dateKey: '2026-06-01', weightLb: 180.0 },
      { dateKey: '2026-06-02', weightLb: 181.2 },
      { dateKey: '2026-06-04', weightLb: 179.4 },
      { dateKey: '2026-06-06', weightLb: 179.8 },
      { dateKey: '2026-06-08', weightLb: 179.0 },
    ];
    const slope = weightSlopeLbPerWeek(points)!;
    expect(slope).toBeLessThan(0);
    expect(slope).toBeGreaterThan(-2.5);
  });
});

describe('projectWeight', () => {
  const losing = [
    { dateKey: '2026-06-01', weightLb: 180 },
    { dateKey: '2026-06-04', weightLb: 179.5 },
    { dateKey: '2026-06-08', weightLb: 179 },
  ];

  it('returns null below the slope gate', () => {
    expect(projectWeight([])).toBeNull();
    expect(projectWeight(losing.slice(0, 2), 170)).toBeNull();
  });

  it('reports slope and the fitted current weight without a goal', () => {
    const p = projectWeight(losing)!;
    expect(p.slopeLbPerWeek).toBeCloseTo(-1, 1);
    expect(p.currentFittedLb).toBeCloseTo(179, 1);
    expect(p.lastDateKey).toBe('2026-06-08');
    expect(p.goalDateKey).toBeNull();
  });

  it('projects the date the goal is reached when the trend moves toward it', () => {
    const p = projectWeight(losing, 175)!;
    expect(p.goalDateKey).not.toBeNull();
    const [, m, d] = p.goalDateKey!.split('-').map(Number);
    expect(m).toBe(7);
    expect(d).toBeGreaterThanOrEqual(4);
    expect(d).toBeLessThanOrEqual(8);
  });

  it('gives no goal date when the trend diverges from the goal', () => {
    expect(projectWeight(losing, 190)!.goalDateKey).toBeNull();
  });

  it('gives no goal date when the crossing is implausibly far out', () => {
    const flat = [
      { dateKey: '2026-06-01', weightLb: 180.0 },
      { dateKey: '2026-06-05', weightLb: 179.98 },
      { dateKey: '2026-06-10', weightLb: 179.95 },
    ];
    expect(projectWeight(flat, 150)!.goalDateKey).toBeNull();
  });
});
