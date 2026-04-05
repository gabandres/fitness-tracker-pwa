import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Auth,
  User,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut as fbSignOut,
} from '@angular/fire/auth';

/**
 * Google-only authentication. Firebase persists the session in
 * IndexedDB (browserLocalPersistence is the default), so users
 * stay signed in across browser restarts until they explicitly
 * sign out or the browser evicts the storage.
 *
 * Gmail-only is enforced in two places:
 *   1. Here in the client: if the signed-in user's email doesn't
 *      end in @gmail.com we immediately sign them out.
 *   2. In Firestore security rules: every read/write checks
 *      request.auth.token.email ends with @gmail.com.
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

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this._user.set(user);
      this.ready.set(true);
    });
  }

  /**
   * Opens the Google sign-in popup. Throws if the popup is blocked
   * or closed, or if the chosen account isn't a @gmail.com address.
   */
  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    // Always show account chooser — avoids the "silently signed in as
    // the wrong Google account" footgun for people with multiple accounts.
    provider.setCustomParameters({ prompt: 'select_account' });

    const result = await signInWithPopup(this.auth, provider);
    const email = result.user.email ?? '';

    if (!email.toLowerCase().endsWith('@gmail.com')) {
      // Not a gmail account — immediately sign them out.
      await fbSignOut(this.auth);
      throw new Error('Gmail accounts only. Choose a @gmail.com account.');
    }
  }

  async signOut(): Promise<void> {
    await fbSignOut(this.auth);
  }
}
