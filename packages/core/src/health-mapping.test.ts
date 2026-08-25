import { describe, expect, it } from 'vitest';
import {
  DAILY_FOLD, SLEEP_MAX_HOURS, WATER_MAX_FLOZ,
  clampSleepHours, clampWaterFlOz,
  fractionToPercent, flOzToLiters, isStorableHealthValue, kgToLb, lbToKg, litersToFlOz,
  latestSampleEndByDay, percentToFraction, reduceImportedSamples, valuesToApply,
  type HealthKind, type HealthSample,
} from './health-mapping';

function sample(over: Partial<HealthSample> = {}): HealthSample {
  return { dateKey: '2026-07-01', kind: 'weight', value: 180, endMs: 1000, fromUs: false, ...over };
}

describe('unit conversions', () => {
  it('kg ↔ lb round-trips within float tolerance', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(kgToLb(81.6))).toBeCloseTo(81.6, 6);
  });
  it('liters ↔ fl oz round-trips', () => {
    expect(litersToFlOz(1)).toBeCloseTo(33.814, 3);
    expect(flOzToLiters(litersToFlOz(2))).toBeCloseTo(2, 6);
  });
  it('fraction ↔ percent for body-fat', () => {
    expect(fractionToPercent(0.183)).toBeCloseTo(18.3, 6);
    expect(percentToFraction(18.3)).toBeCloseTo(0.183, 6);
  });
});

describe('isStorableHealthValue', () => {
  const cases: [HealthKind, number, boolean][] = [
    ['weight', 175, true], ['weight', 0, false], ['weight', 9999, false],
    ['sleep', 7.5, true], ['sleep', 0, false], ['sleep', 25, false],
    ['water', 64, true], ['water', 0, true], ['water', 999, false],
    ['bodyFat', 18, true], ['bodyFat', 2, false], ['bodyFat', 80, false],
    ['weight', NaN, false],
    // Activity: 0 is a real value (a rest day), so it must pass.
    ['steps', 8432, true], ['steps', 0, true], ['steps', -1, false], ['steps', 200_001, false],
    ['activeEnergy', 512, true], ['activeEnergy', 0, true],
    ['activeEnergy', -1, false], ['activeEnergy', 20_001, false],
  ];
  it.each(cases)('%s %d → %s', (kind, value, expected) => {
    expect(isStorableHealthValue(kind, value)).toBe(expected);
  });
});

describe('reduceImportedSamples', () => {
  it('keeps one value per day — latest endMs wins', () => {
    const out = reduceImportedSamples([
      sample({ dateKey: '2026-07-01', value: 180, endMs: 100 }),
      sample({ dateKey: '2026-07-01', value: 179, endMs: 500 }),
      sample({ dateKey: '2026-07-02', value: 178, endMs: 200 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 179, '2026-07-02': 178 });
  });

  it('is order-independent (earlier-listed newer sample still wins)', () => {
    const out = reduceImportedSamples([
      sample({ dateKey: 'd', value: 179, endMs: 500 }),
      sample({ dateKey: 'd', value: 180, endMs: 100 }),
    ]);
    expect(out).toEqual({ d: 179 });
  });

  it('drops samples we wrote (fromUs) so re-sync is idempotent', () => {
    const out = reduceImportedSamples([
      sample({ dateKey: 'd', value: 180, endMs: 100, fromUs: true }),
      sample({ dateKey: 'd', value: 181, endMs: 200, fromUs: false }),
    ]);
    expect(out).toEqual({ d: 181 });
  });

  it('drops a day entirely when every sample for it is ours', () => {
    expect(reduceImportedSamples([sample({ fromUs: true })])).toEqual({});
  });

  it('rejects junk values per-kind (0/implausible weight)', () => {
    const out = reduceImportedSamples([
      sample({ dateKey: 'a', value: 0 }),
      sample({ dateKey: 'b', value: 9999 }),
      sample({ dateKey: 'c', value: 175 }),
    ]);
    expect(out).toEqual({ c: 175 });
  });

  it('sums additive kinds per day (sleep segments → nightly hours)', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'sleep', dateKey: 'd', value: 4, endMs: 100 }),
      sample({ kind: 'sleep', dateKey: 'd', value: 3.5, endMs: 900 }),
      sample({ kind: 'sleep', dateKey: 'e', value: 8, endMs: 200 }),
    ]);
    expect(out).toEqual({ d: 7.5, e: 8 });
  });

  it('sums additive water sips and rejects an impossible day-total', () => {
    expect(
      reduceImportedSamples([
        sample({ kind: 'water', dateKey: 'd', value: 12 }),
        sample({ kind: 'water', dateKey: 'd', value: 20 }),
      ]),
    ).toEqual({ d: 32 });
    // 400 + 400 = 800 fl oz > WATER_MAX_FLOZ → the whole day drops.
    expect(
      reduceImportedSamples([
        sample({ kind: 'water', dateKey: 'd', value: 400 }),
        sample({ kind: 'water', dateKey: 'd', value: 400 }),
      ]),
    ).toEqual({});
  });

  it('returns empty for empty / nullish input', () => {
    expect(reduceImportedSamples([])).toEqual({});
    expect(reduceImportedSamples(undefined as unknown as HealthSample[])).toEqual({});
  });
});

describe('valuesToApply', () => {
  it('emits only days that differ from the current app values', () => {
    const imported = { '2026-07-01': 180, '2026-07-02': 179, '2026-07-03': 178 };
    const current = { '2026-07-01': 180, '2026-07-02': 181 }; // 01 matches, 02 differs, 03 new
    expect(valuesToApply(imported, current)).toEqual({ '2026-07-02': 179, '2026-07-03': 178 });
  });

  it('treats sub-epsilon differences as equal (unit round-trip noise)', () => {
    expect(valuesToApply({ d: 180.02 }, { d: 180.0 })).toEqual({});
    expect(valuesToApply({ d: 180.2 }, { d: 180.0 })).toEqual({ d: 180.2 });
  });

  it('honors a custom epsilon (e.g. whole fl oz for water)', () => {
    expect(valuesToApply({ d: 64.4 }, { d: 64 }, 1)).toEqual({});
    expect(valuesToApply({ d: 66 }, { d: 64 }, 1)).toEqual({ d: 66 });
  });

  it('applies everything when there is no current data', () => {
    expect(valuesToApply({ d: 175 }, {})).toEqual({ d: 175 });
  });
});

describe('DAILY_FOLD', () => {
  it('marks activity as pre-aggregated, not summed', () => {
    // The adapters read activity through the OS aggregate APIs (HealthKit
    // statistics-collection / Health Connect aggregateGroupByPeriod), which
    // merge multiple sources. What arrives is already the day's total, so
    // summing here would double-count the very figure the dedup produced.
    expect(DAILY_FOLD.steps).toBe('preAggregated');
    expect(DAILY_FOLD.activeEnergy).toBe('preAggregated');
  });

  it('leaves the writable kinds unchanged', () => {
    expect(DAILY_FOLD.weight).toBe('latest');
    expect(DAILY_FOLD.bodyFat).toBe('latest');
    // Sleep + water still arrive as raw fragments and still sum.
    expect(DAILY_FOLD.sleep).toBe('sum');
    expect(DAILY_FOLD.water).toBe('sum');
  });
});

describe('activity import (steps / active energy)', () => {
  it('does NOT sum pre-aggregated day totals', () => {
    // Regression guard for the double-count this replaced: the adapter hands
    // us one deduplicated total per day. If a second sample for the same day
    // ever appears it must replace, never add — 8432, not 16864.
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 8432, endMs: 100 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 8432, endMs: 500 }),
    ]);
    expect(out['2026-07-01']).toBe(8432);
  });

  it('keeps one active-energy total per day', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'activeEnergy', dateKey: '2026-07-01', value: 512, endMs: 100 }),
      sample({ kind: 'activeEnergy', dateKey: '2026-07-02', value: 90, endMs: 600 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 512, '2026-07-02': 90 });
  });

  it('takes the latest bucket when a day is re-read mid-day', () => {
    // Health keeps revising today's total as the watch syncs; the newest
    // aggregate for the day is the authoritative one.
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 4000, endMs: 100 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 9100, endMs: 900 }),
    ]);
    expect(out['2026-07-01']).toBe(9100);
  });

  it('keeps a zero-step rest day (0 is a real reading, not missing data)', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 0, endMs: 100 }),
    ]);
    expect(out['2026-07-01']).toBe(0);
  });

  it('rejects an implausible day total', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 200_001, endMs: 100 }),
      sample({ kind: 'steps', dateKey: '2026-07-02', value: 12_000, endMs: 200 }),
    ]);
    expect(out).toEqual({ '2026-07-02': 12_000 });
  });

  it('never re-imports activity we somehow wrote ourselves', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 5000, endMs: 100, fromUs: true }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 3000, endMs: 200 }),
    ]);
    expect(out['2026-07-01']).toBe(3000);
  });
});

describe('latestSampleEndByDay', () => {
  // Sleep folds by SUM, so `reduceImportedSamples` discards the sample times
  // with the fold. The wake instant survives here for one consumer: the import
  // guard's question of which key could hold the night's manual twin (#80).
  it('keeps the LAST end per day, which is when the sleeper woke', () => {
    const out = latestSampleEndByDay([
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 2, endMs: 200 }),
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 3, endMs: 900 }),
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 1, endMs: 500 }),
      sample({ kind: 'sleep', dateKey: '2026-07-02', value: 7, endMs: 50 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 900, '2026-07-02': 50 });
  });

  it('drops our own exports, matching reduceImportedSamples', () => {
    const out = latestSampleEndByDay([
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 7, endMs: 900, fromUs: true }),
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 7, endMs: 300 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 300 });
  });

  it('ignores a non-finite end rather than propagating it', () => {
    // An unknown instant makes the guard behave as it did before #80. A NaN
    // reaching `dayKeyAt` would not.
    const out = latestSampleEndByDay([
      sample({ kind: 'sleep', dateKey: '2026-07-01', value: 7, endMs: Number.NaN }),
    ]);
    expect(out).toEqual({});
  });

  it('is empty for no samples', () => {
    expect(latestSampleEndByDay([])).toEqual({});
  });
});

describe('write-path clamps', () => {
  // Applied by both Firestore adapters, the in-memory adapter and the store's
  // pre-write clamp — these are the bound, not a copy of it.
  it('clamps water to [0, WATER_MAX_FLOZ] and rounds to whole fl oz', () => {
    expect(clampWaterFlOz(-5)).toBe(0);
    expect(clampWaterFlOz(64.4)).toBe(64);
    expect(clampWaterFlOz(WATER_MAX_FLOZ + 1)).toBe(WATER_MAX_FLOZ);
  });

  it('clamps sleep to [0, 24] and snaps to the half hour', () => {
    expect(clampSleepHours(-1)).toBe(0);
    expect(clampSleepHours(7.3)).toBe(7.5);
    expect(clampSleepHours(7.1)).toBe(7);
    expect(clampSleepHours(SLEEP_MAX_HOURS + 3)).toBe(SLEEP_MAX_HOURS);
  });
});
