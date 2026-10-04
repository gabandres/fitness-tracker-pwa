import { describe, expect, it } from 'vitest';
import { classifyRecomp, recompSignal } from './recomp-signal';
import type { Measurement } from './types';

describe('classifyRecomp — the brief\'s table, first match wins', () => {
  it.each([
    [0, -0.25, 'recomp'],
    [0.25, -0.125, 'recomp'],
    [-0.25, -0.5, 'recomp'], // |−0.25| ≤ 0.25 is "stable" — row 1 precedes row 2
    [-0.5, -0.25, 'fat_loss'],
    [-0.5, 0, 'scale_loss_waist_flat'],
    [-0.5, 0.125, 'scale_loss_waist_flat'],
    [0.5, 0.25, 'gaining_fat'],
    [0.5, 0, 'gaining_waist_stable'],
    [0, 0, 'no_signal'],
    [0, 0.5, 'no_signal'],
    [-0.5, 0.5, 'no_signal'],
  ] as const)('weight %f lb/wk, waist %f in/4wk → %s', (w, waist, cls) => {
    expect(classifyRecomp(w, waist)).toBe(cls);
  });
});

const NOW = new Date(2026, 9, 3, 20, 0);
const d = (m: number, day: number) => new Date(2026, m - 1, day, 9);
const flatWeights: Record<string, number> = {};
for (let i = 0; i < 28; i++) {
  const t = new Date(2026, 8, 6 + i);
  flatWeights[`2026-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`] = 156 + (i % 2 ? 0.6 : -0.6);
}

describe('recompSignal', () => {
  it('the account shape: weight flat, waist 32.25 → 32.25 → 32.00 → recomp, but within tape noise', () => {
    const ms: Measurement[] = [
      { date: d(8, 30), waist: 32.25, neck: 14.5 },
      { date: d(9, 14), waist: 32.25, neck: 14.5 },
      { date: d(9, 28), waist: 32, neck: 14.5 },
    ];
    const r = recompSignal({ dailyWeights: flatWeights, measurements: ms, now: NOW });
    expect(r).toMatchObject({ status: 'ok', cls: 'recomp', tapes: 3, waistWithinNoise: true });
    if (r.status === 'ok') {
      expect(r.waistInPer4Wk).toBeCloseTo(-0.238, 2);
      expect(Math.abs(r.weightLbPerWeek)).toBeLessThan(0.25);
    }
  });

  it('needs 3 tapes in the last 42 days', () => {
    const ms: Measurement[] = [
      { date: d(8, 17), waist: 32.5 }, // 47 days back — outside
      { date: d(9, 14), waist: 32.25 },
      { date: d(9, 28), waist: 32 },
    ];
    expect(recompSignal({ dailyWeights: flatWeights, measurements: ms, now: NOW })).toEqual({ status: 'insufficient', reason: 'tapes', tapes: 2 });
  });

  it('a clear move is outside the noise', () => {
    const ms: Measurement[] = [0, 7, 14, 21, 28, 35].map((k, i) => ({ date: new Date(2026, 7, 23 + k, 9), waist: 33 - 0.25 * i }));
    const r = recompSignal({ dailyWeights: flatWeights, measurements: ms, now: NOW });
    expect(r).toMatchObject({ status: 'ok', cls: 'recomp', waistWithinNoise: false, tapes: 6 });
  });
});
