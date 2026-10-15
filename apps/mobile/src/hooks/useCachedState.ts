import { useCallback, useEffect, useRef, useState } from 'react';
import { type CacheSlice, peekCache, readCache, writeCache } from '@/lib/offline-cache';

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
/**
 * `uid:slice` pairs the SERVER has answered in this JS runtime.
 *
 * What makes a cache-only snapshot safe to show. Firestore here is
 * memory-only (LRU, `firebase.ts`): before the server has answered a query in
 * this runtime, a cache-only snapshot is the absence of an answer (empty, or
 * just the docs this device wrote) and must not replace the disk paint. AFTER
 * it has, the memory cache holds that answer plus every local write since, so
 * a cache-only snapshot is NEWER than anything on disk — and dropping it is
 * what kept an offline delete or edit off the screen until reconnect
 * (2026-10-15 audit: once painted, every `fromCache` snapshot was dropped, and
 * offline every snapshot is `fromCache`).
 *
 * Runtime-wide rather than per hook instance: the LRU cache outlives a
 * listener, so a tab that re-opens its listener on focus, or a screen that
 * mounts later, reads the same complete view.
 */
const serverAnswered = new Set<string>();

/** Test seam: forget which slices the server answered. */
export function __resetServerAnswered(): void {
  serverAnswered.clear();
}

export function useCachedState<T>(
  uid: string | undefined,
  slice: CacheSlice,
  initial: T,
): [T, (next: T, opts?: { authoritative?: boolean }) => void, boolean] {
  // Seeded from this session's in-memory copy when there is one, so a screen
  // pushed over Today mounts painted instead of rendering empty first and
  // waiting on the disk read below (`peekCache`).
  const [seed] = useState(() => (uid ? peekCache<T>(uid, slice) : null));
  const [value, setValue] = useState<T>(() => seed ?? initial);
  const [paintedFromCache, setPainted] = useState(seed != null);
  /** Set by the first live write. Guards the late-hydration case above. */
  const live = useRef(false);
  /** Mirror of `paintedFromCache` readable synchronously from `set`. */
  const painted = useRef(seed != null);

  useEffect(() => {
    live.current = false;
    if (!uid) {
      painted.current = false;
      setPainted(false);
      return;
    }
    const hit = peekCache<T>(uid, slice);
    if (hit != null) {
      // On mount this is what the initializer already applied, and both
      // setters bail out; on an account switch it is the new account's value.
      painted.current = true;
      setValue(hit);
      setPainted(true);
      return;
    }
    painted.current = false;
    setPainted(false);
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
      //
      // Unless the server has already answered this slice in this runtime:
      // then the cache-only value is the server's answer plus this device's
      // own writes since, newer than the disk paint (see `serverAnswered`).
      // It is shown but still not persisted — disk only ever holds a value the
      // server confirmed.
      const key = uid ? `${uid}:${slice}` : null;
      if (!authoritative && painted.current && !(key && serverAnswered.has(key))) return;
      if (authoritative) {
        live.current = true;
        if (key) serverAnswered.add(key);
      }
      setValue(next);
      if (uid && authoritative) writeCache(uid, slice, next);
    },
    [uid, slice],
  );

  return [value, set, paintedFromCache];
}
