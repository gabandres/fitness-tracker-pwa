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
  /** True when the complication is on an ACTIVE WATCH FACE. False for a widget
   *  in the Smart Stack, which looks the same to the user but disables the
   *  waking half of the transport. */
  readonly isComplicationEnabled: boolean;
  /** How many of the day's 50 complication transfers remain. */
  readonly remainingComplicationTransfers: number;
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
 * Whether the complication sits on an active watch face.
 *
 * Diagnostics only — nothing branches on it in JS. It exists because it is the
 * one fact that explains an otherwise causeless "my face is stale": on a face
 * the phone can use the waking transport, in the Smart Stack it cannot, and
 * the two are indistinguishable from the user's side.
 */
export function isComplicationEnabled(): boolean {
  return native?.isComplicationEnabled ?? false;
}

/** How many of the day's 50 complication transfers remain (0 off-iOS). */
export function remainingComplicationTransfers(): number {
  return native?.remainingComplicationTransfers ?? 0;
}

/**
 * Assert what the wrist should show.
 *
 * **The name is narrower than the behaviour.** Since 2026-08-10 the native side
 * asserts over BOTH WatchConnectivity queues — `transferCurrentComplicationUserInfo`
 * (the only one that wakes a backgrounded watch app, and therefore the one that
 * actually keeps a face current) plus `updateApplicationContext` (durable,
 * survives for a watch app that starts later). The name is kept because Expo
 * Modules bind by name and Swift changes do not move the runtime fingerprint,
 * so a renamed JS call could reach an older binary over the air and break the
 * watch push there. See `ios/WatchLinkModule.swift`.
 *
 * Latest-wins and never queues, so over-calling is cheap; the native side also
 * skips the send when the counterpart already holds exactly this record, which
 * is what keeps the watch's 40–75/day reload budget — and the complication
 * queue's hard 50/day — untouched in the steady state.
 *
 * Never throws. `WCError.deviceNotPaired` / `.watchAppNotInstalled` are the
 * ordinary case on a watch-less iPhone, not a fault, and are swallowed
 * natively (#44 §5.3).
 */
export function updateApplicationContext(record: Record<string, string>): boolean {
  return native?.updateApplicationContext(record) ?? false;
}
