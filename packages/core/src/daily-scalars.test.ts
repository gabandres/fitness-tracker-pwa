import { describe, expect, it } from 'vitest';
import {
  ML_PER_FL_OZ,
  readActivity,
  readSleepHours,
  readWaterFlOz,
  readWeightLb,
} from './daily-scalars';

describe('readWeightLb', () => {
  it('reads the stored number', () => {
    expect(readWeightLb({ weight: 182.4 })).toBe(182.4);
  });

  it('is null for a doc with no usable number', () => {
    expect(readWeightLb({})).toBeNull();
    expect(readWeightLb({ weight: '182' })).toBeNull();
    expect(readWeightLb({ weight: Number.NaN })).toBeNull();
    expect(readWeightLb(undefined)).toBeNull();
  });
});

describe('readSleepHours', () => {
  it('reads the stored number, including 0', () => {
    expect(readSleepHours({ hours: 7.5 })).toBe(7.5);
    expect(readSleepHours({ hours: 0 })).toBe(0);
  });

  it('is null when the field is missing', () => {
    expect(readSleepHours({})).toBeNull();
    expect(readSleepHours(null)).toBeNull();
  });
});

describe('readWaterFlOz', () => {
  it('prefers the stored flOz field verbatim', () => {
    expect(readWaterFlOz({ flOz: 64 })).toBe(64);
    expect(readWaterFlOz({ flOz: 12.5 })).toBe(12.5);
  });

  it('prefers flOz even when a legacy ml is also present', () => {
    expect(readWaterFlOz({ flOz: 64, ml: 1 })).toBe(64);
  });

  it('converts the legacy ml field, rounded, for display', () => {
    expect(readWaterFlOz({ ml: 500 })).toBe(17); // 16.907…
    expect(readWaterFlOz({ ml: ML_PER_FL_OZ * 8 })).toBe(8);
  });

  it('converts the legacy ml field unrounded when asked to be exact', () => {
    expect(readWaterFlOz({ ml: 500 }, { exact: true })).toBeCloseTo(500 / ML_PER_FL_OZ, 10);
  });

  it('is null when the doc carries neither field', () => {
    expect(readWaterFlOz({})).toBeNull();
    expect(readWaterFlOz({ flOz: null, ml: undefined })).toBeNull();
  });

  it('reads a genuine zero rather than falling through to ml', () => {
    expect(readWaterFlOz({ flOz: 0, ml: 500 })).toBe(0);
  });
});

describe('readActivity', () => {
  it('reads both metrics', () => {
    expect(readActivity({ steps: 8200, activeKcal: 410 })).toEqual({
      steps: 8200,
      activeKcal: 410,
    });
  });

  it('leaves a metric the day does not carry undefined, not zero', () => {
    expect(readActivity({ steps: 8200 })).toEqual({ steps: 8200, activeKcal: undefined });
    expect(readActivity({ activeKcal: 410 })).toEqual({ steps: undefined, activeKcal: 410 });
    expect(readActivity({})).toEqual({ steps: undefined, activeKcal: undefined });
  });

  it('keeps a real zero', () => {
    expect(readActivity({ steps: 0, activeKcal: 0 })).toEqual({ steps: 0, activeKcal: 0 });
  });
});
