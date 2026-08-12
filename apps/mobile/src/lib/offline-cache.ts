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
 * slices are one 14-row log window, one profile and four small maps — kilobytes,
 * bounded by the queries themselves rather than by anything this file does.
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
  | 'activity';

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
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid, slice));
    if (!raw) return null;
    return JSON.parse(raw, reviver) as T;
  } catch {
    return null;
  }
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
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) =>
      uid == null ? k.startsWith(`${CACHE_PREFIX}.`) : k.startsWith(`${CACHE_PREFIX}.${uid}.`),
    );
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    /* Best-effort, same as clearWidget. */
  }
}
