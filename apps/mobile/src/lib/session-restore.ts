import AsyncStorage from '@react-native-async-storage/async-storage';
import { FIREBASE_AUTH_STORAGE_KEY } from './firebase-config';
import {
  deleteBytes,
  isBlockStoreAvailable,
  isE2eeAvailable,
  retrieveBytes,
  storeBytes,
} from '../../modules/block-store';

/**
 * Zero-Tap Sign-In: carry the session onto the user's next Android device.
 *
 * ## Why this shape (issue #107)
 *
 * Play requires apps with sign-in to restore sign-in state across a device
 * migration from **April 2027**, and names the Restore Credentials API. That API
 * is WebAuthn end to end — its own docs make "set up a relying party server" a
 * prerequisite — and Ignia has no app server by design.
 *
 * Google accepts a **Block Store** integration as compliant instead, provided it
 * is in production on or before **30 September 2026**. Block Store needs no
 * server: it is a 16-entry, 4 KB-per-entry key/value store that Play Services
 * backs up with the device and hands back on restore.
 *
 * ## What is stored, and what that is worth to an attacker
 *
 * Firebase's React Native persistence already writes the whole session to
 * AsyncStorage. We store that same blob **with the access token blanked** — so
 * what travels is the refresh token plus identity fields. Two reasons for the
 * blank: an ID token expires in an hour and is worthless by the time a restore
 * happens, and dropping it keeps the payload around 1 KB instead of pushing at
 * the 4 KB ceiling.
 *
 * A refresh token IS a credential. It is stored only when Play Services reports
 * that the backup will be **end-to-end encrypted** — Android 9+ with a screen
 * lock — and it is deleted on sign-out and on account deletion. On a device that
 * cannot E2EE, this feature simply does nothing and the user signs in the way
 * they always have.
 *
 * ## Why restoring needs a reload
 *
 * `initializeAuth` reads AsyncStorage once, at import time in `firebase.ts`, and
 * never re-reads. Writing the blob after that point would be ignored, and racing
 * it is not something to build an auth path on. So when a restore payload is
 * found and there is no local session, the blob is written and the app reloads
 * **once** — guarded by a one-shot flag that makes a loop impossible even if
 * every subsequent step fails.
 *
 * That reload happens on exactly one launch: the first after a device migration,
 * when the user is already sitting in a restore flow. The alternative is asking
 * them to sign in, which is the thing the requirement exists to remove.
 *
 * ## Everything here is best-effort
 *
 * No function throws. This is an optimisation on top of a sign-in that already
 * works; any failure leaves the pre-existing behaviour exactly as it was.
 */

/** Namespaced so a future second payload cannot collide. */
const BLOCK_STORE_KEY = 'fit.ignia.app.session.v1';

/** One-shot guard. Set before the reload, so a failed restore cannot loop. */
const RESTORE_ATTEMPTED_KEY = 'sessionRestore.attempted.v1';

/** Firebase JS persists under `firebase:authUser:{apiKey}:{appName}`. */
const AUTH_KEY_PREFIX = 'firebase:authUser:';

async function findAuthKey(): Promise<string | null> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.find((k) => k.startsWith(AUTH_KEY_PREFIX)) ?? null;
}

/**
 * Drop the short-lived access token from a persisted auth blob.
 *
 * Returns null when the blob carries no refresh token, because without one there
 * is nothing a new device could do with it — storing that would be pure exposure
 * for no benefit.
 */
export function stripAccessToken(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const tokens = obj['stsTokenManager'];
    if (!tokens || typeof tokens !== 'object') return null;
    const t = tokens as Record<string, unknown>;
    if (typeof t['refreshToken'] !== 'string' || t['refreshToken'].length === 0) return null;
    return JSON.stringify({
      ...obj,
      stsTokenManager: { ...t, accessToken: '', expirationTime: 0 },
    });
  } catch {
    return null;
  }
}

/**
 * Mirror the current session into Block Store.
 *
 * Safe to call often — it is idempotent and cheap. Called when the auth state
 * settles on a signed-in user, so the stored refresh token stays current.
 */
export async function saveSessionForRestore(): Promise<boolean> {
  if (!isBlockStoreAvailable) return false;
  try {
    // A refresh token backed up without end-to-end encryption is a credential
    // sitting in Google's cloud under Google's key. Not worth a tap saved.
    if (!(await isE2eeAvailable())) return false;
    const key = await findAuthKey();
    if (!key) return false;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return false;
    const payload = stripAccessToken(raw);
    if (!payload) return false;
    return await storeBytes(BLOCK_STORE_KEY, payload);
  } catch {
    return false;
  }
}

/** Forget the stored session. Called on sign-out and account deletion. */
export async function clearStoredSession(): Promise<void> {
  if (!isBlockStoreAvailable) return;
  try {
    await deleteBytes(BLOCK_STORE_KEY);
    await AsyncStorage.removeItem(RESTORE_ATTEMPTED_KEY);
  } catch {
    /* best-effort: a stale entry is superseded by the next sign-in's write */
  }
}

/** What {@link restoreSessionIfNeeded} decided, for logging and for tests. */
export type RestoreOutcome =
  | 'unavailable' // no Block Store in this binary
  | 'already-signed-in' // a local session exists; nothing to do
  | 'already-attempted' // the one-shot guard has been spent
  | 'nothing-stored' // no payload from a previous device
  | 'restored'; // blob written; the caller should reload

/**
 * Restore a session from a previous device, if this looks like a fresh install
 * that has one waiting.
 *
 * Returns `'restored'` ONLY when the caller should reload the app. Every other
 * outcome means carry on exactly as before.
 *
 * The one-shot flag is written BEFORE the blob, deliberately: if the write or
 * the reload then fails, the next launch takes the `already-attempted` path
 * instead of trying again forever.
 */
export async function restoreSessionIfNeeded(): Promise<RestoreOutcome> {
  if (!isBlockStoreAvailable) return 'unavailable';
  try {
    if (await findAuthKey()) return 'already-signed-in';
    if (await AsyncStorage.getItem(RESTORE_ATTEMPTED_KEY)) return 'already-attempted';

    const payload = await retrieveBytes(BLOCK_STORE_KEY);
    if (!payload) return 'nothing-stored';

    const parsed: unknown = JSON.parse(payload);
    const blob = parsed as Record<string, unknown> | null;
    if (!blob || typeof blob['uid'] !== 'string') return 'nothing-stored';

    await AsyncStorage.setItem(RESTORE_ATTEMPTED_KEY, String(Date.now()));
    await AsyncStorage.setItem(FIREBASE_AUTH_STORAGE_KEY, payload);
    return 'restored';
  } catch {
    return 'nothing-stored';
  }
}
