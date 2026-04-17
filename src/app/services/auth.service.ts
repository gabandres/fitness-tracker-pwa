import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Auth,
  User,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut,
} from '@angular/fire/auth';

/**
 * Multi-provider authentication.
 *
 * Providers supported:
 *   - Google (popup)
 *   - Email/password (with required email verification)
 *
 * Microsoft is wired in a follow-up commit (needs an Azure App
 * Registration).
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

  private readonly _user = signal<User | null>(null);
  /** Reactive current user, driven by Firebase's onAuthStateChanged. */
  readonly user = this._user.asReadonly();
  /** True once Firebase has reported an initial auth state (signed in or not). */
  readonly ready = signal(false);
  readonly isSignedIn = computed(() => this._user() !== null);

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
    await signInWithPopup(this.auth, provider);
  }

  /**
   * Creates a new email/password account. Sends a verification email
   * immediately. The user is signed in, but `emailVerified` is false
   * until they click the link, so Firestore writes will fail until
   * they do.
   */
  async signUpWithEmailPassword(email: string, password: string): Promise<void> {
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    // Best-effort: a missing/blocked verification email is recoverable
    // via resendVerificationEmail() from the verify-banner.
    try {
      await sendEmailVerification(result.user);
    } catch (err) {
      console.warn('Failed to send verification email on sign-up:', err);
    }
  }

  /** Signs in an existing email/password user. */
  async signInWithEmailPassword(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
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
    await fbSignOut(this.auth);
  }
}
