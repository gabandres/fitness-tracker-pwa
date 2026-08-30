import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from '@angular/fire/auth';

/**
 * Web auth, reduced to what the shell needs (ADR-0036).
 *
 * There is one signed-in surface left on the web — `/admin` — and one person
 * who uses it, through the Google account that carries the `admin` claim. So
 * this service offers exactly one way in. The Microsoft/Apple/email-password
 * flows, account linking, sign-up and password reset that used to live here
 * were deleted with the web logging app; the mobile app has its own auth.
 *
 * Firebase persists the session in IndexedDB (browserLocalPersistence is the
 * default), so the admin stays signed in across browser restarts until they
 * sign out or the browser evicts the storage.
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
  /** Always true for a Google sign-in; kept because the delete-account flow on
   *  `/privacy` and the rules both key on it. */
  readonly emailVerified = computed(() => this._user()?.emailVerified ?? false);

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this._user.set(user);
      this.ready.set(true);
    });
  }

  /** Opens the Google sign-in popup. Throws if the popup is blocked or
   *  closed. Always shows the account chooser so someone with several Google
   *  accounts is never silently signed in as the wrong one. */
  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(this.auth, provider);
  }

  /** Re-pull the user record so claim changes are visible without a reload. */
  async reloadUser(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;
    await user.reload();
    // reload() mutates in place and does not re-emit through
    // onAuthStateChanged, so push a fresh reference to wake consumers.
    this._user.set(this.auth.currentUser);
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
  }
}
