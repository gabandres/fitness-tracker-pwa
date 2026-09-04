/**
 * Classifying native Google Sign-In failures.
 *
 * Its own module, dependency-free, for the reason `health-errors.ts` is: a
 * predicate that decides whether a user can sign in has to be reachable from a
 * test, and importing `auth.tsx` drags Firebase's ESM build through a jest
 * transform that cannot handle it.
 */

/**
 * Is this Play Services' `INTERNAL_ERROR` (status code 8)?
 *
 * `statusCodes` from the library covers CANCELLED, IN_PROGRESS,
 * PLAY_SERVICES_NOT_AVAILABLE and SIGN_IN_REQUIRED — it has no member for
 * this one, so the raw code is the only handle. It arrives as the STRING "8"
 * on Android (that is what Sentry recorded), and the number 8 is accepted too
 * rather than trusting one representation of a value crossing the bridge.
 *
 * Matched on the code and never on the message, for the same reason the
 * provider check in `analyze-photo.ts` is: `INTERNAL_ERROR` is Google's
 * wording, not our contract.
 */
export function isGoogleInternalError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: unknown }).code;
  return code === 8 || code === '8';
}

