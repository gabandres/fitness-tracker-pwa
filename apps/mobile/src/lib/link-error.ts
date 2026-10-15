/**
 * Account-linking types, deliberately free of any Firebase import.
 *
 * `auth.tsx` pulls in `firebase/auth`, which ships untranspiled ESM — so any
 * consumer that only needs the error TYPE (a component deciding how to phrase
 * a failure, a test asserting the phrasing) would otherwise drag the whole SDK
 * into its module graph. Keeping these here means the UI layer depends on the
 * vocabulary, not the transport.
 */

/** The provider IDs this app can attach to one account. `oidc.microsoft` is a
 *  custom OIDC provider, not Firebase's built-in `microsoft.com` — the JS SDK
 *  cannot validate a brokered microsoft.com credential outside a popup. */
export type LinkableProvider = 'password' | 'google.com' | 'apple.com' | 'oidc.microsoft';

/**
 * Coded error for the "add a provider to the account I'm already signed into"
 * flow. Distinct from the sign-in errors because the failures differ in kind:
 * `credential-in-use` means the identity is already a SEPARATE Firebase user,
 * which is unrecoverable without merging data and must never be presented as
 * "try again".
 */
export class LinkError extends Error {
  constructor(
    readonly code:
      | 'cancelled'
      | 'unavailable'
      | 'no-user'
      | 'already-linked'
      | 'credential-in-use'
      | 'requires-recent-login'
      | 'last-provider'
      | 'weak-password'
      | 'failed',
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/**
 * A federated credential captured mid-collision, waiting for the user to prove
 * they own the account by signing in with the provider that already holds the
 * email. Mirrors the web `PendingLinkInfo`.
 */
export interface PendingLink {
  readonly email: string;
  readonly attemptedProvider: LinkableProvider;
  /**
   * Which method already owns the email, when Firebase will say. Drives the
   * prompt: "sign in with your password below" is a dead end for an account
   * that only ever had Google. `null` = unknown, and it is the COMMON case —
   * email-enumeration protection makes `fetchSignInMethodsForEmail` answer
   * empty — so the prompt must have a neutral form, never assume a password.
   */
  readonly existingProvider?: LinkableProvider | null;
}

/** Squash an unknown native error into one short, readable line. */
export function describeNativeError(e: unknown): string {
  const code = (e as { code?: string | number })?.code;
  const name = (e as { name?: string })?.name;
  const message = (e as { message?: string })?.message ?? String(e);
  return `${code ?? name ?? 'no-code'} · ${message}`.replace(/\s+/g, ' ').slice(0, 180);
}

/** Maps a Firebase error onto a LinkError. Anything unrecognised stays
 *  `failed` WITH its native code attached, so an unmapped case is still
 *  diagnosable from a screenshot rather than collapsing to "try again". */
export function toLinkError(e: unknown): LinkError {
  if (e instanceof LinkError) return e;
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('provider-already-linked')) return new LinkError('already-linked');
  // Both codes mean "this Google/Apple identity is already its own account".
  if (code.includes('credential-already-in-use') || code.includes('email-already-in-use')) {
    return new LinkError('credential-in-use');
  }
  if (code.includes('requires-recent-login')) return new LinkError('requires-recent-login');
  // Adding a password runs the project's password policy. Its rejection used
  // to fall through to `failed` and read "That didn't work. Please try
  // again." — and trying the same password again can never work.
  if (code.includes('weak-password') || code.includes('password-does-not-meet')) {
    return new LinkError('weak-password');
  }
  return new LinkError('failed', describeNativeError(e));
}

/**
 * Tags a sign-in error whose credential WAS parked for linking, so the screen
 * can show the link prompt instead of the raw message.
 *
 * The screen used to suppress every `account-exists-with-different-credential`
 * on the assumption that a prompt was showing — but the credential is only
 * parked when Firebase hands back both an email and the rejected credential.
 * Without either, nothing was parked, no prompt rendered, and the tap ended in
 * silence (audit 2026-10-15). The tag makes "a prompt is showing" a fact the
 * auth layer states, not one the screen infers from the error code.
 */
export function markLinkCaptured<T>(e: T, captured: boolean): T {
  if (captured && e != null && typeof e === 'object') {
    (e as { linkCaptured?: boolean }).linkCaptured = true;
  }
  return e;
}

/** See {@link markLinkCaptured}. */
export function isLinkCaptured(e: unknown): boolean {
  return (e as { linkCaptured?: unknown } | null)?.linkCaptured === true;
}
