import { describe, expect, it } from 'vitest';
import {
  CM_PER_IN,
  KG_PER_LB,
  compositionAt,
  compositionPoints,
  navyBodyFatPct,
  storedEnergyChangeKcal,
  trendWeightAt,
} from './body-composition';
import type { Measurement } from './types';

const male = (waistIn: number, neckIn: number, heightIn = 68.5) =>
  navyBodyFatPct({ sex: 'male', heightIn, waistIn, neckIn });
const pctOf = (r: ReturnType<typeof navyBodyFatPct>) => (r.ok ? r.pct : NaN);

describe('navyBodyFatPct', () => {
  it('men, 68.5 in: waist 32.00 / neck 14.5 → 15.09%, waist 32.25 → 15.63%', () => {
    expect(pctOf(male(32, 14.5))).toBeCloseTo(15.09, 1);
    expect(Math.abs(pctOf(male(32, 14.5)) - 15.09)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pctOf(male(32.25, 14.5)) - 15.63)).toBeLessThanOrEqual(0.05);
  });

  it('is unrounded — the regression needs the resolution the display estimate drops', () => {
    expect(pctOf(male(32, 14.5))).not.toBe(Math.round(pctOf(male(32, 14.5)) * 10) / 10);
  });

  it('accepts cm and gives the same answer', () => {
    const cm = navyBodyFatPct({ sex: 'male', heightCm: 68.5 * CM_PER_IN, waistCm: 32 * CM_PER_IN, neckCm: 14.5 * CM_PER_IN });
    expect(pctOf(cm)).toBeCloseTo(pctOf(male(32, 14.5)), 9);
  });

  it('women use waist + hip − neck and need the hip', () => {
    const r = navyBodyFatPct({ sex: 'female', heightIn: 65, waistIn: 30, neckIn: 13, hipIn: 38 });
    const expected = 163.205 * Math.log10(30 + 38 - 13) - 97.684 * Math.log10(65) - 78.387;
    expect(pctOf(r)).toBeCloseTo(expected, 9);
    expect(navyBodyFatPct({ sex: 'female', heightIn: 65, waistIn: 30, neckIn: 13 })).toEqual({ ok: false, reason: 'missing_input' });
  });

  it.each([
    [{ heightIn: 47, waistIn: 32, neckIn: 14.5 }, 'height_out_of_range'],
    [{ heightIn: 91, waistIn: 32, neckIn: 14.5 }, 'height_out_of_range'],
    [{ heightIn: 68, waistIn: 19, neckIn: 14.5 }, 'waist_out_of_range'],
    [{ heightIn: 68, waistIn: 71, neckIn: 14.5 }, 'waist_out_of_range'],
    [{ heightIn: 68, waistIn: 32, neckIn: 9 }, 'neck_out_of_range'],
    [{ heightIn: 68, waistIn: 32, neckIn: 26 }, 'neck_out_of_range'],
    [{ heightIn: 68, waistIn: 22, neckIn: 22 }, 'waist_not_above_neck'],
    [{ heightIn: 68, waistIn: 25, neckIn: 24.5 }, 'implausible_result'],
    [{ heightIn: 68, neckIn: 14.5 }, 'missing_input'],
  ])('rejects %j: %s', (inp, reason) => {
    expect(navyBodyFatPct({ sex: 'male', ...inp })).toEqual({ ok: false, reason });
  });
});

const at = (key: string, h = 9) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, h, 0);
};

describe('compositionPoints — source priority per day', () => {
  const body = { sex: 'male' as const, heightIn: 68.5 };

  it('DXA > another measured %BF > Navy > nothing', () => {
    const ms: Measurement[] = [
      { date: at('2026-09-01'), waist: 32, neck: 14.5 },
      { date: at('2026-09-01', 10), bodyFatPct: 18, bodyFatMethod: 'other' },
      { date: at('2026-09-01', 11), bodyFatPct: 17, bodyFatMethod: 'dxa' },
      { date: at('2026-09-02'), waist: 32, neck: 14.5 },
      { date: at('2026-09-02', 10), bodyFatPct: 18, bodyFatMethod: 'other' },
      { date: at('2026-09-03'), waist: 32, neck: 14.5 },
      { date: at('2026-09-04'), chest: 40 },
    ];
    const pts = compositionPoints(ms, body);
    expect(pts.map((p) => [p.dateKey, p.source, Math.round(p.bodyFatPct * 100) / 100])).toEqual([
      ['2026-09-01', 'dxa', 17],
      ['2026-09-02', 'other', 18],
      ['2026-09-03', 'navy', 15.1],
    ]);
  });

  it('takes the median of a day\'s three tape readings', () => {
    const ms: Measurement[] = [32.5, 32, 32.25].map((w, i) => ({ date: at('2026-09-01', 7 + i), waist: w, neck: 14.5 }));
    const [p] = compositionPoints(ms, body);
    expect(p.tapes).toEqual({ waistIn: 32.25, neckIn: 14.5 });
  });

  it('without sex/height only measured %BF can become a point', () => {
    const ms: Measurement[] = [
      { date: at('2026-09-01'), waist: 32, neck: 14.5 },
      { date: at('2026-09-02'), bodyFatPct: 17, bodyFatMethod: 'dxa' },
    ];
    expect(compositionPoints(ms, {}).map((p) => p.source)).toEqual(['dxa']);
  });

  it('skips a tape row that fails the guards (the 06-25 chest-15 row has no neck)', () => {
    const ms: Measurement[] = [{ date: at('2026-06-25'), waist: 32.3, chest: 15 }];
    expect(compositionPoints(ms, body)).toEqual([]);
  });
});

describe('trendWeightAt', () => {
  const series = (from: string, n: number, f: (i: number) => number) => {
    const out: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const [y, m, d] = from.split('-').map(Number);
      out[new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)] = f(i);
    }
    return out;
  };

  it('is the local line, not the single weigh-in that day', () => {
    // 156 ± 1.5 lb alternating noise around a flat trend.
    const w = series('2026-09-01', 29, (i) => 156 + (i % 2 ? 1.5 : -1.5));
    expect(w['2026-09-15']).toBe(154.5);
    expect(trendWeightAt('2026-09-15', w)!).toBeCloseTo(156, 0);
  });

  it('recovers a linear trend exactly, including one-sided at the data\'s end', () => {
    const w = series('2026-09-01', 30, (i) => 160 - 0.1 * i);
    expect(trendWeightAt('2026-09-15', w)!).toBeCloseTo(158.6, 9);
    expect(trendWeightAt('2026-09-30', w)!).toBeCloseTo(157.1, 9);
  });

  it('null when the weigh-ins all sit far to ONE side — a line pushed 11+ days past its data', () => {
    const far = series('2026-09-26', 4, () => 156); // +11 … +14 from 09-15
    expect(trendWeightAt('2026-09-15', far)).toBeNull();
    const near = series('2026-09-17', 4, () => 156); // nearest +2: still the edge of the data
    expect(trendWeightAt('2026-09-15', near)!).toBeCloseTo(156, 9);
  });

  it('null with fewer than 4 weigh-ins nearby', () => {
    expect(trendWeightAt('2026-09-15', { '2026-09-14': 156, '2026-09-15': 156, '2026-09-16': 155 })).toBeNull();
  });
});

describe('compositionAt / storedEnergyChangeKcal', () => {
  it('FM = trend weight × BF, FFM the rest, in kg', () => {
    const w: Record<string, number> = { '2026-09-13': 156, '2026-09-14': 156, '2026-09-15': 156, '2026-09-16': 156 };
    const c = compositionAt({ dateKey: '2026-09-14', bodyFatPct: 15, source: 'navy' }, w)!;
    expect(c.weightKg).toBeCloseTo(156 * KG_PER_LB, 9);
    expect(c.fmKg).toBeCloseTo(156 * KG_PER_LB * 0.15, 9);
    expect(c.ffmKg).toBeCloseTo(156 * KG_PER_LB * 0.85, 9);
  });

  it('ΔFM −0.29 kg, ΔFFM +0.74 kg → ΔE ≈ −1,394 kcal (−100/day over 14 days)', () => {
    const dE = storedEnergyChangeKcal(-0.29, 0.74);
    expect(dE).toBeCloseTo(-1393.76, 2);
    expect(Math.round(dE / 14)).toBe(-100);
  });
});
