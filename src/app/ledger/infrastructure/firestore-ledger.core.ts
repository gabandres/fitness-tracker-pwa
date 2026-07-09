// IMPORTANT: these imports MUST come from '@angular/fire/firestore' in
// the app bundle — the injected `Firestore` instance is created through
// @angular/fire, and mixing it with functions from a second bundled copy
// of the SDK throws "Expected first argument to doc() to be …" at
// runtime. The node emulator suite (vitest.ledger.config.ts) aliases
// this specifier back to plain 'firebase/firestore' so no Angular code
// is pulled into the framework-free test process.
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
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
  SessionExercise,
  TemplateDraft,
  TemplateExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '../../models/workout';
import { normalizeClusterGroups } from '../../utils/cluster-groups';
import { pruneUndefined as pruneUndefinedCore } from '@macrolog/core/prune-undefined';
import {
  oldestFirst,
  toCustomFood,
  toDailyLog,
  toMeasurement,
  toWeeklyReport,
} from '@macrolog/core';

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

  async addLog(entry: LogEntry): Promise<string> {
    const data: Record<string, unknown> = {
      calories: entry.calories,
      timestamp: Timestamp.fromDate(entry.timestamp ?? new Date()),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.carbs != null) data['carbs'] = entry.carbs;
    if (entry.fat != null) data['fat'] = entry.fat;
    if (entry.exerciseCompleted) data['exerciseCompleted'] = true;
    if (entry.mealLabel) data['mealLabel'] = entry.mealLabel;
    if (entry.mealType) data['mealType'] = entry.mealType;
    const ref = await addDoc(this.userCollection('dailyLogs'), data);
    return ref.id;
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
    const data: Record<string, unknown> = {
      calories: entry.calories,
      protein: entry.protein != null ? entry.protein : deleteField(),
      carbs: entry.carbs != null ? entry.carbs : deleteField(),
      fat: entry.fat != null ? entry.fat : deleteField(),
      exerciseCompleted: entry.exerciseCompleted ? true : deleteField(),
      // Migrate away from legacy fields on every edit.
      liftCompleted: deleteField(),
      cardioCompleted: deleteField(),
      mealLabel: entry.mealLabel ? entry.mealLabel : deleteField(),
      mealType: entry.mealType ? entry.mealType : deleteField(),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.timestamp != null) data['timestamp'] = Timestamp.fromDate(entry.timestamp);
    await updateDoc(this.userDocIn('dailyLogs', logId), data);
  }

  async deleteLog(logId: string): Promise<void> {
    await deleteDoc(this.userDocIn('dailyLogs', logId));
  }

  /**
   * Bulk-create log rows (switcher import). Batched in ≤450-write chunks
   * to stay under Firestore's 500-op limit, same pattern as
   * mergeExercises. Field semantics mirror addLog exactly. Returns the
   * number of rows written. NOT atomic across chunks — a mid-import
   * failure leaves earlier chunks committed (caller surfaces the count).
   */
  async importLogs(entries: readonly LogEntry[]): Promise<number> {
    const coll = this.userCollection('dailyLogs');
    let written = 0;
    for (let i = 0; i < entries.length; i += 450) {
      const batch = writeBatch(this.firestore);
      const chunk = entries.slice(i, i + 450);
      for (const entry of chunk) {
        const data: Record<string, unknown> = {
          calories: entry.calories,
          timestamp: Timestamp.fromDate(entry.timestamp ?? new Date()),
        };
        if (entry.weight != null) data['weight'] = entry.weight;
        if (entry.protein != null) data['protein'] = entry.protein;
        if (entry.carbs != null) data['carbs'] = entry.carbs;
        if (entry.fat != null) data['fat'] = entry.fat;
        if (entry.exerciseCompleted) data['exerciseCompleted'] = true;
        if (entry.mealLabel) data['mealLabel'] = entry.mealLabel;
        if (entry.mealType) data['mealType'] = entry.mealType;
        batch.set(doc(coll), data);
      }
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
      const data = d.data() as { weight: number };
      weights[d.id] = data.weight;
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
  // Legacy docs stored { ml } before the 2026-06 unit migration; reads
  // fall back to converting ml→fl oz (1 fl oz = 29.5735 ml) so any doc
  // the migration hasn't rewritten yet still renders correctly.

  async getDailyWater(): Promise<Record<string, number>> {
    const snap = await getDocs(this.userCollection('dailyWater'));
    const water: Record<string, number> = {};
    for (const d of snap.docs) {
      const data = d.data() as { flOz?: number; ml?: number };
      water[d.id] = typeof data.flOz === 'number'
        ? data.flOz
        : typeof data.ml === 'number'
          ? Math.round(data.ml / 29.5735)
          : 0;
    }
    return water;
  }

  async setDailyWater(dateKey: string, flOz: number): Promise<void> {
    await setDoc(this.userDocIn('dailyWater', dateKey), {
      flOz: Math.max(0, Math.min(676, Math.round(flOz))),
    });
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
      const data = d.data() as { hours?: number };
      if (typeof data.hours === 'number') sleep[d.id] = data.hours;
    }
    return sleep;
  }

  async setDailySleep(dateKey: string, hours: number): Promise<void> {
    await setDoc(this.userDocIn('dailySleep', dateKey), {
      hours: Math.max(0, Math.min(24, Math.round(hours * 2) / 2)),
    });
  }

  // ─── Meal presets ─────────────────────────────────────────────

  async getPresets(): Promise<MealPreset[]> {
    const snap = await getDocs(this.userCollection('presets'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MealPreset));
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<string> {
    const data: Record<string, unknown> = {
      name: preset.name,
      calories: preset.calories,
    };
    if (preset.protein != null) data['protein'] = preset.protein;
    if (preset.carbs != null) data['carbs'] = preset.carbs;
    if (preset.fat != null) data['fat'] = preset.fat;
    const ref = await addDoc(this.userCollection('presets'), data);
    return ref.id;
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
    const data: Record<string, unknown> = {
      name: food.name,
      servingSize: food.servingSize,
      servingUnit: food.servingUnit,
      calories: food.calories,
      source: food.source,
      createdAt: Timestamp.fromDate(food.createdAt),
    };
    if (food.brand != null) data['brand'] = food.brand;
    if (food.barcode != null) data['barcode'] = food.barcode;
    if (food.protein != null) data['protein'] = food.protein;
    if (food.carbs != null) data['carbs'] = food.carbs;
    if (food.fat != null) data['fat'] = food.fat;
    if (id) {
      await setDoc(this.userDocIn('customFoods', id), data);
      return id;
    }
    const ref = await addDoc(this.userCollection('customFoods'), data);
    return ref.id;
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
    const data: Record<string, unknown> = { timestamp: Timestamp.now() };
    if (entry.waist != null) data['waist'] = entry.waist;
    if (entry.chest != null) data['chest'] = entry.chest;
    if (entry.bicep != null) data['bicep'] = entry.bicep;
    if (entry.hip != null) data['hip'] = entry.hip;
    if (entry.neck != null) data['neck'] = entry.neck;
    const ref = await addDoc(this.userCollection('measurements'), data);
    return ref.id;
  }

  async updateMeasurement(id: string, entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    // Leave `timestamp` untouched so the row keeps its original date; set
    // provided fields and remove any the caller cleared.
    await updateDoc(this.userDocIn('measurements', id), {
      waist: entry.waist != null ? entry.waist : deleteField(),
      chest: entry.chest != null ? entry.chest : deleteField(),
      bicep: entry.bicep != null ? entry.bicep : deleteField(),
      hip: entry.hip != null ? entry.hip : deleteField(),
      neck: entry.neck != null ? entry.neck : deleteField(),
    });
  }

  async deleteMeasurement(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('measurements', id));
  }

  // ─── Workout: exercise catalog ────────────────────────────────

  async getExercises(): Promise<Exercise[]> {
    const snap = await getDocs(query(this.userCollection('exercises'), orderBy('name')));
    return snap.docs.map((d) => {
      const data = d.data() as ExerciseDoc;
      return {
        id: d.id,
        name: data.name,
        muscles: (data.muscles ?? []) as Exercise['muscles'],
        defaultCues: data.defaultCues ?? [],
        logStyle: data.logStyle,
        seedKey: data.seedKey,
        createdAt: data.createdAt.toDate(),
      };
    });
  }

  async addExercise(exercise: ExerciseDraft): Promise<string> {
    const data: ExerciseDoc = {
      name: exercise.name,
      muscles: exercise.muscles ?? [],
      defaultCues: exercise.defaultCues ?? [],
      logStyle: exercise.logStyle,
      seedKey: exercise.seedKey,
      createdAt: Timestamp.now(),
    };
    const ref = await addDoc(this.userCollection('exercises'), pruneUndefined(data));
    return ref.id;
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
   * chunked into ≤450-op batches to stay under Firestore's 500-write limit.
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

    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(this.firestore);
      for (const op of ops.slice(i, i + 450)) {
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
    const now = Timestamp.now();
    const data = pruneUndefined({
      name: template.name,
      notes: template.notes,
      restMiniSec: template.restMiniSec,
      restClusterSec: template.restClusterSec,
      exercises: template.exercises ?? [],
      seedKey: template.seedKey,
      createdAt: now,
      updatedAt: now,
    });
    const ref = await addDoc(this.userCollection('workoutTemplates'), data);
    return ref.id;
  }

  async updateTemplate(id: string, template: TemplateDraft): Promise<void> {
    // Full overwrite of mutable fields + bump updatedAt; createdAt left
    // untouched by merge.
    const data = pruneUndefined({
      name: template.name,
      notes: template.notes,
      restMiniSec: template.restMiniSec,
      restClusterSec: template.restClusterSec,
      exercises: template.exercises ?? [],
      seedKey: template.seedKey,
      updatedAt: Timestamp.now(),
    });
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
    const now = Timestamp.now();
    const data = pruneUndefined({
      status: session.status,
      templateId: session.templateId,
      templateName: session.templateName,
      timestamp: Timestamp.fromDate(session.date),
      bodyweight: session.bodyweight,
      sleepHours: session.sleepHours,
      durationMin: session.durationMin,
      exercises: session.exercises ?? [],
      nextNotes: session.nextNotes,
      createdAt: now,
      updatedAt: now,
    });
    const ref = await addDoc(this.userCollection('workoutSessions'), data);
    return ref.id;
  }

  async updateSession(id: string, patch: Partial<SessionDraft>): Promise<void> {
    const data: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (patch.status !== undefined) data['status'] = patch.status;
    if (patch.templateId !== undefined) data['templateId'] = patch.templateId;
    if (patch.templateName !== undefined) data['templateName'] = patch.templateName;
    if (patch.date !== undefined) data['timestamp'] = Timestamp.fromDate(patch.date);
    if (patch.bodyweight !== undefined) data['bodyweight'] = patch.bodyweight;
    if (patch.sleepHours !== undefined) data['sleepHours'] = patch.sleepHours;
    if (patch.durationMin !== undefined) data['durationMin'] = patch.durationMin;
    if (patch.exercises !== undefined) data['exercises'] = patch.exercises;
    if (patch.nextNotes !== undefined) data['nextNotes'] = patch.nextNotes;
    await setDoc(this.userDocIn('workoutSessions', id), pruneUndefined(data), { merge: true });
  }

  async deleteSession(id: string): Promise<void> {
    await deleteDoc(this.userDocIn('workoutSessions', id));
  }
}

// ─── Workout mappers (Timestamp ↔ Date at the seam) ─────────────
function toDomainTemplate(id: string, data: WorkoutTemplateDoc): WorkoutTemplate {
  return {
    id,
    name: data.name,
    notes: data.notes,
    restMiniSec: data.restMiniSec,
    restClusterSec: data.restClusterSec,
    exercises: ((data.exercises ?? []) as TemplateExercise[]).map((ex) => ({
      ...ex,
      plannedSets: normalizeClusterGroups(ex.plannedSets ?? []),
    })),
    seedKey: data.seedKey,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}

function toDomainSession(id: string, data: WorkoutSessionDoc): WorkoutSession {
  return {
    id,
    status: data.status,
    templateId: data.templateId,
    templateName: data.templateName,
    date: data.timestamp.toDate(),
    bodyweight: data.bodyweight,
    sleepHours: data.sleepHours,
    durationMin: data.durationMin,
    exercises: ((data.exercises ?? []) as SessionExercise[]).map((ex) => ({
      ...ex,
      sets: normalizeClusterGroups((ex.sets ?? []) as WorkoutSet[]),
    })),
    nextNotes: data.nextNotes,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate(),
  };
}

/** Firestore rejects `undefined` (no `ignoreUndefinedProperties` set on
 *  this app's Firestore instance). Delegates to the shared core pruner,
 *  binding this edge's SDK `Timestamp` as an opaque leaf (core guards `Date`
 *  built-in). Single-sourced with the Expo adapter — see @macrolog/core. */
function pruneUndefined<T>(value: T): T {
  return pruneUndefinedCore(value, (v) => v instanceof Timestamp);
}
