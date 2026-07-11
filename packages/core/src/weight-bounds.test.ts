import { describe, expect, it } from 'vitest';
import {
  checkWeightEntry,
  isStorableWeight,
  WEIGHT_MIN_LB,
  WEIGHT_MAX_LB,
  WEIGHT_DELTA_WARN_LB,
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
