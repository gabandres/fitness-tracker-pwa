import { requireOptionalNativeModule } from 'expo';

/**
 * FastingLiveActivity — the TS face of the fasting Live Activity (N3).
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module is
 * iOS-only and absent from the Android binary, from Expo Go and from web. An
 * optional require makes every call a silent no-op there — the same shape
 * `modules/quick-add-credentials`, `modules/watch-link` and `src/lib/widget.ts`
 * use.
 *
 * Nothing here ever throws. A Lock Screen that will not appear must not be able
 * to fail a fast: `useToday.startFast` writes Firestore first and calls this
 * afterwards, and a rejection at this layer would surface as a failed fast.
 */

interface FastingLiveActivityNativeModule {
  start(startedAtMs: number, locale: string): Promise<string | null>;
  end(): Promise<string | null>;
  /** Raw, delimited. See `parseFastActivityStatus`. */
  status(): Promise<string>;
}

/**
 * - `running` — an Activity is live on the Lock Screen right now.
 * - `stopped` — Live Activities work, there just isn't one. The re-arm case.
 * - `disabled` — the user turned Live Activities off for Ignia in Settings. A
 *   preference, not an error, and never to be nagged about.
 * - `unsupported` — iOS below 16.1.
 * - `unavailable` — no native module (Android, Expo Go, web), or the bridge
 *   class is missing from the binary.
 */
export type FastActivityState =
  | 'running'
  | 'stopped'
  | 'disabled'
  | 'unsupported'
  | 'unavailable';

export interface FastActivityStatus {
  state: FastActivityState;
  /**
   * What the live Activity is counting from, present only when `running`.
   *
   * A running Activity's attributes are immutable, so this is the only way to
   * tell "the Lock Screen already shows this fast" from "it shows a different
   * one" — the case a cold launch after the fast changed in the web PWA lands
   * in.
   */
  startedAtMs?: number;
  /** The locale the running Activity was armed with, present only when `running`. */
  locale?: string;
}

/**
 * `running:1754650000000:es-PR` → `{ state, startedAtMs, locale }`.
 *
 * Exported for `src/__tests__/`: this is the one piece of the bridge that has
 * logic in it, and it is testable without a device.
 */
export function parseFastActivityStatus(raw: string): FastActivityStatus {
  if (!raw.startsWith('running:')) {
    const known: readonly string[] = ['stopped', 'disabled', 'unsupported', 'unavailable'];
    return { state: known.includes(raw) ? (raw as FastActivityState) : 'unavailable' };
  }
  const [, ms, ...rest] = raw.split(':');
  const startedAtMs = Number(ms);
  // A malformed running payload is treated as "no usable Activity" so the
  // caller re-arms, rather than as a running one it would then leave alone.
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return { state: 'stopped' };
  return { state: 'running', startedAtMs, locale: rest.join(':') };
}

const native = requireOptionalNativeModule<FastingLiveActivityNativeModule>('FastingLiveActivity');

/** True when the module is present in this binary (iOS dev/production build). */
export const isFastingLiveActivityAvailable = native != null;

/**
 * Show the Lock Screen timer for a fast that began at `startedAt`.
 *
 * `startedAt` is `profile.fastStartedAt`, not "now" — see the module's Swift
 * header. Calling this for an already-running fast is the intended re-arm path
 * after iOS's 8-hour ceiling ends the previous Activity, and produces a timer at
 * the correct elapsed time rather than one restarting from zero.
 *
 * Resolves to `null` on success or a reason string; never rejects.
 */
export async function startFastActivity(
  startedAt: Date,
  locale: string,
): Promise<string | null> {
  try {
    return (await native?.start(startedAt.getTime(), locale)) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

/** Remove the Lock Screen timer. Safe to call when none is running. */
export async function endFastActivity(): Promise<string | null> {
  try {
    return (await native?.end()) ?? 'unavailable';
  } catch (e) {
    return String(e);
  }
}

export async function getFastActivityStatus(): Promise<FastActivityStatus> {
  try {
    const raw = await native?.status();
    return raw == null ? { state: 'unavailable' } : parseFastActivityStatus(raw);
  } catch {
    return { state: 'unavailable' };
  }
}
