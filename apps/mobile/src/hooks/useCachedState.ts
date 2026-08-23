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
 * `set` takes an optional `{ authoritative }`; see the comment on it.
 *
 * @returns `[value, set, paintedFromCache]` — the third element is true only
 *   when a cached value was actually applied, which is what lets a caller drop
 *   its spinner without claiming a cache hit it did not get.
 */
export function useCachedState<T>(
  uid: string | undefined,
  slice: CacheSlice,
  initial: T,
): [T, (next: T, opts?: { authoritative?: boolean }) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [paintedFromCache, setPainted] = useState(false);
  /** Set by the first live write. Guards the late-hydration case above. */
  const live = useRef(false);
  /** Mirror of `paintedFromCache` readable synchronously from `set`. */
  const painted = useRef(false);

  useEffect(() => {
    live.current = false;
    painted.current = false;
    setPainted(false);
    if (!uid) return;
    let cancelled = false;
    void readCache<T>(uid, slice).then((cached) => {
      if (cancelled || live.current || cached == null) return;
      setValue(cached);
      painted.current = true;
      setPainted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, slice]);

  const set = useCallback(
    (next: T, opts?: { authoritative?: boolean }) => {
      // `authoritative: false` means "this is what the local cache had, not what
      // the server says" — an offline Firestore listener fires immediately with
      // an EMPTY result and `fromCache: true`. Rendering it is fine; treating it
      // as the first LIVE write is not, because that both discards the disk
      // hydration below and writes the empty value through, wiping the cache for
      // the next cold start. Default stays true so every existing caller is
      // unchanged.
      const authoritative = opts?.authoritative ?? true;
      // A cache-only value must not CLOBBER one we already painted from disk
      // either. Not latching and not persisting was not enough: the offline
      // empty snapshot still landed in state, so the hydrated list was replaced
      // by [] a frame after it appeared and Train read as empty anyway. It is
      // still allowed through when nothing better has been shown yet — an empty
      // list beats no render at all.
      if (!authoritative && painted.current) return;
      if (authoritative) live.current = true;
      setValue(next);
      if (uid && authoritative) writeCache(uid, slice, next);
    },
    [uid, slice],
  );

  return [value, set, paintedFromCache];
}
