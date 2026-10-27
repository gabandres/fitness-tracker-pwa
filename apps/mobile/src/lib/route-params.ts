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
 * The param stays on the route for the few frames until the container is
 * ready, which is harmless: every consumer either keys on the value (a change
 * re-fires) or guards its own re-entry.
 *
 * expo-router 58 dropped the container's `ready` event (its ref is ready the
 * moment the container mounts), so readiness is re-checked on the container's
 * `state` event — emitted from a layout effect on mount — with a per-frame
 * re-check as the backstop, capped so a navigator that never mounts (a test)
 * cannot spin forever.
 */
import { router, useNavigationContainerRef } from 'expo-router';
import { useCallback } from 'react';

type Params = Parameters<typeof router.setParams>[0];

/** Minimal shape of the container ref, so the logic is testable without a navigator. */
export type ReadyRef = {
  isReady(): boolean;
  addListener(type: 'state', cb: () => void): () => void;
};

/** ~5 s at 60 Hz: far past any real cold start. */
const MAX_READY_FRAMES = 300;

/** Run `fn` now if the navigator is ready, else once it becomes ready. */
export function whenNavigationReady(ref: ReadyRef, fn: () => void): void {
  if (ref.isReady()) {
    fn();
    return;
  }
  let done = false;
  let frame: number | null = null;
  const runIfReady = () => {
    if (done || !ref.isReady()) return;
    done = true;
    unsubscribe();
    if (frame != null) cancelAnimationFrame(frame);
    fn();
  };
  const unsubscribe = ref.addListener('state', runIfReady);
  let frames = 0;
  const poll = () => {
    frame = null;
    runIfReady();
    if (!done && ++frames < MAX_READY_FRAMES) frame = requestAnimationFrame(poll);
  };
  frame = requestAnimationFrame(poll);
}

/** `router.setParams` that cannot throw on a cold deep-link start. */
export function useSetParamsWhenReady(): (params: Params) => void {
  const navRef = useNavigationContainerRef();
  return useCallback(
    (params: Params) => whenNavigationReady(navRef, () => router.setParams(params)),
    [navRef],
  );
}
