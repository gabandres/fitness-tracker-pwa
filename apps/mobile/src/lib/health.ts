import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { HealthWorkout } from '@macrolog/core/health-workouts';
import { toCardioModality } from '@macrolog/core/health-workouts';
import {
  type WritableKind,
  type HealthSample,
  flOzToLiters,
  kgToLb,
  litersToFlOz,
  calendarDateKey,
  parseYmd,
  percentToFraction,
} from '@macrolog/core';

/**
 * Per-frontend native health adapter (Health Sync — shipped; see STATUS.md).
 *
 * `Platform.OS` picks HealthKit (iOS) or Health Connect (Android) behind one
 * `HealthPort`; both translate through the pure `health-mapping` brain in
 * `@macrolog/core` (dedup, unit conversion, per-day fold, validity). Web /
 * unsupported platforms get a no-op port so callers never branch.
 *
 * The native modules are **lazy-imported inside each method** so the web bundle
 * (react-native-web) and Expo Go never evaluate a module that isn't present —
 * the same guard `settings.tsx` uses for `expo-file-system`. Everything here is
 * `tsc`-verified only; the native round-trips need an EAS dev build to QA.
 *
 * `fromUs` (drop our own writes on import) is free: the OS stamps every sample
 * we save with our bundle id (HealthKit `sourceRevision`) / package name
 * (Health Connect `metadata.dataOrigin`), so we just compare it to {@link APP_ID}.
 */

/** iOS `bundleIdentifier` / Android `package` from app.json — the id the OS
 *  stamps on samples we write, so import can skip them (idempotent re-sync). */
const APP_ID = 'fit.ignia.app';

/**
 * Metrics we read from the OS store. Weight / sleep / water are two-way;
 * steps / activeEnergy are **import-only** (the device measures them, the app
 * can't produce them). Body-fat / nutrition / workouts are the mirror case —
 * export-only, because the app IS their source of truth.
 */
export type ReadableKind = 'weight' | 'sleep' | 'water' | 'steps' | 'activeEnergy';

export interface NutritionExport {
  at: Date;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface WorkoutExport {
  start: Date;
  end: Date;
  /** Free-text session name, used as the Health record title. */
  label?: string;
}

export interface HealthPort {
  /** Is a health store present on this device/platform at all. */
  isAvailable(): Promise<boolean>;
  /** Prompt for the read+write scopes we use. Resolves false if declined. */
  requestPermissions(): Promise<boolean>;
  /** Read the last `sinceDays` of one kind as canonical-unit samples. */
  readSamples(kind: ReadableKind, sinceDays: number): Promise<HealthSample[]>;
  /**
   * Read the last `sinceDays` of WORKOUTS as neutral events (ADR-0026).
   *
   * Deliberately not a `ReadableKind`: a workout is an event with a start, an
   * end and a modality, and `health-mapping`'s daily-scalar pipeline would
   * fold exactly that away. The pure mapping lives in
   * `@macrolog/core/health-workouts`.
   *
   * **Returns `[]` rather than throwing when the scope was never granted.**
   * That is not a convenience — it is HealthKit's own documented behaviour for
   * an unauthorized read, and matching it on Android keeps the two platforms
   * from needing different call sites. The cost is that "no permission" and
   * "no workouts" are indistinguishable here, which is why the UI states the
   * permission separately instead of inferring it from an empty list.
   */
  readWorkouts(sinceDays: number): Promise<HealthWorkout[]>;
  /** Write one day's canonical-unit value (weight lb / sleep hours / water
   *  fl oz / body-fat percent). The sample is dated within `dateKey`'s day, so
   *  editing a past day exports to Health on that day, not today. */
  /** Export one day's value. Typed to `WritableKind` so the import-only
   *  activity metrics can't be passed here — we have nothing to write. */
  writeDaily(kind: WritableKind, dateKey: string, value: number): Promise<void>;
  /** Export one logged meal's macros as dietary samples. */
  writeNutrition(entry: NutritionExport): Promise<void>;
  /** Export a finished workout session. */
  writeWorkout(w: WorkoutExport): Promise<void>;
}

const sinceDate = (days: number): Date => new Date(Date.now() - days * 86_400_000);

/**
 * Local midnight at the start of `d`'s day.
 *
 * Both platforms' aggregate APIs anchor their buckets on the *start of the
 * requested range*, not on the calendar — ask at 15:00 and you get 15:00→15:00
 * "days". Anchoring here is what makes a bucket equal one of the app's days.
 */
function startOfLocalDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Local-naive ISO (`2026-07-23T00:00:00` — no `Z`, no offset), the
 *  `LocalDateTime` shape Health Connect's **period** slicer expects.
 *  `toISOString()` would hand it a UTC instant and cut every bucket at the
 *  wrong hour for any user not on UTC. */
function localIsoNaive(d: Date): string {
  return `${calendarDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** A concrete timestamp inside `dateKey`'s local day for a written sample:
 *  ~7am for sleep (a plausible wake time for a night's total), noon otherwise. */
function anchorAt(dateKey: string, kind: WritableKind): Date {
  const d = parseYmd(dateKey);
  d.setHours(kind === 'sleep' ? 7 : 12, 0, 0, 0);
  return d;
}

// ─────────────────────────── iOS — HealthKit ───────────────────────────

// Loose shapes for the fields we read off kingstinct samples (its full generic
// types are heavier than we need here; we only touch these).
interface HKQty {
  quantity: number;
  startDate: string | number | Date;
  endDate: string | number | Date;
  sourceRevision?: { source?: { bundleIdentifier?: string } };
}
interface HKCat extends HKQty {
  value: number;
}
/** The fields we read off a HealthKit workout. Loose for the same reason
 *  {@link HKQty} is — kingstinct's generated workout types are heavier and
 *  stricter than what can be verified here without a native build. */
interface HKWorkoutRow {
  uuid?: string;
  workoutActivityType?: string | number;
  startDate: string | number | Date;
  endDate: string | number | Date;
  totalDistance?: { quantity?: number };
  totalEnergyBurned?: { quantity?: number };
  sourceRevision?: { source?: { bundleIdentifier?: string; name?: string } };
}

/** One interval of a statistics-collection response. `sumQuantity` is absent
 *  for an interval with no samples at all. */
interface HKStatsBucket {
  sumQuantity?: { quantity: number };
  startDate?: string | number | Date;
  endDate?: string | number | Date;
}

const hkModule = () => import('@kingstinct/react-native-healthkit');

/** HealthKit sleep-analysis category values that count as actually asleep
 *  (not inBed=0, not awake=2): asleepUnspecified/Core/Deep/REM. */
const HK_ASLEEP = new Set([1, 3, 4, 5]);

const HK_READ: Record<ReadableKind, string> = {
  weight: 'HKQuantityTypeIdentifierBodyMass',
  water: 'HKQuantityTypeIdentifierDietaryWater',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  steps: 'HKQuantityTypeIdentifierStepCount',
  activeEnergy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
};

/** HealthKit unit string per quantity kind (sleep is a category, not a
 *  quantity, and is handled separately). */
const HK_UNIT: Record<Exclude<ReadableKind, 'sleep'>, string> = {
  weight: 'lb',
  water: 'fl_oz_us',
  steps: 'count',
  activeEnergy: 'kcal',
};

const ms = (d: string | number | Date): number => new Date(d).getTime();

const healthKit: HealthPort = {
  async isAvailable() {
    try {
      const HK = await hkModule();
      return HK.isHealthDataAvailable();
    } catch {
      return false;
    }
  },

  async requestPermissions() {
    const HK = await hkModule();
    return HK.requestAuthorization({
      toRead: [
        'HKQuantityTypeIdentifierBodyMass',
        'HKQuantityTypeIdentifierDietaryWater',
        'HKCategoryTypeIdentifierSleepAnalysis',
        // Import-only: absent from `toShare` on purpose — the watch measures
        // these, and asking for write access we'd never use is a scope the
        // permission sheet would make the user grant for nothing.
        'HKQuantityTypeIdentifierStepCount',
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        // Cardio import (ADR-0026). A READ scope only: we already write
        // workouts via `toShare` below, and re-importing our own exports is
        // guarded by `fromUs` rather than by asking for less access.
        //
        // Adding this moves NO native surface — HealthKit read types are
        // requested at runtime and NSHealthShareUsageDescription already
        // covers them — which is why iOS gets cardio import by OTA while
        // Android waits for a binary. See the ADR-0026 amendment.
        'HKWorkoutTypeIdentifier',
      ] as never,
      toShare: [
        'HKQuantityTypeIdentifierBodyMass',
        'HKQuantityTypeIdentifierDietaryWater',
        'HKCategoryTypeIdentifierSleepAnalysis',
        'HKQuantityTypeIdentifierBodyFatPercentage',
        'HKQuantityTypeIdentifierDietaryEnergyConsumed',
        'HKQuantityTypeIdentifierDietaryProtein',
        'HKQuantityTypeIdentifierDietaryCarbohydrates',
        'HKQuantityTypeIdentifierDietaryFatTotal',
      ] as never,
    });
  },

  async readSamples(kind, sinceDays) {
    const HK = await hkModule();
    const filter = { startDate: sinceDate(sinceDays), endDate: new Date() };
    const mine = (s: HKQty) => s.sourceRevision?.source?.bundleIdentifier === APP_ID;

    if (kind === 'sleep') {
      const rows = (await HK.queryCategorySamples(HK_READ.sleep as never, {
        limit: 0,
        filter,
      } as never)) as unknown as HKCat[];
      return rows
        .filter((s) => HK_ASLEEP.has(s.value))
        .map((s) => ({
          dateKey: calendarDateKey(new Date(s.endDate)),
          kind: 'sleep' as const,
          value: (ms(s.endDate) - ms(s.startDate)) / 3_600_000, // ms → hours
          endMs: ms(s.endDate),
          fromUs: mine(s),
        }));
    }

    // Activity must come from the *statistics* API, not raw samples.
    // `queryQuantitySamples` returns every matching sample from every source
    // with no merge, so an iPhone + Apple Watch — or Strava / Fitbit writing
    // alongside — makes the same movement land two or three times.
    // `queryStatisticsCollectionForQuantity` is HealthKit's merging path: its
    // options control "the way in which data from multiple sources are merged",
    // and without `separateBySource` overlapping sources collapse to one figure
    // per interval. One interval per local day = one deduplicated day-total,
    // which is why `steps`/`activeEnergy` fold as `preAggregated` in core.
    if (kind === 'steps' || kind === 'activeEnergy') {
      const anchor = startOfLocalDay(sinceDate(sinceDays));
      const buckets = (await HK.queryStatisticsCollectionForQuantity(
        HK_READ[kind] as never,
        ['cumulativeSum'] as never,
        anchor,
        { day: 1 } as never,
        // Nested `date` filter — the documented `FilterForSamples` shape.
        { unit: HK_UNIT[kind], filter: { date: { startDate: anchor, endDate: new Date() } } } as never,
      )) as unknown as HKStatsBucket[];
      return buckets.flatMap((b) => {
        // No `sumQuantity` = the interval held no samples. That is a day the
        // device recorded nothing — missing, not a zero-activity day — so it
        // must not enter the ledger as 0. Missing days fall back to the
        // formula downstream; a fabricated 0 would drag the trailing mean down.
        const q = b.sumQuantity?.quantity;
        if (q == null) return [];
        const start = b.startDate ? new Date(b.startDate) : anchor;
        return [
          {
            // Key the day the bucket STARTS: a [midnight, next-midnight)
            // interval ends at the *following* day's 00:00, so keying off the
            // end — as the raw-sample path does — shifts every day forward one.
            dateKey: calendarDateKey(start),
            kind,
            value: q,
            endMs: b.endDate ? ms(b.endDate) : start.getTime(),
            // Import-only: absent from `toShare`, so we can never be a source.
            fromUs: false,
          },
        ];
      });
    }

    const rows = (await HK.queryQuantitySamples(HK_READ[kind] as never, {
      limit: 0,
      unit: HK_UNIT[kind],
      filter,
    } as never)) as unknown as HKQty[];
    return rows.map((s) => ({
      dateKey: calendarDateKey(new Date(s.endDate ?? s.startDate)),
      kind,
      value: s.quantity,
      endMs: ms(s.endDate ?? s.startDate),
      fromUs: mine(s),
    }));
  },

  async writeDaily(kind, dateKey, value) {
    const HK = await hkModule();
    const at = anchorAt(dateKey, kind);
    if (kind === 'sleep') {
      const start = new Date(at.getTime() - value * 3_600_000);
      await HK.saveCategorySample('HKCategoryTypeIdentifierSleepAnalysis' as never, 1 as never, start, at);
      return;
    }
    const map = {
      weight: ['HKQuantityTypeIdentifierBodyMass', 'lb', value],
      water: ['HKQuantityTypeIdentifierDietaryWater', 'fl_oz_us', value],
      // HealthKit percent quantities carry the 0..1 fraction, unit '%'.
      bodyFat: ['HKQuantityTypeIdentifierBodyFatPercentage', '%', percentToFraction(value)],
    } as const;
    const [id, unit, v] = map[kind];
    await HK.saveQuantitySample(id as never, unit as never, v, at, at);
  },

  async writeNutrition({ at, kcal, protein, carbs, fat }) {
    const HK = await hkModule();
    const one = (id: string, unit: string, v?: number) =>
      v == null ? Promise.resolve(undefined) : HK.saveQuantitySample(id as never, unit as never, v, at, at);
    await Promise.all([
      one('HKQuantityTypeIdentifierDietaryEnergyConsumed', 'kcal', kcal),
      one('HKQuantityTypeIdentifierDietaryProtein', 'g', protein),
      one('HKQuantityTypeIdentifierDietaryCarbohydrates', 'g', carbs),
      one('HKQuantityTypeIdentifierDietaryFatTotal', 'g', fat),
    ]);
  },

  async readWorkouts(sinceDays) {
    const HK = await hkModule();
    // Loosely typed for the same reason `writeWorkout` below is: the generated
    // overloads are stricter than anything verifiable without a native build.
    const query = HK.queryWorkoutSamples as unknown as
      | ((opts: unknown) => Promise<unknown>)
      | undefined;
    if (typeof query !== 'function') return [];
    const rows = (await query({
      limit: 0,
      energyUnit: 'kcal',
      distanceUnit: 'm',
      filter: { startDate: sinceDate(sinceDays), endDate: new Date() },
    })) as unknown as HKWorkoutRow[];
    return (rows ?? []).map((w) => ({
      // `uuid` is HealthKit's stable per-sample identity and is what makes a
      // re-import update rather than duplicate. Falling back to the time range
      // keeps that property for any build where the field is absent.
      id: String(w.uuid ?? `${ms(w.startDate)}-${ms(w.endDate)}`),
      activityType: String(w.workoutActivityType ?? ''),
      startMs: ms(w.startDate),
      endMs: ms(w.endDate),
      distanceM: w.totalDistance?.quantity,
      kcal: w.totalEnergyBurned?.quantity,
      sourceBundleId: w.sourceRevision?.source?.bundleIdentifier,
      sourceName: w.sourceRevision?.source?.name,
      fromUs: w.sourceRevision?.source?.bundleIdentifier === APP_ID,
    }));
  },

  async writeWorkout({ start, end }) {
    const HK = await hkModule();
    const durationSec = Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000));
    // Positional signature per kingstinct docs; loosely typed because its
    // generated overloads are stricter than we can verify without a build.
    const save = HK.saveWorkoutSample as unknown as (...a: unknown[]) => Promise<unknown>;
    await save(
      'HKWorkoutActivityTypeTraditionalStrengthTraining',
      { quantity: durationSec, unit: 'sec' },
      undefined,
      undefined,
      start,
      end,
    );
  },
};

// ───────────────────────── Android — Health Connect ─────────────────────────

interface HCRecord {
  metadata?: { dataOrigin?: string };
  time?: string;
  startTime?: string;
  endTime?: string;
  weight?: { inPounds?: number; inKilograms?: number };
  volume?: { inLiters?: number };
}

/** One period-sliced bucket from `aggregateGroupByPeriod`. `startTime` /
 *  `endTime` come back as local-naive strings (period slicing is
 *  `LocalDateTime`-based), so `new Date()` parses them in the device's zone —
 *  which is exactly the day bucket we want. */
interface HCPeriodGroup {
  startTime?: string;
  endTime?: string;
  result?: {
    /** Steps aggregate. */
    COUNT_TOTAL?: number;
    /** ActiveCaloriesBurned aggregate. */
    ACTIVE_CALORIES_TOTAL?: { inKilocalories?: number };
  };
}

/** The ExerciseSession fields we read. `exerciseType` is a numeric enum on this
 *  platform (HealthKit hands over a string), and `metadata.id` is the stable
 *  record identity that makes a re-import update instead of duplicate. */
interface HCExerciseSession {
  startTime?: string;
  endTime?: string;
  exerciseType?: number | string;
  title?: string;
  metadata?: { id?: string; dataOrigin?: string };
}

const hcModule = () => import('react-native-health-connect');

/**
 * Invert Health Connect's `ExerciseType` name→int table into int→name.
 *
 * Without this every Android workout classifies as `other`, because
 * `toCardioModality` matches on the platform's *name* and this platform sends a
 * number. Read off the module rather than hard-coded: the table gains entries
 * with each Health Connect release, and a stale local copy fails silently by
 * mislabelling new types rather than by erroring.
 *
 * Returns `{}` if the export is missing or shaped differently — callers then
 * fall back to the raw number, which maps to `other` and keeps its digits as a
 * label. Wrong, but visibly wrong, which is the better failure.
 */
function exerciseTypeNames(mod: Record<string, unknown>): Record<number, string> {
  const table = mod['ExerciseType'];
  if (!table || typeof table !== 'object') return {};
  const out: Record<number, string> = {};
  for (const [name, value] of Object.entries(table as Record<string, unknown>)) {
    if (typeof value === 'number') out[value] = name;
  }
  return out;
}

/** Modalities where a distance and an energy total are worth two extra calls.
 *  A strength session has no distance, and a first import over 90 days would
 *  otherwise pay for one per session to learn that. */
const HC_DISTANCE_MODALITIES = new Set(['run', 'walk', 'ride', 'hike', 'row', 'swim']);

/**
 * Aggregate one session's distance and active energy.
 *
 * Health Connect stores these as their own record types rather than as fields
 * on the session, so there is no cheaper way to get them. Each is independently
 * guarded: `READ_DISTANCE` is not declared in `app.json` either, so on today's
 * binary both simply come back absent, and a block with a duration and no
 * distance is a correct block rather than a broken one.
 */
async function hcSessionTotals(
  HC: Awaited<ReturnType<typeof hcModule>>,
  typeName: string,
  startTime: string | undefined,
  endTime: string | undefined,
): Promise<{ distanceM?: number; kcal?: number }> {
  if (!startTime || !endTime) return {};
  const modality = toCardioModality(typeName);
  if (!HC_DISTANCE_MODALITIES.has(modality)) return {};
  const filter = { operator: 'between', startTime, endTime };
  // The aggregate entry point is looked up by name rather than called through
  // the typed namespace, and both spellings are probed. The package's own
  // declarations are not readable from this workspace, the two names have both
  // shipped across versions, and Android cannot exercise this path at all
  // until READ_EXERCISE lands in a binary — so an unresolvable name must
  // degrade to "no totals" rather than fail to compile or throw at runtime.
  // Same posture as `HK.saveWorkoutSample`, which is cast for the same reason.
  const mod = HC as unknown as Record<string, unknown>;
  const agg = (mod['aggregateRecord'] ?? mod['aggregate']) as
    | ((opts: unknown) => Promise<unknown>)
    | undefined;
  if (typeof agg !== 'function') return {};
  const one = async (recordType: string): Promise<Record<string, unknown> | null> => {
    try {
      return (await agg({ recordType, timeRangeFilter: filter })) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const [dist, energy] = await Promise.all([one('Distance'), one('ActiveCaloriesBurned')]);
  const meters = (dist?.['DISTANCE'] as { inMeters?: number } | undefined)?.inMeters;
  const kcal = (energy?.['ACTIVE_CALORIES_TOTAL'] as { inKilocalories?: number } | undefined)
    ?.inKilocalories;
  return {
    ...(typeof meters === 'number' ? { distanceM: meters } : {}),
    ...(typeof kcal === 'number' ? { kcal } : {}),
  };
}

const HC_READ: Record<ReadableKind, string> = {
  weight: 'Weight',
  water: 'Hydration',
  sleep: 'SleepSession',
  steps: 'Steps',
  activeEnergy: 'ActiveCaloriesBurned',
};

const healthConnect: HealthPort = {
  async isAvailable() {
    try {
      const HC = await hcModule();
      return await HC.initialize();
    } catch {
      return false;
    }
  },

  async requestPermissions() {
    const HC = await hcModule();
    await HC.initialize();
    const perms = [
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'write', recordType: 'Weight' },
      { accessType: 'read', recordType: 'SleepSession' },
      { accessType: 'write', recordType: 'SleepSession' },
      { accessType: 'read', recordType: 'Hydration' },
      { accessType: 'write', recordType: 'Hydration' },
      // Import-only — read, never write (see ReadableKind). The matching
      // manifest permissions are already declared in app.json.
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      { accessType: 'write', recordType: 'BodyFat' },
      { accessType: 'write', recordType: 'Nutrition' },
      { accessType: 'write', recordType: 'ExerciseSession' },
    ];
    const granted = await HC.requestPermission(perms as never);
    return Array.isArray(granted) ? granted.length > 0 : !!granted;
  },

  async readSamples(kind, sinceDays) {
    const HC = await hcModule();
    await HC.initialize();

    // Activity must come from the *aggregate* API, not `readRecords`. Health
    // Connect documents that for cumulative types you use `aggregate` instead
    // of `readRecords` precisely "to avoid double counting from multiple
    // sources" — and its dedup covers the Activity category both our kinds
    // live in. `aggregateGroupByPeriod` gives one deduplicated total per
    // calendar day, which is why they fold as `preAggregated` in core.
    if (kind === 'steps' || kind === 'activeEnergy') {
      const anchor = startOfLocalDay(sinceDate(sinceDays));
      const groups = (await HC.aggregateGroupByPeriod({
        recordType: HC_READ[kind],
        timeRangeFilter: {
          operator: 'between',
          startTime: localIsoNaive(anchor),
          endTime: localIsoNaive(new Date()),
        },
        timeRangeSlicer: { period: 'DAYS', length: 1 },
      } as never)) as unknown as HCPeriodGroup[];
      return (groups ?? []).flatMap((g) => {
        const value =
          kind === 'steps' ? g.result?.COUNT_TOTAL : g.result?.ACTIVE_CALORIES_TOTAL?.inKilocalories;
        // An absent metric means the bucket held no records — a missing day,
        // which must stay missing rather than become a 0 (see the iOS branch).
        // Health Connect diverges from HealthKit here: it may return an
        // explicit 0 for an empty day where HealthKit omits the figure
        // entirely. #29 settled that as ABSENCE too — a stored 0 is "the OS
        // reported nothing", never "burned nothing" — so drop it, matching the
        // iOS empty-drop. Without this the ~400-day first import writes
        // hundreds of 0 docs. `reduceActivityWindow` filters `> 0` regardless;
        // this only spares the writes.
        if (value == null || Math.round(value) === 0) return [];
        const start = new Date(g.startTime ?? 0);
        return [
          {
            // Key the day the bucket STARTS — see the iOS branch.
            dateKey: calendarDateKey(start),
            kind,
            value,
            endMs: new Date(g.endTime ?? g.startTime ?? 0).getTime(),
            // Import-only: we never write these, so we can never be a source.
            fromUs: false,
          },
        ];
      });
    }

    const timeRangeFilter = {
      operator: 'between' as const,
      startTime: sinceDate(sinceDays).toISOString(),
      endTime: new Date().toISOString(),
    };
    const res = (await HC.readRecords(HC_READ[kind] as never, { timeRangeFilter } as never)) as unknown as {
      records: HCRecord[];
    };
    const rows = res.records ?? [];
    const mine = (r: HCRecord) => r.metadata?.dataOrigin === APP_ID;

    if (kind === 'sleep') {
      return rows.map((r) => {
        const start = new Date(r.startTime ?? 0).getTime();
        const end = new Date(r.endTime ?? 0).getTime();
        return {
          dateKey: calendarDateKey(new Date(end)),
          kind: 'sleep' as const,
          value: (end - start) / 3_600_000,
          endMs: end,
          fromUs: mine(r),
        };
      });
    }
    if (kind === 'water') {
      return rows.map((r) => {
        const end = new Date(r.endTime ?? r.startTime ?? 0).getTime();
        return {
          dateKey: calendarDateKey(new Date(end)),
          kind: 'water' as const,
          value: litersToFlOz(r.volume?.inLiters ?? 0),
          endMs: end,
          fromUs: mine(r),
        };
      });
    }
    // weight
    return rows.map((r) => {
      const t = new Date(r.time ?? 0).getTime();
      const lb = r.weight?.inPounds ?? (r.weight?.inKilograms != null ? kgToLb(r.weight.inKilograms) : 0);
      return { dateKey: calendarDateKey(new Date(t)), kind: 'weight' as const, value: lb, endMs: t, fromUs: mine(r) };
    });
  },

  async writeDaily(kind, dateKey, value) {
    const HC = await hcModule();
    await HC.initialize();
    const at = anchorAt(dateKey, kind);
    const iso = at.toISOString();
    let record: Record<string, unknown>;
    switch (kind) {
      case 'weight':
        record = { recordType: 'Weight', time: iso, weight: { unit: 'pounds', value } };
        break;
      case 'water':
        record = {
          recordType: 'Hydration',
          startTime: iso,
          endTime: iso,
          volume: { unit: 'liters', value: flOzToLiters(value) },
        };
        break;
      case 'sleep':
        record = {
          recordType: 'SleepSession',
          startTime: new Date(at.getTime() - value * 3_600_000).toISOString(),
          endTime: iso,
        };
        break;
      case 'bodyFat':
        record = { recordType: 'BodyFat', time: iso, percentage: value };
        break;
    }
    await HC.insertRecords([record!] as never);
  },

  async writeNutrition({ at, kcal, protein, carbs, fat }) {
    const HC = await hcModule();
    await HC.initialize();
    const iso = at.toISOString();
    const record: Record<string, unknown> = {
      recordType: 'Nutrition',
      startTime: iso,
      endTime: iso,
      energy: { unit: 'kilocalories', value: kcal },
    };
    if (protein != null) record.protein = { unit: 'grams', value: protein };
    if (carbs != null) record.totalCarbohydrate = { unit: 'grams', value: carbs };
    if (fat != null) record.totalFat = { unit: 'grams', value: fat };
    await HC.insertRecords([record] as never);
  },

  async readWorkouts(sinceDays) {
    // Guarded whole: until `android.permission.health.READ_EXERCISE` is
    // declared in app.json (a manifest change, so it needs a NEW BINARY --
    // ADR-0026 amendment, decision 7), Health Connect refuses this read. It is
    // meant to return an empty list rather than throw, but "meant to" is not a
    // contract worth a crash on the Train tab, and every failure mode here --
    // missing permission, revoked permission, Health Connect not installed --
    // is legitimately "no workouts to import".
    try {
      const HC = await hcModule();
      await HC.initialize();
      const res = (await HC.readRecords('ExerciseSession' as never, {
        timeRangeFilter: {
          operator: 'between',
          startTime: sinceDate(sinceDays).toISOString(),
          endTime: new Date().toISOString(),
        },
      } as never)) as unknown as { records?: HCExerciseSession[] } | HCExerciseSession[];
      const records = Array.isArray(res) ? res : (res?.records ?? []);

      // `exerciseType` is a NUMERIC enum here, where HealthKit gives a string.
      // Handing the number straight to `toCardioModality` would classify every
      // Android workout as `other`, silently. The module exports the name->int
      // table, so invert it once per read.
      const names = exerciseTypeNames(HC as unknown as Record<string, unknown>);

      const out: HealthWorkout[] = [];
      for (const r of records) {
        const startMs = new Date(r.startTime ?? 0).getTime();
        const endMs = new Date(r.endTime ?? 0).getTime();
        if (!(endMs > startMs)) continue;
        const typeName =
          typeof r.exerciseType === 'number'
            ? (names[r.exerciseType] ?? String(r.exerciseType))
            : String(r.exerciseType ?? '');
        const origin = r.metadata?.dataOrigin;
        out.push({
          id: String(r.metadata?.id ?? `${startMs}-${endMs}`),
          activityType: typeName,
          startMs,
          endMs,
          // Distance and energy are SEPARATE record types in Health Connect --
          // an ExerciseSession carries neither -- so each needs its own
          // aggregate over the session's window. Skipped for modalities where
          // a distance is meaningless, to keep a first import from making two
          // extra calls per strength session.
          ...(await hcSessionTotals(HC, typeName, r.startTime, r.endTime)),
          sourceBundleId: origin,
          sourceName: r.title,
          fromUs: origin === APP_ID,
        });
      }
      return out;
    } catch {
      return [];
    }
  },

  async writeWorkout({ start, end, label }) {
    const HC = await hcModule();
    await HC.initialize();
    await HC.insertRecords([
      {
        recordType: 'ExerciseSession',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        // 56 = STRENGTH_TRAINING in Health Connect's exerciseType enum. Verify
        // on a dev build; a wrong value mis-categorizes, it does not crash.
        exerciseType: 56,
        title: label ?? 'Strength training',
      },
    ] as never);
  },
};

// ──────────────────────── No-op (web / Expo Go) ────────────────────────

const noopHealth: HealthPort = {
  async isAvailable() {
    return false;
  },
  async requestPermissions() {
    return false;
  },
  async readSamples() {
    return [];
  },
  async readWorkouts() {
    return [];
  },
  async writeDaily() {},
  async writeNutrition() {},
  async writeWorkout() {},
};

// The native modules are Nitro-based and hard-throw at load in Expo Go
// ("NitroModules are not supported in Expo Go"). Detect the Expo Go client and
// use the no-op adapter there, so the module is never imported and the rest of
// the app stays usable in Expo Go. Real HealthKit/Health Connect only exist in
// a dev/prod build (executionEnvironment is 'storeClient' only in Expo Go).
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** The platform's health adapter. iOS → HealthKit, Android → Health Connect;
 *  Expo Go / web / anything else → a no-op so callers never branch. */
export const health: HealthPort =
  isExpoGo || Platform.OS === 'web'
    ? noopHealth
    : Platform.OS === 'ios'
      ? healthKit
      : Platform.OS === 'android'
        ? healthConnect
        : noopHealth;
