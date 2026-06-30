import { describe, expect, it } from 'vitest';
import { computePlateLoad, DEFAULT_BAR_LB } from './plate-math';

describe('computePlateLoad', () => {
  it('returns null for a non-positive target', () => {
    expect(computePlateLoad(0)).toBeNull();
    expect(computePlateLoad(-50)).toBeNull();
  });

  it('loads a clean 135 as one 45 per side', () => {
    const r = computePlateLoad(135)!;
    expect(r.bar).toBe(45);
    expect(r.perSide).toEqual([{ plate: 45, count: 1 }]);
    expect(r.achievable).toBe(135);
    expect(r.remainder).toBe(0);
  });

  it('greedily stacks heaviest-first for 225', () => {
    // (225-45)/2 = 90 per side → 45 + 45.
    const r = computePlateLoad(225)!;
    expect(r.perSide).toEqual([{ plate: 45, count: 2 }]);
    expect(r.achievable).toBe(225);
  });

  it('mixes denominations and uses the 2.5 plate', () => {
    // (140-45)/2 = 47.5 → 45 + 2.5.
    const r = computePlateLoad(140)!;
    expect(r.perSide).toEqual([
      { plate: 45, count: 1 },
      { plate: 2.5, count: 1 },
    ]);
    expect(r.achievable).toBe(140);
    expect(r.remainder).toBe(0);
  });

  it('reports a remainder when no plate pair closes the gap', () => {
    // (137-45)/2 = 46 → 45 (rem 1 per side = 2 lb total unmet).
    const r = computePlateLoad(137)!;
    expect(r.perSide).toEqual([{ plate: 45, count: 1 }]);
    expect(r.achievable).toBe(135);
    expect(r.remainder).toBe(2);
  });

  it('returns just the bar at or below bar weight', () => {
    const r = computePlateLoad(45)!;
    expect(r.perSide).toEqual([]);
    expect(r.achievable).toBe(DEFAULT_BAR_LB);
    expect(r.remainder).toBe(0);

    const below = computePlateLoad(30)!;
    expect(below.perSide).toEqual([]);
    expect(below.achievable).toBe(45);
    expect(below.remainder).toBe(0); // clamped, not negative
  });

  it('honors a custom bar and plate set', () => {
    // 35-lb training bar, kg-ish plates ignored; (95-35)/2 = 30 → 25 + 5.
    const r = computePlateLoad(95, 35, [25, 10, 5])!;
    expect(r.bar).toBe(35);
    expect(r.perSide).toEqual([
      { plate: 25, count: 1 },
      { plate: 5, count: 1 },
    ]);
    expect(r.achievable).toBe(95);
  });

  it('does not spawn phantom plates from 2.5-lb float drift', () => {
    // 47.5 per side must be exactly 45 + 2.5, no trailing remainder.
    const r = computePlateLoad(140)!;
    expect(r.remainder).toBe(0);
    expect(r.perSide.reduce((s, p) => s + p.plate * p.count, 0)).toBe(47.5);
  });
});
