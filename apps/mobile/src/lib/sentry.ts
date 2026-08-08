/**
 * Sentry for the Expo app.
 *
 * Why this exists: the mobile app had no crash/error reporting at all, so a
 * failure on a tester's device was only ever as good as their description of
 * it. A Google sign-in failure that reproduced for one Android tester and not
 * another was undiagnosable — the native error code never left the phone.
 *
 * Mirrors the web app's contract (`src/main.ts`): a no-op when no DSN is
 * configured, so local dev, Expo Go and fork builds run untouched.
 *
 * Privacy (the app's PII-minimization stance, ADR-0015 / issue #12):
 *  - `sendDefaultPii` stays false — no IP address, no request bodies.
 *  - the Sentry user is the Firebase **uid only**. Never the email. A uid maps
 *    back to a person in the Firebase console when we actually need it, and
 *    doesn't sit in a third-party dashboard otherwise.
 *
 * Cost: errors only. Tracing and replay are off — this is a diagnostic
 * channel, not an APM install.
 */
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

const dsn = (Constants.expoConfig?.extra as { sentry?: { dsn?: string } } | undefined)?.sentry?.dsn;

/** Expo Go can't load the native module (and shouldn't report at all). */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * The build identifier a tester can read back to us: iOS `CFBundleVersion` or
 * Android `versionCode` — read from the **running binary**, via
 * `expo-application`.
 *
 * **Not from `Constants.expoConfig`, and that is the whole point.** `eas.json`
 * sets `appVersionSource: "remote"`, so EAS mints build numbers on its servers
 * and `app.json` never contains one. `expoConfig.ios.buildNumber` and
 * `expoConfig.android.versionCode` are therefore `undefined` in every shipped
 * build, and the old code fell through to its `'0'` default — so **every mobile
 * event Sentry has ever received is tagged `dist: 0`**, on both platforms, for
 * the entire life of the integration.
 *
 * That is not cosmetic. It makes an error impossible to attribute to a binary:
 * diagnosing the `Invalid Hook Call` widget crash on 2026-08-08 needed git
 * archaeology to establish which versionCode it came from, in a repo whose
 * recurring failure is shipping broken and not being able to see it.
 *
 * Expo documents this exact trap and names the fix: read the version from
 * `expo-application`, not from app config. `nativeBuildVersion` is `null` in
 * Expo Go, which never reports anyway.
 */
const buildNumber = Application.nativeBuildVersion ?? '0';

/** True once init ran with a real DSN — guards the capture helpers below. */
let enabled = false;

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    // __DEV__ builds report as 'dev' so a debugging session never pollutes the
    // production issue stream (and never burns quota).
    environment: __DEV__ ? 'dev' : 'prod',
    // Group by the user-facing version + build number, which is what a tester
    // can actually read off the Settings screen / store listing.
    //
    // Both read from the running binary, for the reason `buildNumber` explains
    // above. `version` does happen to be correct in `app.json` today, so this
    // half is prevention rather than a fix — but the two values must come from
    // the same place, or a future divergence reintroduces exactly the bug being
    // fixed here, in the field, silently. Shape is unchanged (a bare version
    // string), so historical issue grouping is preserved.
    release: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown',
    dist: buildNumber,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Native crashes (the Android widget process, HealthKit bridges) are the
    // other half of what we were blind to.
    enableNativeCrashHandling: true,
    // Expo Go can't load the native module; the JS layer still reports.
    enableNative: !inExpoGo,
  });
  enabled = true;

  // Device model / OS version ride along on every event automatically in
  // `contexts.device` and `contexts.os`. These duplicate a few of them as TAGS
  // so they're filterable and searchable from the issue list, which contexts
  // are not.
  Sentry.setTag('device.model', Device.modelName ?? 'unknown');
  Sentry.setTag('device.brand', Device.brand ?? 'unknown');
  Sentry.setTag('os', `${Platform.OS} ${Device.osVersion ?? '?'}`);
  Sentry.setTag('device.isDevice', String(Device.isDevice));
  // How the build was installed. The Google sign-in investigation turned on
  // exactly this: a Play-signed internal-testing install and a sideloaded APK
  // carry different signing certs, and only one is registered with Google.
  Sentry.setTag('executionEnvironment', Constants.executionEnvironment ?? 'unknown');
  Sentry.setTag('build', buildNumber);
}

/** Attach (or clear) the signed-in user. uid only — never the email. */
export function setSentryUser(uid: string | null): void {
  if (!enabled) return;
  Sentry.setUser(uid ? { id: uid } : null);
}

/**
 * Report an error with extra structured context.
 *
 * Use this for failures we *handle* — a caught sign-in error still tells us
 * something, and without an explicit capture it would never be reported.
 */
export function captureError(
  error: unknown,
  context: { where: string; extra?: Record<string, unknown> },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('where', context.where);
    if (context.extra) scope.setContext('detail', context.extra);
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

/** Trail of what the user did before the error, shown on every event. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category: 'app', level: 'info', message, data });
}

export { Sentry };
