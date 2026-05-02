import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  Auth,
  AuthCredential,
  EmailAuthProvider,
  User,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut,
} from '@angular/fire/auth';
import { AnalyticsService } from './analytics.service';

/**
 * Metadata the sign-in UI needs to render an account-link prompt:
 * the email at play, and which provider ID already owns the account
 * so we can tell the user "sign in with X to link your Y".
 */
export interface PendingLinkInfo {
  readonly email: string;
  /** Concretely known existing provider, if Firebase's fetchSignInMethods
   * was able to tell us. With email-enumeration protection enabled (default
   * in newer projects), this will always come back `unknown` — see
   * `candidateProviders` for the fallback list the UI should offer instead. */
  readonly existingProvider: 'google.com' | 'microsoft.com' | 'password' | 'unknown';
  readonly attemptedProvider: 'google.com' | 'microsoft.com' | 'password';
  /** All providers the UI should let the user pick from when linking.
   * Always excludes `attemptedProvider` (that's the one that just failed).
   * When `existingProvider` is resolved, this list has a single entry;
   * under email-enumeration protection it carries the remaining two so
   * the user can pick. */
  readonly candidateProviders: ReadonlyArray<'google.com' | 'microsoft.com' | 'password'>;
}

/**
 * Multi-provider authentication.
 *
 * Providers supported:
 *   - Google (popup)
 *   - Microsoft (popup; multi-tenant + personal accounts)
 *   - Email/password (with required email verification)
 *
 * Verification gate: Firestore rules require `email_verified == true`
 * for all writes. Google returns verified emails by default. Password
 * sign-ups are unverified until the user clicks the link in the
 * verification email — the app surfaces a verify-your-email banner
 * and blocks write paths until then.
 *
 * Firebase persists the session in IndexedDB
 * (browserLocalPersistence is the default), so users stay signed in
 * across browser restarts until they explicitly sign out or the
 * browser evicts the storage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly analytics = inject(AnalyticsService);

  private readonly _user = signal<User | null>(null);
  /** Reactive current user, driven by Firebase's onAuthStateChanged. */
  readonly user = this._user.asReadonly();
  /** True once Firebase has reported an initial auth state (signed in or not). */
  readonly ready = signal(false);
  readonly isSignedIn = computed(() => this._user() !== null);

  // In-memory (tab-scoped) pending-link credential. When a sign-in attempt
  // fails with `auth/account-exists-with-different-credential`, we capture
  // the attempted credential + email here so the next successful sign-in
  // with the *existing* provider can link them. Not persisted — if the tab
  // closes, the user starts over, which is the right safety posture (we
  // don't want a stale credential hanging around across sessions).
  private pendingCredential: AuthCredential | null = null;
  private readonly _pendingLink = signal<PendingLinkInfo | null>(null);
  readonly pendingLink = this._pendingLink.asReadonly();

  /** True when the signed-in user's email is verified. Always true
      for Google sign-in; false for fresh email/password sign-ups
      until the user clicks the verification link. Used by the App
      shell to gate writes behind a "verify your email" screen. */
  readonly emailVerified = computed(() => this._user()?.emailVerified ?? false);

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this._user.set(user);
      this.ready.set(true);
    });

    // Funnel analytics: fire `email_verified` once when the user's
    // verification flag flips false → true. The flip happens after the
    // user clicks the link in their inbox AND we call reloadUser() —
    // covering the verify-banner gate. Tab-scoped latch prevents
    // re-fires from auth state churn.
    let lastEmailVerified = false;
    let lastUid: string | null = null;
    effect(() => {
      const u = this._user();
      if (!u) {
        lastEmailVerified = false;
        lastUid = null;
        return;
      }
      // New session for a different user — reset the latch.
      if (u.uid !== lastUid) {
        lastUid = u.uid;
        lastEmailVerified = u.emailVerified;
        return;
      }
      if (!lastEmailVerified && u.emailVerified) {
        lastEmailVerified = true;
        this.analytics.track('email_verified');
      }
    });
  }

  /** Returns true when the Firebase user was created in roughly the
   *  same moment as their last sign-in (within 5s). Distinguishes a
   *  popup that just minted a new account from one that signed an
   *  existing user back in — the only signal Firebase gives us
   *  client-side. */
  private isNewAccount(user: User): boolean {
    const created = user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : 0;
    const last = user.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : 0;
    if (!created || !last) return false;
    return Math.abs(last - created) < 5_000;
  }

  /**
   * Opens the Google sign-in popup. Throws if the popup is blocked
   * or closed. Email-domain restriction was removed when we expanded
   * to multiple providers (rules still require email_verified=true).
   */
  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    // Always show account chooser — avoids the "silently signed in as
    // the wrong Google account" footgun for people with multiple accounts.
    provider.setCustomParameters({ prompt: 'select_account' });
    this.analytics.track('signup_started', { provider: 'google.com' });
    try {
      const result = await signInWithPopup(this.auth, provider);
      await this.completeLinkIfPending(result.user);
      if (this.isNewAccount(result.user)) {
        this.analytics.track('signup_completed', { provider: 'google.com' });
      }
    } catch (err) {
      await this.capturePendingCredential(err, 'google.com');
      throw err;
    }
  }

  /**
   * Opens the Microsoft sign-in popup. Backed by an Azure App
   * Registration (audience: AzureADandPersonalMicrosoftAccount), so
   * personal Microsoft accounts (outlook/hotmail/live) AND any work
   * or school account can sign in. Provider must be enabled in
   * Firebase Console with the Azure app's client ID + secret.
   */
  async signInWithMicrosoft(): Promise<void> {
    const provider = new OAuthProvider('microsoft.com');
    // Force the account chooser instead of silently reusing whichever
    // Microsoft account the browser last authenticated. Same rationale
    // as `prompt: select_account` for Google.
    provider.setCustomParameters({ prompt: 'select_account' });
    // Request the standard OIDC scopes so Firebase can populate
    // user.email + user.displayName. `email` also flips
    // emailVerified=true on the resulting Firebase user.
    provider.addScope('email');
    provider.addScope('profile');
    this.analytics.track('signup_started', { provider: 'microsoft.com' });
    try {
      const result = await signInWithPopup(this.auth, provider);
      await this.completeLinkIfPending(result.user);
      if (this.isNewAccount(result.user)) {
        this.analytics.track('signup_completed', { provider: 'microsoft.com' });
      }
    } catch (err) {
      await this.capturePendingCredential(err, 'microsoft.com');
      throw err;
    }
  }

  /**
   * Creates a new email/password account. Sends a verification email
   * immediately. The user is signed in, but `emailVerified` is false
   * until they click the link, so Firestore writes will fail until
   * they do.
   */
  async signUpWithEmailPassword(email: string, password: string): Promise<void> {
    this.analytics.track('signup_started', { provider: 'password' });
    try {
      const result = await createUserWithEmailAndPassword(this.auth, email, password);
      this.analytics.track('signup_completed', { provider: 'password' });
      // Best-effort: a missing/blocked verification email is recoverable
      // via resendVerificationEmail() from the verify-banner.
      try {
        await sendEmailVerification(result.user);
      } catch (err) {
        console.warn('Failed to send verification email on sign-up:', err);
      }
    } catch (err) {
      // `email-already-in-use` means the email is already owned by some
      // provider. Surface a pendingLink so the UI can route the user to
      // sign in with that provider (and optionally add a password).
      await this.captureSignUpCollision(err, email, password);
      throw err;
    }
  }

  private async captureSignUpCollision(err: unknown, email: string, password: string): Promise<void> {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/email-already-in-use') return;
    let existingProvider: PendingLinkInfo['existingProvider'] = 'unknown';
    try {
      const methods = await fetchSignInMethodsForEmail(this.auth, email);
      if (methods.includes('google.com')) existingProvider = 'google.com';
      else if (methods.includes('microsoft.com')) existingProvider = 'microsoft.com';
      else if (methods.includes('password')) existingProvider = 'password';
    } catch {
      // Enumeration protection may swallow the lookup — leave as 'unknown'.
    }
    this.pendingCredential = EmailAuthProvider.credential(email, password);
    // Same rule as the popup path: offer the exact existing provider when we
    // know it, otherwise let the user choose between the providers they
    // didn't just attempt. `password` is the attempted provider here, so
    // strip it from the fallback list — suggesting it would just re-trigger
    // the same collision.
    const all: PendingLinkInfo['candidateProviders'] = ['google.com', 'microsoft.com', 'password'];
    const candidateProviders: PendingLinkInfo['candidateProviders'] =
      existingProvider !== 'unknown'
        ? [existingProvider]
        : all.filter((p) => p !== 'password');
    this._pendingLink.set({
      email,
      existingProvider,
      attemptedProvider: 'password',
      candidateProviders,
    });
  }

  /** Signs in an existing email/password user. */
  async signInWithEmailPassword(email: string, password: string): Promise<void> {
    try {
      const result = await signInWithEmailAndPassword(this.auth, email, password);
      await this.completeLinkIfPending(result.user);
    } catch (err) {
      await this.capturePendingCredential(err, 'password', { email, password });
      throw err;
    }
  }

  /** Sends a password-reset email. Errors propagate to the caller so
      the UI can show e.g. "no account with that email". */
  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  /** Re-sends the email-verification link to the current user. */
  async resendVerificationEmail(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('No user signed in.');
    await sendEmailVerification(user);
  }

  /** Forces a refresh of the current user's auth state. Call this
      after the user clicks the verification link in their email so
      the in-memory `emailVerified` flips true without a full reload. */
  async reloadUser(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;
    await user.reload();
    // reload() mutates the user object in place but doesn't re-emit
    // through onAuthStateChanged, so push a fresh reference into the
    // signal to wake any consumers.
    this._user.set(this.auth.currentUser);
  }

  async signOut(): Promise<void> {
    this.clearPendingLink();
    await fbSignOut(this.auth);
  }

  /** UI helper: user bailed out of a link flow. Drops the captured
      credential so a subsequent sign-in attempt doesn't silently link
      something the user doesn't want linked. */
  clearPendingLink(): void {
    this.pendingCredential = null;
    this._pendingLink.set(null);
  }

  /**
   * Inspects a sign-in error, and if it's an "email already used by a
   * different provider" crash, stashes the attempted credential + email
   * and publishes `pendingLink` so the UI can prompt the user to sign in
   * with the existing provider (then auto-link).
   *
   * `passwordOverride` is supplied when the attempted provider was
   * email/password — the AuthCredential returned by EmailAuthProvider
   * requires the raw password, which Firebase's error object doesn't
   * expose. Without that override we can't link email/password back onto
   * a Google-owned account, so we only set pendingLink when the caller
   * handed us the credentials.
   */
  private async capturePendingCredential(
    err: unknown,
    attemptedProvider: 'google.com' | 'microsoft.com' | 'password',
    passwordOverride?: { email: string; password: string },
  ): Promise<void> {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/account-exists-with-different-credential') return;
    const email = (err as { customData?: { email?: string } }).customData?.email;
    if (!email) return;

    let credential: AuthCredential | null = null;
    if (attemptedProvider === 'google.com') {
      credential = GoogleAuthProvider.credentialFromError(err as any);
    } else if (attemptedProvider === 'microsoft.com') {
      credential = OAuthProvider.credentialFromError(err as any);
    } else if (attemptedProvider === 'password' && passwordOverride) {
      credential = EmailAuthProvider.credential(passwordOverride.email, passwordOverride.password);
    }
    if (!credential) return;

    this.pendingCredential = credential;

    // Query which provider currently owns the email so the UI can say
    // "sign in with Google to link your Microsoft account" (as opposed
    // to a generic "different provider" message).
    let existingProvider: PendingLinkInfo['existingProvider'] = 'unknown';
    try {
      const methods = await fetchSignInMethodsForEmail(this.auth, email);
      // Newer Firebase projects enable email-enumeration protection by
      // default and return an empty array regardless of truth, so a
      // non-empty result is the only authoritative signal here.
      if (methods.includes('google.com')) existingProvider = 'google.com';
      else if (methods.includes('microsoft.com')) existingProvider = 'microsoft.com';
      else if (methods.includes('password')) existingProvider = 'password';
    } catch {
      // fetchSignInMethods can fail entirely if enumeration protection is on.
    }

    // Build the candidate list the UI will show. Exclude the provider that
    // just failed (linking it to itself doesn't make sense). When we know
    // the exact existing provider, offer just that one; otherwise let the
    // user pick between the other two.
    const all: PendingLinkInfo['candidateProviders'] = ['google.com', 'microsoft.com', 'password'];
    const candidateProviders: PendingLinkInfo['candidateProviders'] =
      existingProvider !== 'unknown'
        ? [existingProvider]
        : all.filter((p) => p !== attemptedProvider);

    this._pendingLink.set({ email, existingProvider, attemptedProvider, candidateProviders });
  }

  private async completeLinkIfPending(user: User): Promise<void> {
    const cred = this.pendingCredential;
    if (!cred) return;
    const target = this._pendingLink();
    if (!target || target.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
      // Email mismatch — user signed in with a different Google account
      // than the one the pending credential was attached to. Abandon the
      // link rather than associate the wrong account.
      this.clearPendingLink();
      return;
    }
    try {
      await linkWithCredential(user, cred);
    } catch (err) {
      // Most common failure: credential already used somewhere else. Log
      // but don't throw — the user is signed in successfully regardless.
      console.warn('linkWithCredential failed:', err);
    } finally {
      this.clearPendingLink();
    }
  }
}
