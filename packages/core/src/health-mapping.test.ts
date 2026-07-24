import { describe, expect, it } from 'vitest';
import {
  fractionToPercent, flOzToLiters, isStorableHealthValue, kgToLb, lbToKg, litersToFlOz,
  percentToFraction, reduceImportedSamples, valuesToApply,
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

describe('activity import (steps / active energy)', () => {
  it('sums the day-buckets rather than taking the latest', () => {
    // Health stores activity as many short intervals; taking the latest would
    // report the last 15-minute bucket as the whole day.
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 4000, endMs: 100 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 3200, endMs: 500 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 1232, endMs: 900 }),
    ]);
    expect(out['2026-07-01']).toBe(8432);
  });

  it('sums active energy per day', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'activeEnergy', dateKey: '2026-07-01', value: 300, endMs: 100 }),
      sample({ kind: 'activeEnergy', dateKey: '2026-07-01', value: 212, endMs: 500 }),
      sample({ kind: 'activeEnergy', dateKey: '2026-07-02', value: 90, endMs: 600 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 512, '2026-07-02': 90 });
  });

  it('keeps a zero-step rest day (0 is a real reading, not missing data)', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 0, endMs: 100 }),
    ]);
    expect(out['2026-07-01']).toBe(0);
  });

  it('rejects a day whose SUMMED steps are implausible', () => {
    // The gate applies to the day total, not each bucket — one 100k bucket is
    // fine on its own but three of them are corrupt data.
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 100_000, endMs: 100 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 100_000, endMs: 200 }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 100_000, endMs: 300 }),
    ]);
    expect(out['2026-07-01']).toBeUndefined();
  });

  it('never re-imports activity we somehow wrote ourselves', () => {
    const out = reduceImportedSamples([
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 5000, endMs: 100, fromUs: true }),
      sample({ kind: 'steps', dateKey: '2026-07-01', value: 3000, endMs: 200 }),
    ]);
    expect(out['2026-07-01']).toBe(3000);
  });
});
