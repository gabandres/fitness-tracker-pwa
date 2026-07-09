/**
 * Firestore doc → domain mappers, single-sourced for BOTH frontends.
 *
 * The stored Firestore docs carry `Timestamp`-typed dates; the ledger seam
 * exposes plain `Date` (see `CONTEXT.md` → "Date type at the seam"). Every
 * adapter read maps here so no `Timestamp` ever escapes the adapter, and a
 * domain-field change lands once instead of in both the Angular PWA and the
 * Expo app.
 *
 * Framework-free by design (ADR-0012): this module NEVER imports
 * `firebase/firestore`. It matches `Timestamp` STRUCTURALLY via
 * {@link TimestampLike} — both frontends' real `Timestamp` satisfies
 * `{ toDate(): Date }`, so nothing SDK-specific needs importing. Each frontend
 * keeps its own `onSnapshot`/`getDocs` I/O and the `Timestamp` import; only the
 * pure shape-mapping folds in here.
 *
 * Precedent: this generalizes the web `profile-mapper.ts` (the original
 * structural-Timestamp mapper) and `prune-undefined.ts` (the write-path twin).
 *
 * NOTE: the three workout mappers (Exercise / WorkoutTemplate / WorkoutSession)
 * are deliberately NOT here — their domain types are per-frontend and
 * intentionally un-barreled (see `index.ts`), and the web applies
 * `normalizeClusterGroups` where mobile does not, so they are a separate change.
 */
import type { ProfileDateField } from './types';
import type { CustomFood, DailyLog, Measurement, Profile, WeeklyReport } from './types';

/** Structural match for a Firestore `Timestamp` without importing the SDK.
 *  Both frontends' `Timestamp` satisfies this. */
export interface TimestampLike {
  toDate(): Date;
}

export function isTimestampLike(v: unknown): v is TimestampLike {
  return v != null && typeof (v as TimestampLike).toDate === 'function';
}

/**
 * Coerce a stored date value to a `Date`. Accepts a Firestore `Timestamp`
 * (structurally) or an already-mapped `Date`; anything else (missing / bad
 * doc) falls back to `fallback` (epoch by default) rather than throwing, so a
 * malformed row degrades to a visible-but-safe value.
 */
export function toDate(v: unknown, fallback: Date = new Date(0)): Date {
  if (isTimestampLike(v)) return v.toDate();
  return v instanceof Date ? v : fallback;
}

/**
 * The ledger seam delivers log windows OLDEST-FIRST (`CONTEXT.md` → "Log
 * array order"). The underlying Firestore query is `timestamp`-desc, so callers
 * reverse the mapped rows. Stated once here; non-mutating.
 */
export function oldestFirst<T>(rows: readonly T[]): T[] {
  return rows.slice().reverse();
}

// ─── Daily logs ─────────────────────────────────────────────────
export function toDailyLog(id: string, data: Record<string, unknown>): DailyLog {
  return {
    id,
    calories: (data['calories'] as number) ?? 0,
    date: toDate(data['timestamp']),
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

// ─── Body measurements ──────────────────────────────────────────
export function toMeasurement(id: string, data: Record<string, unknown>): Measurement {
  return {
    id,
    date: toDate(data['timestamp']),
    waist: data['waist'] as number | undefined,
    chest: data['chest'] as number | undefined,
    bicep: data['bicep'] as number | undefined,
    hip: data['hip'] as number | undefined,
    neck: data['neck'] as number | undefined,
  };
}

// ─── Custom foods (My Foods library, ADR-0013) ──────────────────
/** Spread-through mapper: the stored shape mirrors {@link CustomFood} field
 *  for field, so only `id` and `createdAt` (Timestamp → Date) need touching. */
export function toCustomFood(id: string, data: Record<string, unknown>): CustomFood {
  return { ...data, id, createdAt: toDate(data['createdAt']) } as unknown as CustomFood;
}

// ─── Weekly reports ─────────────────────────────────────────────
export function toWeeklyReport(id: string, data: Record<string, unknown>): WeeklyReport {
  return {
    id,
    markdown: (data['markdown'] as string) ?? '',
    generatedAt: toDate(data['generatedAt']),
  };
}

// ─── Profile ────────────────────────────────────────────────────
// The date-typed profile fields, listed once. Kept in lockstep with
// `ProfileDateField` — the `satisfies` clause makes drift a compile error if a
// field is added to the union but not here.
const PROFILE_DATE_FIELDS = [
  'createdAt',
  'lastSeenAt',
  'fastStartedAt',
  'ageConfirmedAt',
  'welcomeEmailSentAt',
  'onboardingV2CompletedAt',
  'targetsRefinedAt',
  'compedUntil',
  'referralRewardGrantedAt',
  'lastWeeklyDigestSentAt',
] as const satisfies readonly ProfileDateField[];

// Exhaustiveness in BOTH directions. `satisfies` above proves every array entry
// is a real date field; this proves every date field is in the array. Add a
// field to `ProfileDateField` but forget it here and this line fails to compile
// — otherwise that field would silently keep leaking a Timestamp.
type _MissingDateField = Exclude<ProfileDateField, (typeof PROFILE_DATE_FIELDS)[number]>;
const _allDateFieldsCovered: _MissingDateField extends never ? true : never = true;
void _allDateFieldsCovered;

/** Shallow-copy `src`, converting every Timestamp-valued profile date field to
 *  a `Date`. Non-date fields pass through; `null`/`undefined` dates stay as-is;
 *  a field already a `Date` is left alone (idempotent). */
function convertProfileDates(src: Record<string, unknown>): Record<string, unknown> {
  const out = { ...src };
  for (const field of PROFILE_DATE_FIELDS) {
    const value = out[field];
    if (isTimestampLike(value)) {
      out[field] = value.toDate();
    }
  }
  return out;
}

/**
 * Convert a stored profile doc (Timestamp dates) into a domain
 * {@link Profile} (Date dates). The single Timestamp → Date conversion point
 * on the profile read path — every adapter read of the user doc goes through
 * here so no `Timestamp` escapes the seam.
 */
export function toDomainProfile(doc: Record<string, unknown>): Profile {
  return convertProfileDates(doc) as unknown as Profile;
}

/**
 * Same conversion for a partial write patch. The Firestore adapter builds one
 * Timestamp-typed `updateDoc` patch, then feeds it through here to produce the
 * Date-typed patch for its optimistic signal update — so the two never drift.
 */
export function toDomainProfilePatch(patch: Record<string, unknown>): Partial<Profile> {
  return convertProfileDates(patch) as unknown as Partial<Profile>;
}
