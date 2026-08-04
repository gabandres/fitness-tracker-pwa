import { describe, expect, it } from 'vitest';
import {
  MEASUREMENT_BOUNDS_IN,
  implausibleMeasurementFields,
  isPlausibleMeasurement,
} from './measurement-bounds';

describe('isPlausibleMeasurement', () => {
  it('rejects the reported chest=15in (a neck value in the chest field)', () => {
    expect(isPlausibleMeasurement('chest', 15)).toBe(false);
    // …and accepts the very same number as a neck, which is why one shared
    // range could never have caught it.
    expect(isPlausibleMeasurement('neck', 15)).toBe(true);
  });

  it('accepts ordinary values per field', () => {
    expect(isPlausibleMeasurement('chest', 42)).toBe(true);
    expect(isPlausibleMeasurement('waist', 34)).toBe(true);
    expect(isPlausibleMeasurement('bicep', 14)).toBe(true);
    expect(isPlausibleMeasurement('hip', 40)).toBe(true);
  });

  it('rejects non-finite and out-of-band values', () => {
    expect(isPlausibleMeasurement('waist', Number.NaN)).toBe(false);
    expect(isPlausibleMeasurement('waist', 0)).toBe(false);
    expect(isPlausibleMeasurement('waist', 199)).toBe(false); // old rules allowed this
  });

  it('is inclusive at both ends of every band', () => {
    for (const [field, [lo, hi]] of Object.entries(MEASUREMENT_BOUNDS_IN)) {
      expect(isPlausibleMeasurement(field as never, lo)).toBe(true);
      expect(isPlausibleMeasurement(field as never, hi)).toBe(true);
      expect(isPlausibleMeasurement(field as never, lo - 0.1)).toBe(false);
      expect(isPlausibleMeasurement(field as never, hi + 0.1)).toBe(false);
    }
  });
});

describe('implausibleMeasurementFields', () => {
  it('names only the offending fields', () => {
    expect(implausibleMeasurementFields({ chest: 15, waist: 34 })).toEqual(['chest']);
  });

  it('skips absent and null fields — a partial entry is legitimate', () => {
    expect(implausibleMeasurementFields({ bicep: 14 })).toEqual([]);
    expect(implausibleMeasurementFields({ bicep: 14, chest: null })).toEqual([]);
    expect(implausibleMeasurementFields({})).toEqual([]);
  });
});
