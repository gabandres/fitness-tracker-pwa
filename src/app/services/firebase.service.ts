import { Injectable, computed, inject, signal } from '@angular/core';
import type { LedgerPort } from '../ledger/ports/ledger.port';
import { Firestore, Timestamp, deleteField } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { CallableGateway } from './callable.gateway';
import { readReferrer, clearReferrer } from '../utils/referral';
import type { UnitSystem } from '../models/unit-system';
import type { CustomFood, ServingUnit } from '@macrolog/core';
import type {
  Exercise,
  ExerciseDraft,
  SessionDraft,
  SessionExercise,
  SessionStatus,
  TemplateDraft,
  TemplateExercise,
  WorkoutSession,
  WorkoutTemplate,
} from '../models/workout';
import { toDomainProfile, toDomainProfilePatch } from '../ledger/infrastructure/profile-mapper';
import { FirestoreLedgerCore } from '../ledger/infrastructure/firestore-ledger.core';

// ─── Log types ──────────────────────────────────────────────────
// Note: `liftCompleted` and `cardioCompleted` are legacy fields kept
// for reading historic docs. New writes only set `exerciseCompleted`.

/** Diary slot. Absent on legacy rows — those render in an "other"
 *  bucket, never silently reassigned to a slot. */
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface DailyLogDoc {
  weight?: number;
  calories: number;
  timestamp: Timestamp;
  protein?: number;
  carbs?: number;
  fat?: number;
  exerciseCompleted?: boolean;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
  mealLabel?: string;
  mealType?: MealType;
}

export interface DailyLog {
  id?: string;
  weight?: number;
  calories: number;
  date: Date;
  protein?: number;
  carbs?: number;
  fat?: number;
  exerciseCompleted?: boolean;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
  mealLabel?: string;
  mealType?: MealType;
}

// ─── Measurement types ──────────────────────────────────────────
export interface Measurement {
  id?: string;
  waist?: number;
  chest?: number;
  bicep?: number;
  hip?: number;
  /** Neck circumference (inches) — added 2026-06 for the Navy body-fat
   *  estimate. Optional; older rows lack it. */
  neck?: number;
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
  carbs?: number;
  fat?: number;
}

// ─── Custom food (My Foods library, ADR-0013) ───────────────────
// Single source of truth is @macrolog/core (shared with the Expo app);
// re-exported here so app imports resolve alongside the other domain types.
// The CustomFood.createdAt Date ⇄ Firestore Timestamp mapping lives in
// FirestoreLedgerCore, like every other dated field.
export type { CustomFood, ServingUnit };

/** Shape passed to addLog / updateLog — the fields the user submits. */
export interface LogEntry {
  weight?: number;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  exerciseCompleted?: boolean;
  mealLabel?: string;
  mealType?: MealType;
  timestamp?: Date; // for undo-restore at original time
}

// ─── Workout stored shapes (Timestamp at the seam) ──────────────
// Only top-level dated fields carry Timestamps; nested set/exercise
// objects have no Date fields. The FirestoreLedgerCore's workout
// mappers are the only place Timestamp ↔ Date conversion happens.
export interface ExerciseDoc {
  name: string;
  muscles: string[];
  defaultCues: string[];
  logStyle?: 'weight-reps' | 'bodyweight' | 'time';
  seedKey?: string;
  createdAt: Timestamp;
}

export interface WorkoutTemplateDoc {
  name: string;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  exercises: TemplateExercise[];
  seedKey?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WorkoutSessionDoc {
  status: SessionStatus;
  templateId?: string;
  templateName?: string;
  timestamp: Timestamp; // the session date
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  exercises: SessionExercise[];
  nextNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Profile types ──────────────────────────────────────────────
export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
/** Target weekly weight-change pace in lb/week. Continuous (slider) in
 *  [0, 2]; 0 = maintenance. Persisted to 0.1 precision via {@link clampCutPace}.
 *  (Was a discrete 0|0.5|1|1.5|2 union; widened so a lean cut can sit at,
 *  e.g., 0.9 lb/wk instead of being forced to a coarse 0.5/1.0 step.) */
export type CutPace = number;

/** Clamp a raw pace to the storable band and round to 0.1 lb/wk. */
export function clampCutPace(lbPerWeek: number): CutPace {
  if (!Number.isFinite(lbPerWeek)) return 1.0;
  return Math.max(0, Math.min(2, Math.round(lbPerWeek * 10) / 10));
}
// Re-export so existing imports of GoalDirection from this module keep
// working; the canonical definition lives in utils/macro-heuristic.ts
// alongside the kcal/protein multipliers it parameterizes.
export type { GoalDirection } from '../utils/macro-heuristic';
import type { GoalDirection } from '../utils/macro-heuristic';
import { clampProteinPerKg } from '../utils/macro-heuristic';

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
  /** Personal protein basis (g/kg, 1.6–2.2). Optional: omitted leaves the
   *  default 1.6 g/kg floor in effect. */
  proteinPerKg?: number;
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
  /** Personal safety floor for the daily calorie target, in kcal. Overrides
   *  the hardcoded MIN_DAILY_TARGET (1500) in the TDEE clamp so a
   *  water-suppressed measured TDEE can't silently push the target below a
   *  level the user has deemed too aggressive. Omitted ⇒ 1500 default. */
  calorieFloor?: number;
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
  manualProteinTarget?: number;   // heuristic snapshot (frozen grams) from onboarding
  // Personal protein basis on the g/kg standard (clamped 1.6–2.2). When set
  // it drives proteinTarget LIVE off current weight, overriding the frozen
  // manualProteinTarget snapshot. Lets a lean-cutting lifter dial e.g. 1.9.
  proteinPerKg?: number;
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
  /** Legacy-only: no longer written on new profiles (PII minimization,
   *  2026-07-07). Present on pre-existing docs; email otherwise lives in
   *  Firebase Auth. Never relied on by the client (all UI reads Auth). */
  email?: string;
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
 * The Angular face of the Firestore ledger adapter. All I/O is scoped to
 * the signed-in user's subtree at `users/{uid}`; methods throw if called
 * while unauthenticated — the UI is responsible for gating.
 *
 * Division of labour (issue #6 phase 3): every Firestore verb lives in
 * the framework-free {@link FirestoreLedgerCore} (emulator-tested via
 * `npm run test:ledger`); this service owns the profile signal, the
 * optimistic signal updates, auth/uid wiring, and the callable-backed
 * GDPR verbs.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService implements LedgerPort {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly callables = inject(CallableGateway);

  private readonly core = new FirestoreLedgerCore(this.firestore, () => this.requireUid());

  private readonly _profile = signal<Profile | null>(null);
  readonly profile = this._profile.asReadonly();
  /** True once the user has submitted onboarding. Drives the main gate. */
  readonly profileCompleted = computed(() => this._profile()?.profileCompleted === true);

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('FirebaseService called while unauthenticated.');
    return uid;
  }

  /**
   * Idempotent profile upsert. Call on every sign-in:
   *   - First time:      creates users/{uid} with profileCompleted=false
   *   - Subsequent times: update bumps lastSeenAt, leaves everything else alone
   *
   * Always populates the local profile signal with the latest state.
   */
  async ensureUserProfile(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ensureUserProfile called while unauthenticated.');

    // The core applies a hard 15s ceiling per Firestore call. The SDK
    // retries 504s internally without ever rejecting → app-shell loader
    // hangs forever. A surfaced timeout lets the caller put up retry UI.
    const existing = await this.core.readProfileDoc();
    const now = Timestamp.now();

    if (existing === null) {
      // PII minimization (2026-07-07): the email is NOT persisted to the
      // profile doc — it lives only in Firebase Auth. Server-side email
      // features (welcome, weekly digest) fetch it from Auth by uid.
      const initial: UserProfileDoc = {
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
      await this.core.createProfileDoc(initial);
      this._profile.set(toDomainProfile(initial));
    } else {
      // Map Timestamp -> Date at the seam; overlay the bumped lastSeenAt.
      this._profile.set({ ...toDomainProfile(existing), lastSeenAt: now.toDate() });
      // Bump lastSeenAt fire-and-forget — the loader was already gated
      // on the read, so the write doesn't need to block UI.
      void this.core.updateProfileDoc({ lastSeenAt: now }).catch((err) => {
        console.warn('lastSeenAt bump failed (non-fatal):', err);
      });
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

    await this.core.updateProfileDoc(patch);
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
    // Goal weight lives in TWO legacy fields (targetWeightLbs from onboarding,
    // goalWeightLbs read by the goal-progress bar). Keep them in sync, and
    // CLEAR both on "maintain" — otherwise a stale goalWeightLbs shadows the
    // new goal forever (the "redo onboarding didn't update it" bug).
    const goalWrite: Record<string, unknown> =
      submission.targetWeightLbs != null
        ? { targetWeightLbs: submission.targetWeightLbs, goalWeightLbs: submission.targetWeightLbs }
        : { targetWeightLbs: deleteField(), goalWeightLbs: deleteField() };
    await this.core.updateProfileDoc({ ...patch, ...goalWrite });
    const updated: Profile = { ...current, ...toDomainProfilePatch(patch) };
    if (submission.targetWeightLbs != null) {
      updated.targetWeightLbs = submission.targetWeightLbs;
      updated.goalWeightLbs = submission.targetWeightLbs;
    } else {
      delete (updated as any).targetWeightLbs;
      delete (updated as any).goalWeightLbs;
    }
    this._profile.set(updated);
  }

  /** Persist the Day-3 "Refine targets" sheet. Writes the full
      Mifflin-St Jeor inputs and DELETES the heuristic manual targets so
      the TDEE chain takes over from the next read. Stamps
      `targetsRefinedAt` so the prompting card disappears. */
  async saveRefinedTargets(submission: RefineTargetsSubmission): Promise<void> {
    const current = this._profile();
    if (!current) throw new Error('No profile loaded.');

    const stamp = Timestamp.now();
    const perKg = submission.proteinPerKg != null
      ? clampProteinPerKg(submission.proteinPerKg)
      : undefined;
    await this.core.updateProfileDoc({
      heightIn: submission.heightIn,
      age: submission.age,
      sex: submission.sex,
      activityLevel: submission.activityLevel,
      targetPaceLbsPerWeek: clampCutPace(submission.targetPaceLbsPerWeek),
      manualCaloriesTarget: deleteField(),
      manualProteinTarget: deleteField(),
      ...(perKg != null ? { proteinPerKg: perKg } : {}),
      targetsRefinedAt: stamp,
      lastSeenAt: stamp,
    });
    const updated: Profile = { ...current,
      heightIn: submission.heightIn,
      age: submission.age,
      sex: submission.sex,
      activityLevel: submission.activityLevel,
      targetPaceLbsPerWeek: clampCutPace(submission.targetPaceLbsPerWeek),
      targetsRefinedAt: stamp.toDate(),
    };
    if (perKg != null) updated.proteinPerKg = perKg;
    delete (updated as any).manualCaloriesTarget;
    delete (updated as any).manualProteinTarget;
    this._profile.set(updated);
  }

  /** Generate a new webhook API key (UUID v4) and persist on the profile. */
  async generateWebhookApiKey(): Promise<string> {
    const key = crypto.randomUUID();
    await this.core.updateProfileDoc({ webhookApiKey: key, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, webhookApiKey: key } as any);
    return key;
  }

  /** Revoke the webhook API key. */
  async revokeWebhookApiKey(): Promise<void> {
    await this.core.updateProfileDoc({ webhookApiKey: deleteField(), lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) {
      const updated = { ...current };
      delete (updated as any).webhookApiKey;
      this._profile.set(updated);
    }
  }

  /** Save FCM push token + timezone offset on the profile. */
  async saveFcmToken(token: string): Promise<void> {
    const tz = new Date().getTimezoneOffset();
    await this.core.updateProfileDoc({ fcmToken: token, timezoneOffsetMin: tz, lastSeenAt: Timestamp.now() });
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
    await this.core.updateProfileDoc({ fcmToken: deleteField(), lastSeenAt: Timestamp.now() });
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
    const tz = new Date().getTimezoneOffset();
    await this.core.updateProfileDoc({
      reminderHour: hour,
      timezoneOffsetMin: tz,
      lastSeenAt: Timestamp.now(),
    });
    const current = this._profile();
    if (current) this._profile.set({ ...current, reminderHour: hour, timezoneOffsetMin: tz } as any);
  }

  /** Save the user's personal daily-calorie safety floor (kcal). Pass null to
   *  clear it (reverts the TDEE clamp to the 1500 default). Range-guarded in
   *  firestore.rules; the UI should keep the value in a sane band. */
  async saveCalorieFloor(floor: number | null): Promise<void> {
    await this.core.updateProfileDoc({
      calorieFloor: floor == null ? deleteField() : floor,
      lastSeenAt: Timestamp.now(),
    });
    const current = this._profile();
    if (current) {
      const next = { ...current } as any;
      if (floor == null) delete next.calorieFloor;
      else next.calorieFloor = floor;
      this._profile.set(next);
    }
  }

  /** Start a fast — stores the given start time, or now if omitted.
   *  Accepts a past timestamp so users can backdate a fast they forgot
   *  to log when they actually stopped eating. */
  async startFast(startedAt?: Date): Promise<void> {
    const start = startedAt ? Timestamp.fromDate(startedAt) : Timestamp.now();
    const now = Timestamp.now();
    await this.core.updateProfileDoc({ fastStartedAt: start, lastSeenAt: now });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fastStartedAt: start.toDate() } as any);
  }

  /** Break the fast — clears the timestamp. */
  async breakFast(): Promise<void> {
    await this.core.updateProfileDoc({ fastStartedAt: null, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, fastStartedAt: null } as any);
  }

  /** Toggle travel mode on the profile. */
  async setTravelMode(on: boolean): Promise<void> {
    await this.core.updateProfileDoc({ travelMode: on, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, travelMode: on } as Profile);
  }

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
    await this.core.updateProfileDoc({ hiddenRecentLabels: next, lastSeenAt: Timestamp.now() });
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
    await this.core.updateProfileDoc({ hiddenRecentLabels: next, lastSeenAt: Timestamp.now() });
    if (current) this._profile.set({ ...current, hiddenRecentLabels: next } as Profile);
  }

  /** Persist the user's preferred unit system. Drives the default
   *  portion option (per-100g vs household) in the food-search picker.
   *  Writing the same value back is a no-op latency-wise — Firestore
   *  collapses the patch — so the callers can avoid local equality
   *  checks. */
  async setUnitSystem(system: UnitSystem): Promise<void> {
    await this.core.updateProfileDoc({ unitSystem: system, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, unitSystem: system } as Profile);
  }

  /** Persist the user's personal protein basis (g/kg). Clamped to the
   *  evidence-based [1.6, 2.2] band before writing. Drives proteinTarget
   *  live off current weight (overrides the frozen onboarding snapshot). */
  async setProteinPerKg(gPerKg: number): Promise<void> {
    const perKg = clampProteinPerKg(gPerKg);
    await this.core.updateProfileDoc({ proteinPerKg: perKg, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, proteinPerKg: perKg } as Profile);
  }

  /** Persist the target cut pace (lb/week) live from Settings — partial
   *  profile update, clamped to [0, 2] @ 0.1. Drives the measured-mode
   *  deficit (trueTdee − pace×3500/7) without re-running the full refine. */
  async setTargetPace(lbPerWeek: number): Promise<void> {
    const pace = clampCutPace(lbPerWeek);
    await this.core.updateProfileDoc({ targetPaceLbsPerWeek: pace, lastSeenAt: Timestamp.now() });
    const current = this._profile();
    if (current) this._profile.set({ ...current, targetPaceLbsPerWeek: pace } as Profile);
  }

  /** Toggle weekly-digest opt-in. Refreshes `timezoneOffsetMin` so the
   *  scheduled CF can fire at the user's local Sunday morning even after
   *  travel / DST. */
  async setWeeklyDigestOptIn(on: boolean): Promise<void> {
    const tz = new Date().getTimezoneOffset();
    await this.core.updateProfileDoc({
      weeklyDigestOptIn: on,
      timezoneOffsetMin: tz,
      lastSeenAt: Timestamp.now(),
    });
    const current = this._profile();
    if (current) this._profile.set({
      ...current, weeklyDigestOptIn: on, timezoneOffsetMin: tz,
    } as Profile);
  }

  // ─── Daily logs (FirestoreLedgerCore) ──────────────────────────
  async addLog(entry: LogEntry): Promise<string> {
    return this.core.addLog(entry);
  }

  async getRecentLogs(days = 14): Promise<DailyLog[]> {
    return this.core.getRecentLogs(days);
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    await this.core.updateLog(logId, entry);
  }

  /** Delete a log entry. */
  async deleteLog(logId: string): Promise<void> {
    await this.core.deleteLog(logId);
  }

  /** Bulk-create rows (switcher import). See the core for batching. */
  async importLogs(entries: readonly LogEntry[]): Promise<number> {
    return this.core.importLogs(entries);
  }

  // ─── Daily weights (FirestoreLedgerCore) ───────────────────────
  /** Get all daily weights as a map of dateKey → weight. */
  async getDailyWeights(): Promise<Record<string, number>> {
    return this.core.getDailyWeights();
  }

  /** Set (or overwrite) the weight for a specific day. Doc ID = dateKey. */
  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    await this.core.setDailyWeight(dateKey, weight);
  }

  // ─── Daily water (FirestoreLedgerCore) ─────────────────────────
  async getDailyWater(): Promise<Record<string, number>> {
    return this.core.getDailyWater();
  }

  async setDailyWater(dateKey: string, flOz: number): Promise<void> {
    await this.core.setDailyWater(dateKey, flOz);
  }

  async getDailySleep(): Promise<Record<string, number>> {
    return this.core.getDailySleep();
  }

  async setDailySleep(dateKey: string, hours: number): Promise<void> {
    await this.core.setDailySleep(dateKey, hours);
  }

  // ─── Meal presets (FirestoreLedgerCore) ────────────────────────
  async getPresets(): Promise<MealPreset[]> {
    return this.core.getPresets();
  }

  async addPreset(preset: Omit<MealPreset, 'id'>): Promise<string> {
    return this.core.addPreset(preset);
  }

  async deletePreset(presetId: string): Promise<void> {
    await this.core.deletePreset(presetId);
  }

  // ─── Custom foods (FirestoreLedgerCore) ─────────────────────────
  async getCustomFoods(): Promise<CustomFood[]> {
    return this.core.getCustomFoods();
  }

  /** Save a food to the library. `id` (the barcode for scanned foods) makes
   *  the write a deterministic upsert for de-dup / re-scan match; omit for an
   *  auto-id. Returns the doc id. */
  async addCustomFood(food: Omit<CustomFood, 'id'>, id?: string | null): Promise<string> {
    return this.core.addCustomFood(food, id);
  }

  async deleteCustomFood(foodId: string): Promise<void> {
    await this.core.deleteCustomFood(foodId);
  }

  // ─── Weekly reports (FirestoreLedgerCore) ──────────────────────
  async getLatestReport(): Promise<WeeklyReport | null> {
    return this.core.getLatestReport();
  }

  // ─── Body measurements (FirestoreLedgerCore) ───────────────────
  async getRecentMeasurements(count = 10): Promise<Measurement[]> {
    return this.core.getRecentMeasurements(count);
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<string> {
    return this.core.addMeasurement(entry);
  }

  async updateMeasurement(id: string, entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    await this.core.updateMeasurement(id, entry);
  }

  async deleteMeasurement(id: string): Promise<void> {
    await this.core.deleteMeasurement(id);
  }

  // ─── Workout (FirestoreLedgerCore) ─────────────────────────────
  async getExercises(): Promise<Exercise[]> {
    return this.core.getExercises();
  }

  async addExercise(exercise: ExerciseDraft): Promise<string> {
    return this.core.addExercise(exercise);
  }

  async updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void> {
    await this.core.updateExercise(id, patch);
  }

  async deleteExercise(id: string): Promise<void> {
    await this.core.deleteExercise(id);
  }

  /** Merge exercise `fromId` into `toId` across all sessions/templates,
   *  then delete the victim catalog doc. See the core for the batching. */
  async mergeExercises(fromId: string, toId: string): Promise<void> {
    await this.core.mergeExercises(fromId, toId);
  }

  async getTemplates(): Promise<WorkoutTemplate[]> {
    return this.core.getTemplates();
  }

  async addTemplate(template: TemplateDraft): Promise<string> {
    return this.core.addTemplate(template);
  }

  async updateTemplate(id: string, template: TemplateDraft): Promise<void> {
    await this.core.updateTemplate(id, template);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.core.deleteTemplate(id);
  }

  async getActiveSession(): Promise<WorkoutSession | null> {
    return this.core.getActiveSession();
  }

  async getRecentSessions(count = 30): Promise<WorkoutSession[]> {
    return this.core.getRecentSessions(count);
  }

  async getSessionsForTemplate(templateId: string, count = 10): Promise<WorkoutSession[]> {
    return this.core.getSessionsForTemplate(templateId, count);
  }

  async getAllSessions(): Promise<WorkoutSession[]> {
    return this.core.getAllSessions();
  }

  async startSession(session: SessionDraft): Promise<string> {
    return this.core.startSession(session);
  }

  async updateSession(id: string, patch: Partial<SessionDraft>): Promise<void> {
    await this.core.updateSession(id, patch);
  }

  async deleteSession(id: string): Promise<void> {
    await this.core.deleteSession(id);
  }
}
