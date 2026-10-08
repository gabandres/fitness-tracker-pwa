import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A read-through snapshot of what the last online session saw.
 *
 * ## Why this exists
 *
 * The PWA gets Firestore's own `persistentLocalCache` (`src/app/app.config.ts`).
 * The Expo app cannot: the JS SDK's persistence is IndexedDB, which React Native
 * does not have, so `getFirestore(app)` here is memory-only. Everything the SDK
 * holds dies with the process. Cold-start the app with no signal — a gym
 * basement, a plane, a dead-zone commute — and Today renders an empty day, no
 * rings, no history, and says nothing about why. For a food log used three times
 * a day away from wifi that is the worst screen in the product.
 *
 * This module is the missing half: every subscription writes its latest value
 * through to `AsyncStorage`, and the next cold start paints from disk while the
 * listeners reconnect. It is a **display cache and nothing more** — it never
 * feeds a write, never merges, and is replaced wholesale the moment a real
 * snapshot lands. Firestore stays the only source of truth.
 *
 * ## What is deliberately not here
 *
 * No eviction policy beyond the uid namespace and no size cap. The cached
 * slices are one `LOG_WINDOW_ROWS` (400-row) log window, one profile and a few
 * small maps and lists — tens of kilobytes at most, bounded by the queries
 * themselves rather than by anything this file does. The History calendar's
 * on-demand older months (`history-paging.ts`) are deliberately NOT cached:
 * they are component state, and caching them would be the unbounded growth
 * the window exists to prevent.
 *
 * ## Privacy
 *
 * The cache holds what someone ate, so it is namespaced by uid and dropped on
 * sign-out ({@link clearOfflineCache}), for the same reason `clearWidget` drops
 * the widget snapshot and `clearQuickAdd` drops the pending queue. A uid
 * namespace also means account B can never paint account A's day during the
 * moment before B's listeners deliver.
 */

/** Bump when a slice's shape changes in a way an old payload would mis-render.
 *  Old keys are orphaned rather than migrated — this is a cache, and the cost of
 *  a miss is one spinner. */
const CACHE_VERSION = 1;
const CACHE_PREFIX = `ignia.cache.v${CACHE_VERSION}`;

/** The slices Today paints from. Named rather than free-form so a typo is a
 *  compile error and not a silent permanent cache miss. */
export type CacheSlice =
  | 'logs'
  | 'weights'
  | 'profile'
  | 'presets'
  | 'customFoods'
  | 'water'
  | 'sleep'
  | 'activity'
  // Train's three. Added 2026-08-23: Today painted from disk while Train had
  // no cached slice at all, so it was the ONE tab that blocked on a server
  // round-trip before rendering anything — and it pays that cost on every
  // focus, not just cold start, because its listeners are focus-gated. Bounded
  // like the rest: the sessions slice mirrors the same `limit(50)` the
  // subscription uses.
  | 'workoutSessions'
  | 'exercises'
  | 'templates'
  // Body's own. Added 2026-09-28 (UX_AUDIT S18-13): History, Trends and Body
  // all booted on a bare spinner while Today painted from disk. History and
  // Trends read the SAME queries Today caches (`logs` is the one 400-row
  // window, `weights`/`profile` the same docs), so they now hydrate those
  // slices; measurements are the one read nobody else made. Bounded by the
  // subscription's own `limit(20)`.
  | 'measurements';

function cacheKey(uid: string, slice: CacheSlice): string {
  return `${CACHE_PREFIX}.${uid}.${slice}`;
}

/**
 * `Date` survives the round trip; nothing else non-primitive does.
 *
 * `DailyLog.date` and `Profile.fastStartedAt` are `Date`s, and `JSON.stringify`
 * turns them into strings that `JSON.parse` leaves as strings — so a naive cache
 * would hand `useToday` rows whose `.date.getTime()` is not a function, and the
 * crash would land in `summarizeDay`, far from here. The tagged form is
 * unambiguous: a real payload string can collide with an ISO date, but not with
 * `{__d: …}` carrying exactly one key.
 */
function replacer(this: Record<string, unknown>, key: string, _value: unknown): unknown {
  // `this[key]` is the pre-`toJSON` value; `value` has already been stringified
  // by Date.prototype.toJSON by the time a replacer sees it.
  const raw = this[key];
  if (raw instanceof Date) return { __d: raw.toISOString() };
  return _value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { __d?: unknown }).__d === 'string'
  ) {
    const d = new Date((value as { __d: string }).__d);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  return value;
}

/**
 * Read one slice, or `null` for a miss.
 *
 * Never throws and never rejects: a corrupt or half-written payload is a cache
 * miss, which costs a spinner. Callers treat `null` and "storage exploded"
 * identically because there is nothing else useful to do with the difference.
 */
export async function readCache<T>(uid: string, slice: CacheSlice): Promise<T | null> {
  const key = cacheKey(uid, slice);
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw, reviver) as T;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/**
 * This session's copy of every slice read or written so far.
 *
 * Disk is what survives the process; this is what lets a screen pushed in the
 * SAME session start painted. Without it every newly mounted reader (a History
 * day, Settings, the first visit to Trends or Body) rendered empty, then parsed
 * the 400-row logs blob back off disk, then rendered again — while Today, open
 * underneath, held the same value in memory. Same contents as the disk copy
 * minus the write debounce, so nothing here can paint what disk could not.
 */
const memory = new Map<string, unknown>();

/**
 * The slice as this session last saw it, synchronously — for a `useState`
 * initializer — or `null` when this session has not read or written it yet.
 */
export function peekCache<T>(uid: string, slice: CacheSlice): T | null {
  const key = cacheKey(uid, slice);
  return memory.has(key) ? (memory.get(key) as T) : null;
}

/**
 * Pending write-throughs, coalesced per key.
 *
 * Eight subscriptions deliver their first snapshot within a few ms of each
 * other, and a live day fires again on every meal. Writing straight through
 * would put a burst of `setItem` calls on the same bridge the UI is animating
 * over. The debounce keeps the newest value per slice and pays for one write.
 */
const WRITE_DEBOUNCE_MS = 400;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const latest = new Map<string, unknown>();

/**
 * Write one slice through to disk, debounced.
 *
 * Fire-and-forget by design — the caller is an `onSnapshot` callback rendering a
 * frame, and a cache write is never worth blocking one. A failure means the next
 * cold start shows a spinner instead of stale data.
 */
export function writeCache<T>(uid: string, slice: CacheSlice, value: T): void {
  const key = cacheKey(uid, slice);
  memory.set(key, value);
  latest.set(key, value);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const pending = latest.get(key);
      latest.delete(key);
      try {
        void AsyncStorage.setItem(key, JSON.stringify(pending, replacer)).catch(() => {});
      } catch {
        /* Unserializable payload — a cache miss next launch, not a crash now. */
      }
    }, WRITE_DEBOUNCE_MS),
  );
}

/**
 * Drop every cached slice for an account — or for all of them.
 *
 * Called on sign-out. The `uid`-less form exists for the case where the session
 * is already gone by the time anyone thinks to clear (a token revoked
 * server-side, a deleted account), where the only safe reading of "whose data is
 * this" is "not ours any more".
 */
export async function clearOfflineCache(uid?: string): Promise<void> {
  try {
    // Cancel anything still in the debounce window first, or a queued write
    // lands *after* the clear and resurrects the slice it just removed.
    for (const [key, timer] of timers) {
      if (uid == null || key.startsWith(`${CACHE_PREFIX}.${uid}.`)) {
        clearTimeout(timer);
        timers.delete(key);
        latest.delete(key);
      }
    }
    for (const key of [...memory.keys()]) {
      if (uid == null || key.startsWith(`${CACHE_PREFIX}.${uid}.`)) memory.delete(key);
    }
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) =>
      uid == null ? k.startsWith(`${CACHE_PREFIX}.`) : k.startsWith(`${CACHE_PREFIX}.${uid}.`),
    );
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    /* Best-effort, same as clearWidget. */
  }
}
