import { describe, expect, it } from 'vitest';
import {
  formatMeasure,
  measureBoundsFor,
  measureUnit,
  parseMeasureToIn,
  toDisplayMeasure,
} from './body-measure-units';

describe('measureUnit', () => {
  it('is cm for metric and in for everything else', () => {
    expect(measureUnit('metric')).toBe('cm');
    expect(measureUnit('us')).toBe('in');
    expect(measureUnit(undefined)).toBe('in');
  });
});

describe('toDisplayMeasure', () => {
  it('leaves US alone and converts metric', () => {
    expect(toDisplayMeasure(33.3, 'us')).toBe(33.3);
    expect(toDisplayMeasure(33.3, 'metric')).toBe(84.6);
  });

  it('is the defect this module exists for: 33.3 in is NOT 33.3 cm', () => {
    // The Body tab printed the stored inches unconverted and unlabelled, so a
    // metric user read a 84.6 cm waist as 33.3 cm — a thigh.
    expect(toDisplayMeasure(33.3, 'metric')).not.toBe(33.3);
  });
});

describe('parseMeasureToIn', () => {
  it('round-trips a metric entry back to stored inches', () => {
    const stored = parseMeasureToIn('84.6', 'metric');
    expect(stored).not.toBeNull();
    expect(toDisplayMeasure(stored as number, 'metric')).toBe(84.6);
  });

  it('accepts a comma decimal separator', () => {
    expect(parseMeasureToIn('84,6', 'metric')).toBeCloseTo(33.31, 1);
  });

  it('rejects junk, blanks and non-positive values', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5']) {
      expect(parseMeasureToIn(bad, 'us')).toBeNull();
    }
  });
});

describe('measureBoundsFor', () => {
  it('states a metric waist band in centimetres, not inches', () => {
    expect(measureBoundsFor('waist', 'us')).toEqual({ min: 15, max: 80 });
    // 15in = 38.1cm, 80in = 203.2cm — inclusive after ceil/floor.
    expect(measureBoundsFor('waist', 'metric')).toEqual({ min: 39, max: 203 });
  });

  it('keeps every metric band inside the stored inch band', () => {
    // A band that rounded outward would accept a value the rules then reject —
    // exactly the "client accepts, server refuses" shape that sent an
    // onboarding user to check their email. See CODE_REVIEW_2026-09-22 §2.
    for (const field of ['neck', 'bicep', 'waist', 'chest', 'hip'] as const) {
      const { min, max } = measureBoundsFor(field, 'metric');
      const lo = parseMeasureToIn(String(min), 'metric') as number;
      const hi = parseMeasureToIn(String(max), 'metric') as number;
      expect(lo).toBeGreaterThanOrEqual(measureBoundsFor(field, 'us').min);
      expect(hi).toBeLessThanOrEqual(measureBoundsFor(field, 'us').max);
    }
  });
});

describe('formatMeasure', () => {
  it('always carries a unit — the whole point', () => {
    expect(formatMeasure(33.3, 'us')).toBe('33.3 in');
    expect(formatMeasure(33.3, 'metric')).toBe('84.6 cm');
  });
});
