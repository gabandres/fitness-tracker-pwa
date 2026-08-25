import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useTheme } from '@/lib/theme-context';
import type { ColorTokens } from '@/theme';

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

/**
 * What the user looks at while the JS runtime restarts.
 *
 * ## Why this exists at all
 *
 * `reloadAsync()` is a **process restart**, not a screen transition (ADR-0031).
 * Nothing configurable makes it instant, and the reported defect was never the
 * duration — it was the silence: between the tap and the app coming back the
 * user got the OS's own blank/splash handoff, which reads as a hang. This
 * replaces that dead gap with a surface we control. It changes the duration by
 * zero milliseconds and must never be described as making the restart faster.
 *
 * ## Why a spinner and not the logo
 *
 * `ReloadScreenOptions` also takes an `image`, and the obvious version — pass
 * `require('.../splash-icon.png')` — is wrong twice:
 *
 *  - **Sizing.** expo-updates resolves a `require()` id with
 *    `Image.resolveAssetSource`, which reports the asset's PIXEL size (ours is
 *    1024x1024), and both native reload screens then treat width/height as
 *    dp/points. That lays the mark out at 1024dp — 3584px on the LG G6 — and
 *    crops it to the screen.
 *  - **Motion.** Image and spinner are both centred by the native views
 *    (`Gravity.CENTER` on Android, centre anchors on iOS), so showing both
 *    stacks the spinner on top of the mark. Showing the mark alone reproduces
 *    the launch splash — a still frame, which is the exact thing that reads as
 *    a hang.
 *
 * A moving coral spinner on the app's own canvas says "working" with no
 * ambiguity, and the familiar logo splash follows a beat later anyway when the
 * new bundle boots.
 *
 * ## Why it takes colours rather than reading them
 *
 * ADR-0031 assumed this surface "cannot read `useTheme()` and must be
 * configured statically", because it renders while the app is not running.
 * That is true of the `app.json` reload-screen config and false here: the
 * options are an argument to `reloadAsync`, evaluated in JS a moment BEFORE
 * the restart, so the live palette is available and a dark-theme user gets a
 * dark restart instead of a white flash. Pure, so the mapping is testable
 * without a renderer.
 */
export function reloadScreenOptions(colors: ColorTokens): Updates.ReloadScreenOptions {
  return {
    backgroundColor: colors.paper,
    fade: true,
    spinner: { enabled: true, color: colors.ring, size: 'large' },
  };
}

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
  const { colors } = useTheme();
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
      await Updates.reloadAsync({ reloadScreenOptions: reloadScreenOptions(colors) });
    } catch {
      // Reload refused (dev client, or updates disabled). Re-enable the button
      // rather than leaving it stuck in a spinner forever.
      setApplying(false);
    }
  }, [colors]);

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

// ─── Applying an OTA without asking ────────────────────────────────
//
// The banner works, but it costs the user a tap for something they did not
// choose and cannot evaluate — and without it the cost is worse: a downloaded
// bundle applies on the NEXT cold start, so "restart the app" reliably means
// "restart it twice". That is precisely how this was reported.
//
// Two safe moments to reload, neither of which interrupts anything:
//
//   1. COLD START. `isUpdatePending` on the FIRST render means the bundle was
//      downloaded during a previous run. No in-session state exists yet, so
//      the cost is a beat of splash instead of a stale app.
//   2. THE NEXT FOREGROUND. A bundle that arrives mid-session is left alone —
//      the user opened the app to do something. It is applied when they next
//      come back, in the gap where they were not looking.
//
// Deliberately NOT the moment the download finishes: reloading discards
// unsaved local state (a half-typed entry sheet) and yanks whatever is on
// screen. The distinction between 1 and 2 is why `pendingAtMount` exists —
// without it, `isUpdatePending` flipping true mid-session is indistinguishable
// from a cold start and the reload lands in the middle of the user's session.

/** An update that was auto-applied and did not survive its own launch, so it
 *  is never auto-applied again. `expo-updates` falls back to the previous
 *  bundle when a launch fails; without this latch the fallback and the
 *  auto-apply fight in a loop and the app is effectively bricked. The banner
 *  still offers it manually — retrying deliberately is a different decision. */
const FAILED_KEY = 'ota.failedUpdateId';
/** Written immediately before a reload, cleared once a bundle renders. */
const ATTEMPT_KEY = 'ota.attemptedUpdateId';

/**
 * Whether a downloaded bundle may be applied right now. Pure, so the two
 * decisions that can hurt a user are testable without a device:
 *
 *  - applying at the wrong MOMENT (mid-session, discarding what they typed);
 *  - applying a bundle that already failed to launch, which loops against
 *    expo-updates' own fallback and leaves the app unusable.
 */
export function shouldAutoApplyOta(args: {
  isUpdatePending: boolean;
  /** The downloaded bundle a reload would launch. */
  targetUpdateId?: string;
  /** A bundle previously auto-applied that did not survive its launch. */
  failedUpdateId: string | null;
  /** `mount` = first render of the session; `foreground` = a background→
   *  active transition. */
  moment: 'mount' | 'foreground';
  /** Whether a bundle was already waiting when the session started. */
  pendingAtMount: boolean;
}): boolean {
  const { isUpdatePending, targetUpdateId, failedUpdateId, moment, pendingAtMount } = args;
  if (!isUpdatePending) return false;
  // Never re-apply a bundle that bricked its own launch.
  if (targetUpdateId && failedUpdateId === targetUpdateId) return false;
  // At mount, only a bundle downloaded by an EARLIER run is safe: one that
  // arrives during this session waits for the user to leave.
  return moment === 'foreground' ? true : pendingAtMount;
}

/**
 * Apply OTA updates without asking. Mount ONCE, high in the tree.
 *
 * Returns nothing — it is a side effect, and everything it does is invisible
 * by design. `UpdateBanner` remains the manual path for anyone who lands
 * between the two moments above, and the only route for an update this
 * refuses.
 */
export function useAutoApplyOta(): void {
  const { isUpdatePending, downloadedUpdate, currentlyRunning } = Updates.useUpdates();
  const { colors } = useTheme();

  // True only when a bundle was already waiting as this component first
  // rendered — i.e. it was downloaded by a previous run.
  const pendingAtMount = useRef<boolean | null>(null);
  if (pendingAtMount.current === null) pendingAtMount.current = isUpdatePending;

  // Boot-success latch. An attempt marker surviving into a run of a DIFFERENT
  // update than the one attempted means that bundle failed to launch and
  // expo-updates fell back. Record it so we stop trying.
  useEffect(() => {
    if (!canUpdate) return;
    void (async () => {
      const attempted = await AsyncStorage.getItem(ATTEMPT_KEY);
      if (!attempted) return;
      await AsyncStorage.removeItem(ATTEMPT_KEY);
      if (currentlyRunning?.updateId !== attempted) {
        await AsyncStorage.setItem(FAILED_KEY, attempted);
      }
    })();
  }, [currentlyRunning?.updateId]);

  useEffect(() => {
    if (!canUpdate || !isUpdatePending) return;
    let alive = true;

    // `Updates.updateId` is the RUNNING bundle; the one a reload would launch
    // is the downloaded one.
    const target = downloadedUpdate?.updateId;

    const apply = async (moment: 'mount' | 'foreground') => {
      const failed = await AsyncStorage.getItem(FAILED_KEY);
      if (!alive) return;
      if (!shouldAutoApplyOta({
        isUpdatePending,
        targetUpdateId: target,
        failedUpdateId: failed,
        moment,
        pendingAtMount: pendingAtMount.current === true,
      })) return;
      if (target) await AsyncStorage.setItem(ATTEMPT_KEY, target);
      try {
        await Updates.reloadAsync({ reloadScreenOptions: reloadScreenOptions(colors) });
      } catch {
        // Reload refused (dev client / updates disabled). The banner remains.
      }
    };

    // 1. Downloaded before this session started — apply now, pre-engagement.
    if (AppState.currentState === 'active') void apply('mount');

    // 2. Downloaded during this session — wait for them to leave and return.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void apply('foreground');
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [isUpdatePending, downloadedUpdate?.updateId, colors]);
}
