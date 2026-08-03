import { requireOptionalNativeModule } from 'expo';

/**
 * WatchLink — the TS face of the one-function WatchConnectivity bridge in
 * `ios/WatchLinkModule.swift`.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module
 * is iOS-only and is absent from the Android binary, from Expo Go and from the
 * web bundle. An optional require makes every call below a silent no-op there,
 * which is the same shape `src/lib/health.ts` and `src/lib/widget.ts` already
 * use for native surfaces that do not exist on every runtime.
 *
 * There is no listener API and there never should be: the phone asserts, the
 * watch receives. Nothing flows back (#37 §3).
 */

interface WatchLinkModule {
  /** Whether this device can hold a `WCSession` at all (false on iPad). */
  readonly isSupported: boolean;
  /** Only meaningful once the session has activated; false otherwise. */
  readonly isPaired: boolean;
  readonly isWatchAppInstalled: boolean;
  /** True when something was handed to the system; false when there was
   *  nothing to send to, or the counterpart already held exactly this. */
  updateApplicationContext(record: Record<string, string>): boolean;
}

const native = requireOptionalNativeModule<WatchLinkModule>('WatchLink');

/** True when the native module is linked into this binary. */
export const isWatchLinkAvailable = native != null;

export function isPaired(): boolean {
  return native?.isPaired ?? false;
}

export function isWatchAppInstalled(): boolean {
  return native?.isWatchAppInstalled ?? false;
}

/**
 * Assert what the wrist should show.
 *
 * Latest-wins and never queues, so over-calling is cheap; the native side also
 * skips the send when the counterpart already holds exactly this record, which
 * is what keeps the watch's 40–75/day reload budget untouched in the steady
 * state.
 *
 * Never throws. `WCError.deviceNotPaired` / `.watchAppNotInstalled` are the
 * ordinary case on a watch-less iPhone, not a fault, and are swallowed
 * natively (#44 §5.3).
 */
export function updateApplicationContext(record: Record<string, string>): boolean {
  return native?.updateApplicationContext(record) ?? false;
}
