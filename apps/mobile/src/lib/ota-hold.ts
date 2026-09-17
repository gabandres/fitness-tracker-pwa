import { useEffect } from 'react';

/**
 * A ref-counted "do not restart the process right now" flag.
 *
 * `useAutoApplyOta` calls `Updates.reloadAsync()` on EVERY background→active
 * transition once a bundle is pending (ADR-0031 recorded that as the reason the
 * update banner is almost never seen; it was not read as a data-loss risk).
 * `reloadAsync` is a process restart, so every screen holding unsaved state in
 * `useState` loses it — with no error, no draft and nothing to recover.
 *
 * That is not hypothetical. On 2026-09-16 a user photo-scanned a meal, got a
 * good result at 00:30:24Z, left the app to read the product label, and came
 * back into an auto-applied OTA. The reviewed scan was gone; she re-logged it by
 * hand five minutes later, and the quota slot the scan spent bought nothing.
 *
 * A hold does not cancel the update, it defers it: the AppState listener fires
 * again on the next foreground, and by then the flow is usually finished. The
 * counter is module-level and read at the moment the event arrives, so there is
 * no stale-closure window between taking a hold and the reload deciding.
 *
 * Holds are ref-counted because two surfaces can be open at once, and released
 * from effect cleanup so an unmount cannot leak one. A leaked hold would be a
 * silently un-updatable app, which is why release is idempotent and clamped.
 */
let holds = 0;

/** Whether any surface is currently asking not to be restarted. */
export function isOtaHeld(): boolean {
  return holds > 0;
}

/** Take a hold. Returns its release, which is safe to call more than once. */
export function holdOta(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

/**
 * Hold for as long as `active` is true, releasing on unmount.
 *
 * Pass the condition rather than mounting conditionally: a hook that only
 * sometimes runs is the shape that leaks one.
 */
export function useOtaHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdOta();
  }, [active]);
}

/** Test seam. Never call from app code. */
export function __resetOtaHolds(): void {
  holds = 0;
}
