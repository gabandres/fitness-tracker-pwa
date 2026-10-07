import { describe, expect, it } from 'vitest';
import { tapeDays } from './body-composition';
import { compositionMaintenance } from './composition-maintenance';
import { classifyRecomp, recompSignal, waistIntervalExcludesZero } from './recomp-signal';
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

describe('waistIntervalExcludesZero — the gate on the confident headline', () => {
  it.each([
    [-0.3, 0.24, true], // −0.30 ± 0.24 → [−0.54, −0.06]: zero excluded
    [0.3, 0.24, true],
    [-0.238, 0.341, false], // the account: −0.24 ± 0.34 crosses zero
    [-0.24, 0.24, false], // touches zero — not excluded
    [0, 0.1, false],
    [Number.NaN, 0.1, false],
  ] as const)('slope %f ± %f → %s', (slope, se, out) => {
    expect(waistIntervalExcludesZero(slope, se)).toBe(out);
  });

  it('waistWithinNoise is its negation: a slope exactly one SE from zero is "possible", not a signal', () => {
    const ms: Measurement[] = [
      { date: d(8, 30), waist: 32.25 },
      { date: d(9, 14), waist: 32.25 },
      { date: d(9, 28), waist: 32 },
    ];
    const r = recompSignal({ dailyWeights: flatWeights, measurements: ms, now: NOW });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.waistWithinNoise).toBe(!waistIntervalExcludesZero(r.waistInPer4Wk, r.waistSeInPer4Wk));
    expect(r.waistWithinNoise).toBe(true);
  });
});

describe('tape counts — one definition (`tapeDays`), two windows', () => {
  // The owner's "5 tapes over 54 days" beside "3 tapes": five weekly-ish
  // waist + neck sets, 08-05 → 09-28, only three inside the last 42 days.
  // 08-26 was entered as three readings: still ONE tape on both cards.
  const ms: Measurement[] = [
    { date: d(8, 5), waist: 33, neck: 15 },
    { date: d(8, 12), waist: 32.75, neck: 15 },
    ...[32.5, 32.75, 32.25].map((w, i) => ({ date: new Date(2026, 7, 26, 7 + i), waist: w, neck: 15 })),
    { date: d(9, 14), waist: 32.5, neck: 15 },
    { date: d(9, 28), waist: 32.25, neck: 15 },
  ];

  it('the composition line counts its first→last span, the recomp card its last 42 days — both via tapeDays', () => {
    const comp = compositionMaintenance({
      logs: [],
      dailyWeights: flatWeights,
      measurements: ms,
      profile: { sex: 'male', heightIn: 70 },
      now: NOW,
      draws: 10,
    });
    const recomp = recompSignal({ dailyWeights: flatWeights, measurements: ms, now: NOW });

    expect(comp).toMatchObject({ points: 5, spanDays: 54 });
    expect(comp.points).toBe(tapeDays(ms, undefined, { fromKey: '2026-08-05', toKey: '2026-09-28' }).length);

    expect(recomp.tapes).toBe(3);
    expect(recomp.tapes).toBe(
      tapeDays(ms, undefined, { fromKey: '2026-08-22', toKey: '2026-10-03' }).filter((t) => t.waistIn != null).length,
    );
  });

  it('inside the same window the two counts agree', () => {
    const recent = ms.filter((m) => m.date >= d(8, 22));
    const comp = compositionMaintenance({
      logs: [],
      dailyWeights: flatWeights,
      measurements: recent,
      profile: { sex: 'male', heightIn: 70 },
      now: NOW,
      draws: 10,
    });
    expect(comp.points).toBe(recompSignal({ dailyWeights: flatWeights, measurements: recent, now: NOW }).tapes);
  });
});
