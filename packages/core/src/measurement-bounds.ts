/**
 * Body-measurement sanity rules — the shared answer to "is this a plausible
 * tape measurement", in INCHES (the stored unit; see `MeasurementDoc` in
 * ./firestore-writers).
 *
 * Why this exists: `firestore.rules` applied ONE range to every field —
 * `> 0 && < 200` — so a chest of 15.0 in was accepted and stored. It is almost
 * certainly a neck value typed into the chest field, and nothing anywhere
 * could tell the difference, because a single shared range cannot: 15 is
 * absurd for a chest and ordinary for a neck. Per-field bands are the only
 * thing that separates them.
 *
 * These feed the US-Navy body-fat estimate (./body-fat), so a wrong field is
 * not merely cosmetic — it silently moves a number the user is tracking.
 *
 * Bands are deliberately generous: they are typo filters, not fitness
 * judgements. The app is 13+, so the low ends accommodate a small teenager.
 */

export type MeasurementField = 'waist' | 'chest' | 'bicep' | 'hip' | 'neck';

/** Inclusive [min, max] per field, in inches. */
export const MEASUREMENT_BOUNDS_IN: Record<MeasurementField, readonly [number, number]> = {
  neck: [8, 30],
  bicep: [5, 30],
  waist: [15, 80],
  chest: [20, 80],
  hip: [20, 80],
};

/** True when `value` is a plausible measurement for that specific field. */
export function isPlausibleMeasurement(field: MeasurementField, value: number): boolean {
  const band = MEASUREMENT_BOUNDS_IN[field];
  if (!band || !Number.isFinite(value)) return false;
  return value >= band[0] && value <= band[1];
}

/**
 * Every field that fails its band, for a partial measurement entry. Absent /
 * null fields are skipped — a bicep-only entry is legitimate. Returns an empty
 * array when the entry is safe to store.
 */
export function implausibleMeasurementFields(
  entry: Partial<Record<MeasurementField, number | null | undefined>>,
): MeasurementField[] {
  const bad: MeasurementField[] = [];
  for (const field of Object.keys(MEASUREMENT_BOUNDS_IN) as MeasurementField[]) {
    const value = entry[field];
    if (value == null) continue;
    if (!isPlausibleMeasurement(field, value)) bad.push(field);
  }
  return bad;
}
