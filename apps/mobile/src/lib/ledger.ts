import {
  Timestamp,
  collection,
  deleteDoc as fsDeleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment as fsIncrement,
  limit,
  serverTimestamp,
  onSnapshot,
  orderBy,
  query,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  where,
  writeBatch as fsWriteBatch,
} from 'firebase/firestore';
import type { DocumentReference, SetOptions, WriteBatch } from 'firebase/firestore';
import { addBreadcrumb } from './sentry';
import { reportSnapshotMeta } from './connectivity';
import {
  type CustomFood,
  type DailyLog,
  type LogEntry,
  type Measurement,
  type MealPreset,
  type OnboardingV2Submission,
  type TargetMode,
  type Profile,
  type RefineTargetsSubmission,
  type UnitSystem,
  type WeeklyReport,
  type DailyActivity,
  type DocCodec,
  type Fast,
  isStorableFast,
  type MeasurementInput,
  type UsageCounts,
  type UsagePlatform,
  clampUsageCounts,
  hasUsageCounts,
  usageDocId,
  ACTIVE_ENERGY_MAX_KCAL,
  BATCH_CHUNK,
  STEPS_MAX,
  clampCutPace,
  clampSleepHours,
  clampWaterFlOz,
  MIDNIGHT,
  type DateKey,
  type DayBoundary,
  dayKeyAt,
  manualNightKeys,
  sanitizeDayBoundary,
  setDayStartHour as coreSetDayStartHour,
  oldestFirst,
  pruneUndefined as pruneUndefinedCore,
  readActivity,
  readSleepHours,
  readSleepSource,
  type SleepEntry,
  readWaterFlOz,
  readWeightLb,
  toCustomFood,
  toCustomFoodDoc,
  toDailyLog,
  toDomainProfile,
  toExerciseDoc,
  toLogDoc,
  toLogPatch,
  toMeasurement,
  toMeasurementDoc,
  toMeasurementPatch,
  toMaintenanceSwitchPatch,
  toOnboardingV2Patch,
  toPresetDoc,
  toSessionDoc,
  toSessionPatch,
  toTemplateDoc,
  toTemplatePatch,
  toWeeklyReport,
  withDefaultMealSlot,
  // The energy seam: a finished workout's marker log is 0 kcal, always
  // (ADR-0026 decision 5). Named rather than inlined so the one crossing point
  // between cardio and a measured target is greppable.
  workoutMarkerEntry,
  // Shared workout doc→domain mappers (arch review E). Mobile does NOT
  // normalize cluster groups (the web adapter does), so it uses these directly.
  toWorkoutExercise as toExercise,
  toWorkoutTemplate as toTemplate,
  toWorkoutSession as toSession,
} from '@macrolog/core';
import { db } from './firebase';
import type {
  Exercise,
  ExerciseDraft,
  SessionDraft,
  TemplateDraft,
  TemplateExercise,
  WorkoutSession,
  WorkoutTemplate,
} from './workout';

// Firestore schema mirrors the PWA exactly (see firestore-ledger.core.ts):
//   users/{uid}                       — profile doc
//   users/{uid}/dailyLogs/{id}        — { calories, timestamp, protein?, … }
//   users/{uid}/dailyWeights/{dateKey} — { weight }
// so both apps read/write the same data and pass the same security rules.

const logsCol = (uid: string) => collection(db, 'users', uid, 'dailyLogs');
const logDoc = (uid: string, id: string) => doc(db, 'users', uid, 'dailyLogs', id);
const weightsCol = (uid: string) => collection(db, 'users', uid, 'dailyWeights');
const weightDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailyWeights', dateKey);
const presetsCol = (uid: string) => collection(db, 'users', uid, 'presets');
const presetDoc = (uid: string, id: string) => doc(db, 'users', uid, 'presets', id);
const measurementsCol = (uid: string) => collection(db, 'users', uid, 'measurements');
const measurementDoc = (uid: string, id: string) => doc(db, 'users', uid, 'measurements', id);
const reportsCol = (uid: string) => collection(db, 'users', uid, 'reports');
const fastsCol = (uid: string) => collection(db, 'users', uid, 'fasts');
const userDoc = (uid: string) => doc(db, 'users', uid);

type Unsub = () => void;

/**
 * Where a snapshot came from.
 *
 * This app runs Firestore MEMORY-ONLY (RN has no IndexedDB — `offline-cache.ts`
 * explains why), and an offline listener still fires immediately with an EMPTY
 * result carrying `fromCache: true`. That is not an answer, it is the absence of
 * one, and treating it as authoritative did two kinds of damage in
 * `useCachedState`: it latched the "first live write wins" guard, permanently
 * discarding the disk hydration, and then wrote the empty array THROUGH to
 * AsyncStorage, destroying the cache for the next cold start too. Measured on
 * the LG G6 2026-08-23 — Train rendered "No templates yet" for an account with
 * three, offline, with a warm cache.
 */
export interface SnapshotMeta {
  fromCache: boolean;
}

const metaOf = (snap: { metadata: { fromCache: boolean } }): SnapshotMeta => ({
  fromCache: snap.metadata.fromCache,
});

// ─── Naming the write that failed ───────────────────────────────
//
// A Firestore rejection that crosses an async boundary under Hermes arrives
// with **no stack at all**. Sentry IGNIA-MOBILE-4 is three events of
// "FirebaseError: Missing or insufficient permissions." with `stacktrace: null`
// — no collection, no document, no code path — and the account that produced
// them has not been opened since, so there is nothing left to reproduce. The
// error was unidentifiable from telemetry, and would be again.
//
// The document path is the one identifier that survives, and Firestore already
// carries it on the ref. Every write here goes through the three wrappers
// below, which put the path in the message (what Sentry groups on) and leave a
// breadcrumb carrying the error code. Reads are deliberately not wrapped: a
// failed `onSnapshot` reports through its own `onError` callback with the query
// in hand, which is a channel that already works.
//
// The wrappers keep the SDK names, so the ~30 call sites are untouched and a
// new write cannot forget to opt in — the plain names are these.

/** Attach the failing path, once, and record the code. */
function annotateWrite(err: unknown, path: string): void {
  const code = (err as { code?: string } | null)?.code;
  addBreadcrumb(`firestore write failed: ${path}`, code ? { code } : undefined);
  if (err instanceof Error && !err.message.startsWith(`${path}: `)) {
    // Message only — `code` is what callers branch on and must not move.
    err.message = `${path}: ${err.message}`;
  }
}

// `object`, not `Record<string, unknown>`: the shared writers in
// `@macrolog/core/firestore-writers` return typed doc shapes with no index
// signature, and `createDoc` below already takes `object` for that reason.
async function setDoc(ref: DocumentReference, data: object, options?: SetOptions): Promise<void> {
  const payload = data as Record<string, unknown>;
  try {
    await (options ? fsSetDoc(ref, payload, options) : fsSetDoc(ref, payload));
  } catch (err) {
    annotateWrite(err, ref.path);
    throw err;
  }
}

async function updateDoc(ref: DocumentReference, data: object): Promise<void> {
  try {
    await fsUpdateDoc(ref, data as Record<string, unknown>);
  } catch (err) {
    annotateWrite(err, ref.path);
    throw err;
  }
}

async function deleteDoc(ref: DocumentReference): Promise<void> {
  try {
    await fsDeleteDoc(ref);
  } catch (err) {
    annotateWrite(err, ref.path);
    throw err;
  }
}

/** Batches carry many refs, so the annotation names the batch, not a path. */
function writeBatch(database: Parameters<typeof fsWriteBatch>[0]): WriteBatch {
  const batch = fsWriteBatch(database);
  const commit = batch.commit.bind(batch);
  batch.commit = async () => {
    try {
      await commit();
    } catch (err) {
      annotateWrite(err, 'writeBatch');
      throw err;
    }
  };
  return batch;
}

/** The two SDK values the shared writers can't construct themselves, bound to
 *  this edge's Firestore SDK once (see `@macrolog/core/firestore-writers`).
 *  The PWA adapter binds the identical pair against @angular/fire's SDK copy,
 *  which is why both apps emit byte-identical docs. */
const CODEC: DocCodec<Timestamp> = {
  timestamp: (d) => Timestamp.fromDate(d),
  remove: () => deleteField(),
};

/**
 * Create a doc with a client-minted id — the idempotent replacement for
 * `addDoc`.
 *
 * `addDoc` looks like "setDoc with a random id", but it is not: it attaches a
 * `Precondition.exists(false)` to the mutation. When the Write stream drops
 * *after* the server committed but *before* the ack arrives, the SDK replays
 * the same mutation against the same id, the precondition now fails, and the
 * write rejects with `already-exists` — a create the user watched succeed,
 * reported as a failure. `setDoc` carries no precondition, so the replay is a
 * harmless overwrite of identical bytes.
 *
 * Not hypothetical: Sentry IGNIA-MOBILE-6 on Android vc 13, whose breadcrumb
 * immediately before the throw is
 * `WebChannelConnection RPC 'Write' stream … transport errored`. Flaky mobile
 * networks make this the normal case, not the edge one, which is why every
 * create in this file goes through here. The PWA adapter mirrors it
 * (`createWithId` in `firestore-ledger.core.ts`).
 */
async function createDoc(col: ReturnType<typeof collection>, data: object): Promise<string> {
  const ref = doc(col);
  await setDoc(ref, data as Record<string, unknown>);
  return ref.id;
}

/** Live-subscribe to the latest `count` log rows, delivered OLDEST-FIRST
 *  (matches the ledger seam contract). Doc → domain mapping + the oldest-first
 *  reverse are single-sourced in @macrolog/core (shared with the PWA adapter).
 *
 *  This is also the app's **connectivity probe**. `includeMetadataChanges` costs
 *  no reads — metadata-only events are generated locally — and it is what makes
 *  going offline observable at all: without it, a device that loses signal while
 *  no document changes simply stops hearing anything, which is indistinguishable
 *  from a quiet day. See `connectivity.ts` for what is done with the answer. */
export function subscribeRecentLogs(
  uid: string,
  count: number,
  cb: (logs: DailyLog[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(logsCol(uid), orderBy('timestamp', 'desc'), limit(count));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    {
      next: (snap) => {
        reportSnapshotMeta(snap.metadata.fromCache);
        cb(oldestFirst(snap.docs.map((d) => toDailyLog(d.id, d.data()))), metaOf(snap));
      },
      error: (e) => onError?.(e),
    },
  );
}

/** Live-subscribe to the most recent AI weekly report (or null when none
 *  exists yet). Reports are written server-side by the generateWeeklyReport
 *  Cloud Function; rules block client writes, so read-only here. */
export function subscribeLatestReport(
  uid: string,
  cb: (report: WeeklyReport | null) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(reportsCol(uid), orderBy('generatedAt', 'desc'), limit(1));
  return onSnapshot(
    q,
    (snap) => {
      const d = snap.docs[0];
      if (!d) { cb(null); return; }
      cb(toWeeklyReport(d.id, d.data()));
    },
    onError,
  );
}

/**
 * Add one log row.
 *
 * The meal-slot default is applied HERE rather than by each add surface: this
 * is the one call every in-app add passes through, and a default that each
 * caller has to remember is how the History sheet spent its life filing meals
 * into `other` while the identical meal from Today filed into its slot. See
 * `withDefaultMealSlot`; an explicit `mealType` always wins, and marker rows
 * (exercise, weight) are left untagged.
 */
export async function addLog(uid: string, entry: LogEntry): Promise<string> {
  return createDoc(logsCol(uid), toLogDoc(withDefaultMealSlot(entry, new Date()), CODEC));
}

/**
 * Write a log at an id the CALLER minted (`newLedgerId` in `@macrolog/core`).
 *
 * Only the quick-add path uses this (ADR-0020), and it needs the id before the
 * request rather than after: a widget-button or tile tap that loses its socket
 * mid-`Write` is parked on disk under this id and retried later, and the retry
 * has to be the same doc or the user gets the meal twice. `createDoc` already
 * relies on `setDoc`'s lack of a precondition for exactly that reason; here the
 * id simply has to outlive the process.
 *
 * Identical bytes on the wire otherwise — same serializer, same collection — so
 * nothing downstream can tell a quick-added row from a hand-entered one.
 */
export async function addLogWithId(uid: string, id: string, entry: LogEntry): Promise<void> {
  await setDoc(logDoc(uid, id), toLogDoc(entry, CODEC));
}

export async function updateLog(uid: string, id: string, entry: LogEntry): Promise<void> {
  await updateDoc(logDoc(uid, id), toLogPatch(entry, CODEC));
}

export async function deleteLog(uid: string, id: string): Promise<void> {
  await deleteDoc(logDoc(uid, id));
}

/** Bulk-import parsed LogEntry rows in ≤BATCH_CHUNK-op batches (Firestore's
 *  500-write cap). Returns the number written. Mirrors
 *  FirestoreLedgerCore.importLogs — same chunk size, same row serializer. */
export async function importLogs(uid: string, entries: readonly LogEntry[]): Promise<number> {
  const coll = logsCol(uid);
  let written = 0;
  for (let i = 0; i < entries.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(i, i + BATCH_CHUNK)) {
      batch.set(doc(coll), toLogDoc(entry, CODEC));
    }
    await batch.commit();
    written += Math.min(BATCH_CHUNK, entries.length - i);
  }
  return written;
}

// ─── Daily weights ──────────────────────────────────────────────
export function subscribeDailyWeights(
  uid: string,
  cb: (weights: Record<string, number>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    weightsCol(uid),
    (snap) => {
      const weights: Record<string, number> = {};
      for (const d of snap.docs) {
        const w = readWeightLb(d.data());
        if (w != null) weights[d.id] = w;
      }
      cb(weights, metaOf(snap));
    },
    onError,
  );
}

/**
 * The most recent daily weight, or null if there is none. One doc read: the
 * `dateKey` doc id sorts chronologically, so "latest" is the last id.
 * For screens that need a single weight (the activity-correction basal) and
 * have no reason to hold the whole `subscribeDailyWeights` stream open.
 *
 * Ordering by `documentId()` DESCENDING needs an explicit index — Firestore
 * auto-indexes `__name__` ascending only — so `dailyWeights` carries one in
 * firestore.indexes.json. Without it this rejects with FAILED_PRECONDITION
 * in production while passing every emulator test.
 */
export async function getLatestDailyWeight(uid: string): Promise<number | null> {
  const snap = await getDocs(query(weightsCol(uid), orderBy(documentId(), 'desc'), limit(1)));
  const d = snap.docs[0];
  if (!d) return null;
  return readWeightLb(d.data());
}

export async function setDailyWeight(uid: string, dateKey: string, weight: number): Promise<void> {
  await setDoc(weightDoc(uid, dateKey), { weight });
}

// ─── Daily water ────────────────────────────────────────────────
// users/{uid}/dailyWater/{dateKey} = { flOz }. Stored in fl oz (the ml
// branch is legacy — see project_water_unit_migration). Clamp [0, 676].
const waterCol = (uid: string) => collection(db, 'users', uid, 'dailyWater');
const waterDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailyWater', dateKey);

export function subscribeDailyWater(
  uid: string,
  cb: (water: Record<string, number>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    waterCol(uid),
    (snap) => {
      const water: Record<string, number> = {};
      for (const d of snap.docs) water[d.id] = readWaterFlOz(d.data()) ?? 0;
      cb(water, metaOf(snap));
    },
    onError,
  );
}

/**
 * A bounded window of days — the Trends water card's reader (#115 §3).
 *
 * Separate from {@link subscribeDailyWater} for the same two reasons
 * {@link subscribeDailySleepSince} is separate from its sibling, and they are
 * worth restating because the unbounded form is right where it is used and
 * wrong to copy:
 *
 * - **It is range-bounded and the other one is not.** `subscribeDailyWater`
 *   subscribes the WHOLE collection, which is fine for `useToday`'s single
 *   listener and is not what a second consumer should inherit — this collection
 *   gains a document every day someone drinks anything, so a long-lived account
 *   has hundreds and the card reads fourteen of them.
 * - **ADR-0016 says the second consumer opens its own listener** rather than
 *   widening `useCoreSnapshot`; the duplication is the model and focus-gating is
 *   what bounds it.
 *
 * `dateKey` IS the doc id, so the range is a `documentId()` query and needs no
 * index. Inclusive at `since`.
 *
 * Unlike the unbounded reader this does **not** coerce a missing value to `0`.
 * The card must be able to tell a day with no record from a day with none
 * drunk — a zero-filled gap would drag the median down and draw a bar claiming
 * the user drank nothing.
 */
export function subscribeDailyWaterSince(
  uid: string,
  since: string,
  cb: (water: Record<string, number>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(waterCol(uid), where(documentId(), '>=', since)),
    (snap) => {
      const water: Record<string, number> = {};
      for (const d of snap.docs) {
        const flOz = readWaterFlOz(d.data());
        if (flOz != null) water[d.id] = flOz;
      }
      cb(water, metaOf(snap));
    },
    onError,
  );
}

export async function setDailyWater(uid: string, dateKey: string, flOz: number): Promise<void> {
  await setDoc(waterDoc(uid, dateKey), { flOz: clampWaterFlOz(flOz) });
}

// ─── Daily sleep ────────────────────────────────────────────────
// users/{uid}/dailySleep/{dateKey} = { hours }. Clamp [0, 24], half-hour.
const sleepCol = (uid: string) => collection(db, 'users', uid, 'dailySleep');
const sleepDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailySleep', dateKey);

export function subscribeDailySleep(
  uid: string,
  cb: (sleep: Record<string, number>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    sleepCol(uid),
    (snap) => {
      const sleep: Record<string, number> = {};
      for (const d of snap.docs) {
        const h = readSleepHours(d.data());
        if (h != null) sleep[d.id] = h;
      }
      cb(sleep, metaOf(snap));
    },
    onError,
  );
}

/**
 * A bounded window of nights, WITH provenance — the Trends sleep card's reader
 * (ADR-0033 decision 9, issue #81).
 *
 * Three things make this a separate function rather than an option on
 * {@link subscribeDailySleep}, and all three are the same reason stated at
 * different levels:
 *
 * - **It is range-bounded and the other one is not.** `subscribeDailySleep`
 *   subscribes the WHOLE collection, which is right for `useToday`'s single
 *   listener over a small account and is not what a second consumer should
 *   copy: a two-year account has ~700 documents there. Copying an unbounded
 *   listener into a second hook is how a read bill starts.
 * - **It carries `source`, which the other one drops** — it returns
 *   `dateKey → hours`. The card's footer names provenance at window level
 *   (`imported` / `typed` / `both`), which is the strongest honest claim the
 *   schema supports; there is no `provider`, so it can never say "via Oura".
 * - **ADR-0016 says the second consumer opens its own listener** rather than
 *   sharing Today's. The duplication is the model; what bounds it is
 *   focus-gating, which `useCoreSnapshot` already enforces for this screen.
 *
 * `dateKey` IS the doc id, so the range is a `documentId()` query and needs no
 * index — same shape as {@link getActivityWindow}. Inclusive at `since`.
 */
export function subscribeDailySleepSince(
  uid: string,
  since: string,
  cb: (sleep: Record<string, SleepEntry>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(sleepCol(uid), where(documentId(), '>=', since)),
    (snap) => {
      const sleep: Record<string, SleepEntry> = {};
      for (const d of snap.docs) {
        const hours = readSleepHours(d.data());
        if (hours != null) sleep[d.id] = { hours, source: readSleepSource(d.data()) };
      }
      cb(sleep, metaOf(snap));
    },
    onError,
  );
}

/** Where a night's number came from. Absent on every document written before
 *  2026-08-24, which {@link importDailySleep} treats as `manual` — protecting
 *  what a user already typed rather than assuming it is disposable. */
export type SleepSource = 'manual' | 'import';

/**
 * Write a night the USER entered — the sleep sheet on Today, or the extras on a
 * finished training session. Always wins over an importer.
 */
export async function setDailySleep(
  uid: string,
  dateKey: string,
  hours: number,
  source: SleepSource = 'manual',
): Promise<void> {
  await setDoc(sleepDoc(uid, dateKey), { hours: clampSleepHours(hours), source });
}

/**
 * Write a night an IMPORTER measured (Apple Health, Health Connect, Oura) —
 * **unless the user typed one first.**
 *
 * A daily total is not like a workout: two sources reporting one night are two
 * measurements of the same quantity, so the newer read normally wins. The one
 * exception is a number a person entered by hand, which is a statement of
 * intent rather than a measurement, and silently replacing it is data loss the
 * user never asked for and cannot undo.
 *
 * **A missing `source` counts as manual.** Documents predating this field could
 * be either, and the conservative reading is the one that cannot destroy a real
 * entry: imports fill empty days and refresh days they already own, and leave
 * everything else alone.
 *
 * Returns whether it wrote, so a caller can report honestly instead of
 * counting skips as successes.
 *
 * **The guard is not keyed on the document id any more (issue #80).** It was,
 * and that only asks the right question when the manual writer and the importer
 * agree on the key — which a non-midnight `dayBoundary` makes false: the sleep
 * sheet writes `dayKeyAt(now)` while every importer files the calendar wake
 * day, so a night typed at 01:00 on a 3am boundary sits one document away from
 * the import of the same night, and the guard read past it. Pass `night` and
 * the check widens to the keys that night could have been typed under
 * (`manualNightKeys`); omit it and this behaves exactly as it did.
 *
 * The **write** is still always at `dateKey` — the source's day, per ADR-0030
 * Q5. Only the protection check moved.
 */
export async function importDailySleep(
  uid: string,
  dateKey: string,
  hours: number,
  night?: {
    /** When the sleeper woke: a health sample's `endMs`, Oura's `bedtime_end`. */
    wakeAt?: Date | number | null;
    /** The account's boundary — {@link getDayBoundaryOnce}. */
    boundary?: DayBoundary;
  },
): Promise<boolean> {
  const keys = manualNightKeys(dateKey as DateKey, night?.wakeAt, night?.boundary);
  const snaps = await Promise.all(keys.map((k) => getDoc(sleepDoc(uid, k))));
  if (snaps.some((s) => s.exists() && s.data()?.['source'] !== 'import')) return false;
  await setDoc(sleepDoc(uid, dateKey), { hours: clampSleepHours(hours), source: 'import' });
  return true;
}

// ─── Daily activity (import-only) ───────────────────────────────
// users/{uid}/dailyActivity/{dateKey} = { steps?, activeKcal? }.
//
// One doc per day holding BOTH metrics rather than a collection each: they're
// written together by the same importer, read together by the same UI, and a
// single doc halves the reads (and the rule surface). The two setters merge so
// neither clobbers the other's field.
//
// Import-only on purpose — the phone and watch measure these, the app can't, so
// there is no export path and nothing here ever writes to Health.
const activityCol = (uid: string) => collection(db, 'users', uid, 'dailyActivity');
const activityDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailyActivity', dateKey);

// `DailyActivity` and the four scalar readers below are shared math, so they
// live in `@macrolog/core/daily-scalars`. Re-exported here because every
// mobile consumer already imports the type from the ledger.
export type { DailyActivity };

export function subscribeDailyActivity(
  uid: string,
  cb: (activity: Record<string, DailyActivity>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    activityCol(uid),
    (snap) => {
      const activity: Record<string, DailyActivity> = {};
      for (const d of snap.docs) activity[d.id] = readActivity(d.data());
      cb(activity, metaOf(snap));
    },
    onError,
  );
}

/**
 * One-shot read of a bounded dateKey range of activity docs, inclusive both
 * ends — the activity-level correction's trailing window (`activityWindowRange`
 * in core supplies the bounds).
 *
 * Deliberately a `getDocs`, not a listener, and deliberately NOT folded into
 * `subscribeDailyActivity`: per ADR-0016 each surface reads for itself, and
 * this one wants 28 docs once rather than the whole collection live.
 * `dateKey` IS the doc id, so the range is a documentId() query — no index.
 */
export async function getActivityWindow(
  uid: string,
  from: string,
  to: string,
): Promise<Record<string, DailyActivity>> {
  const snap = await getDocs(
    query(activityCol(uid), where(documentId(), '>=', from), where(documentId(), '<=', to)),
  );
  const activity: Record<string, DailyActivity> = {};
  for (const d of snap.docs) activity[d.id] = readActivity(d.data());
  return activity;
}

export async function setDailySteps(uid: string, dateKey: string, steps: number): Promise<void> {
  const v = Math.max(0, Math.min(STEPS_MAX, Math.round(steps)));
  await setDoc(activityDoc(uid, dateKey), { steps: v }, { merge: true });
}

export async function setDailyActiveEnergy(uid: string, dateKey: string, kcal: number): Promise<void> {
  const v = Math.max(0, Math.min(ACTIVE_ENERGY_MAX_KCAL, Math.round(kcal)));
  await setDoc(activityDoc(uid, dateKey), { activeKcal: v }, { merge: true });
}

/**
 * The account's day boundary, read once.
 *
 * The importers have no profile in scope — they run from Settings and from an
 * app-foreground effect, neither of which holds a listener — and since issue
 * #80 the sleep guard needs the boundary to know which document could hold the
 * manual twin of a night. One document read per import RUN, not per night: the
 * caller threads the result through its loop, which is why this is a bare
 * getter rather than something `importDailySleep` does for itself.
 *
 * Falls back to {@link MIDNIGHT} on any failure. That is the safe direction —
 * midnight is what every account that has never touched the setting is on, and
 * it makes the guard behave exactly as it did before #80 rather than blocking
 * an import on a profile read.
 */
export async function getDayBoundaryOnce(uid: string): Promise<DayBoundary> {
  if (!uid) return MIDNIGHT;
  try {
    const snap = await getDoc(userDoc(uid));
    return sanitizeDayBoundary(snap.data()?.['dayBoundary']);
  } catch {
    return MIDNIGHT;
  }
}

// ─── Health sync — one-shot scalar reads ────────────────────────
// The live tabs subscribe to these collections; the Health importer needs a
// point-in-time snapshot (it can run from Settings, which holds no listeners),
// so it reads once here. `dateKey → value` in each metric's canonical unit
// (weight lb, sleep hours, water fl oz, steps count, activeEnergy kcal) — the
// same units health-mapping uses.
export async function getHealthScalarsOnce(uid: string): Promise<{
  weight: Record<string, number>;
  sleep: Record<string, number>;
  water: Record<string, number>;
  steps: Record<string, number>;
  activeEnergy: Record<string, number>;
}> {
  const [wSnap, sSnap, waSnap, actSnap] = await Promise.all([
    getDocs(weightsCol(uid)),
    getDocs(sleepCol(uid)),
    getDocs(waterCol(uid)),
    getDocs(activityCol(uid)),
  ]);
  const weight: Record<string, number> = {};
  for (const d of wSnap.docs) {
    const w = readWeightLb(d.data());
    if (w != null) weight[d.id] = w;
  }
  const sleep: Record<string, number> = {};
  for (const d of sSnap.docs) {
    const h = readSleepHours(d.data());
    if (h != null) sleep[d.id] = h;
  }
  // `exact` here, not the display rounding the tabs use: the importer diffs
  // this against the platform's own samples, and a rounded fl oz reads as a
  // changed measurement that gets re-written on every import.
  const water: Record<string, number> = {};
  for (const d of waSnap.docs) {
    const flOz = readWaterFlOz(d.data(), { exact: true });
    if (flOz != null) water[d.id] = flOz;
  }
  // Both activity metrics share one doc, so a day may carry either, both, or
  // neither — each map only gets the days that actually have that field.
  const steps: Record<string, number> = {};
  const activeEnergy: Record<string, number> = {};
  for (const d of actSnap.docs) {
    const { steps: s, activeKcal: k } = readActivity(d.data());
    if (s != null) steps[d.id] = s;
    if (k != null) activeEnergy[d.id] = k;
  }
  return { weight, sleep, water, steps, activeEnergy };
}

// ─── Fasting ────────────────────────────────────────────────────
// Fasting state lives on the profile as `fastStartedAt` (Timestamp | null),
// mirroring FirebaseService.startFast / breakFast.
export async function startFast(uid: string, startedAt?: Date): Promise<void> {
  await updateDoc(userDoc(uid), {
    fastStartedAt: startedAt ? Timestamp.fromDate(startedAt) : Timestamp.now(),
    lastSeenAt: Timestamp.now(),
  });
}

/**
 * End the running fast — and KEEP it (ADR-0032, issue #97).
 *
 * This function used to be one line: `updateDoc(userDoc(uid), { fastStartedAt:
 * null })`. That destroyed the fast at the exact moment it became final. A user
 * could fast every day for a year and the app retained one scalar — whether a
 * fast was running right now — so there was no history, no CSV column and
 * nothing Trends could ever draw. It was filed as a data-loss bug rather than a
 * missing feature for that reason.
 *
 * **The batch is not a nicety.** Creating the fast document and nulling
 * `fastStartedAt` must commit together: split into two writes, a failure
 * between them either loses the fast (write the null first) or leaves a phantom
 * timer running against a fast already archived (write the document first).
 * Both are the exact bug class the Zero reviews in ADR-0032 describe.
 *
 * **The interval is validated HERE, before the batch is built, and that
 * ordering is load-bearing.** `firestore.rules` rejects an inverted, zero-length
 * or >14-day interval; a rejected document does not merely fail to save, it
 * fails the whole commit — so `fastStartedAt` would stay set and the user's
 * timer would run forever with no way to stop it. `isStorableFast` is the same
 * three conditions the rules check, exported from `packages/core` so the two
 * cannot drift. When it says no, the timer is cleared and no document is
 * written: an interval it rejects is a clock that went backwards or a timer left
 * running for a fortnight, and leaving someone stuck looking at a counter they
 * cannot stop is worse than dropping a record that was never a fast.
 *
 * `endedAt` is a parameter so a caller can end a fast at a corrected time
 * (ADR-0032 decision 3 — editing is the feature, not the polish); it defaults
 * to now, which is every call today.
 */
export async function breakFast(uid: string, endedAt?: Date): Promise<void> {
  const end = endedAt ?? new Date();
  const snap = await getDoc(userDoc(uid));
  const startedAt = snap.data()?.fastStartedAt as Timestamp | null | undefined;
  const start = startedAt instanceof Timestamp ? startedAt.toDate() : null;

  const batch = writeBatch(db);
  if (start && isStorableFast(start, end)) {
    batch.set(doc(fastsCol(uid)), {
      startedAt: Timestamp.fromDate(start),
      endedAt: Timestamp.fromDate(end),
      source: 'timer',
    });
  }
  batch.update(userDoc(uid), { fastStartedAt: null, lastSeenAt: Timestamp.now() });
  await batch.commit();
}

/**
 * Every completed fast, newest-ended first.
 *
 * Bounded rather than unbounded, per ADR-0016 — this is a one-shot read for the
 * CSV export, not a listener, and an account that has fasted daily for years is
 * still a few hundred documents. `limit` is generous enough that no real export
 * is truncated and low enough that a corrupt account cannot pull an unbounded
 * read on a metered connection.
 */
export async function getFasts(uid: string, count = 2000): Promise<Fast[]> {
  const snap = await getDocs(query(fastsCol(uid), orderBy('endedAt', 'desc'), limit(count)));
  return snap.docs.map((d) => toFast(d.id, d.data()));
}

/**
 * Completed fasts that ended on or after `since` (ADR-0034, issue #98).
 *
 * **Range-bounded, and that is not optional.** The Trends card reads fourteen
 * days; an account that has fasted daily for two years holds ~700 documents in
 * this collection, and an unbounded second listener is how a read bill starts
 * (ADR-0033 §9). `endedAt` carries both the filter and the order, so this is a
 * single-field query and needs no composite index.
 *
 * Its own listener rather than a widening of `useCoreSnapshot`, per ADR-0016:
 * three screens would otherwise pay for a listener one screen reads. What
 * bounds the duplication is focus-gating, which the calling hook does.
 */
export function subscribeFastsSince(
  uid: string,
  since: Date,
  cb: (fasts: Fast[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(
      fastsCol(uid),
      where('endedAt', '>=', Timestamp.fromDate(since)),
      orderBy('endedAt', 'desc'),
    ),
    (snap) => cb(snap.docs.map((d) => toFast(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

/**
 * The days of slack either side of a day's own range that {@link
 * subscribeFastsAround} reads, so the editor has neighbours to check overlap
 * against (ADR-0032 decision 3).
 *
 * **Three, and it is a budget rather than a proof.** The exact query for "every
 * fast that could overlap this one" is `endedAt > ourStart AND endedAt <
 * ourEnd + 14d`, because a colliding fast can start just before ours and run
 * the full `MAX_FAST_MS` ceiling. Subscribing to a fortnight either side of
 * every day a user opens would be an unbounded-ish read on a metered
 * connection for a guard that fires almost never — the exact cost ADR-0033 §9
 * warns about, and ADR-0032 commits to this feature costing "effectively zero".
 *
 * So the window is three days, which covers every fast a person actually logs
 * (the longest plausible is a multi-day water fast of 48–72h) and misses only a
 * conflicting fast longer than that. The consequence is stated plainly because
 * it must not be discovered later: overlap detection is **best-effort**. It has
 * no false positives — a fast this window returns really does collide — only
 * false negatives beyond three days, and a missed collision writes a document
 * the rules accept and the user can still see and fix. The real interval
 * guarantee is `isStorableFast`, which is checked on every write regardless.
 */
const FAST_OVERLAP_WINDOW_DAYS = 3;

/**
 * Completed fasts in a window around one day — the editor's read.
 *
 * Separate from {@link subscribeFastsSince} rather than a widening of it, per
 * ADR-0016: Trends reads a trailing fortnight and the History day detail reads
 * a few days around one date, and collapsing them would make one screen pay for
 * the other's window. Both are range-bounded on `endedAt`, so both are
 * single-field queries needing no composite index.
 *
 * **It is bounded on `endedAt` while the caller filters on attribution**, and
 * those are not the same thing. A fast that ENDED on Tuesday can have started
 * on Monday, so a query bounded to Tuesday's own `dayRange` would silently drop
 * exactly the overnight fasts this feature exists to edit — the single most
 * likely implementation bug in ADR-0032, called out in its consequences. The
 * window here is deliberately wider than the day, and `fastsEndingOn` does the
 * attribution in pure code where it is tested.
 */
export function subscribeFastsAround(
  uid: string,
  dayStart: Date,
  dayEnd: Date,
  cb: (fasts: Fast[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  const pad = FAST_OVERLAP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return onSnapshot(
    query(
      fastsCol(uid),
      where('endedAt', '>=', Timestamp.fromDate(new Date(dayStart.getTime() - pad))),
      where('endedAt', '<=', Timestamp.fromDate(new Date(dayEnd.getTime() + pad))),
      orderBy('endedAt', 'desc'),
    ),
    (snap) => cb(snap.docs.map((d) => toFast(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

/**
 * Write a fast the user asserted by hand — the retroactive "I fasted 18 hours
 * yesterday" that no timer measured.
 *
 * `source: 'manual'` is not decoration. It is the same distinction
 * `dailySleep.source` draws, it is enumerated in `firestore.rules` rather than
 * trusted, and it is what stops a hand-entered interval from later being read
 * as something the app measured. Every write on this path sets it; nothing here
 * may write `'timer'`.
 *
 * Validated with `isStorableFast` before the write for the reason that function
 * documents — the rules reject an inverted, zero-length or >14-day interval,
 * and a caller that discovers this at commit time has already shown the user a
 * success. Throws rather than silently dropping, because unlike `breakFast`
 * there is no running timer to rescue: refusing an impossible interval loudly
 * is the correct outcome when a person typed it.
 */
export async function addFast(uid: string, startedAt: Date, endedAt: Date): Promise<void> {
  if (!isStorableFast(startedAt, endedAt)) throw new Error('fast/invalid-interval');
  await setDoc(doc(fastsCol(uid)), {
    startedAt: Timestamp.fromDate(startedAt),
    endedAt: Timestamp.fromDate(endedAt),
    source: 'manual',
  });
}

/**
 * Correct a stored fast's interval.
 *
 * **`setDoc`, not `updateDoc`, and that is load-bearing.** `isValidFast` is
 * written with `hasOnly` over the three fields, and rules validate the
 * POST-merge document — but a partial update of a legacy row that carries no
 * `source` would leave it absent, while a merge that kept an old `'timer'`
 * source would let a hand-edited fast keep claiming the timer measured it.
 * Replacing the document outright makes the stored shape exactly the three
 * fields the rules describe, every time, with the source telling the truth.
 *
 * A corrected fast is `'manual'` whatever it was before: once a human moved the
 * hands, the record is an assertion and no longer a measurement.
 */
export async function updateFast(
  uid: string,
  fastId: string,
  startedAt: Date,
  endedAt: Date,
): Promise<void> {
  if (!isStorableFast(startedAt, endedAt)) throw new Error('fast/invalid-interval');
  await setDoc(doc(fastsCol(uid), fastId), {
    startedAt: Timestamp.fromDate(startedAt),
    endedAt: Timestamp.fromDate(endedAt),
    source: 'manual',
  });
}

/**
 * Delete a stored fast.
 *
 * Hard delete, no tombstone. ADR-0032 keeps every fast the user ends and makes
 * no product judgement about length — but a fast the user says never happened
 * is not data to preserve, it is a mistake to remove, and a soft-deleted row
 * would have to be filtered out of `fastingWindow`, `completedFastHours` and
 * the CSV, which is three places for it to leak back into an average.
 */
export async function deleteFast(uid: string, fastId: string): Promise<void> {
  await deleteDoc(doc(fastsCol(uid), fastId));
}

function toFast(id: string, data: Record<string, unknown>): Fast {
  const startedAt = data.startedAt as Timestamp | undefined;
  const endedAt = data.endedAt as Timestamp | undefined;
  const source = data.source;
  return {
    id,
    startedAt: startedAt instanceof Timestamp ? startedAt.toDate() : new Date(NaN),
    endedAt: endedAt instanceof Timestamp ? endedAt.toDate() : new Date(NaN),
    ...(source === 'timer' || source === 'manual' ? { source } : {}),
  };
}

// ─── Profile ────────────────────────────────────────────────────
export function subscribeProfile(
  uid: string,
  cb: (profile: Profile | null, meta: { fromCache: boolean }) => void,
  onError?: (e: Error) => void,
): Unsub {
  // Timestamp → Date mapping is single-sourced in @macrolog/core
  // (`toDomainProfile`, shared with the PWA), which converts every
  // profile date field — not just the four this app formerly handled.
  return onSnapshot(
    userDoc(uid),
    { includeMetadataChanges: true },
    {
      // `fromCache` is passed through because the ABSENCE of a profile means
      // two completely different things depending on it. A server snapshot
      // saying the doc does not exist means "this user has not onboarded". A
      // cache-only snapshot saying the same thing means "I have not been able
      // to look" — and this app has no Firestore persistence, so on a cold
      // start with no network that is exactly what arrives.
      //
      // Collapsing the two sent existing users to onboarding whenever they
      // opened the app offline, where finishing the form would overwrite their
      // real targets. See `auth.tsx`.
      next: (snap) => {
        // Also the EARLIEST connectivity signal the app gets: this listener is
        // mounted by the auth provider at startup, well before Today's. The
        // routing gate needs to know whether it is offline before it decides
        // where to send someone.
        reportSnapshotMeta(snap.metadata.fromCache);
        cb(snap.exists() ? toDomainProfile(snap.data()) : null, {
          fromCache: snap.metadata.fromCache,
        });
      },
      error: (e) => onError?.(e),
    },
  );
}

/** Idempotent profile bootstrap — mirrors the PWA's
 *  `FirebaseService.ensureUserProfile`. The web app creates `users/{uid}` on
 *  first sign-in; a user who signs up FIRST on mobile never hits that path, so
 *  without this their onboarding save (`saveOnboardingV2` = an `updateDoc`)
 *  writes to a non-existent doc and fails with "Could not save." Call on every
 *  sign-in. No email is stored (PII minimization — email lives only in Auth). */
export async function ensureProfile(uid: string): Promise<void> {
  const ref = userDoc(uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    // Refresh `timezoneOffsetMin` here, not just on the weekly-digest toggle.
    // This runs from `onAuthStateChanged`, so it fires on every cold start —
    // which is what makes it SELF-HEALING for the users who opted into the
    // digest before mobile wrote a timezone at all. Their profiles carry no
    // offset, and the server reads a missing one as UTC, so their Sunday
    // 10:00 recap arrives at 06:00 in Puerto Rico. Fixing it only on the
    // toggle would have left every existing opt-in broken until they
    // happened to flip the switch twice. Travel and DST correct themselves
    // for free.
    //
    // Guarded on `profileCompleted` because `firestore.rules` validates the
    // profile with `keys().hasOnly([...])` and `timezoneOffsetMin` is on the
    // COMPLETED list only — adding it to a doc still in the initial shape
    // fails both validators and would reject this write, killing the
    // `lastSeenAt` touch for everyone mid-onboarding.
    const patch: Record<string, unknown> = { lastSeenAt: Timestamp.now() };
    if (snap.data()?.['profileCompleted'] === true) {
      patch['timezoneOffsetMin'] = new Date().getTimezoneOffset();
    }
    await updateDoc(ref, patch);
    return;
  }
  const now = Timestamp.now();
  await setDoc(ref, { createdAt: now, lastSeenAt: now, profileCompleted: false });
}

/** Persist the 2-question onboarding. The patch shape is single-sourced in
 *  `@macrolog/core` (`toOnboardingV2Patch`) and shared with the PWA, so the two
 *  apps cannot drift — writes the manual heuristic targets, stamps completion,
 *  flips `profileCompleted`, and clears `targetsRefinedAt`. The profile doc
 *  already exists (created at sign-up), so this is an update. */
export async function saveOnboardingV2(uid: string, s: OnboardingV2Submission): Promise<void> {
  await updateDoc(userDoc(uid), toOnboardingV2Patch(s, CODEC));
}

/** Move the profile onto maintenance in one write — the "and now hold it"
 *  the wizard otherwise makes a whole rerun of. Patch shape is single-sourced
 *  in `@macrolog/core` (`toMaintenanceSwitchPatch`), which also says why the
 *  seed is rewritten from `currentWeightLb`. */
export async function switchToMaintenance(
  uid: string,
  profile: Profile,
  currentWeightLb: number,
): Promise<void> {
  await updateDoc(userDoc(uid), toMaintenanceSwitchPatch(profile, currentWeightLb, CODEC));
}

/** Portion-display unit system (`us` | `metric`). */
export async function setUnitSystem(uid: string, unitSystem: UnitSystem): Promise<void> {
  await updateDoc(userDoc(uid), { unitSystem });
}

/**
 * Move the user's day boundary (ADR-0030), taking effect TODAY and never
 * before it.
 *
 * The write is the whole history, not the new hour, because a boundary is a
 * temporal setting: past days keep the rule they were logged under. Going
 * through `setDayStartHour` is what enforces that — it appends, refuses a
 * `from` that is not after every entry on file, and returns the list unchanged
 * when the hour is already in force, so this is safe to call from an onPress
 * without the screen having to work out whether anything changed.
 *
 * `current` is passed in rather than re-read: the caller already holds the
 * profile from the auth context, and a read-modify-write here would race the
 * snapshot that is about to deliver the same document.
 */
export async function setDayStartHour(
  uid: string,
  current: DayBoundary,
  hour: number,
  today: DateKey = dayKeyAt(new Date(), MIDNIGHT),
): Promise<void> {
  const next = coreSetDayStartHour(current, today, hour);
  if (next === current) return;
  await updateDoc(userDoc(uid), { dayBoundary: next.map((c) => ({ from: c.from, hour: c.hour })) });
}

/** Personal daily-calorie safety floor (kcal). The measured/formula TDEE
 *  target never drops below this (see packages/core tdee.ts clamp). Pass null
 *  to clear it (reverts the clamp to the 1500 default). */
export async function setCalorieFloor(uid: string, floor: number | null): Promise<void> {
  await updateDoc(userDoc(uid), { calorieFloor: floor == null ? deleteField() : floor });
}

/** Personal daily-protein safety floor (grams). Whichever protein target the
 *  chain produces — live g/kg, frozen manual snapshot, or the 1.6 g/kg default
 *  — is lifted to at least this (see packages/core targets.ts). Pass null to
 *  clear it; unlike the calorie floor there is no default, so cleared means no
 *  floor at all. */
export async function setProteinFloor(uid: string, floor: number | null): Promise<void> {
  await updateDoc(userDoc(uid), { proteinFloor: floor == null ? deleteField() : floor });
}

/** UI language (`en` | `es-PR`). Shared with the PWA's Transloco active lang
 *  + server-side email locale. */
export async function setPreferredLocale(uid: string, preferredLocale: string): Promise<void> {
  await updateDoc(userDoc(uid), { preferredLocale });
}

/** Expo push token for the silent OTA pre-download push (#114). Written by
 *  `registerPushToken` once per session; pass null to clear it (the field is
 *  deleted, matching the rules' "absent or string" shape). Client-writable in
 *  `firestore.rules` — the device is the only party that knows its own token. */
export async function setExpoPushToken(uid: string, token: string | null): Promise<void> {
  await updateDoc(userDoc(uid), { expoPushToken: token == null ? deleteField() : token });
}

/** Opt in/out of the Sunday weekly recap email (sent server-side by a CF).
 *  Off by default; `lastWeeklyDigestSentAt` is server-stamped, never written
 *  by the client.
 *
 *  Writes `timezoneOffsetMin` alongside — mirrors the PWA's
 *  `FirebaseService.setWeeklyDigestOptIn`. Without it the digest CF falls back
 *  to offset 0, so it fired at **10:00 UTC** for every mobile-only user (06:00
 *  in Puerto Rico, 03:00 on the US west coast) instead of their local Sunday
 *  morning. Nothing else in this app wrote the field, so mobile opt-ins had
 *  never carried a timezone at all. Refreshed on each toggle so travel and DST
 *  correct themselves. */
// ─── Milestones ─────────────────────────────────────────────────
// users/{uid}/milestones/{key} = { earnedAt }
//
// The KEY IS THE DOCUMENT ID, which is what makes the write idempotent: a
// repeat attempt addresses the same document rather than creating a second
// entry. `firestore.rules` then denies the update outright (`allow update: if
// false`), so the repeat FAILS — deliberately. That is the write-once
// guarantee, and it is why `recordMilestone` swallows its own rejection: a
// denial here is the normal outcome of a race, not an error worth surfacing.
//
// There is no `seenAt` field and no dismissal state. The Today row renders
// while `earnedAt` falls inside the current day and expires by itself, so
// "have we shown this yet" is answered by the clock instead of by a second
// write. See packages/core/src/milestones.ts for why the surface is shaped
// that way rather than as a badge wall.
const milestonesCol = (uid: string) => collection(db, 'users', uid, 'milestones');

export function subscribeMilestones(
  uid: string,
  cb: (earned: Record<string, Date>, meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    milestonesCol(uid),
    (snap) => {
      const earned: Record<string, Date> = {};
      for (const d of snap.docs) {
        const at = d.data()?.earnedAt;
        if (at instanceof Timestamp) earned[d.id] = at.toDate();
      }
      cb(earned, metaOf(snap));
    },
    onError,
  );
}

/**
 * Record a milestone. Idempotent, fire-and-forget, and **never batched with a
 * domain write.**
 *
 * That last point is the one with teeth. `breakFast` is a batch, and #97's fix
 * documents what a rejected member does to one: the whole commit fails. If a
 * milestone write were batched with the meal, workout or fast that earned it, a
 * rules rejection here would roll back the thing the user actually did. A
 * missed milestone is a non-event; a lost meal is a bug report.
 *
 * ## The return value, and why it is trustworthy
 *
 * `true` means this call is what created the document — a NEWLY earned
 * milestone — and that is sound only because `firestore.rules` has no `update`
 * rule for this collection: the key is the doc id and a second `setDoc` is
 * denied, not merged. So success cannot mean "overwrote the one from last
 * week". Callers use it to fire a one-time celebration (`recordPositiveMoment`)
 * without first reading the record back.
 *
 * `false` covers both "already on file" and "offline"; neither is an error and
 * neither is worth distinguishing here — the caller's fallback is to try again
 * next time, which every call site already does by construction.
 */
export async function recordMilestone(uid: string, key: string): Promise<boolean> {
  try {
    await setDoc(doc(milestonesCol(uid), key), { earnedAt: Timestamp.now() });
    return true;
  } catch {
    // Already recorded (rules deny the update), or offline. Both are fine.
    return false;
  }
}

/**
 * Has this account ever completed a fast? One `limit(1)` read.
 *
 * Callers gate this behind "the milestone is not already recorded", so an
 * account that has earned it never pays for the probe again.
 */
export async function hasAnyCompletedFast(uid: string): Promise<boolean> {
  const snap = await getDocs(query(fastsCol(uid), limit(1)));
  return !snap.empty;
}

/** Has this account ever finished a workout? Same gating rule as above. */
export async function hasAnyCompletedWorkout(uid: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'workoutSessions'),
      where('status', '==', 'completed'),
      limit(1),
    ),
  );
  return !snap.empty;
}

export async function setWeeklyDigestOptIn(uid: string, on: boolean): Promise<void> {
  await updateDoc(userDoc(uid), {
    weeklyDigestOptIn: on,
    timezoneOffsetMin: new Date().getTimezoneOffset(),
  });
}

/** Promote the 2-question onboarding to a full Mifflin–St Jeor TDEE. Mirrors
 *  FirebaseService.saveRefinedTargets: writes the profile fields, DELETES the
 *  manual heuristic targets so the TDEE chain falls through to formula mode,
 *  and stamps `targetsRefinedAt`. (proteinPerKg omitted in mobile v1 — leaves
 *  the 1.6 g/kg floor.) */
export async function saveRefinedTargets(uid: string, s: RefineTargetsSubmission): Promise<void> {
  const now = Timestamp.now();
  await updateDoc(userDoc(uid), {
    heightIn: s.heightIn,
    age: s.age,
    sex: s.sex,
    activityLevel: s.activityLevel,
    // The bucket stays the user's stated answer; the multiplier is what the
    // formula estimate actually uses (ADR-0024). `undefined` leaves whatever
    // is stored alone -- only an explicit number or null touches the field, so
    // a plain Refine save cannot silently drop a good multiplier.
    ...(s.activityMultiplier === undefined
      ? {}
      : { activityMultiplier: s.activityMultiplier === null ? deleteField() : s.activityMultiplier }),
    targetPaceLbsPerWeek: clampCutPace(s.targetPaceLbsPerWeek),
    // Refining is a request to be AUTOMATIC, so it sets the mode — it no
    // longer DELETES the manual numbers to get there. Deleting was the only
    // way to hand control back when presence-of-a-value was the mode, and it
    // threw away a number the user may have chosen on purpose: the one-way
    // door out of custom targets, with no route back except re-running
    // onboarding. The values now survive an automatic spell and return intact
    // when the user switches back (`Profile.targetMode`, packages/core).
    targetMode: 'auto',
    targetsRefinedAt: now,
    lastSeenAt: now,
  });
}

/** Switch between estimator-driven and user-typed targets, and store the
 *  numbers. Per-field: pass `null` for a value to hand THAT number back to
 *  the estimator while leaving the other one custom. Writing a value while
 *  `mode` is `'auto'` is legal and inert — it is how the editor keeps a
 *  number the user may want back without acting on it. */
export async function saveTargetMode(
  uid: string,
  mode: TargetMode,
  targets: { calories?: number | null; protein?: number | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { targetMode: mode, lastSeenAt: Timestamp.now() };
  if (targets.calories !== undefined) {
    patch['manualCaloriesTarget'] = targets.calories == null ? deleteField() : targets.calories;
  }
  if (targets.protein !== undefined) {
    patch['manualProteinTarget'] = targets.protein == null ? deleteField() : targets.protein;
  }
  await updateDoc(userDoc(uid), patch);
}

/** Append `hiddenRecentLabels` to the profile. Mirrors the PWA's
 *  `FirebaseService.hideRecentLabel` — the next array is computed by the
 *  caller (the hook holds the live profile) and written whole, so this
 *  stays a single field write the rules already permit. */
export async function setHiddenRecentLabels(uid: string, labels: string[]): Promise<void> {
  await updateDoc(userDoc(uid), { hiddenRecentLabels: labels });
}

// ─── Meal presets ───────────────────────────────────────────────
// users/{uid}/presets/{id} — quick-add templates. Shape mirrors the PWA
// FirestoreLedgerCore.addPreset (name + calories required; macros optional).
function toPreset(id: string, data: Record<string, unknown>): MealPreset {
  return {
    id,
    name: (data['name'] as string) ?? '',
    calories: (data['calories'] as number) ?? 0,
    protein: data['protein'] as number | undefined,
    carbs: data['carbs'] as number | undefined,
    fat: data['fat'] as number | undefined,
  };
}

export function subscribePresets(
  uid: string,
  cb: (presets: MealPreset[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    presetsCol(uid),
    (snap) => cb(snap.docs.map((d) => toPreset(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

export async function addPreset(uid: string, preset: Omit<MealPreset, 'id'>): Promise<string> {
  return createDoc(presetsCol(uid), toPresetDoc(preset));
}

export async function deletePreset(uid: string, id: string): Promise<void> {
  await deleteDoc(presetDoc(uid, id));
}

// ─── Custom foods (My Foods library, ADR-0013) ──────────────────
// users/{uid}/customFoods/{id} — a saved, portionable food. Shape + Date⇄
// Timestamp mapping mirror FirestoreLedgerCore.getCustomFoods/addCustomFood so
// both apps share the collection and pass the isValidCustomFood rule. Barcode-
// sourced foods upsert at the barcode doc id (caller passes it for de-dup);
// others auto-id.
const customFoodsCol = (uid: string) => collection(db, 'users', uid, 'customFoods');
const customFoodDoc = (uid: string, id: string) => doc(db, 'users', uid, 'customFoods', id);

export function subscribeCustomFoods(
  uid: string,
  cb: (foods: CustomFood[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    customFoodsCol(uid),
    (snap) => cb(snap.docs.map((d) => toCustomFood(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

export async function addCustomFood(
  uid: string,
  food: Omit<CustomFood, 'id'>,
  id?: string | null,
): Promise<string> {
  const data = toCustomFoodDoc(food, CODEC);
  if (id) {
    await setDoc(customFoodDoc(uid, id), data);
    return id;
  }
  return createDoc(customFoodsCol(uid), data);
}

export async function deleteCustomFood(uid: string, id: string): Promise<void> {
  await deleteDoc(customFoodDoc(uid, id));
}

// ─── Body measurements ──────────────────────────────────────────
// users/{uid}/measurements/{id} — { timestamp, waist?, chest?, bicep?,
// hip?, neck? } in inches. Shape mirrors FirestoreLedgerCore.addMeasurement.
/** Live-subscribe to the latest `count` measurement rows, newest-first. */
export function subscribeMeasurements(
  uid: string,
  count: number,
  cb: (measurements: Measurement[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(measurementsCol(uid), orderBy('timestamp', 'desc'), limit(count));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => toMeasurement(d.id, d.data()))), onError);
}

export async function addMeasurement(uid: string, entry: MeasurementInput): Promise<string> {
  return createDoc(measurementsCol(uid), toMeasurementDoc(entry, CODEC));
}

/** Edits an existing measurement in place. `toMeasurementPatch` keeps the
 *  original `timestamp` (the row must not jump to today) and deletes fields the
 *  user cleared, so an accidental waist entry can be removed rather than frozen
 *  into the body-fat estimate forever. Same writer the PWA uses. */
export async function updateMeasurement(
  uid: string,
  id: string,
  entry: MeasurementInput,
): Promise<void> {
  await updateDoc(measurementDoc(uid, id), toMeasurementPatch(entry, CODEC));
}

export async function deleteMeasurement(uid: string, id: string): Promise<void> {
  await deleteDoc(measurementDoc(uid, id));
}

// ─── Train tab (workouts, ADR-0007) ─────────────────────────────
// Three collections, shapes mirror FirestoreLedgerCore + the firestore.rules
// validators (isValidExercise / isValidWorkoutSession):
//   users/{uid}/exercises/{id}        — { name, muscles[], defaultCues[], logStyle?, createdAt }
//   users/{uid}/workoutSessions/{id}  — { status, timestamp, exercises[], …, createdAt, updatedAt }
//   users/{uid}/workoutTemplates/{id}  — { name, exercises[], …, createdAt, updatedAt }
// Firestore rejects `undefined`, so every write is run through
// pruneUndefined first.
const exercisesCol = (uid: string) => collection(db, 'users', uid, 'exercises');
const exerciseDoc = (uid: string, id: string) => doc(db, 'users', uid, 'exercises', id);
const sessionsCol = (uid: string) => collection(db, 'users', uid, 'workoutSessions');
const sessionDoc = (uid: string, id: string) => doc(db, 'users', uid, 'workoutSessions', id);
const templatesCol = (uid: string) => collection(db, 'users', uid, 'workoutTemplates');
const templateDoc = (uid: string, id: string) => doc(db, 'users', uid, 'workoutTemplates', id);

/** Recursively drop undefined-valued keys (Firestore rejects undefined).
 *  Delegates to the shared core pruner, binding this edge's SDK `Timestamp`
 *  as an opaque leaf (core guards `Date` built-in). Single-sourced with the
 *  PWA adapter — see @macrolog/core. */
function pruneUndefined<T>(value: T): T {
  return pruneUndefinedCore(value, (v) => v instanceof Timestamp);
}

// ── Exercise catalog ──
export function subscribeExercises(
  uid: string,
  cb: (exercises: Exercise[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(exercisesCol(uid), orderBy('name')),
    (snap) => cb(snap.docs.map((d) => toExercise(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

export async function addExercise(uid: string, draft: ExerciseDraft): Promise<string> {
  return createDoc(exercisesCol(uid), pruneUndefined(toExerciseDoc(draft, CODEC)));
}

export async function editExercise(
  uid: string,
  id: string,
  patch: Partial<ExerciseDraft>,
): Promise<void> {
  await updateDoc(exerciseDoc(uid, id), pruneUndefined({ ...patch }));
}

export async function deleteExercise(uid: string, id: string): Promise<void> {
  await deleteDoc(exerciseDoc(uid, id));
}

/** Merge catalog exercise `fromId` (victim) into `toId` (survivor): rewrite
 *  every session and template that references the victim to point at the
 *  survivor (snapshotting the survivor's name), then delete the victim doc.
 *  Mirrors FirestoreLedgerCore.mergeExercises — batched in BATCH_CHUNK ops. */
export async function mergeExercises(uid: string, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const survivor = await getDoc(exerciseDoc(uid, toId));
  const toName = survivor.data()?.['name'] as string | undefined;

  const remap = (arr: unknown): TemplateExercise[] | null => {
    let changed = false;
    const next = ((arr as TemplateExercise[]) ?? []).map((ex) => {
      if (ex.exerciseId === fromId) {
        changed = true;
        return { ...ex, exerciseId: toId, name: toName ?? ex.name };
      }
      return ex;
    });
    return changed ? next : null;
  };

  const [sessSnap, tplSnap] = await Promise.all([getDocs(sessionsCol(uid)), getDocs(templatesCol(uid))]);
  const ops: { ref: ReturnType<typeof doc>; exercises: TemplateExercise[] }[] = [];
  for (const d of [...sessSnap.docs, ...tplSnap.docs]) {
    const exercises = remap(d.data()['exercises']);
    if (exercises) ops.push({ ref: d.ref, exercises });
  }

  for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_CHUNK)) {
      batch.update(op.ref, pruneUndefined({ exercises: op.exercises, updatedAt: Timestamp.now() }));
    }
    await batch.commit();
  }
  await deleteDoc(exerciseDoc(uid, fromId));
}

// ── Templates ──
// users/{uid}/workoutTemplates/{id} — { name, notes?, restMiniSec?,
// restClusterSec?, exercises[], createdAt, updatedAt } (rules
// isValidWorkoutTemplate). Mirrors FirestoreLedgerCore add/update/delete.
export function subscribeTemplates(
  uid: string,
  cb: (templates: WorkoutTemplate[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(templatesCol(uid), orderBy('updatedAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => toTemplate(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

export async function addTemplate(uid: string, draft: TemplateDraft): Promise<string> {
  return createDoc(templatesCol(uid), pruneUndefined(toTemplateDoc(draft, CODEC)));
}

export async function updateTemplate(uid: string, id: string, draft: TemplateDraft): Promise<void> {
  // Full overwrite of mutable fields + bump updatedAt; createdAt untouched by
  // merge. A merge-update of `exercises` would union arrays, so the patch
  // carries the whole template doc.
  const data = pruneUndefined(toTemplatePatch(draft, CODEC));
  await setDoc(templateDoc(uid, id), data, { merge: true });
}

export async function deleteTemplate(uid: string, id: string): Promise<void> {
  await deleteDoc(templateDoc(uid, id));
}

// ── Sessions ──
// The domain calls it `date`; the stored field is `timestamp`. Both the
// create and the sparse live-update shapes come from @macrolog/core.

/** One-shot read of the in-progress session, if any (status == 'active'). */
export async function getActiveSession(uid: string): Promise<WorkoutSession | null> {
  const snap = await getDocs(query(sessionsCol(uid), where('status', '==', 'active'), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toSession(d.id, d.data());
}

export function subscribeRecentSessions(
  uid: string,
  count: number,
  cb: (sessions: WorkoutSession[], meta?: SnapshotMeta) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(sessionsCol(uid), orderBy('timestamp', 'desc'), limit(count)),
    (snap) => cb(snap.docs.map((d) => toSession(d.id, d.data())), metaOf(snap)),
    onError,
  );
}

/** One-shot read of the most recent `count` sessions, newest first. The
 *  import path needs a snapshot rather than a subscription: it runs on app
 *  foreground, merges into what it finds, and is done. */
export async function getRecentSessions(uid: string, count: number): Promise<WorkoutSession[]> {
  const snap = await getDocs(query(sessionsCol(uid), orderBy('timestamp', 'desc'), limit(count)));
  return snap.docs.map((d) => toSession(d.id, d.data()));
}

export async function startSession(uid: string, draft: SessionDraft): Promise<string> {
  return createDoc(sessionsCol(uid), pruneUndefined(toSessionDoc(draft, CODEC)));
}

export async function updateSession(
  uid: string,
  id: string,
  patch: Partial<SessionDraft>,
): Promise<void> {
  const data = pruneUndefined(toSessionPatch(patch, CODEC));
  await setDoc(sessionDoc(uid, id), data, { merge: true });
}

export async function deleteSession(uid: string, id: string): Promise<void> {
  await deleteDoc(sessionDoc(uid, id));
}

// ─── One-shot full reads (data export) ──────────────────────────
// Unwindowed getDocs reads that back the CSV export; the live app otherwise
// reads through the windowed subscriptions above.

export async function getAllLogs(uid: string): Promise<DailyLog[]> {
  const snap = await getDocs(query(logsCol(uid), orderBy('timestamp', 'asc')));
  return snap.docs.map((d) => toDailyLog(d.id, d.data()));
}

export async function getAllMeasurements(uid: string): Promise<Measurement[]> {
  const snap = await getDocs(query(measurementsCol(uid), orderBy('timestamp', 'asc')));
  return snap.docs.map((d) => toMeasurement(d.id, d.data()));
}

export async function getAllDailyWeights(uid: string): Promise<Record<string, number>> {
  const snap = await getDocs(weightsCol(uid));
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    const w = readWeightLb(d.data());
    if (w != null) out[d.id] = w;
  }
  return out;
}

export async function getAllDailyWater(uid: string): Promise<Record<string, number>> {
  const snap = await getDocs(waterCol(uid));
  const out: Record<string, number> = {};
  for (const d of snap.docs) out[d.id] = readWaterFlOz(d.data()) ?? 0;
  return out;
}

export async function getAllDailySleep(uid: string): Promise<Record<string, number>> {
  const snap = await getDocs(sleepCol(uid));
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    const h = readSleepHours(d.data());
    if (h != null) out[d.id] = h;
  }
  return out;
}

export async function getAllSessions(uid: string): Promise<WorkoutSession[]> {
  const snap = await getDocs(query(sessionsCol(uid), orderBy('timestamp', 'asc')));
  return snap.docs.map((d) => toSession(d.id, d.data()));
}

/** Stamp `date` as an exercise day (a 0-kcal DailyLog with
 *  `exerciseCompleted`) so the workout counts toward the streak — but only
 *  if no exercise-marked log already exists that day. Mirrors
 *  FitnessStore.markExercised.
 *
 *  The zero comes from `workoutMarkerEntry` rather than a literal, because
 *  this log IS an input to energy balance and therefore the one place an
 *  imported cardio calorie could reach a measured target. ADR-0026 decision 5;
 *  pinned by `cardio-energy-independence.test.ts`. */
export async function markExercised(
  uid: string,
  date: Date,
  boundary: DayBoundary = MIDNIGHT,
): Promise<void> {
  const key = dayKeyAt(date, boundary);
  const snap = await getDocs(query(logsCol(uid), orderBy('timestamp', 'desc'), limit(60)));
  const already = snap.docs.some((d) => {
    const data = d.data() as { timestamp?: Timestamp; exerciseCompleted?: boolean; liftCompleted?: boolean; cardioCompleted?: boolean };
    if (!data.timestamp) return false;
    const marked = data.exerciseCompleted || data.liftCompleted || data.cardioCompleted;
    return marked && dayKeyAt(data.timestamp.toDate(), boundary) === key;
  });
  if (already) return;
  await addLog(uid, { ...workoutMarkerEntry(), timestamp: date });
}

// ─── Consultation quota (read-only) ─────────────────────────────
// `consultationQuota/{uid}_{utcDay}` = { count }. The server owns the
// counter (admin SDK); `firestore.rules` allows a client to read only its
// OWN doc, keyed by the uid prefix.
//
// It exists so Coach can state the day's remaining consultations BEFORE one
// is spent — the count used to arrive only in a consultation's own response,
// which meant the allowance was unknowable until it was used. A missing doc
// means none used today, which is why absence reads as a full allowance
// rather than an error.
const CONSULTATION_LIMIT_FREE = 3;

/** UTC day key — must match `utcDayKey()` in `functions/src/daily-quota.ts`,
 *  which mints the doc id. UTC, not local: the quota resets at UTC midnight
 *  and a local-date key would look up the wrong doc for half the world. */
function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getConsultationQuota(
  uid: string,
): Promise<{ used: number; remaining: number; limit: number }> {
  const limit = CONSULTATION_LIMIT_FREE;
  const snap = await getDoc(doc(db, 'consultationQuota', `${uid}_${utcDayKey()}`));
  const used = snap.exists() ? ((snap.data() as { count?: number }).count ?? 0) : 0;
  return { used, remaining: Math.max(0, limit - used), limit };
}

// ─── Product analytics ────────────────────────────────────────────
// One doc per user per day of integer counts (`usage-events.ts` in
// @macrolog/core owns the catalogue; `firestore.rules` enforces it). The
// buffering, the flush cadence and every call site live in `analytics.ts` —
// this is only the write, kept here so the app has exactly one file that
// talks to Firestore.

/**
 * Merge a batch of counts into today's usage doc.
 *
 * `increment` rather than a read-modify-write: two devices on the same account
 * — a phone and the PWA — would otherwise clobber each other's totals, and the
 * increment is resolved server-side so neither has to know about the other. The
 * doc is created by the same call when it does not exist, which is why `merge`
 * carries the identity fields too.
 *
 * Fire-and-forget by contract. A failed analytics write must never surface to a
 * user or fail the action that produced it.
 */
export async function recordUsage(
  uid: string,
  dayKey: string,
  platform: UsagePlatform,
  counts: UsageCounts,
): Promise<void> {
  const clamped = clampUsageCounts(counts);
  if (!hasUsageCounts(clamped)) return;
  const increments: Record<string, unknown> = {};
  for (const [event, n] of Object.entries(clamped)) increments[event] = fsIncrement(n as number);
  await setDoc(
    doc(db, 'usageEvents', usageDocId(uid, dayKey)),
    { uid, day: dayKey, platform, updatedAt: serverTimestamp(), ...increments },
    { merge: true },
  );
}
