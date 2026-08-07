import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

// Making an over-the-air update VISIBLE.
//
// `expo-updates` is configured in app.json (fingerprint runtime policy) and
// baked into every binary from Android vc 11 / iOS build 24 onward, but until
// now nothing in the app ever read it. The default `checkAutomatically` is
// ON_LOAD, so an update downloads quietly in the background and applies on the
// *next* cold start — a tester who keeps the app resident can sit on stale code
// indefinitely and nothing ever tells them. That is exactly how a tester stayed
// on an old build until they were told by hand.
//
// This module is the JS half of the fix: surface the pending update and let the
// user apply it now. It is deliberately pure JS — no native dependency — so it
// does NOT move the fingerprint and therefore ships over the air to the
// binaries already in testers' hands. Binary (native) updates are a different
// mechanism entirely; see `play-update.ts`.

/** `Updates` throws rather than no-ops in dev/Expo Go, so every call site is
 *  gated on this. `isEnabled` is false in Expo Go and in any binary built
 *  without expo-updates. */
const canUpdate = Updates.isEnabled && !__DEV__;

export interface OtaUpdateState {
  /** A new bundle is downloaded and waiting for a reload. */
  pending: boolean;
  /** A reload is in flight — used to disable the button so it can't double-fire. */
  applying: boolean;
  /** Reload into the downloaded bundle. Resolves before the reload actually
   *  happens, so callers must not sequence anything after it. */
  apply: () => Promise<void>;
}

/**
 * Track whether an OTA update is ready to apply.
 *
 * Two paths feed `pending`:
 *  - the automatic ON_LOAD check at cold start, reported by `useUpdates()`;
 *  - an explicit re-check whenever the app returns to the foreground, which is
 *    what catches the resident-app case the ON_LOAD check structurally cannot.
 */
export function useOtaUpdate(): OtaUpdateState {
  const { isUpdatePending } = Updates.useUpdates();
  const [foregroundPending, setForegroundPending] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!canUpdate) return;

    let alive = true;

    const check = async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable || !alive) return;
        await Updates.fetchUpdateAsync();
        if (alive) setForegroundPending(true);
      } catch {
        // Offline, or the update server is unreachable. A failed check is not
        // worth surfacing — the user did not ask for one, and the ON_LOAD
        // check will try again on the next cold start.
      }
    };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void check();
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const apply = useCallback(async () => {
    if (!canUpdate) return;
    setApplying(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Reload refused (dev client, or updates disabled). Re-enable the button
      // rather than leaving it stuck in a spinner forever.
      setApplying(false);
    }
  }, []);

  return {
    pending: canUpdate && (isUpdatePending || foregroundPending),
    applying,
    apply,
  };
}

// ─── Binary (store) updates ────────────────────────────────────────
//
// An OTA update can only replace JavaScript. When a release carries native
// changes it ships as a new binary, and `expo-updates` is blind to it — the
// runtime version moves, so the OTA channel deliberately does NOT deliver it.
// Play does update closed-track testers eventually, but "eventually" is how a
// tester sat on an old versionCode until they were told by hand.
//
// The source of truth is a static file on the hosting site we already deploy,
// NOT Firestore: `/config` is admin-read-only, and a per-launch document read
// would be a recurring cost for a value that changes a few times a year. The
// file is served `no-cache`, so a bump lands on the next launch.

const VERSION_URL = 'https://ignia.fit/app-version.json';
const DISMISSED_KEY = 'appUpdate.dismissed';
const FETCH_TIMEOUT_MS = 5000;

/** Store listing deep links. `market:`/`itms-apps:` open the store app
 *  directly; both fall back to the https listing if the store app is absent. */
const STORE_URL = Platform.select({
  android: 'market://details?id=fit.ignia.app',
  ios: 'itms-apps://apps.apple.com/app/id6788589414',
  default: 'https://ignia.fit',
});
const STORE_URL_FALLBACK = Platform.select({
  android: 'https://play.google.com/store/apps/details?id=fit.ignia.app',
  ios: 'https://apps.apple.com/app/id6788589414',
  default: 'https://ignia.fit',
});

interface VersionManifest {
  android?: { latestVersionCode?: number };
  ios?: { latestBuild?: number };
}

/** The build number of the running binary. Android reports versionCode, iOS
 *  CFBundleVersion. Null in Expo Go and on web, which disables the check. */
function installedBuild(): number | null {
  const raw = Application.nativeBuildVersion;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Should the store banner show? Pure so the decision is testable without a
 * network or AsyncStorage — every guard here is a case that produced a wrong
 * banner during development.
 *
 * @param current  build number of the running binary; null in Expo Go/dev
 * @param latest   newest published build; null if the manifest never arrived
 * @param dismissed the build the user last dismissed, if any
 */
export function shouldPromptStoreUpdate(
  current: number | null,
  latest: number | null,
  dismissed: number | null,
): boolean {
  // Unknown on either side means we genuinely do not know. Never guess: a
  // false "you're out of date" sends users to a store page that offers them
  // nothing, and a false "you're current" is the bug this whole feature exists
  // to kill.
  if (current == null || latest == null) return false;
  if (latest <= current) return false;
  // A dismissal covers that build and every older one, but must not suppress a
  // NEWER release — otherwise one dismissal silences the banner forever.
  return dismissed == null || latest > dismissed;
}

export interface StoreUpdateState {
  /** A newer binary is published and the user has not dismissed this one. */
  available: boolean;
  /** Open the store listing. */
  open: () => void;
  /** Hide until a version newer than the current target appears. */
  dismiss: () => void;
}

/**
 * Track whether a newer *binary* is on the store.
 *
 * Deliberately dismissible: a tester who cannot take the update right now
 * should not face a permanent banner, and unlike the OTA case we cannot
 * resolve the condition ourselves — leaving the store is the only action, and
 * it may not even be available to them on their track.
 */
export function useStoreUpdate(): StoreUpdateState {
  const [latest, setLatest] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const stored = await AsyncStorage.getItem(DISMISSED_KEY);
      if (!alive) return;
      setDismissed(stored == null ? null : Number(stored));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(VERSION_URL, { signal: controller.signal });
        if (!res.ok) return;
        const manifest = (await res.json()) as VersionManifest;
        const value =
          Platform.OS === 'android'
            ? manifest.android?.latestVersionCode
            : manifest.ios?.latestBuild;
        if (alive && typeof value === 'number') setLatest(value);
      } catch {
        // Offline, timed out, or the file is missing/malformed. Staying silent
        // is the correct failure mode: a version check that cannot reach the
        // network must never imply the user is up to date OR out of date.
      } finally {
        clearTimeout(timer);
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const open = useCallback(() => {
    void Linking.openURL(STORE_URL).catch(() => Linking.openURL(STORE_URL_FALLBACK));
  }, []);

  const dismiss = useCallback(() => {
    if (latest == null) return;
    setDismissed(latest);
    void AsyncStorage.setItem(DISMISSED_KEY, String(latest));
  }, [latest]);

  const available = ready && shouldPromptStoreUpdate(installedBuild(), latest, dismissed);

  return { available, open, dismiss };
}
