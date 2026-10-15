import { useEffect, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchVersionManifest,
  installedIdentity,
  isGateableRuntime,
  versionKey,
  type InstalledIdentity,
  type VersionManifest,
} from '@/lib/app-update';

// "Update required" — the server-controlled floor under which a binary is no
// longer supported.
//
// Why it exists: an OTA has to be published once per runtime still in users'
// hands, and every retired runtime kept alive is another publish, another
// fingerprint gate and another chance of shipping JS a binary cannot run.
// Once a new binary is LIVE in the store, the owner raises the minimum from
// the admin console (`adminSetMinAppVersion`) and the older runtimes are
// retired: they see a full-screen, non-dismissible screen whose one action is
// the store listing. `apps/mobile/AGENTS.md` "Which runtimes get an OTA" is the
// policy.
//
// The source is `android.minVersionCode` / `ios.minVersion` in the same
// `/app-version.json` the store banner reads. Every rule below errs toward NOT
// blocking: a false "update required" locks someone out of their own data
// behind a store page that may have nothing for them, which is far worse than
// one more release on an old runtime.

/** Last minimum this device successfully fetched, raw as served (Android a
 *  versionCode, iOS a marketing version). Lets the gate hold offline — but
 *  only after the device has SEEN a minimum online; with no cache and no
 *  network it never blocks. */
export const MIN_CACHE_KEY = 'appUpdate.minRequired';

/**
 * Is the running binary below the minimum? Pure. Null on either side means we
 * do not know — never guess, and never block on a guess.
 */
export function isUpdateRequired(current: number | null, min: number | null): boolean {
  if (current == null || min == null) return false;
  return current < min;
}

/** A served minimum as a comparable number for `os`, or null when absent or
 *  unparseable — the same key spaces `pickStoreTarget` uses. Pure. */
export function minKey(os: string, raw: unknown): number | null {
  if (os === 'android') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return typeof raw === 'string' ? versionKey(raw) : null;
}

/** The raw minimum the manifest sets for `os`, or null (no gate). Pure. */
export function rawMinimum(manifest: VersionManifest, os: string): number | string | null {
  const raw = os === 'android' ? manifest.android?.minVersionCode : manifest.ios?.minVersion;
  return minKey(os, raw) != null ? (raw as number | string) : null;
}

/** The running binary in the minimum's key space: Android versionCode, iOS
 *  marketing version. Pure. */
export function currentKey(os: string, installed: InstalledIdentity): number | null {
  if (os === 'android') return minKey('android', installed.build ?? null);
  return versionKey(installed.version);
}

async function readCachedMinimum(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(MIN_CACHE_KEY);
  } catch {
    return null;
  }
}

async function writeCachedMinimum(raw: number | string | null): Promise<void> {
  try {
    if (raw == null) await AsyncStorage.removeItem(MIN_CACHE_KEY);
    else await AsyncStorage.setItem(MIN_CACHE_KEY, String(raw));
  } catch {
    // A lost cache write only costs the offline case; never surface it.
  }
}

/**
 * Fetch the manifest and remember its minimum. Returns the raw minimum
 * (`null` = the server says no gate, which also CLEARS the cache so lifting
 * the gate reaches every device that comes online), or `undefined` when the
 * fetch failed — in which case the cache is left exactly as it was.
 */
async function refreshMinimum(os: string): Promise<number | string | null | undefined> {
  const manifest = await fetchVersionManifest();
  if (!manifest) return undefined;
  const raw = rawMinimum(manifest, os);
  await writeCachedMinimum(raw);
  return raw;
}

/**
 * Whether this binary must be updated before it can be used. Checked on
 * launch (cache first, then network) and again on every return to the
 * foreground, so a minimum raised while the app is resident still lands.
 * Always false in Expo Go / dev / a binary with no readable build number.
 */
export function useUpdateRequired(): boolean {
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!isGateableRuntime()) return;
    const os = Platform.OS;
    const current = currentKey(os, installedIdentity());
    if (current == null) return;
    let alive = true;
    // Once the network has answered, the cache is history. Without this a
    // slow AsyncStorage read resolving AFTER a foreground re-check (the
    // AppState listener is live from the first render) would re-apply a
    // minimum the server has already cleared.
    let fresh = false;

    const apply = (raw: number | string | null) => {
      if (alive) setRequired(isUpdateRequired(current, minKey(os, raw)));
    };
    const check = async () => {
      const raw = await refreshMinimum(os);
      // A failed fetch changes nothing: the cached verdict (or "not
      // required") stands.
      if (raw !== undefined) {
        fresh = true;
        apply(raw);
      }
    };

    void (async () => {
      const cached = await readCachedMinimum();
      if (!fresh) apply(cached);
      await check();
    })();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return required;
}
