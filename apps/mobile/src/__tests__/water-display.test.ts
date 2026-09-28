import { WATER_MAX_FLOZ } from '@macrolog/core';
import {
  WATER_PILLS,
  displayWater,
  toFlOz,
  waterMaxDisplay,
  waterStep,
  waterUnitFor,
} from '@/components/water-display';

/**
 * Water in the user's unit (UX_AUDIT S18-8). The store is fl oz; what is
 * pinned is that the metric surface is a pure view over it — nothing here
 * changes what gets written for a US user, and a metric user's taps and
 * typed numbers convert once, at the boundary, and read back honestly.
 */
describe('water-display', () => {
  it('names the unit per system', () => {
    expect(waterUnitFor('us')).toBe('fl oz');
    expect(waterUnitFor('metric')).toBe('ml');
  });

  it('is the identity for US — the shipped behaviour must not move', () => {
    expect(displayWater(16, 'us')).toBe(16);
    expect(toFlOz(8, 'us')).toBe(8);
    expect(WATER_PILLS.us).toEqual([8, 16, 24]);
    expect(waterStep('us')).toBe(8);
    expect(waterMaxDisplay('us')).toBe(WATER_MAX_FLOZ);
  });

  it('shows ml from stored fl oz at 29.5735 ml per fl oz', () => {
    expect(displayWater(8, 'metric')).toBe(237);
    expect(displayWater(0, 'metric')).toBe(0);
    expect(displayWater(WATER_MAX_FLOZ, 'metric')).toBe(Math.round(676 * 29.5735));
  });

  it('converts a typed ml amount to fl oz for the store', () => {
    expect(toFlOz(250, 'metric')).toBeCloseTo(8.4535, 3);
    expect(toFlOz(1000, 'metric')).toBeCloseTo(33.814, 2);
  });

  it('round-trips within the store’s integer rounding', () => {
    // The ledger rounds fl oz on write; a metric pill lands on the nearest
    // whole fl oz and reads back within one fl oz (30 ml) of what was tapped.
    for (const ml of WATER_PILLS.metric) {
      const stored = Math.round(toFlOz(ml, 'metric'));
      expect(Math.abs(displayWater(stored, 'metric') - ml)).toBeLessThanOrEqual(15);
    }
  });

  it('offers glass-sized metric pills', () => {
    expect(WATER_PILLS.metric).toEqual([250, 500, 750]);
    expect(waterStep('metric')).toBe(250);
  });
});
