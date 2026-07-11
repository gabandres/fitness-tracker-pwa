import { isStorableWeight } from './weight-bounds';

/**
 * Health Sync Phase 1 — pure mapping layer (see apps/mobile/HEALTH_PHASE1_PLAN.md).
 *
 * No native imports, no Firebase: just the types, unit conversion, dedup keys,
 * and conflict policy shared by the iOS (HealthKit) and Android (Health Connect)
 * adapters. Everything device-specific lives in the per-frontend `health.ts`
 * adapter; this module is the reusable, unit-tested brain (zero devices needed).
 *
 * Weight-only in Phase 1. `HealthKind` widens in later phases (sleep, water,
 * body-fat) reusing this same seam.
 */

export type HealthKind = 'weight';

export interface HealthSample {
  /** localDateKey — the app's day bucket the sample's end time falls in. */
  dateKey: string;
  kind: HealthKind;
  /** Canonical app unit for weight is lb (matches `dailyWeights`). */
  valueLb: number;
  /** Sample end time (epoch ms) — the tie-break for same-day conflicts. */
  endMs: number;
  /** True when this sample's source bundle id is ours — i.e. the app wrote it
   *  (so import must drop it, never re-import our own exports). */
  fromUs: boolean;
}

export const LB_PER_KG = 2.20462;
export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;

/**
 * Collapse many same-day samples into one weight per dateKey. Samples we wrote
 * (`fromUs`) are dropped first, so a re-sync never re-imports our own exports
 * (idempotent). Among the remaining samples for a day, the latest `endMs` wins.
 * Junk values (0 lb, implausible readings) are rejected via `isStorableWeight`,
 * the same guard the manual logger uses. Returns a `dateKey → lb` map.
 */
export function reduceImportedWeights(samples: HealthSample[]): Record<string, number> {
  // Per day, remember the winning sample's endMs so a later sample can displace
  // an earlier one deterministically regardless of input order.
  const bestEndMs: Record<string, number> = {};
  const out: Record<string, number> = {};
  for (const s of samples ?? []) {
    if (s.fromUs) continue;
    if (s.kind !== 'weight') continue;
    if (!isStorableWeight(s.valueLb)) continue;
    const prev = bestEndMs[s.dateKey];
    if (prev == null || s.endMs > prev) {
      bestEndMs[s.dateKey] = s.endMs;
      out[s.dateKey] = s.valueLb;
    }
  }
  return out;
}

/**
 * Merge policy for a single day when Health and the app disagree.
 *
 * Phase-1 rule (locked per the plan's recommendation): a Health reading is
 * authoritative for its day — a scale/Watch measurement beats a hand-typed
 * value — so Health import overwrites. `dailyWeights` docs carry no updatedAt,
 * so an app-vs-health recency comparison isn't possible; manual edits re-export
 * to Health instead (handled by the adapter's write path). We only decline to
 * overwrite when the values already match (no write needed) or the Health value
 * is not storable (keep the app value).
 */
export function resolveWeightConflict(
  appLb: number | null,
  _appUpdatedMs: number | null,
  healthLb: number,
  _healthEndMs: number,
): number {
  if (!isStorableWeight(healthLb)) return appLb ?? healthLb;
  return healthLb;
}

/**
 * The days that actually need a Firestore write on import: the reduced Health
 * map minus days whose current `dailyWeights` value already matches (within a
 * 0.05 lb epsilon, since lb↔kg round-trips aren't bit-exact). Keeps a re-sync
 * from issuing no-op writes. Returns `dateKey → lb` to persist.
 */
export function weightsToApply(
  imported: Record<string, number>,
  currentDailyWeights: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [dateKey, healthLb] of Object.entries(imported ?? {})) {
    const appLb = currentDailyWeights?.[dateKey] ?? null;
    if (appLb != null && Math.abs(appLb - healthLb) < 0.05) continue;
    out[dateKey] = resolveWeightConflict(appLb, null, healthLb, 0);
  }
  return out;
}
