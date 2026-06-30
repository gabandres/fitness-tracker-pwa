import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type {
  DailyLog,
  LogEntry,
  Measurement,
  MealPreset,
  OnboardingV2Submission,
  Profile,
  UnitSystem,
} from '@macrolog/core';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';

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
  if (s.targetWeightLbs != null) patch['targetWeightLbs'] = s.targetWeightLbs;
  await updateDoc(userDoc(uid), patch);
}

/** Portion-display unit system (`us` | `metric`). */
export async function setUnitSystem(uid: string, unitSystem: UnitSystem): Promise<void> {
  await updateDoc(userDoc(uid), { unitSystem });
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
