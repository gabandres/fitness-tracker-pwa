import { useCallback, useEffect, useRef, useState } from 'react';
import { type CacheSlice, peekCache, readCache, sameCacheValue, writeCache } from '@/lib/offline-cache';

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
  /**
   * What is on screen, and what disk (and `offline-cache`'s memory copy) holds,
   * readable synchronously from `set` — the two halves of the equality skip.
   *
   * Two refs, not one, because they diverge: a cache-only value is SHOWN but
   * not persisted, so when the server then confirms that same value it is a
   * no-op for the screen and still owed to disk. Comparing against the screen
   * alone would have skipped that write and left the next cold start on the
   * older value.
   */
  const shown = useRef<T>(seed ?? initial);
  const stored = useRef<T | null>(seed);
  /** The first render's `initial`, so a sign-out can put it back by identity. */
  const [initialValue] = useState(initial);

  useEffect(() => {
    live.current = false;
    if (!uid) {
      painted.current = false;
      setPainted(false);
      stored.current = null;
      // Signed out (or the account is not known yet): drop what the last
      // account's slice put on screen rather than keep it under no uid. A
      // no-op on a mount that never had a uid — the value is still `initial`.
      if (shown.current !== initialValue) {
        shown.current = initialValue;
        setValue(initialValue);
      }
      return;
    }
    const hit = peekCache<T>(uid, slice);
    if (hit != null) {
      // On mount this is what the initializer already applied, and both
      // setters bail out; on an account switch it is the new account's value.
      painted.current = true;
      shown.current = hit;
      stored.current = hit;
      setValue(hit);
      setPainted(true);
      return;
    }
    painted.current = false;
    stored.current = null;
    setPainted(false);
    let cancelled = false;
    void readCache<T>(uid, slice).then((cached) => {
      if (cancelled || live.current || cached == null) return;
      shown.current = cached;
      stored.current = cached;
      setValue(cached);
      painted.current = true;
      setPainted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, slice, initialValue]);

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
      // The provenance bookkeeping runs whether or not the value changed: a
      // server answer identical to the disk paint is still the server's
      // answer, and it is what lets a later cache-only snapshot through.
      if (authoritative) {
        live.current = true;
        if (key) serverAnswered.add(key);
      }
      // ── The equality skip (2026-10-21) ──
      //
      // Today re-attaches ~21 listeners on every focus, and each one's first
      // snapshot was a NEW array or map holding exactly what was already on
      // screen. Every one of them re-rendered Today (≈10 renders per refocus,
      // each re-deriving targets, the streak and the diary over 400 rows) and
      // re-serialized its slice to AsyncStorage. Same value → no `setValue`,
      // and no write-through when disk already holds it. `sameCacheValue` is
      // O(n) and short-circuits on the row objects `onChangedData` carried
      // over, so the compare costs far less than the render it replaces.
      if (!sameCacheValue(shown.current, next)) {
        shown.current = next;
        setValue(next);
      }
      if (uid && authoritative && !(stored.current != null && sameCacheValue(stored.current, next))) {
        stored.current = next;
        writeCache(uid, slice, next);
      }
    },
    [uid, slice],
  );

  return [value, set, paintedFromCache];
}

/**
 * `useState` for a listener's slice that is NOT cached to disk, with the same
 * equality skip as {@link useCachedState}: a delivery structurally equal to
 * what is held keeps the held value, so React bails out instead of
 * re-rendering the screen.
 *
 * For the channels a refocus re-opens that never had a disk slice — Today's
 * trained-day sessions and its night's times, the milestones, the target
 * records, a day's fasts. Each one's first snapshot after a refocus is a new
 * object holding what was already shown, and each was one more full render of
 * Today. The setter ignores a second argument, so it drops straight into a
 * `feedChannel`'s `apply`.
 */
export function useStableState<T>(initial: T | (() => T)): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // Compared against a ref, NOT inside a functional update: returning `prev`
  // from an updater still re-runs the component whenever React cannot bail out
  // eagerly (any other update pending on the fiber — the norm on Today, where
  // a refocus delivers several channels in one tick). Not calling the setter
  // at all is the only skip that is free. Every write goes through `set`, so
  // the ref cannot drift from the state.
  const held = useRef(value);
  const set = useCallback((next: T) => {
    if (sameCacheValue(held.current, next)) return;
    held.current = next;
    setValue(next);
  }, []);
  return [value, set];
}
