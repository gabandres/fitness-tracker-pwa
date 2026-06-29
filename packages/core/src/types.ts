/**
 * Shared domain types — the Date-typed shapes that cross the ledger seam
 * and are consumed by UI / derivations in BOTH the Angular PWA and the
 * Expo app. Stored-doc shapes (Firestore `Timestamp`-typed) are NOT here;
 * they stay per-frontend next to the SDK that owns `Timestamp`.
 *
 * Source of truth: `@macrolog/core`. The Angular app re-exports these from
 * `services/firebase.service.ts` so existing imports keep working.
 */
import type { GoalDirection } from './macro-heuristic';
import type { UnitSystem } from './unit-system';

// ─── Log types ──────────────────────────────────────────────────
// Note: `liftCompleted` and `cardioCompleted` are legacy fields kept
// for reading historic docs. New writes only set `exerciseCompleted`.

/** Diary slot. Absent on legacy rows — those render in an "other"
 *  bucket, never silently reassigned to a slot. */
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

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

  // Public profile (opt-in transformation page at /u/<slug>).
  publicSlug?: string;
  publicProfileEnabled?: boolean;
  publicDisplayName?: string;

  // Recent-entry suppressions. Per-label hide list so quick-add chips can
  // be dismissed without destroying the underlying log rows. Comparison is
  // case-insensitive — labels are normalized to lowercase at write time.
  hiddenRecentLabels?: string[];

  // Unit system for portion display. `us` (default) leaves behavior
  // unchanged when undefined; `metric` makes per-100g the default option.
  unitSystem?: UnitSystem;

  // Weekly digest opt-in. `lastWeeklyDigestSentAt` is server-stamped;
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

/** Date-typed fields on the profile. Listed once so a stored-doc type
 *  can override exactly these to `Timestamp` and the mapper can convert
 *  exactly these back to `Date`. */
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
