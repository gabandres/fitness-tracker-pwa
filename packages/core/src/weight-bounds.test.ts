import { describe, expect, it } from 'vitest';
import {
  checkWeightEntry,
  isStorableWeight,
  WEIGHT_MIN_LB,
  WEIGHT_MAX_LB,
  WEIGHT_DELTA_WARN_LB,
  WEIGH_IN_MIN_DATE_KEY,
  isStorableWeighInDate,
} from './weight-bounds';

describe('checkWeightEntry', () => {
  it('accepts a plausible weight with no prior', () => {
    expect(checkWeightEntry(180)).toEqual({ ok: true });
  });

  it('rejects weights outside the soft range (the 11 lb bug)', () => {
    expect(checkWeightEntry(11)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(checkWeightEntry(WEIGHT_MIN_LB - 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(checkWeightEntry(WEIGHT_MAX_LB + 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(checkWeightEntry(NaN)).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('accepts the soft-range boundaries', () => {
    expect(checkWeightEntry(WEIGHT_MIN_LB)).toEqual({ ok: true });
    expect(checkWeightEntry(WEIGHT_MAX_LB)).toEqual({ ok: true });
  });

  it('flags a large day-over-day jump for confirmation, not rejection', () => {
    const r = checkWeightEntry(200, 180);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'large-delta') expect(r.deltaLb).toBe(20);
  });

  it('allows a delta within the warn threshold', () => {
    expect(checkWeightEntry(180 + WEIGHT_DELTA_WARN_LB, 180)).toEqual({ ok: true });
  });
});

describe('isStorableWeight', () => {
  it('rejects absolute-garbage values on every write path', () => {
    expect(isStorableWeight(11)).toBe(false);
    expect(isStorableWeight(0)).toBe(false);
    expect(isStorableWeight(1000)).toBe(false);
    expect(isStorableWeight(NaN)).toBe(false);
  });

  it('accepts a realistic weight', () => {
    expect(isStorableWeight(180)).toBe(true);
  });
});

describe('isStorableWeighInDate', () => {
  const TODAY = '2026-08-04';

  it('rejects a future weigh-in — you cannot have weighed yourself tomorrow', () => {
    expect(isStorableWeighInDate('2026-08-05', TODAY)).toBe(false);
    expect(isStorableWeighInDate('2027-01-01', TODAY)).toBe(false);
  });

  it('accepts today and ordinary past dates, including real imported history', () => {
    expect(isStorableWeighInDate(TODAY, TODAY)).toBe(true);
    expect(isStorableWeighInDate('2026-07-12', TODAY)).toBe(true);
    // 2017 and 2022 rows are OLD, not malformed: a genuine import can carry
    // them, so the date gate must not be what removes them.
    expect(isStorableWeighInDate('2017-06-22', TODAY)).toBe(true);
    expect(isStorableWeighInDate('2022-09-13', TODAY)).toBe(true);
  });

  it('rejects a mistyped year below the floor', () => {
    expect(isStorableWeighInDate('0217-06-22', TODAY)).toBe(false);
    expect(isStorableWeighInDate('1017-06-22', TODAY)).toBe(false);
    expect(isStorableWeighInDate('1999-12-31', TODAY)).toBe(false);
    expect(isStorableWeighInDate(WEIGH_IN_MIN_DATE_KEY, TODAY)).toBe(true);
  });

  it('rejects anything that is not a YYYY-MM-DD key', () => {
    for (const bad of ['', '2026-8-4', '2026/08/04', 'today', '2026-08-04T00:00:00Z']) {
      expect(isStorableWeighInDate(bad, TODAY)).toBe(false);
    }
  });
});
