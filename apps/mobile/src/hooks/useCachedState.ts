import { useCallback, useEffect, useRef, useState } from 'react';
import { type CacheSlice, readCache, writeCache } from '@/lib/offline-cache';

/**
 * `useState`, but the last value survives the process and paints the next cold
 * start before any listener has answered.
 *
 * Drop-in for the `useState` calls a subscribing hook keeps its slices in: the
 * setter is what an `onSnapshot` callback already calls, and it now writes
 * through to `AsyncStorage` on its way. See `offline-cache.ts` for why the Expo
 * app needs this at all when the PWA does not.
 *
 * ## The ordering rule this exists to enforce
 *
 * Hydration is async and a live snapshot can beat it — on a warm network it
 * usually does. If the cached value were applied unconditionally it would land
 * *on top of* fresher data and the screen would flick backwards to the last
 * session's totals. So the first live write wins permanently: once the setter
 * has run, hydration is discarded rather than applied late.
 *
 * @returns `[value, set, paintedFromCache]` — the third element is true only
 *   when a cached value was actually applied, which is what lets a caller drop
 *   its spinner without claiming a cache hit it did not get.
 */
export function useCachedState<T>(
  uid: string | undefined,
  slice: CacheSlice,
  initial: T,
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [paintedFromCache, setPainted] = useState(false);
  /** Set by the first live write. Guards the late-hydration case above. */
  const live = useRef(false);

  useEffect(() => {
    live.current = false;
    setPainted(false);
    if (!uid) return;
    let cancelled = false;
    void readCache<T>(uid, slice).then((cached) => {
      if (cancelled || live.current || cached == null) return;
      setValue(cached);
      setPainted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, slice]);

  const set = useCallback(
    (next: T) => {
      live.current = true;
      setValue(next);
      if (uid) writeCache(uid, slice, next);
    },
    [uid, slice],
  );

  return [value, set, paintedFromCache];
}
