import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { checkAndFetchOta } from '@/lib/app-update';
import { setExpoPushToken } from '@/lib/ledger';

// Remote-push token registration + the silent OTA pre-download listener
// (#112/#114). This is the JS half of the feature ONLY, and it is deliberately
// inert on today's binaries:
//
//  - Android has no `googleServicesFile` / google-services.json, so
//    `getExpoPushTokenAsync` throws (no FCM sender to register with).
//  - iOS has no aps-environment (push) entitlement, so APNs registration is
//    refused and the same call throws.
//
// Both failures are EXPECTED and swallowed silently below — no retry, no
// Sentry, no user surface. The moment vc 41 / the next iOS build ship the
// native config (see STATUS.md's #114 row for the exact remainder), this code
// starts working with no further JS change, which is the point of landing it
// now: it rides the OTA channel while the native half waits for the #107
// binary chain.

/** `extra.eas.projectId` from app.json, which `getExpoPushTokenAsync` needs to
 *  mint a token scoped to this EAS project. Read-only — never write config. */
function easProjectId(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * Fetch this device's Expo push token and store it on the user's profile.
 *
 * MUST silently no-op on every failure path — on today's binaries the token
 * call always throws (see the header comment), and a registration the user
 * never asked for must never surface an error or loop. One attempt per call;
 * the caller (`useRegisterPushToken`) limits it to once per session.
 */
export async function registerPushToken(uid: string | null | undefined): Promise<void> {
  if (!uid || Platform.OS === 'web') return;
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data;
    if (token) await setExpoPushToken(uid, token);
  } catch {
    // Expected on every current binary (no FCM config / no push entitlement).
    // Also covers offline and a rules rejection. Silent by design.
  }
}

/**
 * Register the push token once per session, when auth first becomes ready —
 * the same run-once latch shape as the `app_open` effect in the authed
 * layout: a ref, flipped on the first truthy uid, never re-fired on
 * foregrounds or re-renders.
 */
export function useRegisterPushToken(uid: string | null | undefined): void {
  const registered = useRef(false);
  useEffect(() => {
    if (registered.current || !uid) return;
    registered.current = true;
    void registerPushToken(uid);
  }, [uid]);
}

/** Payload shape `adminAnnounceOta` sends (functions/src/announce-ota.ts). */
interface OtaPushData {
  type?: unknown;
  platform?: unknown;
}

/**
 * Pure decider: does this push payload ask THIS device to pre-download an
 * OTA? The sender cannot tell platforms apart from the token alone, so it
 * pushes to every registered device and stamps the payload with the platform
 * the OTA was published for; the device filters itself out here.
 */
export function shouldFetchOnPush(data: unknown, ownPlatform: string): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const { type, platform } = data as OtaPushData;
  if (type !== 'ota-published') return false;
  return platform == null || platform === ownPlatform;
}

/**
 * Listen for the silent `ota-published` push and pre-download the bundle so
 * the next launch applies it immediately instead of fetching first.
 *
 * On today's binaries this listener NEVER fires: delivering a push at all
 * needs the native config listed above, and delivering one in the BACKGROUND
 * additionally needs `UIBackgroundModes: ["remote-notification"]` on iOS —
 * which is app.json, which moves the fingerprint, which is exactly the line
 * this slice stops at. Mounting it now is free and means the vc-41 binaries
 * need no JS change. Do NOT add background modes or any config from here.
 */
export function useOtaPushListener(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (shouldFetchOnPush(data, Platform.OS)) void checkAndFetchOta();
    });
    return () => sub.remove();
  }, []);
}
