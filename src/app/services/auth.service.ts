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
  linkWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut,
  unlink as fbUnlink,
  updateProfile,
} from '@angular/fire/auth';
import { AnalyticsService } from './analytics.service';
import { CallableGateway } from './callable.gateway';
import { TranslationService } from './translation.service';

/**
 * Metadata the sign-in UI needs to render an account-link prompt:
 * the email at play, and which provider ID already owns the account
 * so we can tell the user "sign in with X to link your Y".
 */
/** Sign-in methods an account can hold. Mirrors the mobile `LinkableProvider`,
 *  except mobile's Microsoft is a custom OIDC provider (`oidc.microsoft`)
 *  because the JS SDK can't validate a brokered `microsoft.com` credential
 *  outside a popup — a difference that only exists below this type. */
export type LinkableProvider = 'password' | 'google.com' | 'microsoft.com' | 'apple.com';

/** Why a link attempt failed, in terms the UI can phrase. `credential-in-use`
 *  is the one that is NOT retryable: that identity is already its own account. */
export type LinkFailure =
  | 'cancelled'
  | 'already-linked'
  | 'credential-in-use'
  | 'requires-recent-login'
  | 'last-provider'
  | 'failed';

export class LinkError extends Error {
  constructor(readonly failure: LinkFailure) {
    super(failure);
  }
}

export interface PendingLinkInfo {
  readonly email: string;
  /** Concretely known existing provider, if Firebase's fetchSignInMethods
   * was able to tell us. With email-enumeration protection enabled (default
   * in newer projects), this will always come back `unknown` — see
   * `candidateProviders` for the fallback list the UI should offer instead. */
  readonly existingProvider: 'google.com' | 'microsoft.com' | 'apple.com' | 'password' | 'unknown';
  readonly attemptedProvider: 'google.com' | 'microsoft.com' | 'apple.com' | 'password';
  /** All providers the UI should let the user pick from when linking.
   * Always excludes `attemptedProvider` (that's the one that just failed).
   * When `existingProvider` is resolved, this list has a single entry;
   * under email-enumeration protection it carries the remaining two so
   * the user can pick. */
  readonly candidateProviders: ReadonlyArray<'google.com' | 'microsoft.com' | 'apple.com' | 'password'>;
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
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);

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

  async signInWithApple(): Promise<void> {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    this.analytics.track('signup_started', { provider: 'apple.com' });
    try {
      const result = await signInWithPopup(this.auth, provider);
      await this.completeLinkIfPending(result.user);
      if (this.isNewAccount(result.user)) {
        this.analytics.track('signup_completed', { provider: 'apple.com' });
      }
    } catch (err) {
      await this.capturePendingCredential(err, 'apple.com');
      throw err;
    }
  }

  /**
   * Creates a new email/password account. Sends a verification email
   * immediately. The user is signed in, but `emailVerified` is false
   * until they click the link, so Firestore writes will fail until
   * they do.
   */
  async signUpWithEmailPassword(email: string, password: string, displayName?: string): Promise<void> {
    this.analytics.track('signup_started', { provider: 'password' });
    try {
      const result = await createUserWithEmailAndPassword(this.auth, email, password);
      this.analytics.track('signup_completed', { provider: 'password' });
      // Set the display name (first + last) so greetings/share cards have it.
      const name = displayName?.trim();
      if (name) {
        try {
          await updateProfile(result.user, { displayName: name });
        } catch (err) {
          console.warn('updateProfile(displayName) failed on sign-up:', err);
        }
      }
      // Best-effort: a missing/blocked verification email is recoverable
      // via resendVerificationEmail() from the verify-banner.
      try {
        await this.sendVerificationEmail();
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

  /**
   * Sends a password-reset email through our own `sendPasswordReset`
   * callable rather than Firebase's client SDK.
   *
   * Firebase's built-in mail is sent from `noreply@<project>.firebaseapp.com`
   * — a domain we don't control, so it fails DMARC alignment with ignia.fit
   * and is unbrandable. The callable generates the same action link
   * server-side and delivers it via Resend from our own domain.
   *
   * The server answers `{ ok: true }` for any syntactically valid address,
   * present or not, so this deliberately CANNOT report "no account with
   * that email" — that response was an enumeration oracle. The UI shows the
   * same neutral confirmation either way (it already did). Errors still
   * propagate for malformed input and rate limiting.
   */
  async sendPasswordReset(email: string): Promise<void> {
    await this.callables.call<{ email: string; locale: string }, { ok: true }>(
      'sendPasswordReset',
      { email, locale: this.translation.language() },
    );
  }

  /**
   * Sends the email-verification link through our own `sendVerificationEmail`
   * callable rather than the client SDK's `sendEmailVerification`.
   *
   * Same reasoning as `sendPasswordReset` above, and it matters more here:
   * verification is the signup wall, so mail that lands in junk is a user who
   * never reaches the product. Firebase's own sender cannot be moved to our
   * domain on this project — every write to the Auth email config is refused
   * with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` while email-enumeration
   * protection is enabled, and that protection is worth more than the setting.
   *
   * The callable reads the address from the auth token, so there is nothing
   * to pass and nothing a caller can spoof.
   */
  async sendVerificationEmail(): Promise<void> {
    await this.callables.call<{ locale: string }, { ok: true; alreadyVerified?: boolean }>(
      'sendVerificationEmail',
      { locale: this.translation.language() },
    );
  }

  /** Re-sends the email-verification link to the current user. */
  async resendVerificationEmail(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('No user signed in.');
    await this.sendVerificationEmail();
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
    attemptedProvider: 'google.com' | 'microsoft.com' | 'apple.com' | 'password',
    passwordOverride?: { email: string; password: string },
  ): Promise<void> {
    const code = (err as { code?: string })?.code;
    if (code !== 'auth/account-exists-with-different-credential') return;
    const email = (err as { customData?: { email?: string } }).customData?.email;
    if (!email) return;

    let credential: AuthCredential | null = null;
    if (attemptedProvider === 'google.com') {
      credential = GoogleAuthProvider.credentialFromError(err as any);
    } else if (attemptedProvider === 'microsoft.com' || attemptedProvider === 'apple.com') {
      // Both are OAuthProvider-backed, and `signInWithApple` already passes
      // 'apple.com' in — without this branch that call captured nothing and the
      // link prompt never appeared for Apple.
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

  // ---- Account linking (Settings → sign-in methods) ------------------------

  /**
   * Sign-in methods currently attached to the account, read off Firebase's own
   * `providerData` — the only source that stays honest after a link/unlink.
   *
   * This is the *proactive* half of linking: `pendingLink` above only fires
   * when a provider hands back an email that already exists, which never
   * happens for Apple's Hide My Email relay addresses. Connecting from a
   * signed-in session is the path that covers those.
   */
  readonly linkedProviders = computed<readonly LinkableProvider[]>(() =>
    (this._user()?.providerData ?? [])
      .map((p) => p.providerId)
      .filter(
        (id): id is LinkableProvider =>
          id === 'password' ||
          id === 'google.com' ||
          id === 'microsoft.com' ||
          id === 'apple.com',
      ),
  );

  /** Attaches another provider to the CURRENT account via its popup. */
  async linkProvider(providerId: Exclude<LinkableProvider, 'password'>): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new LinkError('failed');
    if (this.linkedProviders().includes(providerId)) throw new LinkError('already-linked');
    const provider =
      providerId === 'google.com' ? new GoogleAuthProvider() : new OAuthProvider(providerId);
    provider.setCustomParameters({ prompt: 'select_account' });
    if (providerId !== 'google.com') {
      (provider as OAuthProvider).addScope('email');
    }
    try {
      await linkWithPopup(user, provider);
      this._user.set(this.auth.currentUser);
    } catch (err) {
      throw this.toLinkError(err);
    }
  }

  /** Adds an email/password credential to a federated-only account, using the
   *  account's own email, so the user gains a second way in. */
  async linkPassword(password: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user?.email) throw new LinkError('failed');
    try {
      await linkWithCredential(user, EmailAuthProvider.credential(user.email, password));
      this._user.set(this.auth.currentUser);
    } catch (err) {
      throw this.toLinkError(err);
    }
  }

  /** Detaches a provider. Refuses on the last one — Firebase would happily
   *  leave an account with no way to sign in, which is unrecoverable. */
  async unlinkProvider(providerId: LinkableProvider): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new LinkError('failed');
    if (this.linkedProviders().length <= 1) throw new LinkError('last-provider');
    try {
      await fbUnlink(user, providerId);
      this._user.set(this.auth.currentUser);
    } catch (err) {
      throw this.toLinkError(err);
    }
  }

  private toLinkError(err: unknown): LinkError {
    if (err instanceof LinkError) return err;
    const code = (err as { code?: string })?.code ?? '';
    if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
      return new LinkError('cancelled');
    }
    if (code.includes('provider-already-linked')) return new LinkError('already-linked');
    if (code.includes('credential-already-in-use') || code.includes('email-already-in-use')) {
      return new LinkError('credential-in-use');
    }
    if (code.includes('requires-recent-login')) return new LinkError('requires-recent-login');
    return new LinkError('failed');
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
