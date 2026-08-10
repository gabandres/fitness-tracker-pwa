/**
 * Readers for the four per-day scalar collections —
 * `dailyWeights`, `dailyWater`, `dailySleep`, `dailyActivity`.
 *
 * Each of these is one doc per `dateKey` holding one or two numbers, and each
 * carries a small piece of storage history that a caller must not have to
 * know: water is stored in fl oz but has a legacy `ml` branch, sleep may be
 * missing its only field, activity packs two independent metrics into one doc
 * so a day may hold either, both, or neither.
 *
 * That knowledge used to be restated at every read site — twelve copies across
 * the mobile ledger's subscribe / range / export paths, three of the water
 * conversion alone, and one of those three rounded while the others did not.
 * It lives here now so there is one place to be right and one place to test.
 *
 * Sibling of `./firestore-mappers`, which does the same job for the shaped
 * collections (logs, measurements, workouts, profile). Same rule applies: this
 * module never imports a Firestore SDK — callers hand it `snap.data()`.
 */

/** Millilitres per US fluid ounce. The `ml` field is legacy; nothing writes it
 *  any more, but historic docs still carry it. */
export const ML_PER_FL_OZ = 29.5735;

/** Both activity metrics as one day's doc. Either field may be absent: they are
 *  written independently by the Health importer into the same doc. */
export interface DailyActivity {
  steps?: number;
  activeKcal?: number;
}

/** A finite number, or null for anything else (missing field, string, NaN). */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Bodyweight in lb from a `dailyWeights/{dateKey}` doc, or null when the doc
 *  carries no usable number. */
export function readWeightLb(data: unknown): number | null {
  return num((data as { weight?: unknown } | null | undefined)?.weight);
}

/** Sleep in hours from a `dailySleep/{dateKey}` doc, or null when absent. */
export function readSleepHours(data: unknown): number | null {
  return num((data as { hours?: unknown } | null | undefined)?.hours);
}

/**
 * Water in fl oz from a `dailyWater/{dateKey}` doc, or null when the doc holds
 * neither field.
 *
 * The legacy `ml` branch is rounded to whole fl oz, because that is what the
 * daily-metrics UI has always shown and a 16.907 in the water row is noise.
 * Pass `{ exact: true }` for the Health importer, which diffs its result
 * against HealthKit/Health Connect samples: a rounded value there reads as a
 * changed measurement and re-writes the day on every import.
 */
export function readWaterFlOz(data: unknown, opts?: { exact?: boolean }): number | null {
  const d = data as { flOz?: unknown; ml?: unknown } | null | undefined;
  const flOz = num(d?.flOz);
  if (flOz != null) return flOz;
  const ml = num(d?.ml);
  if (ml == null) return null;
  const converted = ml / ML_PER_FL_OZ;
  return opts?.exact ? converted : Math.round(converted);
}

/** Steps + active energy from a `dailyActivity/{dateKey}` doc. Fields the doc
 *  does not carry come back `undefined` rather than 0 — a day with no steps
 *  recorded is not a day with zero steps. */
export function readActivity(data: unknown): DailyActivity {
  const d = data as { steps?: unknown; activeKcal?: unknown } | null | undefined;
  return {
    steps: num(d?.steps) ?? undefined,
    activeKcal: num(d?.activeKcal) ?? undefined,
  };
}
