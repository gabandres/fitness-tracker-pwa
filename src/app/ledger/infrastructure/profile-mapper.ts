import type {
  Profile,
  ProfileDateField,
  UserProfileDoc,
} from '../../services/firebase.service';

/**
 * The single Timestamp -> Date conversion point on the profile read path.
 *
 * Firestore stores profile dates as `Timestamp`; the ledger seam exposes
 * `Date` (see `CONTEXT.md` -> "Date type at the seam"). Every Firestore
 * adapter read of the user doc goes through {@link toDomainProfile} so no
 * `Timestamp` ever escapes the adapter. Intentionally free of Angular and
 * `firebase` imports so it can run framework-free under the contract suite.
 */

/** Structural match for a Firestore `Timestamp` without importing it. */
interface TimestampLike {
  toDate(): Date;
}

function isTimestampLike(v: unknown): v is TimestampLike {
  return (
    v != null &&
    typeof (v as TimestampLike).toDate === 'function'
  );
}

/** The date-typed profile fields, listed once. Kept in lockstep with
 *  {@link ProfileDateField} — the `satisfies` clause makes drift a
 *  compile error if a field is added to the union but not here. */
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

// Exhaustiveness in BOTH directions. `satisfies` above proves every array
// entry is a real date field; this proves every date field is in the array.
// Add a field to `ProfileDateField` but forget it here and this line fails
// to compile — otherwise that field would silently keep leaking a Timestamp.
type _MissingDateField = Exclude<ProfileDateField, (typeof PROFILE_DATE_FIELDS)[number]>;
const _allDateFieldsCovered: _MissingDateField extends never ? true : never = true;
void _allDateFieldsCovered;

/** Shallow-copy `src`, converting every Timestamp-valued profile date
 *  field to a `Date`. The shared core of both exports below. */
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
 * Convert a stored {@link UserProfileDoc} (Timestamp dates) into a domain
 * {@link Profile} (Date dates). Non-date fields pass through untouched;
 * `null` / `undefined` dates stay as-is. Idempotent: a field that is
 * already a `Date` is left alone, so re-mapping is harmless.
 */
export function toDomainProfile(doc: UserProfileDoc): Profile {
  return convertProfileDates(doc as unknown as Record<string, unknown>) as unknown as Profile;
}

/**
 * Same conversion for a partial write patch. The Firestore adapter builds
 * one Timestamp-typed doc patch for `updateDoc`, then feeds it through
 * here to produce the Date-typed patch for its optimistic signal update —
 * so the two never drift and `Timestamp` never reaches the signal.
 */
export function toDomainProfilePatch(
  patch: Partial<UserProfileDoc>,
): Partial<Profile> {
  return convertProfileDates(patch as Record<string, unknown>) as unknown as Partial<Profile>;
}
