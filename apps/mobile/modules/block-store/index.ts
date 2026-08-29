import { requireOptionalNativeModule } from 'expo';

/**
 * BlockStore — the TS face of Play Services' backup/restore key-value store
 * (`android/src/main/java/expo/modules/blockstore/`).
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module is
 * Android-only and absent from the iOS binary, from Expo Go and from the web
 * bundle, so every call below is a silent no-op there. Same shape as
 * `modules/quick-add-tile` and `modules/watch-link`.
 *
 * Why Block Store and not the Restore Credentials API that Play's Zero-Tap
 * requirement names: Restore Credentials needs a WebAuthn relying-party server,
 * which this project does not have. Google accepts Block Store as compliant
 * provided the integration is in production by 30 September 2026. See #107.
 */

interface BlockStoreNativeModule {
  storeBytes(key: string, value: string): Promise<boolean>;
  retrieveBytes(key: string): Promise<string | null>;
  deleteBytes(key: string): Promise<boolean>;
  isE2eeAvailable(): Promise<boolean>;
}

const native = requireOptionalNativeModule<BlockStoreNativeModule>('BlockStore');

/** True when Block Store is present in this binary (Android release builds). */
export const isBlockStoreAvailable = native != null;

/** Play Services' documented ceiling per entry. */
export const BLOCK_STORE_MAX_BYTES = 4096;

/**
 * Store a string for restore onto the user's next device.
 *
 * Returns false rather than throwing on every failure path — an absent module, a
 * declining device, an oversized payload. Callers treat a false as "the user
 * will sign in normally on their next phone", which is exactly the pre-existing
 * behaviour.
 */
export async function storeBytes(key: string, value: string): Promise<boolean> {
  if (new TextEncoder().encode(value).length > BLOCK_STORE_MAX_BYTES) return false;
  try {
    return (await native?.storeBytes(key, value)) ?? false;
  } catch {
    return false;
  }
}

/** Read a previously stored string, or null. Never throws. */
export async function retrieveBytes(key: string): Promise<string | null> {
  try {
    return (await native?.retrieveBytes(key)) ?? null;
  } catch {
    return null;
  }
}

/** Forget a stored string. Never throws. */
export async function deleteBytes(key: string): Promise<boolean> {
  try {
    return (await native?.deleteBytes(key)) ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether the backup would be end-to-end encrypted here (Android 9+ with a
 * screen lock). Checked before storing anything that can authenticate a user.
 */
export async function isE2eeAvailable(): Promise<boolean> {
  try {
    return (await native?.isE2eeAvailable()) ?? false;
  } catch {
    return false;
  }
}
