import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Auth,
  User,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut as fbSignOut,
} from '@angular/fire/auth';

/**
 * Storage key used to stash the email address between "send link" and
 * "complete sign-in" — Firebase requires the same email on both sides.
 * If the user clicks the link on a different device, we prompt for it.
 */
const EMAIL_STORAGE_KEY = 'fitness.signin.email';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);

  private readonly _user = signal<User | null>(null);
  /** Reactive current user, driven by Firebase's onAuthStateChanged. */
  readonly user = this._user.asReadonly();
  /** True once Firebase has reported an initial auth state (signed in or not). */
  readonly ready = signal(false);
  /** Convenience computed for template use. */
  readonly isSignedIn = computed(() => this._user() !== null);

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this._user.set(user);
      this.ready.set(true);
    });
  }

  /**
   * Send a magic link to the given email and stash the address so
   * completeSignIn() can use it later. `url` is where Firebase should
   * redirect the user after they click the link — must be whitelisted
   * in the Firebase Auth authorized domains list.
   */
  async sendSignInLink(email: string): Promise<void> {
    const url = window.location.origin + '/';
    await sendSignInLinkToEmail(this.auth, email, {
      url,
      handleCodeInApp: true,
    });
    window.localStorage.setItem(EMAIL_STORAGE_KEY, email);
  }

  /**
   * Call on app bootstrap. If the current URL is a sign-in link (set
   * by Firebase when the user clicks the email), complete the flow.
   * Returns true if a sign-in was attempted (successful or not).
   */
  async completeSignInFromUrl(): Promise<boolean> {
    const href = window.location.href;
    if (!isSignInWithEmailLink(this.auth, href)) {
      return false;
    }

    let email = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    if (!email) {
      // Cross-device case: user clicked the link on a different device
      // than the one where they typed their email. Prompt them.
      email = window.prompt('Confirm your email address to finish signing in:');
      if (!email) return false;
    }

    await signInWithEmailLink(this.auth, email, href);
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);

    // Strip the sign-in params from the URL so a refresh doesn't re-trigger.
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
  }
}
