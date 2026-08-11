import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_LOGS_KEY,
  QUICK_ADD_MAX,
  type PendingLog,
  type QuickAddTarget,
  type WidgetSnapshot,
  applyQuickAddToSnapshot,
  buildPendingLog,
  mergePendingLog,
  newLedgerId,
  parsePendingLogs,
  pendingLogEntry,
  prunePendingLogs,
  quickAddEntry,
  serializePendingLogs,
} from '@macrolog/core';
import { Platform } from 'react-native';
import { setTileState } from '../../modules/quick-add-tile';
import {
  clearQuickAddCredentials,
  setQuickAddCredentials,
} from '../../modules/quick-add-credentials';
import { widgetStrings } from '../widgets/strings';
import { NATIVE_REST_CONFIG, auth, onSessionTokenChanged } from './firebase';
import { exportNutrition } from './health-sync';
import { addLogWithId } from './ledger';
import { APP_GROUP, assertWatchSnapshot, readWidgetSnapshot, saveWidgetSnapshot } from './widget';

/**
 * Quick-add adapter — the impure half of ADR-0020. Every rule lives in
 * `@macrolog/core`'s `quick-add`; this file is storage, auth and the ledger
 * call.
 *
 * ## The context this has to run in
 * Most of it executes in the **Android widget task handler** — a headless JS
 * context the OS starts when the app's UI was never mounted. There is no React
 * tree, no `AuthProvider`, no i18n and no `useToday`. What there *is*, and what
 * the whole design rests on, is `AsyncStorage`: `firebase.ts` initialises auth
 * with `getReactNativePersistence(AsyncStorage)`, so the signed-in session
 * rehydrates in that context too — asynchronously, which is why
 * {@link currentUid} exists.
 *
 * ## Slots are device-local on purpose
 * Which presets are quick-addable is a property of *this phone's* home screen
 * and tile, not of the account, so it lives in `AsyncStorage` next to the
 * reminder and Health-connection preferences. It also means adding a quick-add
 * slot needs no new Firestore field and therefore no `firestore.rules` deploy.
 */

/** Ordered preset ids the user designated, slot 1 first. Device-local. */
const SLOTS_KEY = 'ignia.quickAdd.slots.v1';

/** How long to wait for auth to rehydrate in a headless context before giving
 *  up. Reading a value out of `AsyncStorage` is single-digit milliseconds; this
 *  is generous by two orders of magnitude and still well inside the ~10s an
 *  Android widget task gets. */
const AUTH_WAIT_MS = 4000;

export async function getQuickAddSlots(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SLOTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, QUICK_ADD_MAX);
  } catch {
    return [];
  }
}

export async function setQuickAddSlots(ids: readonly string[]): Promise<void> {
  const next = ids.slice(0, QUICK_ADD_MAX);
  await AsyncStorage.setItem(SLOTS_KEY, JSON.stringify(next));
  for (const l of listeners) l(next);
}

/** In-process listeners on the slot list. The picker lives in Settings and the
 *  snapshot writer lives on Today, and `AsyncStorage` has no change events — so
 *  without this, designating a slot would not reach the home screen until the
 *  next foreground. Deliberately not a context: nothing renders from it except
 *  the widget sync, and the value is device state, not account state. */
const listeners = new Set<(ids: string[]) => void>();

export function subscribeQuickAddSlots(cb: (ids: string[]) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Toggle a preset's membership in the slot list, preserving the order the user
 * picked in. Returns the new list so the caller can render without re-reading.
 *
 * At the cap the *oldest* selection is dropped rather than the tap being
 * refused: a picker that silently does nothing when you tap a fourth item is
 * indistinguishable from a broken one, and the list is small enough to see.
 */
export async function toggleQuickAddSlot(presetId: string): Promise<string[]> {
  const current = await getQuickAddSlots();
  const next = current.includes(presetId)
    ? current.filter((id) => id !== presetId)
    : [...current, presetId].slice(-QUICK_ADD_MAX);
  await setQuickAddSlots(next);
  return next;
}

/**
 * The signed-in uid, waiting for persistence to rehydrate if it has not yet.
 *
 * `auth.currentUser` is null for the first tick of a cold headless start, so
 * reading it directly would make every quick-add on a freshly-woken widget look
 * like a signed-out one. Resolves `null` on genuine sign-out and on timeout —
 * both mean "do not write".
 */
export function currentUid(timeoutMs = AUTH_WAIT_MS): Promise<string | null> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  return new Promise((resolve) => {
    let done = false;
    const finish = (uid: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub?.();
      resolve(uid);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsub = auth.onAuthStateChanged(
      (u) => finish(u?.uid ?? null),
      () => finish(null),
    );
  });
}

/**
 * How long a quick-add write may run before it is treated as offline.
 *
 * Comfortably inside `QuickAddTileTaskService`'s 15s headless budget, and
 * outside it only after the 4s auth wait has already been spent — see
 * `withWriteDeadline` for why a deadline is needed at all.
 */
const WRITE_DEADLINE_MS = 6000;

/**
 * Resolve, or reject once the deadline passes.
 *
 * ## Why this exists — a tap that vanished
 *
 * `logQuickAdd` parks a row when the write **throws**, which is the entire
 * offline story: `WIDGET.md` promises "airplane mode → tap → re-enable, open
 * the app, the row lands". That promise rested on an assumption nobody had
 * tested, and it is wrong.
 *
 * **Firestore's `setDoc` does not reject when it cannot reach the backend.** It
 * waits, indefinitely, and resolves whenever connectivity returns. So on a
 * flaky or absent connection `addLogWithId` neither resolves nor throws — the
 * `catch` never runs, `park()` is unreachable, and the optimistic snapshot
 * (applied only after the write returns) never moves either. The tap is
 * silently lost.
 *
 * On a glanceable surface that is worse than anywhere else, because the caller
 * is a headless task with a hard ceiling: `QuickAddTileTaskService` allows 15s
 * and Android then kills the process mid-await, taking the un-parked row with
 * it. Observed 2026-08-08 on the `ignia-a35` emulator — a `Write` RPC logged
 * `transport errored`, no pending-logs key was ever created, and
 * `ActivityManager` reported the service overran.
 *
 * A deadline converts that hang into the throw the design already handles.
 * Double-writing is not a risk: the id is minted **before** the attempt
 * precisely so a retry is an idempotent upsert of identical bytes (ADR-0020),
 * so a slow write that lands after we have parked the same id is a no-op.
 */
function withWriteDeadline<T>(p: Promise<T>, ms = WRITE_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('quick-add write deadline')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Whether a quick-add landed in the ledger or was parked for later. The
 *  difference is the entire content of the user-facing receipt, so it is a
 *  return value and not a log line. */
export type QuickAddResult = 'logged' | 'queued' | 'signed-out';

/**
 * Log one quick-add target. Never throws — every caller is a fire-and-forget OS
 * callback where a rejection surfaces as nothing at all.
 *
 * The id is minted before the attempt, so a failed write is parked under the
 * same id the retry will use: if the original request actually reached the
 * server and only its ack was lost, the flush overwrites identical bytes
 * instead of adding a second meal to the day.
 *
 * A `signed-out` result deliberately parks **nothing**. A pending row is
 * addressed to a uid, and guessing the account at flush time could put this
 * meal on someone else's ledger.
 */
export async function logQuickAdd(
  target: QuickAddTarget,
  at: Date = new Date(),
): Promise<QuickAddResult> {
  const uid = await currentUid();
  if (!uid) return 'signed-out';

  const id = newLedgerId(Math.random);
  const entry = quickAddEntry(target, at);
  try {
    await withWriteDeadline(addLogWithId(uid, id, entry));
    // Best-effort and fully guarded inside; a quick-add is a meal like any
    // other, so it belongs in Health for the same reason `useToday.addEntry`
    // mirrors one. Silently absent in a headless context without permission.
    void exportNutrition({
      at,
      kcal: entry.calories,
      protein: entry.protein,
      carbs: entry.carbs,
      fat: entry.fat,
    });
    return 'logged';
  } catch {
    await park(buildPendingLog(id, uid, entry, at.getTime()));
    return 'queued';
  }
}

/** What one slot tap did, and what the glanceable surfaces should now draw.
 *  `'no-target'` covers a slot whose preset vanished between the last snapshot
 *  write and the tap, and a tap arriving before the app has ever written one. */
export interface QuickAddOutcome {
  result: QuickAddResult | 'no-target';
  /** The snapshot to render: optimistically incremented on a write that landed
   *  or was parked, untouched otherwise, `null` when there was none on disk. */
  snapshot: WidgetSnapshot | null;
  target?: QuickAddTarget;
}

/**
 * Log the preset in a slot, from whichever surface was tapped.
 *
 * Both entry points funnel through here — the widget button's task handler and
 * the Quick Settings tile's headless task — so the two can never disagree about
 * what a slot means, whether a signed-out tap writes, or how the totals move.
 * The only thing the callers do differently is *how* they redraw: the widget
 * handler already holds a `renderWidget`, the tile has to ask the OS.
 *
 * The optimistic snapshot is the receipt. `applyQuickAddToSnapshot` is a local
 * edit, not a recomputation — a widget process has one day's totals and no log
 * list — so it is close, not authoritative, and the app's next `syncWidget`
 * replaces it with the real summary.
 */
export async function performQuickAdd(
  slot: number,
  at: Date = new Date(),
): Promise<QuickAddOutcome> {
  const snapshot = await readWidgetSnapshot();
  const target = snapshot?.quickAdd?.[slot];
  if (!snapshot || !target) return { result: 'no-target', snapshot };

  const result = await logQuickAdd(target, at);

  // A signed-out tap wrote nothing anywhere and never will — the row is
  // unattributable. Moving the numbers for it would leave the home screen
  // disagreeing with the app, which is worse than the tap doing nothing.
  if (result === 'signed-out') return { result, snapshot, target };

  const next = applyQuickAddToSnapshot(snapshot, target, at.getTime());
  if (next) {
    await saveWidgetSnapshot(next);
    // ...and tell the WATCH, which `saveWidgetSnapshot` does not: it is
    // Android-only, and this is the one write path that never passes through
    // `syncWidget`. Without this a quick-added meal reached the phone's widget
    // and left the complication showing stale numbers until the app was next
    // opened on Today.
    assertWatchSnapshot(next);
  }
  return { result, snapshot: next ?? snapshot, target };
}

/**
 * Where the pending queue lives, which is **not the same store on both
 * platforms** — and it cannot be.
 *
 * On Android the only writer is JS (the widget task handler and the tile's
 * headless task both run in our JS context), so `AsyncStorage` is right and is
 * what everything else here uses.
 *
 * On iOS the writer is **Swift**: an App Intent parks a failed REST write with no
 * JS anywhere in the process. `AsyncStorage` is a SQLite database in the app's own
 * container — an intent cannot reach it, and the app could not see anything the
 * intent wrote there. The App Group container is the one store both processes
 * share, so on iOS the queue lives there, under the same key
 * (`PENDING_LOGS_KEY`), in the same wire shape `PendingLog` defines.
 *
 * Getting this wrong is invisible: every iOS quick-add would appear to queue and
 * then never flush, because the flush would be reading an empty store.
 */
/**
 * Where a native quick-add records what happened to it. Must equal
 * `Glance.quickAddOutcomeKey` in `targets/_shared/Glance.swift`.
 */
export const QUICK_ADD_OUTCOME_KEY = 'ignia.quickAdd.outcome.v1';

/**
 * What the last **native** widget/tile tap did. `null` when none has ever run.
 *
 * Distinct from `QuickAddOutcome` above, which is what an in-app `logQuickAdd`
 * returns synchronously to its caller. This one crosses a process boundary and
 * is read back later, so it carries a timestamp and no snapshot.
 */
export interface NativeQuickAddOutcome {
  /**
   * - `logged` — written to the ledger.
   * - `queued` — parked offline; the app lands it on next foreground.
   * - `signedOut` — no readable credential. **Nothing was written and nothing
   *   was parked**, and the widget's numbers deliberately did not move.
   * - `noSlot` — the bound preset no longer exists.
   */
  outcome: 'logged' | 'queued' | 'signedOut' | 'noSlot';
  atMs: number;
}

/**
 * Read the note a native quick-add left behind (iOS only; `null` elsewhere).
 *
 * A widget button cannot answer back — no dialog, no toast, no screen — and the
 * two failure paths that matter leave the widget's numbers untouched, which is
 * precisely what a button that was never wired up looks like. An unreachable
 * keychain made every widget quick-add a silent no-op from build 27 to build 32
 * and nothing recorded it anywhere, including Sentry, which does not exist in a
 * Swift extension. This is the channel that would have caught it in a day.
 *
 * Diagnosis, not telemetry: it is written to the shared App Group and read back
 * by the app. Nothing leaves the device.
 */
export async function readQuickAddOutcome(): Promise<NativeQuickAddOutcome | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const { ExtensionStorage } = require('@bacons/apple-targets');
    const json = new ExtensionStorage(APP_GROUP).get(QUICK_ADD_OUTCOME_KEY);
    if (!json) return null;
    const parsed = JSON.parse(json) as { outcome?: string; atMs?: string | number };
    const outcome = parsed.outcome;
    if (
      outcome !== 'logged' &&
      outcome !== 'queued' &&
      outcome !== 'signedOut' &&
      outcome !== 'noSlot'
    ) {
      return null;
    }
    const atMs = Number(parsed.atMs);
    return { outcome, atMs: Number.isFinite(atMs) ? atMs : 0 };
  } catch {
    return null;
  }
}

const pendingStore = {
  async read(): Promise<string | null> {
    if (Platform.OS === 'ios') {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      return new ExtensionStorage(APP_GROUP).get(PENDING_LOGS_KEY) ?? null;
    }
    return AsyncStorage.getItem(PENDING_LOGS_KEY);
  },
  async write(json: string): Promise<void> {
    if (Platform.OS === 'ios') {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      new ExtensionStorage(APP_GROUP).set(PENDING_LOGS_KEY, json);
      return;
    }
    await AsyncStorage.setItem(PENDING_LOGS_KEY, json);
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'ios') {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      new ExtensionStorage(APP_GROUP).set(PENDING_LOGS_KEY, undefined);
      return;
    }
    await AsyncStorage.removeItem(PENDING_LOGS_KEY);
  },
};

async function park(row: PendingLog): Promise<void> {
  try {
    const list = parsePendingLogs(await pendingStore.read());
    await pendingStore.write(serializePendingLogs(mergePendingLog(list, row)));
  } catch {
    /* A queue we cannot write is a lost tap, not a crash. */
  }
}

export async function readPendingLogs(): Promise<PendingLog[]> {
  try {
    return parsePendingLogs(await pendingStore.read());
  } catch {
    return [];
  }
}

/**
 * Try to land every parked write for the current account, then rewrite the
 * queue with whatever is left.
 *
 * Called on app foreground (see `useWidgetSync`), which is the moment a device
 * that was offline when the tile was tapped is most likely back. Each row is
 * attempted independently — one permanent failure must not block the rest, the
 * same reasoning `CLAUDE.md` applies to the hourly dispatcher.
 *
 * Returns how many landed, so a caller can decide whether the numbers on screen
 * are about to move.
 */
export async function flushPendingLogs(uid: string, nowMs: number = Date.now()): Promise<number> {
  const all = await readPendingLogs();
  if (all.length === 0) return 0;

  // Age + account pruning happens BEFORE the attempts: a row belonging to a
  // previous session is not "failed", it is not ours to write, and this is the
  // path that clears it.
  const mine = prunePendingLogs(all, nowMs, uid);
  const stillPending: PendingLog[] = [];
  let landed = 0;

  for (const row of mine) {
    try {
      await addLogWithId(uid, row.id, pendingLogEntry(row));
      landed++;
    } catch {
      stillPending.push(row);
    }
  }

  try {
    if (stillPending.length === 0) await pendingStore.clear();
    else await pendingStore.write(serializePendingLogs(stillPending));
  } catch {
    /* Best-effort: worst case a landed row is retried, which is idempotent. */
  }
  return landed;
}

/**
 * Hand iOS the credential an App Intent needs to write on its own (ADR-0020).
 *
 * The refresh token is the only part JS has that Swift cannot get: it is exchanged
 * at `securetoken.googleapis.com` for a one-hour ID token, which the Firestore
 * REST API accepts. That is what lets a Siri phrase or a widget button write with
 * no Firebase SDK in the process and no Cloud Function anywhere.
 *
 * Signed out clears it — and that is the most important clear in this feature,
 * because the envelope is the one artefact that can still *write* after the
 * session is gone.
 *
 * **Do not call this from an effect keyed on the uid alone.** It reads
 * `user.refreshToken`, which is populated *after* `uid` on a restored session,
 * and the empty-token branch below clears the envelope. Keyed on uid, that clear
 * is terminal for the session: nothing changes again, nothing retries, and every
 * Siri phrase and widget tap reports signed-out for as long as the app runs.
 * `watchQuickAddCredentials` is the correct entry point. See it for what that
 * cost.
 *
 * Android is a no-op: its surfaces reach the ledger through JS and never need a
 * bare credential.
 */
export async function syncQuickAddCredentials(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const user = auth.currentUser;
  // `user.refreshToken` is exposed by the JS SDK on the User object. It can be
  // empty on a freshly-restored session before the first token refresh, and an
  // empty envelope is worse than none — it would make the intents report a
  // failure rather than "sign in again".
  if (!user?.uid || !user.refreshToken) {
    await clearQuickAddCredentials();
    return;
  }
  await setQuickAddCredentials({
    refreshToken: user.refreshToken,
    uid: user.uid,
    apiKey: NATIVE_REST_CONFIG.apiKey,
    projectId: NATIVE_REST_CONFIG.projectId,
  });
}

/**
 * Keep the credential envelope in step with the session, for as long as the app
 * is running. Returns an unsubscribe.
 *
 * ## Why this exists — the failure it fixes
 *
 * The envelope used to be written from an effect keyed on the **uid**. That is
 * one event too few. `onAuthStateChanged` — which is what sets the uid — fires
 * as soon as a session is restored from disk, and at that moment
 * `user.refreshToken` can still be `''`. `syncQuickAddCredentials` correctly
 * refuses to write an empty envelope and **clears** the old one instead. Keyed
 * on the uid, nothing then re-ran: the uid was already set and never changed
 * again, so the envelope stayed absent for the whole session.
 *
 * The result is invisible. `QuickAdd.log` returns `.signedOut`, and
 * `LogQuickAddSlotIntent` is the one intent that returns a bare `.result()` with
 * no dialog — so a widget tap does *nothing at all*: no row, no error, no moved
 * number, nothing in Sentry. Reported from a device on 2026-08-08 as "when I
 * click on preset from the widget, nothing happens", on builds 30/31, with the
 * same code that had been proven working from Siri on build 28. It is
 * session-dependent, which is exactly why it passed device QA once and failed
 * later.
 *
 * `onIdTokenChanged` is the right event and `onAuthStateChanged` is not: the
 * former also fires when the token is refreshed, which is the transition that
 * was being missed. It fires on sign-in, on refresh and on sign-out — the three
 * moments the envelope's validity actually changes.
 *
 * iOS-only, like everything else here.
 */
export function watchQuickAddCredentials(): () => void {
  if (Platform.OS !== 'ios') return () => {};
  return onSessionTokenChanged(() => {
    void syncQuickAddCredentials();
  });
}

/**
 * Mirror slot 1 onto the Quick Settings tile.
 *
 * The tile is Kotlin and runs before any JS does, so it cannot ask what the
 * user's first preset is called — and it must be labelled, because a Quick
 * Settings tap is blind (ADR-0020). This is the only place that mirror is
 * written, and it is driven from the same effect that writes the widget snapshot
 * so the two can never describe different presets.
 *
 * `enabled: false` with a null label is the correct state for both "no slots
 * designated" and "signed out": the tile goes inert and its tap opens the app
 * instead of logging something unnamed.
 */
export async function syncQuickAddTile(
  targets: readonly QuickAddTarget[],
  signedIn: boolean,
  locale: string,
): Promise<void> {
  const first = signedIn ? targets[0] : undefined;
  // Set from JS, so unlike the manifest's `android:label` this follows the APP's
  // locale rather than the device's — the distinction WIDGET.md draws for every
  // glanceable surface. The verb comes from the widget's own string table
  // rather than a second one: it is the same word for the same purpose, and a
  // duplicate table is a thing to keep in step for no benefit.
  const verb = widgetStrings(locale).quickAddA11y;
  await setTileState(first ? `${verb} ${first.name}` : null, first != null);
}

/**
 * Drop the queue and the slot list on sign-out.
 *
 * The queue is the privacy-relevant half — it holds what someone ate, addressed
 * to their uid — and it is cleared for the same reason `clearWidget` drops the
 * snapshot. The slots go too: they name presets the next account does not have,
 * so leaving them would draw buttons that resolve to nothing.
 */
export async function clearQuickAdd(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SLOTS_KEY);
    await pendingStore.clear();
  } catch {
    /* best-effort, same as clearWidget */
  }
  // The iOS credential envelope is the single most important thing to drop here:
  // it is the one artefact that can still WRITE after the session is gone. Its
  // own module swallows failures, so this cannot strand the sign-out.
  await clearQuickAddCredentials();
  // And make the tile inert. It lives in the notification shade, outside the app
  // entirely, so leaving it labelled with the previous account's preset is the
  // same leak `clearWidget` exists to prevent — and tapping it would then write
  // to whoever signs in next. Unconditional, and after the storage clear, so a
  // failed `multiRemove` cannot skip it.
  await setTileState(null, false);
}
