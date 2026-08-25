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
