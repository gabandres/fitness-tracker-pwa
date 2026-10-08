/**
 * `router.setParams`, held until the root navigator is ready.
 *
 * A screen that consumes a one-shot param (`openAdd`, `fast`, `quickAddSlot`,
 * `weigh`) clears it from an effect once handled. On a COLD start from a deep
 * link — the home-screen widget's `ignia://?openAdd=1`, the fasting Live
 * Activity, the Quick Settings tile fallback, a Siri weigh-in — that effect
 * runs before the navigation container's own `ready` effect (React fires child
 * effects first), and expo-router's `assertIsReady` throws "Attempted to
 * navigate before mounting the Root Layout component". Thrown from an effect it
 * is a fatal JS error, and expo-updates' error recovery then kills the app:
 * tapping the widget with the app closed crashed it (2026-10-08). A warm tap
 * never saw it, because the container was long since ready.
 *
 * The param stays on the route for the few frames until `ready`, which is
 * harmless: every consumer either keys on the value (a change re-fires) or
 * guards its own re-entry.
 */
import { router, useNavigationContainerRef } from 'expo-router';
import { useCallback } from 'react';

type Params = Parameters<typeof router.setParams>[0];

/** Minimal shape of the container ref, so the logic is testable without a navigator. */
export type ReadyRef = {
  isReady(): boolean;
  addListener(type: 'ready', cb: () => void): () => void;
};

/** Run `fn` now if the navigator is ready, else once it becomes ready. */
export function whenNavigationReady(ref: ReadyRef, fn: () => void): void {
  if (ref.isReady()) {
    fn();
    return;
  }
  const unsubscribe = ref.addListener('ready', () => {
    unsubscribe();
    fn();
  });
}

/** `router.setParams` that cannot throw on a cold deep-link start. */
export function useSetParamsWhenReady(): (params: Params) => void {
  const navRef = useNavigationContainerRef();
  return useCallback(
    (params: Params) => whenNavigationReady(navRef, () => router.setParams(params)),
    [navRef],
  );
}
