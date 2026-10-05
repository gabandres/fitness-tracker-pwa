import { requireOptionalNativeModule } from 'expo';

/**
 * RestTimerActivity — the TS face of the rest-timer Live Activity (Train review
 * item 20). The screen-facing seam is `src/lib/rest-timer-activity.ts`; this
 * file is only the bridge.
 *
 * `requireOptionalNativeModule`, as in `modules/fasting-live-activity`: the
 * module is iOS-only and absent from Android, Expo Go, web — and from every iOS
 * binary older than the one that introduced it, which an OTA can still reach.
 * Absent means every call is a silent no-op.
 *
 * Nothing here ever throws. A Lock Screen timer that will not start must not be
 * able to fail a ticked set.
 */

interface RestTimerActivityNativeModule {
  start(endsAtMs: number, exerciseName: string, locale: string): Promise<string | null>;
  update(endsAtMs: number): Promise<string | null>;
  end(): Promise<string | null>;
  status(): Promise<string>;
}

const native = requireOptionalNativeModule<RestTimerActivityNativeModule>('RestTimerActivity');

/** True when the module is present in this binary. */
export const isRestTimerActivityAvailable = native != null;

/** Resolves to `null` on success or a reason string; never rejects. */
export async function startRestActivity(
  endsAtMs: number,
  exerciseName: string,
  locale: string,
): Promise<string | null> {
  try {
    return (await native?.start(endsAtMs, exerciseName, locale)) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

export async function updateRestActivity(endsAtMs: number): Promise<string | null> {
  try {
    return (await native?.update(endsAtMs)) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

export async function endRestActivity(): Promise<string | null> {
  try {
    return (await native?.end()) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

/** `running:<endsAtMs>` / `stopped` / `disabled` / `unsupported` / `unavailable`. */
export async function getRestActivityStatus(): Promise<string> {
  try {
    return (await native?.status()) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}
