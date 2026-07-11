import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import {
  type HealthKind,
  type HealthSample,
  flOzToLiters,
  kgToLb,
  litersToFlOz,
  localDateKey,
  parseYmd,
  percentToFraction,
} from '@macrolog/core';

/**
 * Per-frontend native health adapter (Health Sync — see HEALTHKIT_PLAN.md).
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

/** Metrics we both read and write (two-way). Body-fat / nutrition / workouts
 *  are export-only — the app is their source of truth, so they're never read. */
export type ReadableKind = 'weight' | 'sleep' | 'water';

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
  /** Write one day's canonical-unit value (weight lb / sleep hours / water
   *  fl oz / body-fat percent). The sample is dated within `dateKey`'s day, so
   *  editing a past day exports to Health on that day, not today. */
  writeDaily(kind: HealthKind, dateKey: string, value: number): Promise<void>;
  /** Export one logged meal's macros as dietary samples. */
  writeNutrition(entry: NutritionExport): Promise<void>;
  /** Export a finished workout session. */
  writeWorkout(w: WorkoutExport): Promise<void>;
}

const sinceDate = (days: number): Date => new Date(Date.now() - days * 86_400_000);

/** A concrete timestamp inside `dateKey`'s local day for a written sample:
 *  ~7am for sleep (a plausible wake time for a night's total), noon otherwise. */
function anchorAt(dateKey: string, kind: HealthKind): Date {
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

const hkModule = () => import('@kingstinct/react-native-healthkit');

/** HealthKit sleep-analysis category values that count as actually asleep
 *  (not inBed=0, not awake=2): asleepUnspecified/Core/Deep/REM. */
const HK_ASLEEP = new Set([1, 3, 4, 5]);

const HK_READ: Record<ReadableKind, string> = {
  weight: 'HKQuantityTypeIdentifierBodyMass',
  water: 'HKQuantityTypeIdentifierDietaryWater',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
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
          dateKey: localDateKey(new Date(s.endDate)),
          kind: 'sleep' as const,
          value: (ms(s.endDate) - ms(s.startDate)) / 3_600_000, // ms → hours
          endMs: ms(s.endDate),
          fromUs: mine(s),
        }));
    }

    const unit = kind === 'weight' ? 'lb' : 'fl_oz_us';
    const rows = (await HK.queryQuantitySamples(HK_READ[kind] as never, {
      limit: 0,
      unit,
      filter,
    } as never)) as unknown as HKQty[];
    return rows.map((s) => ({
      dateKey: localDateKey(new Date(s.endDate ?? s.startDate)),
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

const hcModule = () => import('react-native-health-connect');

const HC_READ: Record<ReadableKind, string> = {
  weight: 'Weight',
  water: 'Hydration',
  sleep: 'SleepSession',
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
          dateKey: localDateKey(new Date(end)),
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
          dateKey: localDateKey(new Date(end)),
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
      return { dateKey: localDateKey(new Date(t)), kind: 'weight' as const, value: lb, endMs: t, fromUs: mine(r) };
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
