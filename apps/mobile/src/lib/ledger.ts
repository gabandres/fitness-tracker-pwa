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
  OnboardingV2Submission,
  Profile,
  UnitSystem,
} from '@macrolog/core';
import { db } from './firebase';

// Firestore schema mirrors the PWA exactly (see firestore-ledger.core.ts):
//   users/{uid}                       — profile doc
//   users/{uid}/dailyLogs/{id}        — { calories, timestamp, protein?, … }
//   users/{uid}/dailyWeights/{dateKey} — { weight }
// so both apps read/write the same data and pass the same security rules.

const logsCol = (uid: string) => collection(db, 'users', uid, 'dailyLogs');
const logDoc = (uid: string, id: string) => doc(db, 'users', uid, 'dailyLogs', id);
const weightsCol = (uid: string) => collection(db, 'users', uid, 'dailyWeights');
const weightDoc = (uid: string, dateKey: string) => doc(db, 'users', uid, 'dailyWeights', dateKey);
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
