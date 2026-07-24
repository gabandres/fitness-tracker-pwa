import { isStorableWeight } from './weight-bounds';

/**
 * Health Sync — pure mapping layer (see apps/mobile/HEALTH_PHASE1_PLAN.md and
 * apps/mobile/HEALTHKIT_PLAN.md).
 *
 * No native imports, no Firebase: just the types, unit conversion, dedup keys,
 * and conflict policy shared by the iOS (HealthKit) and Android (Health Connect)
 * adapters. Everything device-specific lives in the per-frontend `health.ts`
 * adapter; this module is the reusable, unit-tested brain (zero devices needed).
 *
 * Phase 1 shipped weight only. The seam now spans every daily-scalar metric the
 * app mirrors to/from the OS health store — weight, sleep, water, body-fat —
 * all reduced through one code path (latest-endMs-per-day wins, our own writes
 * dropped so a re-sync is idempotent). Per-event exports (nutrition, workouts)
 * don't fit the daily-scalar shape and are handled directly by the adapter;
 * only their unit constants live here.
 */

/** Metrics the app both reads and writes. The app is a source of truth for
 *  these, so export is meaningful. Canonical app units: weight=lb, sleep=hours,
 *  water=fl oz, bodyFat=percent. */
export type WritableKind = 'weight' | 'sleep' | 'water' | 'bodyFat';

/**
 * Metrics the app only ever **reads**. The phone and the watch measure these;
 * the app has no way to produce them, so there is nothing to export and
 * `writeDaily` deliberately won't accept them.
 *
 * Canonical app units: steps=count, activeEnergy=kcal.
 */
export type ImportOnlyKind = 'steps' | 'activeEnergy';

/** Every daily-scalar metric that crosses the seam as a `HealthSample`. */
export type HealthKind = WritableKind | ImportOnlyKind;

export interface HealthSample {
  /** localDateKey — the app's day bucket the sample's end time falls in. */
  dateKey: string;
  kind: HealthKind;
  /** Value in the app's canonical unit for `kind` (see HealthKind). */
  value: number;
  /** Sample end time (epoch ms) — the tie-break for same-day conflicts. */
  endMs: number;
  /** True when this sample's source bundle id is ours — i.e. the app wrote it
   *  (so import must drop it, never re-import our own exports). */
  fromUs: boolean;
}

// ── Unit conversions (pure; the adapter converts native units → canonical
//    app units before building a HealthSample, and back on export) ──
export const LB_PER_KG = 2.20462;
export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;

/** US customary fluid ounces per liter (Health stores hydration in liters). */
export const FL_OZ_PER_LITER = 33.8140226;
export const litersToFlOz = (l: number): number => l * FL_OZ_PER_LITER;
export const flOzToLiters = (flOz: number): number => flOz / FL_OZ_PER_LITER;

/** HealthKit body-fat is a 0..1 fraction; the app (and Health Connect) use a
 *  0..100 percent. */
export const fractionToPercent = (f: number): number => f * 100;
export const percentToFraction = (p: number): number => p / 100;

/** Water clamp — mirrors the ledger's `dailyWater` bound (fl oz). */
export const WATER_MAX_FLOZ = 676;

/** Activity clamps. Both are generous by design — the point is to reject
 *  corrupt or duplicated data, not to referee an ultramarathon. The world
 *  24-hour step record is ~250k and a Tour stage burns ~8k kcal. */
export const STEPS_MAX = 200_000;
export const ACTIVE_ENERGY_MAX_KCAL = 20_000;

/**
 * Per-kind validity gate, applied before a sample is imported (or a value is
 * exported) so junk never crosses the seam. Weight reuses `isStorableWeight`
 * (the same guard the manual logger + store backstop use); the others use the
 * same bounds the app's own inputs enforce.
 */
export function isStorableHealthValue(kind: HealthKind, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  switch (kind) {
    case 'weight':
      return isStorableWeight(value);
    case 'sleep':
      return value > 0 && value <= 24;
    case 'water':
      return value >= 0 && value <= WATER_MAX_FLOZ;
    case 'bodyFat':
      return value >= 3 && value <= 75;
    case 'steps':
      return value >= 0 && value <= STEPS_MAX;
    case 'activeEnergy':
      return value >= 0 && value <= ACTIVE_ENERGY_MAX_KCAL;
  }
}

/**
 * How multiple same-day samples of a kind collapse to the day's single value:
 * a point-in-time reading (weight, body-fat) takes the latest by `endMs`; an
 * accumulating metric (sleep segments, water sips) sums across the day. The
 * adapter still does kind-specific pre-filtering before this (e.g. keep only
 * "asleep" sleep stages, not "inBed"); this owns only the per-day fold.
 */
const ADDITIVE: Record<HealthKind, boolean> = {
  weight: false,
  bodyFat: false,
  sleep: true,
  water: true,
  // Health stores activity as many short buckets across the day (a walk here,
  // a workout there), so the day's figure is the sum. Taking the latest would
  // report the last 15-minute bucket as the whole day.
  steps: true,
  activeEnergy: true,
};

/**
 * Collapse many same-day samples into one value per dateKey. Samples we wrote
 * (`fromUs`) are dropped first, so a re-sync never re-imports our own exports
 * (idempotent). Point-in-time kinds keep the latest `endMs`; additive kinds sum
 * (see {@link ADDITIVE}). Junk values are rejected via `isStorableHealthValue`
 * — for additive kinds the gate is applied to the *summed* day total, not each
 * fragment (a single sip is a valid partial). Callers pass one kind's samples
 * per call. Returns `dateKey → value` in the app's canonical unit for that kind.
 */
export function reduceImportedSamples(samples: readonly HealthSample[]): Record<string, number> {
  const list = samples ?? [];
  const kind = list[0]?.kind;
  if (!kind) return {};
  const additive = ADDITIVE[kind];
  const bestEndMs: Record<string, number> = {};
  const out: Record<string, number> = {};
  for (const s of list) {
    if (s.fromUs || !Number.isFinite(s.value)) continue;
    if (additive) {
      out[s.dateKey] = (out[s.dateKey] ?? 0) + s.value; // gate the day-total below
      continue;
    }
    if (!isStorableHealthValue(s.kind, s.value)) continue;
    const prev = bestEndMs[s.dateKey];
    if (prev == null || s.endMs > prev) {
      bestEndMs[s.dateKey] = s.endMs;
      out[s.dateKey] = s.value;
    }
  }
  // Additive kinds gate the summed day-total, not each fragment.
  if (additive) {
    for (const [dateKey, total] of Object.entries(out)) {
      if (!isStorableHealthValue(kind, total)) delete out[dateKey];
    }
  }
  return out;
}

/**
 * The days that actually need a write on import: the reduced Health map minus
 * days whose current app value already matches (within `epsilon` — unit
 * round-trips like lb↔kg or L↔flOz aren't bit-exact). Keeps a re-sync from
 * issuing no-op writes. A Health reading is authoritative for its day (a
 * scale / Watch / manual-in-Health entry beats nothing, and the app has no
 * per-day updatedAt to compare recency), so a differing Health value overwrites.
 * Returns `dateKey → value` to persist.
 */
export function valuesToApply(
  imported: Record<string, number>,
  current: Record<string, number>,
  epsilon = 0.05,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dateKey, healthVal] of Object.entries(imported ?? {})) {
    const appVal = current?.[dateKey];
    if (appVal != null && Math.abs(appVal - healthVal) < epsilon) continue;
    out[dateKey] = healthVal;
  }
  return out;
}
