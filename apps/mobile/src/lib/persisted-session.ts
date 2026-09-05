import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The last signed-in session, read straight off disk without waiting for
 * Firebase Auth.
 *
 * ## Why this exists (#83)
 *
 * `onAuthStateChanged` does not fire until Firebase has validated the restored
 * user's ID token, and that validation is a network call with no timeout we
 * control. Measured on the LG G6 against a black-holed DNS: **8,690 ms** to the
 * first auth event, against **771 ms** on a working network. Until it fires,
 * `initializing` is true and the root layout holds a full-screen, tap-eating
 * splash over the app — so a dead network costs nearly nine seconds of a screen
 * that answers nothing.
 *
 * None of that wait buys information we do not already have. Firebase's own
 * React Native persistence writes the session to `AsyncStorage` on every auth
 * change, so the uid of the last signed-in user is sitting on disk and can be
 * read in single-digit milliseconds. That is enough to answer the only question
 * the gate is blocked on: *is there a session here at all, and whose?*
 *
 * ## What this is NOT
 *
 * **It is not authentication, and it must never be treated as such.** A record
 * on disk proves someone signed in on this device once, not that the session is
 * still valid — the token may be expired, revoked, or belong to a deleted
 * account. Nothing here grants access to anything: every read and write still
 * goes through `firestore.rules`, which sees the real Firebase session or no
 * session at all. The presumed uid only decides which cached screen to paint
 * while the real answer is in flight, and it is discarded the instant
 * `onAuthStateChanged` fires — whatever that says wins, including "signed out".
 */

/** Firebase JS persists under `firebase:authUser:{apiKey}:{appName}`. */
const AUTH_KEY_PREFIX = 'firebase:authUser:';

export interface PersistedSession {
  uid: string;
  /** Mirrors `User.emailVerified`; the gate routes on it before Firebase answers. */
  emailVerified: boolean;
}

/**
 * Parse Firebase's persisted auth blob. Exported for tests — the shape is the
 * SDK's, not ours, so it is worth pinning what we depend on: exactly two
 * fields, both of which have been stable across the v9→v12 major versions.
 */
export function parsePersistedSession(raw: string | null): PersistedSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const uid = (parsed as Record<string, unknown>)['uid'];
    if (typeof uid !== 'string' || uid.length === 0) return null;
    // Absent means "not verified" rather than "unknown": treating a missing
    // flag as verified would route an unverified signup straight into the app,
    // where every write then fails the rules' email_verified gate.
    return { uid, emailVerified: (parsed as Record<string, unknown>)['emailVerified'] === true };
  } catch {
    // A corrupt blob is not an error worth surfacing — it just means we wait
    // for Firebase like we always did.
    return null;
  }
}

/**
 * The persisted session, or null if there is none / it cannot be read.
 *
 * Never throws and never rejects: every failure mode here (no key, corrupt
 * JSON, AsyncStorage unavailable) has the same correct answer — "we do not
 * know, fall back to waiting for Firebase".
 */
export async function readPersistedSession(): Promise<PersistedSession | null> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const key = keys.find((k) => k.startsWith(AUTH_KEY_PREFIX));
    if (!key) return null;
    return parsePersistedSession(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

// ─── A null verdict that the disk contradicts ───────────────────────────────
//
// Firebase can answer `onAuthStateChanged(null)` on a launch where its OWN
// persisted session is still sitting in AsyncStorage. That is not what a
// sign-out looks like: every path by which the SDK decides "signed out" — an
// explicit `signOut()`, a revoked or expired token it could not refresh, a
// deleted account — removes the blob BEFORE it notifies listeners. A null
// verdict with the blob intact therefore means the SDK never read it: the
// persistence probe failed or raced and it fell back to in-memory persistence.
//
// The one place this has been seen is right after an OTA apply: `reloadAsync`
// restarts the JS runtime, Firebase re-initialises from AsyncStorage, and the
// owner's iPhone landed on the sign-in screen — while reopening the app
// restored the session untouched, which is exactly the signature above.
// Reopening is the fix, so the app does it itself: one reload, guarded by a
// one-shot flag so a persistent failure degrades to today's behaviour (the
// sign-in screen) rather than a loop. The flag is cleared the next time
// Firebase produces a user, so each future occurrence gets its own retry.
//
// This is NOT a way of keeping a revoked session alive. When Firebase means
// "signed out" the blob is gone and this path never engages; when the blob is
// present the reload simply asks Firebase again, and whatever it says then is
// applied exactly as before.

/** One-shot guard. Set before the reload, so a failed retry cannot loop. */
const REHYDRATE_RETRIED_KEY = 'auth.rehydrateRetried.v1';

export type NullVerdictAction = 'signed-out' | 'reload';

/**
 * What to do with a null auth verdict. Pure, so the decision is testable
 * without AsyncStorage or a runtime: reload only when the disk still holds a
 * session AND this launch has not already retried.
 */
export function nullVerdictAction(input: {
  sessionOnDisk: boolean;
  alreadyRetried: boolean;
}): NullVerdictAction {
  if (!input.sessionOnDisk) return 'signed-out';
  if (input.alreadyRetried) return 'signed-out';
  return 'reload';
}

/**
 * Decide how to treat a null verdict, and arm the one-shot guard when the
 * answer is `'reload'`. Never throws: any storage failure answers
 * `'signed-out'`, which is what the app did before this existed.
 */
export async function reconcileNullVerdict(): Promise<NullVerdictAction> {
  try {
    const [session, retried] = await Promise.all([
      readPersistedSession(),
      AsyncStorage.getItem(REHYDRATE_RETRIED_KEY),
    ]);
    const action = nullVerdictAction({ sessionOnDisk: session != null, alreadyRetried: retried != null });
    if (action === 'reload') await AsyncStorage.setItem(REHYDRATE_RETRIED_KEY, String(Date.now()));
    return action;
  } catch {
    return 'signed-out';
  }
}

/** Disarm the guard once Firebase has produced a user again. Never throws. */
export async function clearRehydrateRetry(): Promise<void> {
  try {
    await AsyncStorage.removeItem(REHYDRATE_RETRIED_KEY);
  } catch {
    /* best-effort */
  }
}
