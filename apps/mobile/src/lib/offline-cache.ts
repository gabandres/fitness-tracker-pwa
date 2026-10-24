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
  | 'measurements'
  // "Day fully logged?" answers (2026-10-24, `complete-day.ts`). A first
  // frame painted from the logs slice without them would compute the
  // maintenance estimate under a different rule than the next frame — the
  // half-logged days the answers exclude would briefly count again. Bounded
  // by the user's own taps: one small entry per answered day.
  | 'dayLogged';

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
  // The disk read is async, and a live snapshot (`writeCache`) or a sign-out
  // (`clearOfflineCache`) can land while it is in flight. Setting memory from
  // the older disk payload after that overwrote the fresher value (audit #25),
  // so the read only fills memory if nothing touched this key meanwhile — and
  // hands back the newer value if something wrote one.
  // Registered even before any write, so a clear during this read bumps it.
  if (!versions.has(key)) versions.set(key, 0);
  const seen = versions.get(key) ?? 0;
  try {
    const raw = await AsyncStorage.getItem(key);
    if ((versions.get(key) ?? 0) !== seen) return memory.has(key) ? (memory.get(key) as T) : null;
    if (!raw) return null;
    const value = JSON.parse(raw, reviver) as T;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/** Bumped by every write and clear of a key — see {@link readCache}. */
const versions = new Map<string, number>();
function bump(key: string): void {
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

/**
 * The slices Today's first frame reads — what {@link preloadCache} warms while
 * Firebase Auth is still deciding who is signed in.
 */
export const FIRST_PAINT_SLICES: readonly CacheSlice[] = [
  'logs',
  'weights',
  'profile',
  'presets',
  'customFoods',
  'water',
  'sleep',
  'activity',
  'dayLogged',
];

/**
 * Read `slices` for `uid` into the in-memory copy, in ONE storage call, so the
 * hooks that mount once auth answers find them with {@link peekCache} —
 * synchronously, in their `useState` initializer — instead of starting a disk
 * read then.
 *
 * Why (2026-10-21): every reading hook keys on `user?.uid`, and `user` is null
 * until `onAuthStateChanged` fires — which on React Native waits on a token
 * refresh and an account lookup (~771 ms on the LG G6, `auth.tsx`). So the
 * disk read of Today's slices could not even START until then, and Today's
 * first painted frame was auth + an AsyncStorage round trip + parsing the
 * 400-row logs blob, in series. The uid is already on disk in Firebase's own
 * persisted session (`persisted-session.ts`); reading the slices for it during
 * the auth wait takes the disk half off the critical path.
 *
 * **Nothing is displayed by this.** It fills a cache keyed by uid; what paints
 * is still decided by the hooks and the auth gate. A uid that Firebase then
 * rejects simply never gets asked for — and its slices were already on this
 * device's disk, so holding them in memory exposes nothing new.
 *
 * Same race rule as {@link readCache}: a key written or cleared while the read
 * is in flight is left alone. Never throws.
 */
export async function preloadCache(uid: string, slices: readonly CacheSlice[]): Promise<void> {
  const keys = slices.map((s) => cacheKey(uid, s)).filter((k) => !memory.has(k));
  if (keys.length === 0) return;
  const seen = new Map<string, number>();
  for (const k of keys) {
    if (!versions.has(k)) versions.set(k, 0);
    seen.set(k, versions.get(k) ?? 0);
  }
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, raw] of pairs) {
      if (!raw || memory.has(key) || (versions.get(key) ?? 0) !== seen.get(key)) continue;
      try {
        memory.set(key, JSON.parse(raw, reviver));
      } catch {
        /* A corrupt slice is a miss, same as `readCache`. */
      }
    }
  } catch {
    /* Storage unavailable: the hooks read for themselves, as before. */
  }
}

/**
 * Whether two cache payloads say the same thing — what lets
 * `useCachedState` skip both the re-render and the write-through when a
 * listener re-delivers what is already on screen.
 *
 * A structural walk, not a fingerprint: the slices are plain JSON-ish data plus
 * `Date`s, and a fingerprint (ids + `updatedAt`) would miss a server-side edit
 * that does not bump a stamp — `enforceHealthTombstones` rewrites a session's
 * `cardio` without touching `updatedAt` (pinned in
 * `perf-keystroke-churn.test.ts`). O(n) and allocation-free; it stops at the first difference, and a
 * row object `onChangedData` carried over unchanged is `===` and costs one
 * compare. `undefined` and an absent key are equal (JSON drops both), `Date`s
 * compare by time, NaN equals NaN.
 */
export function sameCacheValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameCacheValue(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k in ao) if (!sameCacheValue(ao[k], bo[k])) return false;
  for (const k in bo) if (!(k in ao) && bo[k] !== undefined) return false;
  return true;
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
  bump(key);
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
    // A read still in flight must not repopulate what this just cleared.
    for (const key of [...versions.keys()]) {
      if (uid == null || key.startsWith(`${CACHE_PREFIX}.${uid}.`)) bump(key);
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
