import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Screen-reader announcements and timing, in one place.
 *
 * `accessibilityLiveRegion` is Android-only in React Native and
 * `accessibilityRole="alert"` does not speak on iOS, so before this helper a
 * VoiceOver user heard no toast, no receipt, no Undo and no error anywhere in
 * the app. `announce` is the cross-platform call; Android still gets it through
 * the live region where one exists, so callers that already render a live
 * region pass `{ androidHasLiveRegion: true }` to avoid a double read.
 */
export function announce(message: string, opts: { androidHasLiveRegion?: boolean } = {}): void {
  if (!message) return;
  if (Platform.OS === 'android' && opts.androidHasLiveRegion) return;
  AccessibilityInfo.announceForAccessibility(message);
}

let screenReaderOn = false;
let primed = false;

/** Start tracking the screen-reader state. Idempotent; call once at app start
 *  (the toast host does it). */
export function primeScreenReaderState(): void {
  if (primed) return;
  primed = true;
  AccessibilityInfo.isScreenReaderEnabled()
    .then((on) => {
      screenReaderOn = on;
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener('screenReaderChanged', (on: boolean) => {
    screenReaderOn = on;
  });
}

/** Synchronous best-known screen-reader state (false until primed). */
export function isScreenReaderOn(): boolean {
  return screenReaderOn;
}

/**
 * How long a timed control should stay up (WCAG 2.2.1). A screen-reader user
 * has to swipe to reach the action, so an actionable toast gets at least 10 s
 * when one is running; Android also honours the system's "time to take action"
 * setting through `getRecommendedTimeoutMillis`.
 */
export async function recommendedTimeoutMs(baseMs: number, hasAction: boolean): Promise<number> {
  let ms = baseMs;
  if (hasAction && screenReaderOn) ms = Math.max(ms, 10_000);
  if (Platform.OS === 'android') {
    try {
      ms = Math.max(ms, await AccessibilityInfo.getRecommendedTimeoutMillis(ms));
    } catch {
      /* keep ms */
    }
  }
  return ms;
}
