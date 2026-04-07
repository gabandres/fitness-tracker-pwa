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

// ─── Log types ──────────────────────────────────────────────────
export interface DailyLogDoc {
  weight?: number;
  calories: number;
  timestamp: Timestamp;
  protein?: number;
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
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
  mealLabel?: string;
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
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
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
    if (entry.liftCompleted != null) data['liftCompleted'] = entry.liftCompleted;
    if (entry.cardioCompleted != null) data['cardioCompleted'] = entry.cardioCompleted;
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
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.liftCompleted != null) data['liftCompleted'] = entry.liftCompleted;
    if (entry.cardioCompleted != null) data['cardioCompleted'] = entry.cardioCompleted;
    if (entry.mealLabel) data['mealLabel'] = entry.mealLabel;
    await updateDoc(ref, data);
  }

  /** Delete a log entry. */
  async deleteLog(logId: string): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyLogs', logId);
    await deleteDoc(ref);
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

  async saveReport(markdown: string): Promise<void> {
    await addDoc(this.reportsCollection(), {
      markdown,
      generatedAt: Timestamp.now(),
    });
  }
}
