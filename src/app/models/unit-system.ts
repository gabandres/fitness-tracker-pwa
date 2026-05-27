/**
 * Unit system preference. Drives the default serving option in the
 * food-search portion picker:
 *   - 'us': cup / tbsp / oz first, per-100g pushed to the bottom.
 *   - 'metric': per-100g first, household measures below.
 *
 * `undefined` on the profile reads as 'us' (the historical default for
 * existing users — no migration needed).
 */
export type UnitSystem = 'us' | 'metric';
