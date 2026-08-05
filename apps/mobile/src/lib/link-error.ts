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
}
