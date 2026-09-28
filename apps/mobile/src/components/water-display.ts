import { ML_PER_FL_OZ, WATER_MAX_FLOZ, type UnitSystem } from '@macrolog/core';

/**
 * Water on screen, in the user's unit system (UX_AUDIT S18-8).
 *
 * The STORE is fl oz and stays fl oz: `dailyWater/{dateKey} = { flOz }` is
 * what `firestore.rules`, the Health mapping and the Trends card all read, and
 * a pt-BR user's history is not going to be rewritten for a display change.
 * So this file is the whole metric surface: what the row and the sheet show,
 * what the pills add, and how a typed number becomes the stored one.
 *
 * Display is DERIVED from the stored integer — `clampWaterFlOz` rounds on
 * write — so a +250 ml tap lands as 8 fl oz and reads back as 237 ml. That is
 * the honest number: the alternative (rounding the display back to the pill
 * value) would show a total the store does not hold.
 */
export type WaterUnit = 'fl oz' | 'ml';

/** Quick-add pill sizes, in the DISPLAY unit. */
export const WATER_PILLS: Record<UnitSystem, readonly number[]> = {
  us: [8, 16, 24],
  metric: [250, 500, 750],
};

/** The row's "minus" step, in the display unit — one pill's worth. */
export function waterStep(system: UnitSystem): number {
  return WATER_PILLS[system][0];
}

export function waterUnitFor(system: UnitSystem): WaterUnit {
  return system === 'metric' ? 'ml' : 'fl oz';
}

/** Stored fl oz → the number the user sees. Whole units either way. */
export function displayWater(flOz: number, system: UnitSystem): number {
  return system === 'metric' ? Math.round(flOz * ML_PER_FL_OZ) : Math.round(flOz);
}

/** A number in the display unit → fl oz for the store (unrounded; the ledger
 *  clamps and rounds on write, so the conversion stays reversible here). */
export function toFlOz(display: number, system: UnitSystem): number {
  return system === 'metric' ? display / ML_PER_FL_OZ : display;
}

/** The storable daily maximum, in the display unit. */
export function waterMaxDisplay(system: UnitSystem): number {
  return displayWater(WATER_MAX_FLOZ, system);
}
