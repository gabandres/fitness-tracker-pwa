/**
 * Quick-add — logging a preset from outside the app (ADR-0020).
 *
 * The glanceable surfaces (Android home-screen widget button, the Quick
 * Settings tile, and on iOS an App Intent / interactive widget button) all do
 * the same thing: write one preset straight into the ledger with no review
 * screen and no app launch. This module owns every rule in that path that is
 * not platform plumbing:
 *
 *   - **which** presets are reachable ({@link resolveQuickAddTargets}),
 *   - **what** gets written ({@link quickAddEntry}),
 *   - **what happens when the write fails** — the pending queue
 *     ({@link buildPendingLog} … {@link prunePendingLogs}),
 *   - **the doc id**, minted before the attempt ({@link newLedgerId}).
 *
 * ## Why the id is minted here and not by Firestore
 * A quick-add is the flakiest write in the app: a tile tap in a lift, a widget
 * button on a train. When the socket dies mid-`Write`, the client cannot tell a
 * request that never arrived from one that landed and lost its ack. Minting the
 * id up front makes the retry a `setDoc` of the *same* id — an idempotent
 * overwrite of identical bytes instead of a second meal on the user's day. It
 * is the same property `createDoc` in `apps/mobile/src/lib/ledger.ts` buys for
 * in-app creates (Sentry IGNIA-MOBILE-6); here it also has to survive being
 * parked on disk, which is why the id is a field of {@link PendingLog}.
 *
 * ## Why a pending log carries its uid
 * A queued write is flushed later, by the app, on whatever session is signed in
 * then. Landing someone else's meal on the current account is worse than losing
 * the tap, so the uid rides along and {@link prunePendingLogs} drops anything
 * that does not match. A surface that cannot resolve a uid at tap time must
 * **not** enqueue — it has nothing to write the row against.
 *
 * Pure by construction: no storage, no `Date.now()`, no randomness of its own.
 * The caller injects `nowMs`, `at` and `rand`.
 */

import { MEAL_TYPES, type LogEntry, type LogSource, type MealPreset, type MealType } from './types';

/** How many quick-add slots a user can designate. Slot 1 is the one a blind
 *  single-tap surface (the Quick Settings tile) uses; the interactive widget
 *  shows up to all three. Three because that is what fits a `systemMedium`
 *  face without the buttons becoming un-tappable. */
export const QUICK_ADD_MAX = 3;

/**
 * A preset flattened into everything a widget process needs to draw a button
 * and write a row — no Firestore read, no auth, no `MealPreset` lookup. This is
 * what travels in the widget snapshot blob.
 */
export interface QuickAddTarget {
  /** The `presets/{id}` doc this came from. Kept so a slot survives a rename
   *  and so the Settings picker can show which preset is bound. */
  presetId: string;
  /** Becomes the log's `mealLabel`, and the button's caption. */
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * Turn the user's designated slot ids into drawable targets.
 *
 * The slot list is device-local and the presets are server state, so the two
 * drift constantly — a preset gets deleted on another device, or the list
 * outlives it. Every kind of drift resolves the same way: the slot silently
 * disappears. Never throws, never returns a hole.
 *
 * Order is the user's slot order, not the presets' order. Duplicates collapse,
 * unknown ids vanish, and a zero-calorie preset is dropped: it would render a
 * button whose tap writes a row that changes nothing, which reads as a broken
 * button rather than as a no-op.
 */
export function resolveQuickAddTargets(
  presetIds: readonly string[] | null | undefined,
  presets: readonly MealPreset[] | null | undefined,
): QuickAddTarget[] {
  if (!presetIds || !presets) return [];
  const byId = new Map<string, MealPreset>();
  for (const p of presets) if (p.id) byId.set(p.id, p);

  const out: QuickAddTarget[] = [];
  const seen = new Set<string>();
  for (const id of presetIds) {
    if (out.length >= QUICK_ADD_MAX) break;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    const preset = byId.get(id);
    if (!preset) continue;
    if (!Number.isFinite(preset.calories) || preset.calories <= 0) continue;
    out.push({
      presetId: id,
      name: preset.name,
      calories: Math.round(preset.calories),
      ...(num(preset.protein) != null ? { protein: num(preset.protein) as number } : {}),
      ...(num(preset.carbs) != null ? { carbs: num(preset.carbs) as number } : {}),
      ...(num(preset.fat) != null ? { fat: num(preset.fat) as number } : {}),
    });
  }
  return out;
}

/** A finite, non-negative number rounded to one decimal, or undefined. Macros
 *  are optional on a preset and must stay optional on the wire — `undefined`
 *  is dropped by `prune-undefined` before the write, a `0` would be stored. */
function num(n: number | null | undefined): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 10) / 10;
}

/**
 * What a quick-add writes. `at` is the tap time, passed in rather than read,
 * because a queued write flushes later and must still land on the day it was
 * *tapped* — a Tuesday-evening shake does not belong on Wednesday's total.
 *
 * No `mealType`: a preset has none, and inferring one from the clock would be
 * the app deciding that 4pm is a snack. The row groups under "other", which is
 * what an untyped in-app entry already does.
 */
export function quickAddEntry(target: QuickAddTarget, at: Date): LogEntry {
  return {
    calories: target.calories,
    ...(target.protein != null ? { protein: target.protein } : {}),
    ...(target.carbs != null ? { carbs: target.carbs } : {}),
    ...(target.fat != null ? { fat: target.fat } : {}),
    mealLabel: target.name,
    timestamp: at,
  };
}

// ─── The pending queue ──────────────────────────────────────────

/** Wire version of a parked write. Bump with {@link PENDING_LOGS_KEY}. */
export const PENDING_LOGS_VERSION = 1;

/** Storage key for the queue — Android `AsyncStorage`, iOS App Group
 *  `UserDefaults` (the intent process has no AsyncStorage). Versioned so a v1
 *  queue written by an old binary is never half-read by a new one. */
export const PENDING_LOGS_KEY = 'ignia.pendingLogs.v1';

/** Hard cap on parked writes. A queue longer than this is not a flaky network,
 *  it is a user tapping a tile that has been broken for days; keeping the
 *  newest is the only reading of that with a sane flush. */
export const PENDING_LOGS_MAX = 25;

/** How long a parked write stays worth flushing. Past a week the user has
 *  certainly either re-logged the meal by hand or stopped caring, and silently
 *  materialising a row on a day they have already reviewed is worse than
 *  dropping it. */
export const PENDING_LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One write parked on disk. Flat and primitive-only: iOS writes these from
 * Swift with `JSONEncoder`, so there is no `Date` and no nested object
 * anywhere in the shape.
 */
export interface PendingLog {
  v: number;
  /** The ledger doc id, minted at tap time. The flush is a `setDoc` of this
   *  id, which is what makes a replay harmless. */
  id: string;
  /** Whose ledger this belongs to. See the module header. */
  uid: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel?: string;
  /**
   * Which meal slot the row files into, when the caller already decided.
   *
   * Optional, and absent on every write the **native** surfaces park: a widget
   * button and a Quick Settings tile are blind taps with no slot picker, and
   * Swift's `JSONEncoder` simply omits the key. It is carried for the in-app
   * offline path, where the user did pick a slot in the add sheet — dropping it
   * there would file a parked breakfast into whatever `withDefaultMealSlot`
   * infers from the flush time, which can be hours later and a different meal.
   */
  mealType?: MealType;
  /**
   * Creation provenance, carried so a parked write flushes as what it was.
   *
   * Absent on every native tap (a widget button is not a photo scan, and
   * Swift's `JSONEncoder` omits the key) and on every typed meal. It is here
   * for one case: a photo scan logged with no signal. Drop it and the row that
   * eventually lands is indistinguishable from a typed one — which is the exact
   * gap `first-scan` was blocked on, reintroduced on the offline path only,
   * where nobody would look for it.
   */
  source?: LogSource;
  /** Tap time, epoch ms. Becomes the log's timestamp on flush. */
  atMs: number;
}

/** Park an entry. `entry.timestamp` wins over `atMs` when present — it is the
 *  tap time the caller already decided on. */
export function buildPendingLog(id: string, uid: string, entry: LogEntry, atMs: number): PendingLog {
  const at = entry.timestamp instanceof Date ? entry.timestamp.getTime() : atMs;
  return {
    v: PENDING_LOGS_VERSION,
    id,
    uid,
    calories: Math.round(entry.calories),
    ...(num(entry.protein) != null ? { protein: num(entry.protein) as number } : {}),
    ...(num(entry.carbs) != null ? { carbs: num(entry.carbs) as number } : {}),
    ...(num(entry.fat) != null ? { fat: num(entry.fat) as number } : {}),
    ...(entry.mealLabel ? { mealLabel: entry.mealLabel } : {}),
    ...(entry.mealType ? { mealType: entry.mealType } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    atMs: Number.isFinite(at) ? Math.round(at) : atMs,
  };
}

/** Back to the domain shape the ledger writes. */
export function pendingLogEntry(p: PendingLog): LogEntry {
  return {
    calories: p.calories,
    ...(p.protein != null ? { protein: p.protein } : {}),
    ...(p.carbs != null ? { carbs: p.carbs } : {}),
    ...(p.fat != null ? { fat: p.fat } : {}),
    ...(p.mealLabel ? { mealLabel: p.mealLabel } : {}),
    ...(p.mealType ? { mealType: p.mealType } : {}),
    ...(p.source ? { source: p.source } : {}),
    timestamp: new Date(p.atMs),
  };
}

function isPendingLog(x: unknown): x is PendingLog {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o['v'] !== PENDING_LOGS_VERSION) return false;
  if (typeof o['id'] !== 'string' || o['id'] === '') return false;
  if (typeof o['uid'] !== 'string' || o['uid'] === '') return false;
  if (typeof o['calories'] !== 'number' || !Number.isFinite(o['calories'])) return false;
  if (typeof o['atMs'] !== 'number' || !Number.isFinite(o['atMs'])) return false;
  // Absent is the normal case (every native tap). Present-but-unknown is a
  // corrupted row: `firestore.rules` validates the slot, so flushing it would
  // fail permanently and the row would sit in the queue retrying until the TTL
  // dropped it. Reject it here instead, where one bad row does not take the
  // good ones with it.
  if (o['mealType'] !== undefined && !MEAL_TYPES.includes(o['mealType'] as MealType)) return false;
  // Same rule as the slot above, same reason: `isValidLog` allow-lists the
  // value, so a corrupted `source` would fail its flush forever and sit in the
  // queue until the TTL. Reject the row here, not on the wire.
  if (o['source'] !== undefined && o['source'] !== 'photo') return false;
  return true;
}

/**
 * Decode the queue off disk. Anything unreadable — absent, truncated by a
 * mid-write kill, written by a newer binary — collapses to an empty queue, and
 * a single bad row does not discard the good ones around it. This runs inside a
 * widget task handler where a throw is an invisible failure, so it never
 * throws.
 */
export function parsePendingLogs(raw: string | null | undefined): PendingLog[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isPendingLog);
}

export function serializePendingLogs(list: readonly PendingLog[]): string {
  return JSON.stringify(list);
}

/**
 * Add one write to the queue, oldest-first.
 *
 * Deduped by id, which is the whole point of minting it early: the same tap
 * retried twice — by a widget redraw, by an intent the OS replayed — parks
 * once. The newer copy wins, because it carries the later view of the entry.
 * Over the cap, the oldest go.
 */
export function mergePendingLog(
  list: readonly PendingLog[],
  next: PendingLog,
): PendingLog[] {
  const out = list.filter((p) => p.id !== next.id);
  out.push(next);
  return out.slice(-PENDING_LOGS_MAX);
}

/**
 * What is still worth flushing: this account's writes, younger than the TTL.
 *
 * Passing `uid` is how a sign-out becomes a queue clear — everything belonging
 * to the previous account fails the filter. Passing `null` prunes on age only,
 * for the case where there is no session to compare against.
 */
export function prunePendingLogs(
  list: readonly PendingLog[],
  nowMs: number,
  uid: string | null,
): PendingLog[] {
  return list.filter((p) => {
    if (uid != null && p.uid !== uid) return false;
    return nowMs - p.atMs <= PENDING_LOG_TTL_MS;
  });
}

// ─── Ledger ids ─────────────────────────────────────────────────

/** Firestore's own auto-id alphabet and length. Matching them exactly means a
 *  minted id is indistinguishable from one `doc(col)` produced, so nothing
 *  downstream — rules, exports, the PWA — can tell which path wrote a row. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 20;

/**
 * Mint a ledger doc id. `rand` must return `[0, 1)` — `Math.random` in JS,
 * `SystemRandomNumberGenerator` on the Swift side.
 *
 * Collision risk is the same as Firestore's own: 62^20. This is not a security
 * token and must not be used as one — it is a name, and it is written into a
 * path the rules already scope to one user.
 */
export function newLedgerId(rand: () => number): string {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    const idx = Math.floor(rand() * ID_ALPHABET.length);
    out += ID_ALPHABET[Math.min(ID_ALPHABET.length - 1, Math.max(0, idx))];
  }
  return out;
}
