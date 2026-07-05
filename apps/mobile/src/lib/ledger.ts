import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  type CustomFood,
  type DailyLog,
  type LogEntry,
  type Measurement,
  type MealPreset,
  type OnboardingV2Submission,
  type Profile,
  type RefineTargetsSubmission,
  type UnitSystem,
  type WeeklyReport,
  clampCutPace,
  localDateKey,
} from '@macrolog/core';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
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

function toDailyLog(id: string, data: Record<string, unknown>): DailyLog {
  return {
    id,
    calories: (data['calories'] as number) ?? 0,
    date: (data['timestamp'] as Timestamp).toDate(),
    weight: data['weight'] as number | undefined,
    protein: data['protein'] as number | undefined,
    carbs: data['carbs'] as number | undefined,
    fat: data['fat'] as number | undefined,
    exerciseCompleted: data['exerciseCompleted'] as boolean | undefined,
    liftCompleted: data['liftCompleted'] as boolean | undefined,
    cardioCompleted: data['cardioCompleted'] as boolean | undefined,
    mealLabel: data['mealLabel'] as string | undefined,
    mealType: data['mealType'] as DailyLog['mealType'],
  };
}

/** Live-subscribe to the latest `count` log rows, delivered OLDEST-FIRST
 *  (matches the ledger seam contract). */
export function subscribeRecentLogs(
  uid: string,
  count: number,
  cb: (logs: DailyLog[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(logsCol(uid), orderBy('timestamp', 'desc'), limit(count));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => toDailyLog(d.id, d.data())).reverse()),
    onError,
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
      const data = d.data();
      cb({
        id: d.id,
        markdown: (data['markdown'] as string) ?? '',
        generatedAt: (data['generatedAt'] as Timestamp).toDate(),
      });
    },
    onError,
  );
}

function logData(entry: LogEntry): Record<string, unknown> {
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
  return data;
}

export async function addLog(uid: string, entry: LogEntry): Promise<string> {
  const ref = await addDoc(logsCol(uid), logData(entry));
  return ref.id;
}

export async function updateLog(uid: string, id: string, entry: LogEntry): Promise<void> {
  const data: Record<string, unknown> = {
    calories: entry.calories,
    protein: entry.protein != null ? entry.protein : deleteField(),
    carbs: entry.carbs != null ? entry.carbs : deleteField(),
    fat: entry.fat != null ? entry.fat : deleteField(),
    exerciseCompleted: entry.exerciseCompleted ? true : deleteField(),
    liftCompleted: deleteField(),
    cardioCompleted: deleteField(),
    mealLabel: entry.mealLabel ? entry.mealLabel : deleteField(),
    mealType: entry.mealType ? entry.mealType : deleteField(),
  };
  if (entry.weight != null) data['weight'] = entry.weight;
  if (entry.timestamp != null) data['timestamp'] = Timestamp.fromDate(entry.timestamp);
  await updateDoc(logDoc(uid, id), data);
}

export async function deleteLog(uid: string, id: string): Promise<void> {
  await deleteDoc(logDoc(uid, id));
}

/** Bulk-import parsed LogEntry rows in ≤450-op batches (Firestore's 500-write
 *  cap). Returns the number written. Mirrors FirestoreLedgerCore.importLogs. */
export async function importLogs(uid: string, entries: readonly LogEntry[]): Promise<number> {
  const coll = logsCol(uid);
  let written = 0;
  for (let i = 0; i < entries.length; i += 450) {
    const batch = writeBatch(db);
    for (const entry of entries.slice(i, i + 450)) batch.set(doc(coll), logData(entry));
    await batch.commit();
    written += Math.min(450, entries.length - i);
  }
  return written;
}

// ─── Daily weights ──────────────────────────────────────────────
export function subscribeDailyWeights(
  uid: string,
  cb: (weights: Record<string, number>) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    weightsCol(uid),
    (snap) => {
      const weights: Record<string, number> = {};
      for (const d of snap.docs) weights[d.id] = (d.data() as { weight: number }).weight;
      cb(weights);
    },
    onError,
  );
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
  cb: (water: Record<string, number>) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    waterCol(uid),
    (snap) => {
      const water: Record<string, number> = {};
      for (const d of snap.docs) {
        const data = d.data() as { flOz?: number; ml?: number };
        water[d.id] =
          typeof data.flOz === 'number'
            ? data.flOz
            : typeof data.ml === 'number'
              ? Math.round(data.ml / 29.5735)
              : 0;
      }
      cb(water);
    },
    onError,
  );
}

export async function setDailyWater(uid: string, dateKey: string, flOz: number): Promise<void> {
  await setDoc(waterDoc(uid, dateKey), { flOz: Math.max(0, Math.min(676, Math.round(flOz))) });
}

// ─── Daily sleep ────────────────────────────────────────────────
// users/{uid}/dailySleep/{dateKey} = { hours }. Clamp [0, 24], half-hour.
const sleepCol = (uid: string) => collection(db, 'users', uid, 'dailySleep');
const sleepDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailySleep', dateKey);

export function subscribeDailySleep(
  uid: string,
  cb: (sleep: Record<string, number>) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    sleepCol(uid),
    (snap) => {
      const sleep: Record<string, number> = {};
      for (const d of snap.docs) {
        const data = d.data() as { hours?: number };
        if (typeof data.hours === 'number') sleep[d.id] = data.hours;
      }
      cb(sleep);
    },
    onError,
  );
}

export async function setDailySleep(uid: string, dateKey: string, hours: number): Promise<void> {
  await setDoc(sleepDoc(uid, dateKey), { hours: Math.max(0, Math.min(24, Math.round(hours * 2) / 2)) });
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
function toProfile(data: Record<string, unknown>): Profile {
  const d = (v: unknown): Date | undefined =>
    v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : (v as Date | undefined);
  return {
    ...(data as object),
    createdAt: d(data['createdAt']) ?? new Date(0),
    lastSeenAt: d(data['lastSeenAt']) ?? new Date(0),
    fastStartedAt: d(data['fastStartedAt']) ?? null,
    // Referral reward expiry — convert the Timestamp so the Invite section can
    // compare it as a Date. Absent for users who never earned a reward.
    ...(data['compedUntil'] ? { compedUntil: d(data['compedUntil']) } : {}),
  } as Profile;
}

export function subscribeProfile(
  uid: string,
  cb: (profile: Profile | null) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    userDoc(uid),
    (snap) => cb(snap.exists() ? toProfile(snap.data()) : null),
    onError,
  );
}

/** Persist the 2-question onboarding. Mirrors the PWA's
 *  `FirebaseService.saveOnboardingV2` byte-for-byte: writes the manual
 *  heuristic targets, stamps completion, and flips `profileCompleted` so the
 *  TDEE chain prefers these numbers until the user has measured data. The
 *  profile doc already exists (created at sign-up), so this is an update. */
export async function saveOnboardingV2(uid: string, s: OnboardingV2Submission): Promise<void> {
  const patch: Record<string, unknown> = {
    goalDirection: s.goalDirection,
    manualCaloriesTarget: s.manualCaloriesTarget,
    manualProteinTarget: s.manualProteinTarget,
    onboardingV2CompletedAt: Timestamp.now(),
    profileCompleted: true,
    lastSeenAt: Timestamp.now(),
  };
  // Goal weight lives in TWO legacy fields (targetWeightLbs from onboarding,
  // goalWeightLbs read by the goal-progress bar). Keep them in sync, and CLEAR
  // both when the goal is "maintain" — otherwise a stale goalWeightLbs shadows
  // the new goal forever (the "redo onboarding didn't update it" bug).
  if (s.targetWeightLbs != null) {
    patch['targetWeightLbs'] = s.targetWeightLbs;
    patch['goalWeightLbs'] = s.targetWeightLbs;
  } else {
    patch['targetWeightLbs'] = deleteField();
    patch['goalWeightLbs'] = deleteField();
  }
  await updateDoc(userDoc(uid), patch);
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

/** UI language (`en` | `es-PR`). Shared with the PWA's Transloco active lang
 *  + server-side email locale. */
export async function setPreferredLocale(uid: string, preferredLocale: string): Promise<void> {
  await updateDoc(userDoc(uid), { preferredLocale });
}

/** Opt in/out of the Sunday weekly recap email (sent server-side by a CF).
 *  Off by default; `lastWeeklyDigestSentAt` is server-stamped, never written
 *  by the client. */
export async function setWeeklyDigestOptIn(uid: string, on: boolean): Promise<void> {
  await updateDoc(userDoc(uid), { weeklyDigestOptIn: on });
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
    targetPaceLbsPerWeek: clampCutPace(s.targetPaceLbsPerWeek),
    manualCaloriesTarget: deleteField(),
    manualProteinTarget: deleteField(),
    targetsRefinedAt: now,
    lastSeenAt: now,
  });
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
  cb: (presets: MealPreset[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    presetsCol(uid),
    (snap) => cb(snap.docs.map((d) => toPreset(d.id, d.data()))),
    onError,
  );
}

export async function addPreset(uid: string, preset: Omit<MealPreset, 'id'>): Promise<string> {
  const data: Record<string, unknown> = { name: preset.name, calories: preset.calories };
  if (preset.protein != null) data['protein'] = preset.protein;
  if (preset.carbs != null) data['carbs'] = preset.carbs;
  if (preset.fat != null) data['fat'] = preset.fat;
  const ref = await addDoc(presetsCol(uid), data);
  return ref.id;
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

function toCustomFood(id: string, data: Record<string, unknown>): CustomFood {
  const raw = data['createdAt'];
  const createdAt =
    raw && typeof (raw as { toDate?: unknown }).toDate === 'function'
      ? (raw as Timestamp).toDate()
      : new Date(0);
  return { ...(data as object), id, createdAt } as CustomFood;
}

export function subscribeCustomFoods(
  uid: string,
  cb: (foods: CustomFood[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    customFoodsCol(uid),
    (snap) => cb(snap.docs.map((d) => toCustomFood(d.id, d.data()))),
    onError,
  );
}

export async function addCustomFood(
  uid: string,
  food: Omit<CustomFood, 'id'>,
  id?: string | null,
): Promise<string> {
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
    await setDoc(customFoodDoc(uid, id), data);
    return id;
  }
  const ref = await addDoc(customFoodsCol(uid), data);
  return ref.id;
}

export async function deleteCustomFood(uid: string, id: string): Promise<void> {
  await deleteDoc(customFoodDoc(uid, id));
}

// ─── Body measurements ──────────────────────────────────────────
// users/{uid}/measurements/{id} — { timestamp, waist?, chest?, bicep?,
// hip?, neck? } in inches. Shape mirrors FirestoreLedgerCore.addMeasurement.
function toMeasurement(id: string, data: Record<string, unknown>): Measurement {
  return {
    id,
    date: (data['timestamp'] as Timestamp).toDate(),
    waist: data['waist'] as number | undefined,
    chest: data['chest'] as number | undefined,
    bicep: data['bicep'] as number | undefined,
    hip: data['hip'] as number | undefined,
    neck: data['neck'] as number | undefined,
  };
}

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

type MeasurementInput = Omit<Measurement, 'id' | 'date'>;

function measurementData(entry: MeasurementInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (entry.waist != null) data['waist'] = entry.waist;
  if (entry.chest != null) data['chest'] = entry.chest;
  if (entry.bicep != null) data['bicep'] = entry.bicep;
  if (entry.hip != null) data['hip'] = entry.hip;
  if (entry.neck != null) data['neck'] = entry.neck;
  return data;
}

export async function addMeasurement(uid: string, entry: MeasurementInput): Promise<string> {
  const ref = await addDoc(measurementsCol(uid), { timestamp: Timestamp.now(), ...measurementData(entry) });
  return ref.id;
}

export async function deleteMeasurement(uid: string, id: string): Promise<void> {
  await deleteDoc(measurementDoc(uid, id));
}

// ─── Progress photos (ADR-0010) ─────────────────────────────────
// Bytes live in Storage at users/{uid}/photos/{dateKey}.jpg (owner-only,
// JPEG <2MB per storage.rules); an index doc users/{uid}/photos/{dateKey}
// holds { storagePath, takenAt, weightLb? }. One photo per local-date key;
// re-uploading a day overwrites.
const photosCol = (uid: string) => collection(db, 'users', uid, 'photos');
const photoDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'photos', dateKey);
const photoStoragePath = (uid: string, dateKey: string) => `users/${uid}/photos/${dateKey}.jpg`;

export interface ProgressPhoto {
  dateKey: string;
  storagePath: string;
  takenAt: Date;
  weightLb?: number;
  /** Resolved download URL for <Image>, populated by subscribeProgressPhotos. */
  url?: string;
}

/** Live-subscribe to the photo index (newest first), resolving each row's
 *  download URL so an <Image> can render it. */
export function subscribeProgressPhotos(
  uid: string,
  cb: (photos: ProgressPhoto[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  const q = query(photosCol(uid), orderBy('takenAt', 'desc'));
  return onSnapshot(
    q,
    async (snap) => {
      const photos = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as { storagePath: string; takenAt: Timestamp; weightLb?: number };
          let url: string | undefined;
          try {
            url = await getDownloadURL(storageRef(storage, data.storagePath));
          } catch {
            // Object missing (partial delete) — leave url undefined; the
            // grid skips broken rows rather than crashing.
          }
          return {
            dateKey: d.id,
            storagePath: data.storagePath,
            takenAt: data.takenAt.toDate(),
            weightLb: data.weightLb,
            url,
          };
        }),
      );
      cb(photos);
    },
    onError,
  );
}

/** Upload a JPEG blob for `dateKey` (Storage object first, then index doc
 *  so a doc never points at a missing object), and return the index row. */
export async function uploadProgressPhoto(
  uid: string,
  dateKey: string,
  blob: Blob,
  weightLb?: number,
): Promise<void> {
  const path = photoStoragePath(uid, dateKey);
  await uploadBytes(storageRef(storage, path), blob, { contentType: 'image/jpeg' });
  const data: Record<string, unknown> = { storagePath: path, takenAt: Timestamp.now() };
  if (weightLb != null) data['weightLb'] = weightLb;
  await setDoc(photoDoc(uid, dateKey), data);
}

export async function deleteProgressPhoto(uid: string, dateKey: string): Promise<void> {
  try {
    await deleteObject(storageRef(storage, photoStoragePath(uid, dateKey)));
  } catch {
    // Object already gone — still drop the index doc so no ghost row remains.
  }
  await deleteDoc(photoDoc(uid, dateKey));
}

// ─── Train tab (workouts, ADR-0007) ─────────────────────────────
// Three collections, shapes mirror FirestoreLedgerCore + the firestore.rules
// validators (isValidExercise / isValidWorkoutSession):
//   users/{uid}/exercises/{id}        — { name, muscles[], defaultCues[], logStyle?, createdAt }
//   users/{uid}/workoutSessions/{id}  — { status, timestamp, exercises[], …, createdAt, updatedAt }
// (templates are not written by mobile v1). Firestore rejects `undefined`,
// so every write is run through pruneUndefined first.
const exercisesCol = (uid: string) => collection(db, 'users', uid, 'exercises');
const exerciseDoc = (uid: string, id: string) => doc(db, 'users', uid, 'exercises', id);
const sessionsCol = (uid: string) => collection(db, 'users', uid, 'workoutSessions');
const sessionDoc = (uid: string, id: string) => doc(db, 'users', uid, 'workoutSessions', id);
const templatesCol = (uid: string) => collection(db, 'users', uid, 'workoutTemplates');
const templateDoc = (uid: string, id: string) => doc(db, 'users', uid, 'workoutTemplates', id);

/** Recursively drop undefined-valued keys (Firestore rejects undefined). */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => pruneUndefined(v)) as unknown as T;
  if (value !== null && typeof value === 'object' && !(value instanceof Timestamp)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = pruneUndefined(v);
    }
    return out as T;
  }
  return value;
}

// ── Exercise catalog ──
function toExercise(id: string, data: Record<string, unknown>): Exercise {
  return {
    id,
    name: (data['name'] as string) ?? '',
    muscles: (data['muscles'] as Exercise['muscles']) ?? [],
    defaultCues: (data['defaultCues'] as string[]) ?? [],
    logStyle: data['logStyle'] as Exercise['logStyle'],
    seedKey: data['seedKey'] as string | undefined,
    createdAt: (data['createdAt'] as Timestamp)?.toDate() ?? new Date(0),
  };
}

export function subscribeExercises(
  uid: string,
  cb: (exercises: Exercise[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(exercisesCol(uid), orderBy('name')),
    (snap) => cb(snap.docs.map((d) => toExercise(d.id, d.data()))),
    onError,
  );
}

export async function addExercise(uid: string, draft: ExerciseDraft): Promise<string> {
  const data = pruneUndefined({
    name: draft.name,
    muscles: draft.muscles ?? [],
    defaultCues: draft.defaultCues ?? [],
    logStyle: draft.logStyle,
    seedKey: draft.seedKey,
    createdAt: Timestamp.now(),
  });
  const ref = await addDoc(exercisesCol(uid), data);
  return ref.id;
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
 *  Mirrors FirestoreLedgerCore.mergeExercises — batched in chunks of 450. */
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

  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 450)) {
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
function toTemplate(id: string, data: Record<string, unknown>): WorkoutTemplate {
  return {
    id,
    name: (data['name'] as string) ?? '',
    notes: data['notes'] as string | undefined,
    restMiniSec: data['restMiniSec'] as number | undefined,
    restClusterSec: data['restClusterSec'] as number | undefined,
    exercises: ((data['exercises'] as TemplateExercise[]) ?? []).map((ex) => ({
      ...ex,
      plannedSets: ex.plannedSets ?? [],
    })),
    seedKey: data['seedKey'] as string | undefined,
    createdAt: (data['createdAt'] as Timestamp)?.toDate() ?? new Date(0),
    updatedAt: (data['updatedAt'] as Timestamp)?.toDate() ?? new Date(0),
  };
}

export function subscribeTemplates(
  uid: string,
  cb: (templates: WorkoutTemplate[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(templatesCol(uid), orderBy('updatedAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => toTemplate(d.id, d.data()))),
    onError,
  );
}

export async function addTemplate(uid: string, draft: TemplateDraft): Promise<string> {
  const now = Timestamp.now();
  const data = pruneUndefined({
    name: draft.name,
    notes: draft.notes,
    restMiniSec: draft.restMiniSec,
    restClusterSec: draft.restClusterSec,
    exercises: draft.exercises ?? [],
    seedKey: draft.seedKey,
    createdAt: now,
    updatedAt: now,
  });
  const ref = await addDoc(templatesCol(uid), data);
  return ref.id;
}

export async function updateTemplate(uid: string, id: string, draft: TemplateDraft): Promise<void> {
  // Full overwrite of mutable fields + bump updatedAt; createdAt untouched by
  // merge. A merge-update of `exercises` would union arrays, so write the
  // whole template doc (createAt stays, no `exercises` field omitted).
  const data = pruneUndefined({
    name: draft.name,
    notes: draft.notes,
    restMiniSec: draft.restMiniSec,
    restClusterSec: draft.restClusterSec,
    exercises: draft.exercises ?? [],
    seedKey: draft.seedKey,
    updatedAt: Timestamp.now(),
  });
  await setDoc(templateDoc(uid, id), data, { merge: true });
}

export async function deleteTemplate(uid: string, id: string): Promise<void> {
  await deleteDoc(templateDoc(uid, id));
}

// ── Sessions ──
function toSession(id: string, data: Record<string, unknown>): WorkoutSession {
  return {
    id,
    status: data['status'] as WorkoutSession['status'],
    templateId: data['templateId'] as string | undefined,
    templateName: data['templateName'] as string | undefined,
    date: (data['timestamp'] as Timestamp).toDate(),
    bodyweight: data['bodyweight'] as number | undefined,
    sleepHours: data['sleepHours'] as number | undefined,
    durationMin: data['durationMin'] as number | undefined,
    exercises: ((data['exercises'] as SessionExercise[]) ?? []).map((ex) => ({
      ...ex,
      sets: (ex.sets ?? []) as WorkoutSet[],
    })),
    nextNotes: data['nextNotes'] as string | undefined,
    createdAt: (data['createdAt'] as Timestamp)?.toDate() ?? new Date(0),
    updatedAt: (data['updatedAt'] as Timestamp)?.toDate() ?? new Date(0),
  };
}

/** Serialize a SessionDraft to the stored doc shape (date → `timestamp`). */
function sessionData(draft: Partial<SessionDraft>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (draft.status !== undefined) data['status'] = draft.status;
  if (draft.templateId !== undefined) data['templateId'] = draft.templateId;
  if (draft.templateName !== undefined) data['templateName'] = draft.templateName;
  if (draft.date !== undefined) data['timestamp'] = Timestamp.fromDate(draft.date);
  if (draft.bodyweight !== undefined) data['bodyweight'] = draft.bodyweight;
  if (draft.sleepHours !== undefined) data['sleepHours'] = draft.sleepHours;
  if (draft.durationMin !== undefined) data['durationMin'] = draft.durationMin;
  if (draft.exercises !== undefined) data['exercises'] = draft.exercises;
  if (draft.nextNotes !== undefined) data['nextNotes'] = draft.nextNotes;
  return data;
}

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
  cb: (sessions: WorkoutSession[]) => void,
  onError?: (e: Error) => void,
): Unsub {
  return onSnapshot(
    query(sessionsCol(uid), orderBy('timestamp', 'desc'), limit(count)),
    (snap) => cb(snap.docs.map((d) => toSession(d.id, d.data()))),
    onError,
  );
}

export async function startSession(uid: string, draft: SessionDraft): Promise<string> {
  const now = Timestamp.now();
  const data = pruneUndefined({ ...sessionData(draft), createdAt: now, updatedAt: now });
  const ref = await addDoc(sessionsCol(uid), data);
  return ref.id;
}

export async function updateSession(
  uid: string,
  id: string,
  patch: Partial<SessionDraft>,
): Promise<void> {
  const data = pruneUndefined({ ...sessionData(patch), updatedAt: Timestamp.now() });
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
  for (const d of snap.docs) out[d.id] = (d.data() as { weight: number }).weight;
  return out;
}

export async function getAllDailyWater(uid: string): Promise<Record<string, number>> {
  const snap = await getDocs(waterCol(uid));
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    const data = d.data() as { flOz?: number; ml?: number };
    out[d.id] =
      typeof data.flOz === 'number'
        ? data.flOz
        : typeof data.ml === 'number'
          ? Math.round(data.ml / 29.5735)
          : 0;
  }
  return out;
}

export async function getAllDailySleep(uid: string): Promise<Record<string, number>> {
  const snap = await getDocs(sleepCol(uid));
  const out: Record<string, number> = {};
  for (const d of snap.docs) {
    const data = d.data() as { hours?: number };
    if (typeof data.hours === 'number') out[d.id] = data.hours;
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
