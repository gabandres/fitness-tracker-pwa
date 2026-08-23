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
  localDateKey,
  oldestFirst,
  pruneUndefined as pruneUndefinedCore,
  readActivity,
  readSleepHours,
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
  toOnboardingV2Patch,
  toPresetDoc,
  toSessionDoc,
  toSessionPatch,
  toTemplateDoc,
  toTemplatePatch,
  toWeeklyReport,
  withDefaultMealSlot,
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

export async function setDailySleep(uid: string, dateKey: string, hours: number): Promise<void> {
  await setDoc(sleepDoc(uid, dateKey), { hours: clampSleepHours(hours) });
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

export async function breakFast(uid: string): Promise<void> {
  await updateDoc(userDoc(uid), { fastStartedAt: null, lastSeenAt: Timestamp.now() });
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

/** Portion-display unit system (`us` | `metric`). */
export async function setUnitSystem(uid: string, unitSystem: UnitSystem): Promise<void> {
  await updateDoc(userDoc(uid), { unitSystem });
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
 *  FitnessStore.markExercised. */
export async function markExercised(uid: string, date: Date): Promise<void> {
  const key = localDateKey(date);
  const snap = await getDocs(query(logsCol(uid), orderBy('timestamp', 'desc'), limit(60)));
  const already = snap.docs.some((d) => {
    const data = d.data() as { timestamp?: Timestamp; exerciseCompleted?: boolean; liftCompleted?: boolean; cardioCompleted?: boolean };
    if (!data.timestamp) return false;
    const marked = data.exerciseCompleted || data.liftCompleted || data.cardioCompleted;
    return marked && localDateKey(data.timestamp.toDate()) === key;
  });
  if (already) return;
  await addLog(uid, { calories: 0, exerciseCompleted: true, timestamp: date });
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
