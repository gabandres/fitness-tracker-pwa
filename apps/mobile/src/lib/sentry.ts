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
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

const dsn = (Constants.expoConfig?.extra as { sentry?: { dsn?: string } } | undefined)?.sentry?.dsn;

/** Expo Go can't load the native module (and shouldn't report at all). */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** The build identifier a tester can read back to us: iOS build number or
 *  Android versionCode, whichever platform we're on. */
const buildNumber = String(
  (Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode) ?? '0',
);

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
    release: `${Constants.expoConfig?.version ?? 'unknown'}`,
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
