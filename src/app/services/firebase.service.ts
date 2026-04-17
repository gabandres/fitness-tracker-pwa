import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
  deleteDoc,
  deleteField,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';

// ─── Log types ──────────────────────────────────────────────────
// Note: `liftCompleted` and `cardioCompleted` are legacy fields kept
// for reading historic docs. New writes only set `exerciseCompleted`.
export interface DailyLogDoc {
  weight?: number;
  calories: number;
  timestamp: Timestamp;
  protein?: number;
  exerciseCompleted?: boolean;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
  mealLabel?: string;
}

export interface DailyLog {
  id?: string;
  weight?: number;
  calories: number;
  date: Date;
  protein?: number;
  exerciseCompleted?: boolean;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
  mealLabel?: string;
}

// ─── Measurement types ──────────────────────────────────────────
export interface Measurement {
  id?: string;
  waist?: number;
  chest?: number;
  bicep?: number;
  hip?: number;
  date: Date;
}

// ─── Report types ───────────────────────────────────────────────
export interface WeeklyReport {
  id?: string;
  markdown: string;
  generatedAt: Date;
}

// ─── Preset types ───────────────────────────────────────────────
export interface MealPreset {
  id?: string;
  name: string;
  calories: number;
  protein?: number;
}

/** Shape passed to addLog / updateLog — the fields the user submits. */
export interface LogEntry {
  weight?: number;
  calories: number;
  protein?: number;
  exerciseCompleted?: boolean;
  mealLabel?: string;
  timestamp?: Date; // for undo-restore at original time
}

// ─── Profile types ──────────────────────────────────────────────
export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type CutPace = 0.5 | 1.0 | 1.5 | 2.0;

/**
 * Profile field values collected during onboarding. These drive the
 * Mifflin-St Jeor seed estimate used before the user has 14 days of
 * real data, and the target calculation thereafter.
 */
export interface ProfileFields {
  heightIn: number;            // total inches, 40–96
  age: number;                 // 13–120
  sex: Sex;
  activityLevel: ActivityLevel;
  targetPaceLbsPerWeek: CutPace;
  goalWeightLbs?: number;      // optional
  travelMode?: boolean;        // when true, target = maintenance (pace=0)
  fastStartedAt?: Date | null; // when fasting — ISO timestamp of fast start
  webhookApiKey?: string;      // static UUID for Apple Shortcuts webhook auth
  fcmToken?: string;           // FCM push token
  reminderHour?: number;       // 0–23, default 20 (8 PM)
  timezoneOffsetMin?: number;  // from new Date().getTimezoneOffset()
}

/** Full user profile doc as stored in Firestore. */
export interface UserProfile extends Partial<ProfileFields> {
  email: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  profileCompleted: boolean;
}

/**
 * All Firestore I/O is scoped to the currently signed-in user's
 * subtree at `users/{uid}`. Methods throw if called while
 * unauthenticated — the UI is responsible for gating.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);

  private readonly _profile = signal<UserProfile | null>(null);
  readonly profile = this._profile.asReadonly();
  /** True once the user has submitted onboarding. Drives the main gate. */
  readonly profileCompleted = computed(() => this._profile()?.profileCompleted === true);

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('FirebaseService called while unauthenticated.');
    return uid;
  }

  private logsCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'dailyLogs');
  }

  private userDoc() {
    return doc(this.firestore, 'users', this.requireUid());
  }

  /**
   * Idempotent profile upsert. Call on every sign-in:
   *   - First time:      creates users/{uid} with profileCompleted=false
   *   - Subsequent times: updateDoc bumps lastSeenAt, leaves everything else alone
   *
   * Always populates the local profile signal with the latest state.
   */
  async ensureUserProfile(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ensureUserProfile called while unauthenticated.');

    const ref = this.userDoc();
    const snap = await getDoc(ref);
    const now = Timestamp.now();

    if (!snap.exists()) {
      const initial: UserProfile = {
        email: user.email ?? '',
        createdAt: now,
        lastSeenAt: now,
        profileCompleted: false,
      };
      await setDoc(ref, initial);
      this._profile.set(initial);
    } else {
      await updateDoc(ref, { lastSeenAt: now });
      const existing = snap.data() as UserProfile;
      this._profile.set({ ...existing, lastSeenAt: now });
    }
  }

  /** Clear the local profile signal on sign-out. */
  clearProfile(): void {
    this._profile.set(null);
  }

  /**
   * Submit (or update) the user's completed profile. Always sets
   * profileCompleted to true. Rules enforce all range checks.
   */
  async saveProfile(fields: ProfileFields): Promise<void> {
    const current = this._profile();
    if (!current) throw new Error('No profile loaded.');

    const ref = this.userDoc();
    const patch: Partial<UserProfile> = {
      heightIn: fields.heightIn,
      age: fields.age,
      sex: fields.sex,
      activityLevel: fields.activityLevel,
      targetPaceLbsPerWeek: fields.targetPaceLbsPerWeek,
      profileCompleted: true,
      lastSeenAt: Timestamp.now(),
    };
    if (fields.goalWeightLbs != null) {
      patch.goalWeightLbs = fields.goalWeightLbs;
    }

    await updateDoc(ref, patch);
    this._profile.set({ ...current, ...patch } as UserProfile);
  }

  /** Generate a new webhook API key (UUID v4) and persist on the profile. */
  async generateWebhookApiKey(): Promise<string> {
    const key = crypto.randomUUID();
    const ref = this.userDoc();
    await updateDoc(ref, { webhookApiKey: key, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, webhookApiKey: key } as any);
    return key;
  }

  /** Revoke the webhook API key. */
  async revokeWebhookApiKey(): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { webhookApiKey: deleteField(), lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) {
      const updated = { ...current };
      delete (updated as any).webhookApiKey;
      this._profile.set(updated);
    }
  }

  /** Save FCM push token + timezone offset on the profile. */
  async saveFcmToken(token: string): Promise<void> {
    const ref = this.userDoc();
    const tz = new Date().getTimezoneOffset();
    await updateDoc(ref, { fcmToken: token, timezoneOffsetMin: tz, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fcmToken: token, timezoneOffsetMin: tz } as any);
  }

  /** Permanently delete the current user's account and all associated
      data. Calls the deleteAccount Cloud Function, which removes
      Firestore subcollections and the Firebase Auth user. After this
      resolves, sign-out the client and redirect to /. */
  async deleteMyAccount(): Promise<void> {
    const callable = httpsCallable<void, { success: boolean }>(this.functions, 'deleteAccount');
    await callable();
  }

  /** Clear FCM token (permission revoked). */
  async clearFcmToken(): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { fcmToken: deleteField(), lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) {
      const updated = { ...current };
      delete (updated as any).fcmToken;
      this._profile.set(updated);
    }
  }

  /** Save the user's preferred reminder hour (0–23). */
  async saveReminderHour(hour: number): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { reminderHour: hour, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, reminderHour: hour } as any);
  }

  /** Start a fast — stores the current timestamp. */
  async startFast(): Promise<void> {
    const ref = this.userDoc();
    const now = Timestamp.now();
    await updateDoc(ref, { fastStartedAt: now, lastSeenAt: now });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fastStartedAt: now.toDate() } as any);
  }

  /** Break the fast — clears the timestamp. */
  async breakFast(): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { fastStartedAt: null, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fastStartedAt: null } as any);
  }

  /** Toggle travel mode on the profile. */
  async setTravelMode(on: boolean): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { travelMode: on, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, travelMode: on } as UserProfile);
  }

  // ─── Daily logs ────────────────────────────────────────────────
  async addLog(entry: LogEntry): Promise<void> {
    const data: Record<string, unknown> = {
      calories: entry.calories,
      timestamp: Timestamp.fromDate(entry.timestamp ?? new Date()),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.exerciseCompleted) data['exerciseCompleted'] = true;
    if (entry.mealLabel) data['mealLabel'] = entry.mealLabel;
    await addDoc(this.logsCollection(), data);
  }

  async getRecentLogs(days = 14): Promise<DailyLog[]> {
    const q = query(this.logsCollection(), orderBy('timestamp', 'desc'), limit(days));
    const snap = await getDocs(q);
    const results: DailyLog[] = snap.docs.map((d) => {
      const data = d.data() as DailyLogDoc;
      return {
        id: d.id,
        weight: data.weight,
        calories: data.calories,
        date: data.timestamp.toDate(),
        protein: data.protein,
        exerciseCompleted: data.exerciseCompleted,
        liftCompleted: data.liftCompleted,
        cardioCompleted: data.cardioCompleted,
        mealLabel: data.mealLabel,
      };
    });
    return results.reverse();
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyLogs', logId);
    const data: Record<string, unknown> = {
      calories: entry.calories,
      protein: entry.protein != null ? entry.protein : deleteField(),
      exerciseCompleted: entry.exerciseCompleted ? true : deleteField(),
      // Migrate away from legacy fields on every edit.
      liftCompleted: deleteField(),
      cardioCompleted: deleteField(),
      mealLabel: entry.mealLabel ? entry.mealLabel : deleteField(),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.timestamp != null) data['timestamp'] = Timestamp.fromDate(entry.timestamp);
    await updateDoc(ref, data);
  }

  /** Delete a log entry. */
  async deleteLog(logId: string): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyLogs', logId);
    await deleteDoc(ref);
  }

  // ─── Daily weights ────────────────────────────────────────────
  private weightsCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'dailyWeights');
  }

  /** Get all daily weights as a map of dateKey → weight. */
  async getDailyWeights(): Promise<Record<string, number>> {
    const snap = await getDocs(this.weightsCollection());
    const weights: Record<string, number> = {};
    for (const d of snap.docs) {
      const data = d.data() as { weight: number };
      weights[d.id] = data.weight;
    }
    return weights;
  }

  /** Set (or overwrite) the weight for a specific day. Doc ID = dateKey. */
  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyWeights', dateKey);
    await setDoc(ref, { weight });
  }

  // ─── Meal presets ─────────────────────────────────────────────
  private presetsCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'presets');
  }

  async getPresets(): Promise<MealPreset[]> {
    const snap = await getDocs(this.presetsCollection());
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MealPreset));
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<void> {
    const data: Record<string, unknown> = {
      name: preset.name,
      calories: preset.calories,
    };
    if (preset.protein != null) data['protein'] = preset.protein;
    await addDoc(this.presetsCollection(), data);
  }

  async deletePreset(presetId: string): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'presets', presetId);
    await deleteDoc(ref);
  }

  // ─── Weekly reports ───────────────────────────────────────────
  private reportsCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'reports');
  }

  async getLatestReport(): Promise<WeeklyReport | null> {
    const q = query(this.reportsCollection(), orderBy('generatedAt', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data() as { markdown: string; generatedAt: Timestamp };
    return { id: d.id, markdown: data.markdown, generatedAt: data.generatedAt.toDate() };
  }

  // New report docs are written by the `generateWeeklyReport` Cloud
  // Function via the admin SDK. Client writes are blocked by rules.

  // ─── Body measurements ────────────────────────────────────────
  private measurementsCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'measurements');
  }

  async getRecentMeasurements(count = 10): Promise<Measurement[]> {
    const q = query(this.measurementsCollection(), orderBy('timestamp', 'desc'), limit(count));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as { waist?: number; chest?: number; bicep?: number; hip?: number; timestamp: Timestamp };
      return { id: d.id, waist: data.waist, chest: data.chest, bicep: data.bicep, hip: data.hip, date: data.timestamp.toDate() };
    });
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    const data: Record<string, unknown> = { timestamp: Timestamp.now() };
    if (entry.waist != null) data['waist'] = entry.waist;
    if (entry.chest != null) data['chest'] = entry.chest;
    if (entry.bicep != null) data['bicep'] = entry.bicep;
    if (entry.hip != null) data['hip'] = entry.hip;
    await addDoc(this.measurementsCollection(), data);
  }

  async deleteMeasurement(id: string): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'measurements', id);
    await deleteDoc(ref);
  }
}
