import { useSyncExternalStore } from 'react';

// Is the branded boot splash (`Splash` in `_layout.tsx`) covering the screen
// right now?
//
// ## Why a screen needs to know
//
// The welcome intro on the sign-in screen continues the splash: its flame and
// wordmark sit exactly where `BrandLoader` left them, and the moment the
// overlay lifts the flame catches, rises and the copy arrives. Reanimated
// entering animations run on MOUNT, and the sign-in route mounts UNDER the
// overlay (the root layout always renders `<Slot/>` and covers it), so an
// entrance keyed on mount would play to nobody and the user would meet a screen
// that had already finished moving. The intro waits for this to flip instead.
//
// ## Why an external store and not context
//
// Same shape as `holdTour`/`releaseTour` in `lib/tour.ts`: one boolean, one
// writer (`AuthGate`), read by one screen. A context would need a provider
// above the router, and this has no reason to survive the process — it is
// `true` at boot (a cold start IS on the splash) and follows the overlay from
// there.

let visible = true;
const listeners = new Set<() => void>();

/** Called by the root layout whenever the overlay's visibility changes. */
export function setSplashVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  for (const l of listeners) l();
}

/** Synchronous read, for code outside React. */
export function isSplashVisible(): boolean {
  return visible;
}

/** Re-renders when the boot splash appears or lifts. */
export function useSplashVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => visible,
    () => visible,
  );
}
