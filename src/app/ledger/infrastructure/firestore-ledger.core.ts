// IMPORTANT: these imports MUST come from '@angular/fire/firestore' in
// the app bundle — the injected `Firestore` instance is created through
// @angular/fire, and mixing it with functions from a second bundled copy
// of the SDK throws "Expected first argument to doc() to be …" at
// runtime. The node emulator suite (vitest.ledger.config.ts) aliases
// this specifier back to plain 'firebase/firestore' so no Angular code
// is pulled into the framework-free test process.
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  increment,
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  deleteField,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import type {
  CustomFood,
  DailyLog,
  ExerciseDoc,
  LogEntry,
  MealPreset,
  Measurement,
  UserProfileDoc,
  WeeklyReport,
  WorkoutSessionDoc,
  WorkoutTemplateDoc,
} from '../../services/firebase.service';
import type {
  Exercise,
  ExerciseDraft,
  SessionDraft,
  TemplateDraft,
  WorkoutSession,
  WorkoutTemplate,
} from '../../models/workout';
import {
  type UsageCounts,
  clampUsageCounts,
  hasUsageCounts,
  normalizeClusterGroups,
  usageDocId,
} from '@macrolog/core';
import { pruneUndefined as pruneUndefinedCore } from '@macrolog/core/prune-undefined';
import {
  BATCH_CHUNK,
  clampSleepHours,
  clampWaterFlOz,
  oldestFirst,
  readSleepHours,
  readWaterFlOz,
  readWeightLb,
  toCustomFood,
  toCustomFoodDoc,
  toDailyLog,
  toExerciseDoc,
  toLogDoc,
  toLogPatch,
  toMeasurement,
  toMeasurementDoc,
  toMeasurementPatch,
  toPresetDoc,
  toSessionDoc,
  toSessionPatch,
  toTemplateDoc,
  toTemplatePatch,
  toWeeklyReport,
  toWorkoutExercise,
  toWorkoutTemplate,
  toWorkoutSession,
  type DocCodec,
} from '@macrolog/core';

/** The two SDK values the shared writers can't construct themselves, bound to
 *  this edge's Firestore SDK once (see `@macrolog/core/firestore-writers`).
 *  The Expo adapter binds the identical pair against its own SDK copy. */
export const CODEC: DocCodec<Timestamp> = {
  timestamp: (d) => Timestamp.fromDate(d),
  remove: () => deleteField(),
};

/**
 * Framework-free Firestore I/O core for the ledger adapter (issue #6
 * phase 3). `new`-able without Angular DI — the constructor takes a raw
 * `Firestore` handle and a uid thunk — so the SAME class runs in prod
 * (behind `FirebaseService`, which keeps the signals + auth wiring) and
 * under the Firestore emulator in `npm run test:ledger`.
 *
 * Imports come from `firebase/firestore`, never `@angular/fire/*`, so
 * the emulator suite can construct it in a plain node process.
 *
 * Owns every collection verb: profile-doc primitives, dailyLogs,
 * dailyWeights, dailyWater, presets, reports, measurements, and the
 * three workout collections — query shapes, Timestamp ↔ Date mapping,
 * `deleteField` semantics, and batch chunking all live here.
 */
export class FirestoreLedgerCore {
  constructor(
    private readonly firestore: Firestore,
    private readonly uid: () => string,
  ) {}

  private userDoc() {
    return doc(this.firestore, 'users', this.uid());
  }

  private userCollection(name: string) {
    return collection(this.firestore, 'users', this.uid(), name);
  }

  private userDocIn(collectionName: string, id: string) {
    return doc(this.firestore, 'users', this.uid(), collectionName, id);
  }

  /**
   * Create a doc with a client-minted id — the idempotent replacement for
   * `addDoc`, and the only way creates are made in this adapter.
   *
   * `addDoc` reads like "setDoc with a random id", but it attaches a
   * `Precondition.exists(false)` to the mutation. If the Write stream drops
   * *after* the server committed but *before* the ack arrives, the SDK replays
   * the same mutation against the same id, the precondition now fails, and the
   * write rejects with `already-exists` — a create the user watched succeed,
   * reported as a failure. `setDoc` carries no precondition, so the replay is a
   * harmless overwrite of identical bytes.
   *
   * Found on mobile (Sentry IGNIA-MOBILE-6, Android vc 13, breadcrumb
   * `WebChannelConnection RPC 'Write' stream … transport errored` immediately
   * before the throw). The web adapter had the identical latent race, so it is
   * fixed here too rather than twice-diagnosed later — `createDoc` in
   * `apps/mobile/src/lib/ledger.ts` is the mirror. `importLogs` already used
   * this shape via `batch.set(doc(coll), …)`.
   */
  private async createIn(collectionName: string, data: object): Promise<string> {
    const ref = doc(this.userCollection(collectionName));
    await setDoc(ref, data as Record<string, unknown>);
    return ref.id;
  }

  /** Hard ceiling per Firestore call. The Firestore SDK retries 504s
   *  internally without ever rejecting → app-shell loader hangs forever.
   *  Surfacing a timeout lets the caller put up a retry UI. */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
  }

  // ─── Profile doc primitives ────────────────────────────────────

  /** Read the stored profile doc, or null when none exists yet. */
  async readProfileDoc(): Promise<UserProfileDoc | null> {
    const snap = await this.withTimeout(getDoc(this.userDoc()), 15_000, 'profile-read');
    return snap.exists() ? (snap.data() as UserProfileDoc) : null;
  }

  /** Create the profile doc (first sign-in). */
  async createProfileDoc(initial: UserProfileDoc): Promise<void> {
    await this.withTimeout(setDoc(this.userDoc(), initial), 15_000, 'profile-create');
  }

  /** Apply a partial update to the profile doc. The patch carries
   *  Firestore types (`Timestamp`, `deleteField()` sentinels) — the
   *  caller maps to domain `Date` for its optimistic signal via
   *  `toDomainProfilePatch`. */
  async updateProfileDoc(patch: Partial<UserProfileDoc> | Record<string, unknown>): Promise<void> {
    await updateDoc(this.userDoc(), patch as Record<string, unknown>);
  }

  // ─── Daily logs ────────────────────────────────────────────────

  /**
   * Add one log row.
   *
   * **No meal-slot default here, and that asymmetry with the Expo ledger is
   * deliberate.** The web already defaults the slot one layer up, in the entry
   * form (`EntryFormManager` → `defaultMealTypeForHour`), which pre-selects a
   * chip the user can then *deselect* to mean "this meal has no slot". That
   * intent is erased before it reaches here — `parseMealDraft` drops a null
   * `mealType` rather than forwarding it — so a write-path default cannot tell
   * "the caller forgot" from "the user said no", and applying one silently
   * overrode every deliberate deselection. Measured in a browser against the
   * emulator on 2026-08-10: deselecting the chip at 11:36 still wrote
   * `mealType: 'lunch'`.
   *
   * Mobile has no such affordance — its chips start unset and it has defaulted
   * at the write since the slot feature shipped — so `withDefaultMealSlot`
   * stays in the Expo ledger, where it is what makes History match Today.
   */
  async addLog(entry: LogEntry): Promise<string> {
    return this.createIn('dailyLogs', toLogDoc(entry, CODEC));
  }

  /** Latest `count` rows, returned OLDEST-FIRST (the underlying query is
   *  desc-ordered; the seam contract reverses — see CONTEXT.md
   *  "Log array order"). Timestamp → Date happens here. */
  async getRecentLogs(count = 14): Promise<DailyLog[]> {
    const q = query(this.userCollection('dailyLogs'), orderBy('timestamp', 'desc'), limit(count));
    const snap = await getDocs(q);
    return oldestFirst(snap.docs.map((d) => toDailyLog(d.id, d.data())));
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    await updateDoc(this.userDocIn('dailyLogs', logId), toLogPatch(entry, CODEC));
  }

  async deleteLog(logId: string): Promise<void> {
    await deleteDoc(this.userDocIn('dailyLogs', logId));
  }

  /**
   * Bulk-create log rows (switcher import). Batched in ≤`BATCH_CHUNK`-write
   * chunks to stay under Firestore's 500-op limit, same pattern as
   * mergeExercises. Rows are serialized by the same `toLogDoc` addLog uses, so
   * an imported row and a typed one cannot differ. Returns the number of rows
   * written. NOT atomic across chunks — a mid-import failure leaves earlier
   * chunks committed (caller surfaces the count).
   */
  async importLogs(entries: readonly LogEntry[]): Promise<number> {
    const coll = this.userCollection('dailyLogs');
    let written = 0;
    for (let i = 0; i < entries.length; i += BATCH_CHUNK) {
      const batch = writeBatch(this.firestore);
      const chunk = entries.slice(i, i + BATCH_CHUNK);
      for (const entry of chunk) batch.set(doc(coll), toLogDoc(entry, CODEC));
      await batch.commit();
      written += chunk.length;
    }
    return written;
  }

  // ─── Daily weights ────────────────────────────────────────────

  /** All daily weights as a map of dateKey → weight (lb). */
  async getDailyWeights(): Promise<Record<string, number>> {
    const snap = await getDocs(this.userCollection('dailyWeights'));
    const weights: Record<string, number> = {};
    for (const d of snap.docs) {
      const w = readWeightLb(d.data());
      if (w != null) weights[d.id] = w;
    }
    return weights;
  }

  /** Set (or overwrite) the weight for a specific day. Doc ID = dateKey. */
  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    await setDoc(this.userDocIn('dailyWeights', dateKey), { weight });
  }

  // ─── Daily water ──────────────────────────────────────────────
  // Stored in US fluid ounces (single source of truth — the app is
  // imperial throughout). One doc per date keyed by the dateKey, shape
  // { flOz }. Clamped at 676 fl oz (~5 gal, mirrored in rules) to catch
  // fat-finger entries that would otherwise pollute charts.
  //
  // Legacy docs stored { ml } before the 2026-06 unit migration; the shared
  // reader falls back to converting ml→fl oz so any doc the migration hasn't
  // rewritten yet still renders correctly (`@macrolog/core/daily-scalars` —
  // the Expo ledger reads the same docs through the same function).

  async getDailyWater(): Promise<Record<string, number>> {
    const snap = await getDocs(this.userCollection('dailyWater'));
    const water: Record<string, number> = {};
    for (const d of snap.docs) water[d.id] = readWaterFlOz(d.data()) ?? 0;
    return water;
  }

  async setDailyWater(dateKey: string, flOz: number): Promise<void> {
    await setDoc(this.userDocIn('dailyWater', dateKey), { flOz: clampWaterFlOz(flOz) });
  }

  // ─── Daily sleep ──────────────────────────────────────────────
  // Hours slept, one doc per date keyed by the dateKey, shape { hours }.
  // Canonical daily record; the Train session sheet's per-workout sleep
  // mirrors into here on finish (same as bodyweight → dailyWeights), so a
  // non-workout day can still log sleep. Clamped to [0, 24], half-hour steps.

  async getDailySleep(): Promise<Record<string, number>> {
    const snap = await getDocs(this.userCollection('dailySleep'));
    const sleep: Record<string, number> = {};
    for (const d of snap.docs) {
      const h = readSleepHours(d.data());
      if (h != null) sleep[d.id] = h;
    }
    return sleep;
  }

  async setDailySleep(dateKey: string, hours: number): Promise<void> {
    await setDoc(this.userDocIn('dailySleep', dateKey), { hours: clampSleepHours(hours) });
  }

  // ─── Meal presets ─────────────────────────────────────────────

  async getPresets(): Promise<MealPreset[]> {
    const snap = await getDocs(this.userCollection('presets'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MealPreset));
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<string> {
    return this.createIn('presets', toPresetDoc(preset));
  }

  async deletePreset(presetId: string): Promise<void> {
    await deleteDoc(this.userDocIn('presets', presetId));
  }

  // ─── Custom foods (My Foods library, ADR-0013) ────────────────

  async getCustomFoods(): Promise<CustomFood[]> {
    const snap = await getDocs(this.userCollection('customFoods'));
    return snap.docs.map((d) => toCustomFood(d.id, d.data()));
  }

  /** Save a food. When `id` (the barcode for scanned foods) is provided the
   *  write is a deterministic upsert at that id (de-dup + re-scan match);
   *  omit it for an auto-id. `createdAt` maps Date → Timestamp at the seam. */
  async addCustomFood(food: Omit<CustomFood, 'id'>, id?: string | null): Promise<string> {
    const data = toCustomFoodDoc(food, CODEC);
    if (id) {
      await setDoc(this.userDocIn('customFoods', id), data);
      return id;
    }
    return this.createIn('customFoods', data);
  }

  async deleteCustomFood(foodId: string): Promise<void> {
    await deleteDoc(this.userDocIn('customFoods', foodId));
  }

  // ─── Weekly reports ───────────────────────────────────────────
  // New report docs are written by the `generateWeeklyReport` Cloud
  // Function via the admin SDK. Client writes are blocked by rules.

  async getLatestReport(): Promise<WeeklyReport | null> {
    const q = query(this.userCollection('reports'), orderBy('generatedAt', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return toWeeklyReport(d.id, d.data());
  }

  // ─── Body measurements ────────────────────────────────────────

  async getRecentMeasurements(count = 10): Promise<Measurement[]> {
    const q = query(this.userCollection('measurements'), orderBy('timestamp', 'desc'), limit(count));
    const snap = await getDocs(q);
    return snap.docs.map((d) => toMeasurement(d.id, d.data()));
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<string> {
    return this.createIn('measurements', toMeasurementDoc(entry, CODEC));
  }

  async updateMeasurement(id: string, entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    // The patch leaves `timestamp` alone so the row keeps its original date.
    await updateDoc(this.userDocIn('measurements', id), toMeasurementPatch(entry, CODEC));
  }

  async deleteMeasurement(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('measurements', id));
  }

  // ─── Workout: exercise catalog ────────────────────────────────

  async getExercises(): Promise<Exercise[]> {
    const snap = await getDocs(query(this.userCollection('exercises'), orderBy('name')));
    return snap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
  }

  async addExercise(exercise: ExerciseDraft): Promise<string> {
    return this.createIn('exercises', pruneUndefined(toExerciseDoc(exercise, CODEC)));
  }

  async updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void> {
    await updateDoc(this.userDocIn('exercises', id), pruneUndefined({ ...patch }));
  }

  async deleteExercise(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('exercises', id));
  }

  /**
   * Merge exercise `fromId` into `toId`: rewrite every session and template
   * that references the victim so it points at the survivor (and adopts the
   * survivor's display name), then delete the victim catalog doc. Writes are
   * chunked into ≤`BATCH_CHUNK`-op batches to stay under Firestore's 500-write
   * limit.
   */
  async mergeExercises(fromId: string, toId: string): Promise<void> {
    if (fromId === toId) return;
    const toSnap = await getDoc(this.userDocIn('exercises', toId));
    const toName = (toSnap.data() as ExerciseDoc | undefined)?.name;

    const remap = <T extends { exercises?: { exerciseId: string; name: string }[] }>(data: T) => {
      let changed = false;
      const exercises = (data.exercises ?? []).map((ex) =>
        ex.exerciseId === fromId
          ? ((changed = true), { ...ex, exerciseId: toId, name: toName ?? ex.name })
          : ex,
      );
      return changed ? exercises : null;
    };

    const ops: { ref: ReturnType<typeof doc>; exercises: unknown[] }[] = [];
    const [sessSnap, tplSnap] = await Promise.all([
      getDocs(this.userCollection('workoutSessions')),
      getDocs(this.userCollection('workoutTemplates')),
    ]);
    sessSnap.forEach((d) => {
      const next = remap(d.data() as WorkoutSessionDoc);
      if (next) ops.push({ ref: d.ref, exercises: next });
    });
    tplSnap.forEach((d) => {
      const next = remap(d.data() as WorkoutTemplateDoc);
      if (next) ops.push({ ref: d.ref, exercises: next });
    });

    for (let i = 0; i < ops.length; i += BATCH_CHUNK) {
      const batch = writeBatch(this.firestore);
      for (const op of ops.slice(i, i + BATCH_CHUNK)) {
        batch.update(op.ref, pruneUndefined({ exercises: op.exercises, updatedAt: Timestamp.now() }));
      }
      await batch.commit();
    }

    await deleteDoc(this.userDocIn('exercises', fromId));
  }

  // ─── Workout: templates ───────────────────────────────────────

  async getTemplates(): Promise<WorkoutTemplate[]> {
    const snap = await getDocs(query(this.userCollection('workoutTemplates'), orderBy('updatedAt', 'desc')));
    return snap.docs.map((d) => toDomainTemplate(d.id, d.data() as WorkoutTemplateDoc));
  }

  async addTemplate(template: TemplateDraft): Promise<string> {
    return this.createIn('workoutTemplates', pruneUndefined(toTemplateDoc(template, CODEC)));
  }

  async updateTemplate(id: string, template: TemplateDraft): Promise<void> {
    // Full overwrite of mutable fields + bump updatedAt; createdAt left
    // untouched by merge.
    const data = pruneUndefined(toTemplatePatch(template, CODEC));
    await setDoc(this.userDocIn('workoutTemplates', id), data, { merge: true });
  }

  async deleteTemplate(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('workoutTemplates', id));
  }

  // ─── Workout: sessions ────────────────────────────────────────

  async getActiveSession(): Promise<WorkoutSession | null> {
    const q = query(this.userCollection('workoutSessions'), where('status', '==', 'active'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return toDomainSession(d.id, d.data() as WorkoutSessionDoc);
  }

  async getRecentSessions(count = 30): Promise<WorkoutSession[]> {
    const q = query(this.userCollection('workoutSessions'), orderBy('timestamp', 'desc'), limit(count));
    const snap = await getDocs(q);
    return snap.docs.map((d) => toDomainSession(d.id, d.data() as WorkoutSessionDoc));
  }

  async getSessionsForTemplate(templateId: string, count = 10): Promise<WorkoutSession[]> {
    const q = query(
      this.userCollection('workoutSessions'),
      where('templateId', '==', templateId),
      where('status', '==', 'completed'),
      orderBy('timestamp', 'desc'),
      limit(count),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => toDomainSession(d.id, d.data() as WorkoutSessionDoc));
  }

  async getAllSessions(): Promise<WorkoutSession[]> {
    const q = query(this.userCollection('workoutSessions'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => toDomainSession(d.id, d.data() as WorkoutSessionDoc));
  }

  async startSession(session: SessionDraft): Promise<string> {
    return this.createIn('workoutSessions', pruneUndefined(toSessionDoc(session, CODEC)));
  }

  async updateSession(id: string, patch: Partial<SessionDraft>): Promise<void> {
    const data = pruneUndefined(toSessionPatch(patch, CODEC));
    await setDoc(this.userDocIn('workoutSessions', id), data, { merge: true });
  }

  async deleteSession(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('workoutSessions', id));
  }

  // ─── Product analytics ──────────────────────────────────────
  /**
   * Merge usage counts into `usageEvents/{uid}_{dayKey}`.
   *
   * The one write in this class that is not under `users/{uid}`: the
   * collection is top-level so retention can be answered with a single query
   * instead of a collection-group scan. `increment` rather than
   * read-modify-write — the same account can be open in this tab and on a
   * phone, and a lost update there is a silently wrong number nobody would
   * ever notice.
   *
   * Mirrors `recordUsage` in the Expo adapter byte for byte, same as every
   * other doc both apps write.
   */
  async recordUsage(dayKey: string, counts: UsageCounts): Promise<void> {
    const clamped = clampUsageCounts(counts);
    if (!hasUsageCounts(clamped)) return;
    const increments: Record<string, unknown> = {};
    for (const [event, n] of Object.entries(clamped)) increments[event] = increment(n as number);
    await setDoc(
      doc(this.firestore, 'usageEvents', usageDocId(this.uid(), dayKey)),
      { uid: this.uid(), day: dayKey, platform: 'web', updatedAt: serverTimestamp(), ...increments },
      { merge: true },
    );
  }
}

// ─── Workout mappers (Timestamp ↔ Date at the seam) ─────────────
// Shared field-copy + Timestamp→Date lives in @macrolog/core's
// toWorkoutTemplate / toWorkoutSession (arch review E). The web adapter alone
// additionally runs normalizeClusterGroups (mobile does not — the historical
// asymmetry), so it applies that as a post-step here rather than in the shared
// mapper.
function toDomainTemplate(id: string, data: WorkoutTemplateDoc): WorkoutTemplate {
  const t = toWorkoutTemplate(id, data as unknown as Record<string, unknown>);
  return {
    ...t,
    exercises: t.exercises.map((ex) => ({
      ...ex,
      plannedSets: normalizeClusterGroups(ex.plannedSets),
    })),
  };
}

function toDomainSession(id: string, data: WorkoutSessionDoc): WorkoutSession {
  const s = toWorkoutSession(id, data as unknown as Record<string, unknown>);
  return {
    ...s,
    exercises: s.exercises.map((ex) => ({
      ...ex,
      sets: normalizeClusterGroups(ex.sets),
    })),
  };
}

/** Firestore rejects `undefined` (no `ignoreUndefinedProperties` set on
 *  this app's Firestore instance). Delegates to the shared core pruner,
 *  binding this edge's SDK `Timestamp` as an opaque leaf (core guards `Date`
 *  built-in). Single-sourced with the Expo adapter — see @macrolog/core. */
function pruneUndefined<T>(value: T): T {
  return pruneUndefinedCore(value, (v) => v instanceof Timestamp);
}
