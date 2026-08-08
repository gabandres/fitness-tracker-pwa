import { requireOptionalNativeModule } from 'expo';

/**
 * QuickAddCredentials — the TS face of the Keychain envelope that lets an iOS
 * App Intent write to Firestore without Firebase (ADR-0020).
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module is
 * iOS-only and absent from the Android binary, from Expo Go and from web. An
 * optional require makes every call a silent no-op there — the same shape
 * `modules/watch-link` and `src/lib/widget.ts` use.
 *
 * Write-only from JS. The read side is Swift, in `targets/_shared/QuickAdd.swift`,
 * and the two agree on the keychain service/account by convention; see the
 * module's Swift header for why that is deliberate and what breaks if they drift.
 */

interface QuickAddCredentialsNativeModule {
  setCredentials(json: string): Promise<void>;
  clearCredentials(): Promise<void>;
  hasCredentials(): Promise<boolean>;
}

const native = requireOptionalNativeModule<QuickAddCredentialsNativeModule>('QuickAddCredentials');

/** True when the module is present in this binary (iOS dev/production build). */
export const isQuickAddCredentialsAvailable = native != null;

/**
 * What a native quick-add needs to reach Firestore on its own. Assembled in JS so
 * the API key and project id stay single-sourced in `firebase.ts` — Swift never
 * holds a second copy of either.
 */
export interface QuickAddCredentials {
  /** Long-lived; exchanged at `securetoken.googleapis.com` for an ID token. */
  refreshToken: string;
  /** The public web API key. Public by design (see CLAUDE.md), and it grants
   *  nothing without the refresh token. */
  apiKey: string;
  projectId: string;
  /** Whose ledger to write to. Also returned by the token exchange, but carried
   *  here so a write can be addressed before any network call. */
  uid: string;
}

/** Never rejects: a credential we could not store means the intents fall back to
 *  "open Ignia to sign in", which is the correct degraded state and must not
 *  surface as an error inside an auth state change. */
export async function setQuickAddCredentials(creds: QuickAddCredentials): Promise<void> {
  try {
    await native?.setCredentials(JSON.stringify(creds));
  } catch {
    /* best-effort */
  }
}

export async function clearQuickAddCredentials(): Promise<void> {
  try {
    await native?.clearCredentials();
  } catch {
    /* best-effort */
  }
}

export async function hasQuickAddCredentials(): Promise<boolean> {
  try {
    return (await native?.hasCredentials()) ?? false;
  } catch {
    return false;
  }
}
