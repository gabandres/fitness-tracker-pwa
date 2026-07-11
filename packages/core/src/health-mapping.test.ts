import { describe, expect, it } from 'vitest';
import {
  kgToLb, lbToKg, reduceImportedWeights, resolveWeightConflict, weightsToApply,
  type HealthSample,
} from './health-mapping';

function sample(over: Partial<HealthSample> = {}): HealthSample {
  return { dateKey: '2026-07-01', kind: 'weight', valueLb: 180, endMs: 1000, fromUs: false, ...over };
}

describe('kg ↔ lb', () => {
  it('round-trips within float tolerance', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(kgToLb(81.6))).toBeCloseTo(81.6, 6);
  });
});

describe('reduceImportedWeights', () => {
  it('keeps one weight per day — latest endMs wins', () => {
    const out = reduceImportedWeights([
      sample({ dateKey: '2026-07-01', valueLb: 180, endMs: 100 }),
      sample({ dateKey: '2026-07-01', valueLb: 179, endMs: 500 }),
      sample({ dateKey: '2026-07-02', valueLb: 178, endMs: 200 }),
    ]);
    expect(out).toEqual({ '2026-07-01': 179, '2026-07-02': 178 });
  });

  it('is order-independent (earlier-listed newer sample still wins)', () => {
    const out = reduceImportedWeights([
      sample({ dateKey: 'd', valueLb: 179, endMs: 500 }),
      sample({ dateKey: 'd', valueLb: 180, endMs: 100 }),
    ]);
    expect(out).toEqual({ d: 179 });
  });

  it('drops samples we wrote (fromUs) so re-sync is idempotent', () => {
    const out = reduceImportedWeights([
      sample({ dateKey: 'd', valueLb: 180, endMs: 100, fromUs: true }),
      sample({ dateKey: 'd', valueLb: 181, endMs: 200, fromUs: false }),
    ]);
    expect(out).toEqual({ d: 181 });
  });

  it('drops a day entirely when every sample for it is ours', () => {
    const out = reduceImportedWeights([sample({ fromUs: true })]);
    expect(out).toEqual({});
  });

  it('rejects junk values (0 lb, implausible)', () => {
    const out = reduceImportedWeights([
      sample({ dateKey: 'a', valueLb: 0 }),
      sample({ dateKey: 'b', valueLb: 9999 }),
      sample({ dateKey: 'c', valueLb: 175 }),
    ]);
    expect(out).toEqual({ c: 175 });
  });

  it('returns empty for empty / nullish input', () => {
    expect(reduceImportedWeights([])).toEqual({});
    expect(reduceImportedWeights(undefined as unknown as HealthSample[])).toEqual({});
  });
});

describe('resolveWeightConflict', () => {
  it('lets a storable Health reading win (scale is authoritative)', () => {
    expect(resolveWeightConflict(182, null, 180, 0)).toBe(180);
    expect(resolveWeightConflict(null, null, 180, 0)).toBe(180);
  });

  it('keeps the app value when the Health value is junk', () => {
    expect(resolveWeightConflict(182, null, 0, 0)).toBe(182);
  });
});

describe('weightsToApply', () => {
  it('emits only days that differ from the current dailyWeights', () => {
    const imported = { '2026-07-01': 180, '2026-07-02': 179, '2026-07-03': 178 };
    const current = { '2026-07-01': 180, '2026-07-02': 181 }; // 01 matches, 02 differs, 03 new
    expect(weightsToApply(imported, current)).toEqual({ '2026-07-02': 179, '2026-07-03': 178 });
  });

  it('treats sub-0.05 lb differences as equal (lb↔kg round-trip noise)', () => {
    expect(weightsToApply({ d: 180.02 }, { d: 180.0 })).toEqual({});
    expect(weightsToApply({ d: 180.2 }, { d: 180.0 })).toEqual({ d: 180.2 });
  });

  it('applies everything when there is no current data', () => {
    expect(weightsToApply({ d: 175 }, {})).toEqual({ d: 175 });
  });
});
