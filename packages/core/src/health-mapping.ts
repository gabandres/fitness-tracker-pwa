import { isStorableWeight } from './weight-bounds';

/**
 * Health Sync — pure mapping layer (shipped; see STATUS.md).
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
  /** `dayKeyAt` — the app's day bucket the sample's end time falls in. */
  dateKey: string;
  kind: HealthKind;
  /** Value in the app's canonical unit for `kind` (see HealthKind). */
  value: number;
  /** Sample end time (epoch ms) — the tie-break for same-day conflicts. */
  endMs: number;
  /** True when this sample's source bundle id is ours — i.e. the app wrote it
   *  (so import must drop it, never re-import our own exports). */
  fromUs: boolean;
  /** The recording app/device — HealthKit `sourceRevision.source.bundleIdentifier`,
   *  Health Connect `metadata.dataOrigin.packageName`. Optional because not
   *  every adapter path has one; samples without it pool under one anonymous
   *  source. What the `maxSource` fold groups by. */
  source?: string;
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

/** Upper bound on a day's water, in fl oz (~5 gal). The canonical bound: the
 *  ledger's `dailyWater` writes clamp to it via {@link clampWaterFlOz}, and
 *  firestore.rules mirrors the same number. */
export const WATER_MAX_FLOZ = 676;

/** Upper bound on a day's sleep, in hours. */
export const SLEEP_MAX_HOURS = 24;

/**
 * Clamp a day's water to the storable range and round to whole fl oz. Applied
 * on every write path — both Firestore adapters, the in-memory adapter, and
 * the store's own pre-write clamp — so a fat-fingered entry can't reach a
 * chart, and no two of those sites can disagree about what "too much" is.
 */
export function clampWaterFlOz(flOz: number): number {
  return Math.max(0, Math.min(WATER_MAX_FLOZ, Math.round(flOz)));
}

/** Clamp a day's sleep to `[0, 24]` hours, snapped to the half hour the UI
 *  offers. Same four write paths as {@link clampWaterFlOz}. */
export function clampSleepHours(hours: number): number {
  return Math.max(0, Math.min(SLEEP_MAX_HOURS, Math.round(hours * 2) / 2));
}

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
      return value > 0 && value <= SLEEP_MAX_HOURS;
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
 * How multiple same-day samples of a kind collapse to the day's single value.
 *
 * - `latest` — a point-in-time reading (weight, body-fat): newest `endMs` wins.
 * - `sum` — an accumulating metric the adapter hands us as raw fragments
 *   (water sips): add them up across the day.
 * - `maxSource` — an accumulating metric where every source records the SAME
 *   underlying event (sleep: a Watch and an Oura ring both see one night).
 *   Fragments are summed **within** a source and the largest single source's
 *   total is the day's value — never the cross-source sum, which is how a
 *   7.5 h night became ~16 h when two devices both wrote it to Health.
 * - `preAggregated` — the adapter already asked the OS for **the day's total**
 *   and hands us one value per day. Summing here would double-count a figure
 *   that is complete on arrival, so this folds like `latest`.
 */
export type DailyFold = 'latest' | 'sum' | 'maxSource' | 'preAggregated';

/**
 * Per-kind fold policy (see {@link DailyFold}). The adapter still does
 * kind-specific pre-filtering before this (e.g. keep only "asleep" sleep
 * stages, not "inBed"); this owns only the per-day fold.
 */
export const DAILY_FOLD: Record<HealthKind, DailyFold> = {
  weight: 'latest',
  bodyFat: 'latest',
  // Was `sum` until 2026-09-28. Every sleep source measures the same night,
  // so summing across sources doubles it; see `DailyFold`.
  sleep: 'maxSource',
  water: 'sum',
  // Activity is additive *in nature* — Health stores it as many short buckets
  // across the day — but we no longer sum those buckets ourselves. Both OSes
  // document the raw sample/record APIs as double-counting when more than one
  // source (phone + watch, or a third-party fitness app) records the same
  // movement, and both put the source merge behind a dedicated aggregating
  // API: HealthKit's statistics-collection query, Health Connect's
  // `aggregateGroupByPeriod`. The adapter uses those, so what reaches us is
  // one deduplicated day-total per day — already folded.
  steps: 'preAggregated',
  activeEnergy: 'preAggregated',
};

/**
 * Collapse many same-day samples into one value per dateKey. Samples we wrote
 * (`fromUs`) are dropped first, so a re-sync never re-imports our own exports
 * (idempotent). The fold is per-kind (see {@link DAILY_FOLD}): `sum` adds the
 * day's fragments, while `latest` and `preAggregated` both keep the newest
 * `endMs` — for `preAggregated` that is a safety net, since the adapter should
 * only ever emit one already-summed value per day. Junk values are rejected via
 * `isStorableHealthValue` — for `sum` kinds the gate is applied to the *summed*
 * day total, not each fragment (a single sip is a valid partial). Callers pass
 * one kind's samples per call. Returns `dateKey → value` in the app's canonical
 * unit for that kind.
 */
export function reduceImportedSamples(samples: readonly HealthSample[]): Record<string, number> {
  const list = samples ?? [];
  const kind = list[0]?.kind;
  if (!kind) return {};
  const fold = DAILY_FOLD[kind];
  const additive = fold === 'sum' || fold === 'maxSource';
  const bestEndMs: Record<string, number> = {};
  const out: Record<string, number> = {};
  // maxSource only: dateKey → source → that source's summed fragments.
  const perSource: Record<string, Record<string, number>> = {};
  for (const s of list) {
    if (s.fromUs || !Number.isFinite(s.value)) continue;
    if (fold === 'maxSource') {
      const bySource = (perSource[s.dateKey] ??= {});
      const src = s.source ?? '';
      bySource[src] = (bySource[src] ?? 0) + s.value;
      continue;
    }
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
  if (fold === 'maxSource') {
    for (const [dateKey, bySource] of Object.entries(perSource)) {
      out[dateKey] = Math.max(...Object.values(bySource));
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
 * `dateKey → epoch ms` of the last time the USER acted on that day's value by
 * hand — deleted the weigh-in, or typed one over it.
 *
 * A device-local fact (the app keeps it in AsyncStorage), never a Firestore
 * field: it describes what this phone's importer must not undo, and the rules
 * would have to be redeployed before a client could write a new field anyway.
 */
export type ManualOverrides = Readonly<Record<string, number>>;

/**
 * Drop the Health samples a manual act has superseded.
 *
 * ## The bug this closes
 *
 * `valuesToApply` treats a Health reading as authoritative for its day, which
 * is right for a day the app knows nothing about and wrong for a day the user
 * has just corrected. Delete a weigh-in a smart scale also wrote, and the next
 * foreground import (every one, via `useHealthAutoImport`) finds the scale's
 * sample, sees no Firestore value for the day, and writes it straight back.
 * Type 178 over a scale's 180 and the same import "corrects" it to 180. Both
 * read to the user as the app ignoring them.
 *
 * ## Why by time, not by day
 *
 * A sample is dropped only when it ENDED at or before the manual act. A
 * reading taken afterwards — the person steps on the scale again that evening —
 * is newer information than the correction and still imports, under the same
 * "newest reading wins" rule `reduceImportedSamples` applies within a day. A
 * per-day block would silently swallow that reading forever.
 */
export function dropOverriddenSamples(
  samples: readonly HealthSample[],
  overrides: ManualOverrides | null | undefined,
): HealthSample[] {
  if (!overrides || Object.keys(overrides).length === 0) return [...(samples ?? [])];
  return (samples ?? []).filter((s) => {
    const at = overrides[s.dateKey];
    return at == null || s.endMs > at;
  });
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

/**
 * The latest sample end time per day — the instant the day's last fragment
 * finished.
 *
 * `reduceImportedSamples` keeps this internally for `latest`/`preAggregated`
 * kinds and throws it away for `sum` kinds, because a sum does not need a
 * tie-break. **Sleep is a `sum` kind that needs it anyway**, for a reason that
 * has nothing to do with folding: the wake instant is what tells
 * `manualNightKeys` whether a night could have been typed under the previous
 * day's key (issue #80). The `dateKey` on a sleep sample has already discarded
 * the time.
 *
 * **The LATEST end, not the earliest, and the choice matters.** A night arrives
 * as several stage fragments, and the one that ends last is the one that ends
 * when the sleeper woke — which is the instant the boundary question is about.
 * The earliest fragment on a day can end minutes after midnight in the middle
 * of a night that runs to 07:00, and reading that as the wake time would put
 * the night on the wrong side of the boundary.
 *
 * The known imprecision, stated rather than hidden: a **nap** later the same
 * day ends after the night does and wins this max, so a day holding both an
 * early-morning wake and an afternoon nap reports the nap. That reverts to the
 * pre-#80 behaviour for that day — a missed protection, never a wrong write —
 * and it needs an afternoon nap on a non-midnight boundary on a night that
 * ended before the boundary, which is not a combination worth a per-fragment
 * model of what a "night" is.
 *
 * Samples the app itself exported are dropped, matching
 * {@link reduceImportedSamples}: they are not a measurement of anything.
 */
export function latestSampleEndByDay(samples: readonly HealthSample[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples ?? []) {
    if (s.fromUs || !Number.isFinite(s.endMs)) continue;
    const prev = out[s.dateKey];
    if (prev == null || s.endMs > prev) out[s.dateKey] = s.endMs;
  }
  return out;
}

/**
 * Health Connect `SleepSessionRecord.stages[].stage` values that mean the
 * sleeper was asleep: SLEEPING(2), LIGHT(4), DEEP(5), REM(6). Excluded:
 * UNKNOWN(0), AWAKE(1), OUT_OF_BED(3), and AWAKE_IN_BED(7, newer SDKs).
 * Numeric on purpose — core stays free of the native package.
 */
export const HC_ASLEEP_STAGES: ReadonlySet<number> = new Set([2, 4, 5, 6]);

export interface SleepSessionLike {
  startMs: number;
  endMs: number;
  /** Stage intervals, when the source recorded them. */
  stages?: readonly { startMs: number; endMs: number; stage: number }[];
}

/**
 * Hours actually asleep in one Health Connect sleep session.
 *
 * A `SleepSession` spans in-bed to out-of-bed. When the source recorded
 * stages, awake and out-of-bed intervals are part of that span, so the
 * session length overstates sleep — sum only the asleep stages. Without
 * stages (many sources write none) the span is all we have, so it is used
 * as-is; that keeps a stage-less source comparable to HealthKit, whose
 * adapter already filters to asleep category values.
 *
 * Non-finite or inverted intervals contribute nothing.
 */
export function asleepHoursFromSession(session: SleepSessionLike): number {
  const span = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 3_600_000 : 0;
  const stages = session.stages ?? [];
  if (stages.length === 0) return span(session.startMs, session.endMs);
  let hours = 0;
  for (const st of stages) {
    if (HC_ASLEEP_STAGES.has(st.stage)) hours += span(st.startMs, st.endMs);
  }
  return hours;
}
