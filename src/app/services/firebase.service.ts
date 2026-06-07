import { Injectable, computed, inject, signal } from '@angular/core';
import type { LedgerPort } from '../ledger/ports/ledger.port';
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
import { CallableGateway } from './callable.gateway';
import { readReferrer, clearReferrer } from '../utils/referral';
import type { UnitSystem } from '../models/unit-system';
import { toDomainProfile, toDomainProfilePatch } from '../ledger/infrastructure/profile-mapper';

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
export type CutPace = 0 | 0.5 | 1.0 | 1.5 | 2.0;
// Re-export so existing imports of GoalDirection from this module keep
// working; the canonical definition lives in utils/macro-heuristic.ts
// alongside the kcal/protein multipliers it parameterizes.
export type { GoalDirection } from '../utils/macro-heuristic';
import type { GoalDirection } from '../utils/macro-heuristic';

/** v2 2-question onboarding submission. Heuristic targets are computed
 *  by the caller (component) and persisted as manualCaloriesTarget /
 *  manualProteinTarget so the FitnessStore overrides TDEE-based math.
 *  targetWeightLbs is required for lose/gain, omitted for maintain. */
export interface OnboardingV2Submission {
  weightLbs: number;
  goalDirection: GoalDirection;
  targetWeightLbs?: number;
  manualCaloriesTarget: number;
  manualProteinTarget: number;
}

/** Payload from the Day-3 "Refine targets" sheet. Promotes a 2-Q-onboarded
 *  profile to a full Mifflin-St Jeor-driven TDEE: writes the missing
 *  profile fields and clears the manual heuristic targets so the
 *  FitnessStore.targetCalories chain falls through to formula mode. */
export interface RefineTargetsSubmission {
  heightIn: number;
  age: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  targetPaceLbsPerWeek: CutPace;
}

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
  ageConfirmedAt?: Date;       // COPPA/EU: timestamp the user attested 13+ (16+ EU)
  ageConfirmed?: boolean;      // transient checkbox state — never persisted, drives the stamp below
  preferredLocale?: string;    // Transloco active lang ('en' | 'es-PR'); used server-side for email locale
  welcomeEmailSentAt?: Date;      // server-set latch; clients never write this
  // v2 2-question onboarding (Q10 of UX revamp v2). When present, the
  // FitnessStore prefers these manual targets over TDEE-derived math.
  goalDirection?: GoalDirection;
  targetWeightLbs?: number;       // for lose/gain; omitted for maintain
  manualCaloriesTarget?: number;  // heuristic: weight_lb × {11/14/17}
  manualProteinTarget?: number;   // heuristic: weight_lb × {1.0/0.9/0.8}
  onboardingV2CompletedAt?: Date;
  targetsRefinedAt?: Date;        // stamped when the user fills the Day-3
                                   // "Refine targets" sheet — drops the
                                   // manual heuristic in favour of the
                                   // formula-mode TDEE chain.

  // Referrals. `referredBy` is set once on profile create from the
  // ?ref=<uid> query param the user followed; immutable thereafter.
  // `compedUntil` is server-stamped to (now + 30d) on each side when
  // the referred user pays for the first time. `referralRewardGrantedAt`
  // is the latch on the referee that prevents double-grants.
  referredBy?: string;
  compedUntil?: Date;
  referralRewardGrantedAt?: Date;

  // Public profile (opt-in transformation page at /u/<slug>). The slug
  // is claimed via a server callable so uniqueness is enforced; the
  // public-facing mirror lives in the `publicProfiles` collection and
  // is rebuilt by an `onUserDocUpdate` trigger whenever any of these
  // fields or weight history change. Clients NEVER write to the public
  // mirror directly — rules block it.
  publicSlug?: string;
  publicProfileEnabled?: boolean;
  publicDisplayName?: string;

  // Recent-entry suppressions. Recent quick-add chips are derived from
  // the trailing log window (FitnessStore.recentEntries); deleting a
  // historical log to remove a chip would destroy data, so instead we
  // store a per-label hide list here. FitnessStore filters chips
  // against this set so they stop surfacing while the underlying log
  // entries remain intact. Comparison is case-insensitive — the labels
  // here are normalized to lowercase at write time.
  hiddenRecentLabels?: string[];

  // Unit system for portion display in the food-search picker and any
  // future cup/tbsp-vs-grams toggle. `us` (cup/tbsp/oz default) is the
  // implicit pre-existing behavior — leaving this undefined renders
  // identically. `metric` makes the per-100g row the default option in
  // the portion picker so users in metric markets don't have to scroll
  // past household measures every time.
  unitSystem?: UnitSystem;

  // Weekly digest. Opt-in toggle in settings → scheduled CF reads users
  // where this is true on Sunday morning local-tz and emails the last-7d
  // recap. Default false: existing users don't suddenly get an unsolicited
  // email. `lastWeeklyDigestSentAt` is server-stamped after each send;
  // clients read but never write it.
  weeklyDigestOptIn?: boolean;
  lastWeeklyDigestSentAt?: Date;
}

/**
 * **Domain** profile — the shape the ledger seam exposes (see
 * `CONTEXT.md` → Profile). Every date is a JS `Date`; callers never see
 * a Firestore `Timestamp`. This is what `LEDGER_PORT.profile` returns
 * and what every store/component consumes.
 */
export interface Profile extends Partial<ProfileFields> {
  email: string;
  createdAt: Date;
  lastSeenAt: Date;
  profileCompleted: boolean;
}

/** Date-typed fields on the profile. Listed once so `UserProfileDoc`
 *  can override exactly these to `Timestamp` and the
 *  `toDomainProfile` mapper can convert exactly these back to `Date`. */
export type ProfileDateField =
  | 'createdAt'
  | 'lastSeenAt'
  | 'fastStartedAt'
  | 'ageConfirmedAt'
  | 'welcomeEmailSentAt'
  | 'onboardingV2CompletedAt'
  | 'targetsRefinedAt'
  | 'compedUntil'
  | 'referralRewardGrantedAt'
  | 'lastWeeklyDigestSentAt';

/**
 * **Stored** profile — the doc as persisted at `users/{uid}`. Identical
 * to {@link Profile} except every {@link ProfileDateField} is a Firestore
 * `Timestamp`. Lives only inside the Firestore adapter + the mapper;
 * never crosses the ledger seam.
 */
export type UserProfileDoc = Omit<Profile, ProfileDateField> & {
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  fastStartedAt?: Timestamp | null;
  ageConfirmedAt?: Timestamp;
  welcomeEmailSentAt?: Timestamp;
  onboardingV2CompletedAt?: Timestamp;
  targetsRefinedAt?: Timestamp;
  compedUntil?: Timestamp;
  referralRewardGrantedAt?: Timestamp;
  lastWeeklyDigestSentAt?: Timestamp;
};

/**
 * All Firestore I/O is scoped to the currently signed-in user's
 * subtree at `users/{uid}`. Methods throw if called while
 * unauthenticated — the UI is responsible for gating.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService implements LedgerPort {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly callables = inject(CallableGateway);

  private readonly _profile = signal<Profile | null>(null);
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
    // Hard 15s ceiling per Firestore call. The Firestore SDK retries
    // 504s internally without ever rejecting → app-shell loader hangs
    // forever. Surfacing a timeout lets the caller put up a retry UI.
    const snap = await this.withTimeout(getDoc(ref), 15_000, 'profile-read');
    const now = Timestamp.now();

    if (!snap.exists()) {
      const initial: UserProfileDoc = {
        email: user.email ?? '',
        createdAt: now,
        lastSeenAt: now,
        profileCompleted: false,
      };
      // Stamp `referredBy` from the captured ?ref= latch (set when the
      // user landed via a friend's share URL). Self-refs are rejected
      // — a user opening their own link can't reward themselves. The
      // server-side onSubscriptionPaid trigger validates the referrer
      // exists before granting any reward.
      const refUid = readReferrer();
      if (refUid && refUid !== user.uid) initial.referredBy = refUid;
      clearReferrer();
      // Fire-and-forget the seen-stamp update in non-create paths too.
      // Setting the local signal BEFORE the write resolves the loader
      // immediately on the create path; if the write fails the user
      // sees an error toast on next mutation rather than a dead app.
      await this.withTimeout(setDoc(ref, initial), 15_000, 'profile-create');
      this._profile.set(toDomainProfile(initial));
    } else {
      const existing = snap.data() as UserProfileDoc;
      // Map Timestamp -> Date at the seam; overlay the bumped lastSeenAt.
      this._profile.set({ ...toDomainProfile(existing), lastSeenAt: now.toDate() });
      // Bump lastSeenAt fire-and-forget — the loader was already gated
      // on the read, so the write doesn't need to block UI.
      void updateDoc(ref, { lastSeenAt: now }).catch((err) => {
        console.warn('lastSeenAt bump failed (non-fatal):', err);
      });
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
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
    const patch: Partial<UserProfileDoc> = {
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
    // Only stamp the age attestation when the caller passes an explicit
    // `ageConfirmed: true` AND we haven't stamped one yet. This keeps the
    // attestation bound to the actual checkbox event rather than implicit
    // from any saveProfile call.
    if (fields.ageConfirmed === true && current.ageConfirmedAt == null) {
      patch.ageConfirmedAt = Timestamp.now();
    }
    // Persist the Transloco active language so the welcome-email trigger
    // (and any future server-side email) renders in the locale the user
    // actually onboarded in. Browser locale isn't available to Firestore
    // triggers; only what's persisted on the doc is.
    if (fields.preferredLocale) {
      patch.preferredLocale = fields.preferredLocale;
    }

    await updateDoc(ref, patch);
    this._profile.set({ ...current, ...toDomainProfilePatch(patch) });
  }

  /** Persist a v2 2-question onboarding submission. Writes the heuristic
      kcal/protein targets and the goal direction; also writes the user's
      current weight as today's daily weight so the dashboard reflects it
      immediately. Sets onboardingV2CompletedAt so the new-user redirect
      doesn't fire again. */
  async saveOnboardingV2(submission: OnboardingV2Submission): Promise<void> {
    const current = this._profile();
    if (!current) throw new Error('No profile loaded.');

    const ref = this.userDoc();
    const patch: Partial<UserProfileDoc> = {
      goalDirection: submission.goalDirection,
      manualCaloriesTarget: submission.manualCaloriesTarget,
      manualProteinTarget: submission.manualProteinTarget,
      onboardingV2CompletedAt: Timestamp.now(),
      // Mark profile complete so the v1 gate doesn't re-trigger v1
      // onboarding for users who came in through the v2 path. Existing
      // v1 fields stay unset; surfaces that depend on them gracefully
      // handle missing data (TDEE chain falls back to formula).
      profileCompleted: true,
      lastSeenAt: Timestamp.now(),
    };
    if (submission.targetWeightLbs != null) {
      patch.targetWeightLbs = submission.targetWeightLbs;
    }
    await updateDoc(ref, patch);
    this._profile.set({ ...current, ...toDomainProfilePatch(patch) });
  }

  /** Persist the Day-3 "Refine targets" sheet. Writes the full
      Mifflin-St Jeor inputs and DELETES the heuristic manual targets so
      the TDEE chain takes over from the next read. Stamps
      `targetsRefinedAt` so the prompting card disappears. */
  async saveRefinedTargets(submission: RefineTargetsSubmission): Promise<void> {
    const current = this._profile();
    if (!current) throw new Error('No profile loaded.');

    const ref = this.userDoc();
    const stamp = Timestamp.now();
    await updateDoc(ref, {
      heightIn: submission.heightIn,
      age: submission.age,
      sex: submission.sex,
      activityLevel: submission.activityLevel,
      targetPaceLbsPerWeek: submission.targetPaceLbsPerWeek,
      manualCaloriesTarget: deleteField(),
      manualProteinTarget: deleteField(),
      targetsRefinedAt: stamp,
      lastSeenAt: stamp,
    });
    const updated: Profile = { ...current,
      heightIn: submission.heightIn,
      age: submission.age,
      sex: submission.sex,
      activityLevel: submission.activityLevel,
      targetPaceLbsPerWeek: submission.targetPaceLbsPerWeek,
      targetsRefinedAt: stamp.toDate(),
    };
    delete (updated as any).manualCaloriesTarget;
    delete (updated as any).manualProteinTarget;
    this._profile.set(updated);
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
    await this.callables.call<void, { success: boolean }>('deleteAccount');
  }

  /** GDPR Art. 20 portability: fetch a full JSON snapshot of every
      document we hold for the signed-in user. CSV export covers logs
      only — this is for full portability / regulator requests. */
  async exportMyData(): Promise<unknown> {
    return this.callables.call<void, unknown>('exportUserData');
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

  /** Save the user's preferred reminder hour (0–23). Also refresh
      `timezoneOffsetMin` so the CF computes the correct local hour after
      travel / DST shifts (without this, push fires at the user's
      original-signup local hour forever). */
  async saveReminderHour(hour: number): Promise<void> {
    const ref = this.userDoc();
    const tz = new Date().getTimezoneOffset();
    await updateDoc(ref, {
      reminderHour: hour,
      timezoneOffsetMin: tz,
      lastSeenAt: Timestamp.now(),
    });
    const current = this._profile();
    if (current) this._profile.set({ ...current, reminderHour: hour, timezoneOffsetMin: tz } as any);
  }

  /** Start a fast — stores the given start time, or now if omitted.
   *  Accepts a past timestamp so users can backdate a fast they forgot
   *  to log when they actually stopped eating. */
  async startFast(startedAt?: Date): Promise<void> {
    const ref = this.userDoc();
    const start = startedAt ? Timestamp.fromDate(startedAt) : Timestamp.now();
    const now = Timestamp.now();
    await updateDoc(ref, { fastStartedAt: start, lastSeenAt: now });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fastStartedAt: start.toDate() } as any);
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
    if (current) this._profile.set({ ...current, travelMode: on } as Profile);
  }

  /** Persist the user's preferred unit system. Drives the default
   *  portion option (per-100g vs household) in the food-search picker.
   *  Writing the same value back is a no-op latency-wise — Firestore
   *  collapses the patch — so the callers can avoid local equality
   *  checks. */
  /** Add a meal label to the user's recent-quick-add hide list. The
   *  label is normalized to lowercase before storage so duplicates with
   *  different casing collapse to one entry. Capped at 200 entries to
   *  keep the profile doc bounded — well past anything a real user
   *  would amass. */
  async hideRecentLabel(label: string): Promise<void> {
    const norm = label.trim().toLowerCase();
    if (!norm) return;
    const current = this._profile();
    const existing = ((current as { hiddenRecentLabels?: string[] } | null)?.hiddenRecentLabels) ?? [];
    if (existing.includes(norm)) return;
    const next = [...existing, norm].slice(-200);
    const ref = this.userDoc();
    await updateDoc(ref, { hiddenRecentLabels: next, lastSeenAt: Timestamp.now() });
    if (current) this._profile.set({ ...current, hiddenRecentLabels: next } as Profile);
  }

  /** Remove a label from the hide list. Used by an "undo / show again"
   *  affordance if/when surfaced. */
  async unhideRecentLabel(label: string): Promise<void> {
    const norm = label.trim().toLowerCase();
    if (!norm) return;
    const current = this._profile();
    const existing = ((current as { hiddenRecentLabels?: string[] } | null)?.hiddenRecentLabels) ?? [];
    const next = existing.filter((l) => l !== norm);
    if (next.length === existing.length) return;
    const ref = this.userDoc();
    await updateDoc(ref, { hiddenRecentLabels: next, lastSeenAt: Timestamp.now() });
    if (current) this._profile.set({ ...current, hiddenRecentLabels: next } as Profile);
  }

  async setUnitSystem(system: UnitSystem): Promise<void> {
    const ref = this.userDoc();
    await updateDoc(ref, { unitSystem: system, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, unitSystem: system } as Profile);
  }

  /** Toggle weekly-digest opt-in. Refreshes `timezoneOffsetMin` so the
   *  scheduled CF can fire at the user's local Sunday morning even after
   *  travel / DST. */
  async setWeeklyDigestOptIn(on: boolean): Promise<void> {
    const ref = this.userDoc();
    const tz = new Date().getTimezoneOffset();
    await updateDoc(ref, {
      weeklyDigestOptIn: on,
      timezoneOffsetMin: tz,
      lastSeenAt: Timestamp.now(),
    });
    const current = this._profile();
    if (current) this._profile.set({
      ...current, weeklyDigestOptIn: on, timezoneOffsetMin: tz,
    } as Profile);
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

  // ─── Daily water ──────────────────────────────────────────────
  // Stored in milliliters (single source of truth); client renders oz/ml
  // based on locale. Same shape as dailyWeights: one doc per date keyed
  // by the dateKey. Rules cap at 20000 ml (~5 gal) to catch fat-finger
  // entries that would otherwise pollute charts.
  private waterCollection() {
    return collection(this.firestore, 'users', this.requireUid(), 'dailyWater');
  }

  async getDailyWater(): Promise<Record<string, number>> {
    const snap = await getDocs(this.waterCollection());
    const water: Record<string, number> = {};
    for (const d of snap.docs) {
      const data = d.data() as { ml: number };
      water[d.id] = data.ml;
    }
    return water;
  }

  async setDailyWater(dateKey: string, ml: number): Promise<void> {
    const ref = doc(this.firestore, 'users', this.requireUid(), 'dailyWater', dateKey);
    await setDoc(ref, { ml: Math.max(0, Math.min(20000, Math.round(ml))) });
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
