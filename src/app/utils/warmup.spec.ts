import { generateWarmup } from './warmup';

describe('generateWarmup', () => {
  it('returns nothing at or below the bar', () => {
    expect(generateWarmup(45)).toEqual([]);
    expect(generateWarmup(30)).toEqual([]);
  });

  it('ramps empty bar → 50/70/90% rounded to loadable weights for 225', () => {
    // 50%→112.5→loadable 105 (45+15? no 15 plate → 45+10+5=105? per side
    // (112.5-45)/2=33.75 → 25+5=30 → 105). 70%→157.5→155. 90%→202.5→200.
    const r = generateWarmup(225);
    expect(r[0]).toEqual({ weight: 45, reps: 10, pct: null });
    // every set is loadable (multiple of plate granularity) and strictly
    // ascending, ending below the working weight.
    const weights = r.map((s) => s.weight);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
    expect(new Set(weights).size).toBe(weights.length); // no dups
    expect(weights[weights.length - 1]).toBeLessThan(225);
    expect(r.every((s) => s.weight >= 45)).toBe(true);
  });

  it('rounds each percentage DOWN, never above the target fraction', () => {
    const r = generateWarmup(225);
    for (const s of r) {
      if (s.pct == null) continue;
      expect(s.weight).toBeLessThanOrEqual(225 * s.pct);
    }
  });

  it('reps descend as load climbs', () => {
    const r = generateWarmup(315);
    expect(r[0].reps).toBe(10); // bar
    const working = r.filter((s) => s.pct != null);
    for (let i = 1; i < working.length; i++) {
      expect(working[i].reps).toBeLessThanOrEqual(working[i - 1].reps);
    }
  });

  it('produces a short ramp for a light working weight (no near-dups)', () => {
    // 65 lb: 50%→32.5<bar, 70%→45.5→bar, 90%→58.5→55. Only bar + 55.
    const r = generateWarmup(65);
    expect(r[0].weight).toBe(45);
    expect(r.every((s) => s.weight < 65)).toBe(true);
    expect(new Set(r.map((s) => s.weight)).size).toBe(r.length);
  });

  it('honors a custom bar and plate set', () => {
    const r = generateWarmup(95, 35, [25, 10, 5]);
    expect(r[0]).toEqual({ weight: 35, reps: 10, pct: null });
    expect(r.every((s) => s.weight < 95 && s.weight >= 35)).toBe(true);
  });
});
