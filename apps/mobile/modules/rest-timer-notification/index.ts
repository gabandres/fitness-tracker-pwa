import { requireOptionalNativeModule } from 'expo';

/**
 * RestTimerNotification — the Android counterpart of `modules/rest-timer-activity`:
 * an ongoing notification whose header counts down to the end of a rest. The
 * screen-facing seam is `src/lib/rest-timer-activity.ts`, which calls this next
 * to the iOS Live Activity; this file is only the bridge.
 *
 * `requireOptionalNativeModule`: Android-only, and absent from iOS, Expo Go,
 * web and every Android binary older than vc 48 — which a 1.2.5 OTA can still
 * reach. Absent means every call is a silent no-op.
 *
 * Nothing here ever throws.
 */

interface RestTimerNotificationNativeModule {
  start(endsAtMs: number, title: string, body: string, channelName: string): Promise<string | null>;
  update(endsAtMs: number): Promise<string | null>;
  end(): Promise<string | null>;
  status(): Promise<string>;
}

const native = requireOptionalNativeModule<RestTimerNotificationNativeModule>('RestTimerNotification');

/** True when the module is present in this binary. */
export const isRestTimerNotificationAvailable = native != null;

/** Resolves to `null` on success or a reason string; never rejects. */
export async function startRestNotification(
  endsAtMs: number,
  title: string,
  body: string,
  channelName: string,
): Promise<string | null> {
  try {
    return (await native?.start(endsAtMs, title, body, channelName)) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

export async function updateRestNotification(endsAtMs: number): Promise<string | null> {
  try {
    return (await native?.update(endsAtMs)) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

export async function endRestNotification(): Promise<string | null> {
  try {
    return (await native?.end()) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

/** `running:<endsAtMs>` / `stopped` / `disabled` / `unavailable`. */
export async function getRestNotificationStatus(): Promise<string> {
  try {
    return (await native?.status()) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}
