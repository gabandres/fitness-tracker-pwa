/**
 * Classifying Cloud Functions callable failures on the client.
 *
 * Its own module, dependency-free, for the reason `google-signin-errors.ts`
 * is: importing `auth.tsx` drags Firebase's ESM build through a jest transform
 * that cannot handle it, and these predicates decide what a user is told.
 */

/**
 * Did the response get lost on the way back, rather than the server refusing?
 *
 * When `fetch` itself rejects, the Firebase JS SDK has no HTTP status and no
 * body, so it reports `functions/internal` with the bare message `"internal"`
 * and no `details`. Every `internal` OUR callables throw carries
 * `details.code` (`functions/src/error-codes.ts`), so the missing details is
 * the tell.
 *
 * On iOS this is the common case of switching apps mid-request: the user signs
 * up, goes straight to Mail, iOS suspends the app with the request in flight,
 * and on return the request fails, even though the function ran to completion.
 * `IGNIA-MOBILE-13` (2026-11-07, 1.2.11 build 75) is that exact sequence: the
 * function logged `sent` at 18:36:22, the app went to the background at
 * 18:36:21, and the client recorded "internal" when it came back at 18:36:32.
 * The outcome is UNKNOWN, not failed.
 */
export function isLostCallableResponse(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, message, details } = e as { code?: unknown; message?: unknown; details?: unknown };
  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') return true;
  return code === 'functions/internal' && message === 'internal' && details == null;
}

/** Our typed rate-limit rejection (`ErrorCode.RATE_LIMITED`). */
export function isRateLimited(e: unknown): boolean {
  return (e as { details?: { code?: unknown } } | null)?.details?.code === 'RATE_LIMITED';
}

/**
 * The server refused an AI call because the caller's email is not verified
 * (`ErrorCode.EMAIL_NOT_VERIFIED`, decided from the ID token's
 * `email_verified` claim). Since 2026-11-19 an unverified account can log
 * everything; only the AI features that cost money stay locked until the email
 * is confirmed, and the server is the authority on that.
 *
 * Two shapes carry the code: a callable rejection puts it in `details.code`
 * (the `isRateLimited` convention), and the coach's HTTP stream rejects with a
 * `CoachError` whose own `code` is the server's JSON `{ code }`. A callable's
 * own `code` is always `functions/<status>`, so reading both cannot misfire.
 */
export function isEmailNotVerified(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, details } = e as { code?: unknown; details?: { code?: unknown } | null };
  return details?.code === 'EMAIL_NOT_VERIFIED' || code === 'EMAIL_NOT_VERIFIED';
}

/**
 * Runs a send whose outcome can be lost in transit, retrying ONCE when it is.
 *
 * A retry that comes back `RATE_LIMITED` counts as success: the verification
 * callable returns that when Firebase Auth throttles link generation because a
 * link was minted moments ago, which means the first attempt reached
 * the server. Telling the user "we couldn't send it" at that point would be
 * false. Any other failure on the retry is real and is rethrown.
 *
 * Only for idempotent-enough sends: a retry after a lost success sends a
 * second email, and both links work. That is better than a false "send
 * failed" banner on the signup wall.
 */
export async function sendWithLostResponseRetry(
  send: () => Promise<unknown>,
  onRetry?: (firstError: unknown) => void,
): Promise<void> {
  try {
    await send();
    return;
  } catch (e) {
    if (!isLostCallableResponse(e)) throw e;
    onRetry?.(e);
  }
  try {
    await send();
  } catch (e) {
    if (isRateLimited(e)) return;
    throw e;
  }
}
