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
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

// ─── Log types ──────────────────────────────────────────────────
export interface DailyLogDoc {
  weight: number;
  calories: number;
  timestamp: Timestamp;
  protein?: number;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
}

export interface DailyLog {
  id?: string;
  weight: number;
  calories: number;
  date: Date;
  protein?: number;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
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
  weight: number;
  calories: number;
  protein?: number;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
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

  // ─── Daily logs ────────────────────────────────────────────────
  async addLog(entry: LogEntry): Promise<void> {
    const data: Record<string, unknown> = {
      weight: entry.weight,
      calories: entry.calories,
      timestamp: Timestamp.fromDate(new Date()),
    };
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.liftCompleted != null) data['liftCompleted'] = entry.liftCompleted;
    if (entry.cardioCompleted != null) data['cardioCompleted'] = entry.cardioCompleted;
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
      };
    });
    return results.reverse();
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyLogs', logId);
    const data: Record<string, unknown> = {
      weight: entry.weight,
      calories: entry.calories,
    };
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.liftCompleted != null) data['liftCompleted'] = entry.liftCompleted;
    if (entry.cardioCompleted != null) data['cardioCompleted'] = entry.cardioCompleted;
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
}
