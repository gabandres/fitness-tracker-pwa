/**
 * The Today "reconnect Apple Health" prompt — its rule and storage keys
 * (2026-10-20). No imports on purpose: `useHealthReconnect` and the tests read
 * it without loading `health-sync` (which reaches the Firebase SDK).
 */

/** Set once an import has seen a workout recorded by an Apple Watch. */
export const SAW_APPLE_WATCH_KEY = 'ignia.health.sawAppleWatch';
/** Until when the Today reconnect prompt is snoozed (epoch ms). */
export const RECONNECT_SNOOZE_KEY = 'ignia.health.reconnectSnoozeUntil';
/** "Later" hides the prompt this long; it comes back until the reconnect. */
export const RECONNECT_SNOOZE_MS = 3 * 86_400_000;

/**
 * Should Today prompt this device to reconnect Apple Health? iOS, connected,
 * under a scope older than the current one (heart rate arrived in v3), with
 * Apple Watch workouts seen, and not snoozed. Pure inputs, so the rule is
 * tested without a device. It cannot be mandatory: iOS lets the user decline
 * the sheet, and never says whether a READ was granted.
 */
export function shouldPromptReconnect(args: {
  ios: boolean;
  connected: boolean;
  needsReauth: boolean;
  sawWatch: boolean;
  snoozedUntil: number | null;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  return args.ios && args.connected && args.needsReauth && args.sawWatch
    && !(args.snoozedUntil != null && args.snoozedUntil > now);
}
