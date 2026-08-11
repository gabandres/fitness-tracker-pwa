import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { updateApplicationContext } from '../../modules/watch-link';
import {
  WIDGET_SNAPSHOT_KEY,
  type DailyTargets,
  type DaySummary,
  type QuickAddTarget,
  type WidgetSnapshot,
  buildWidgetSnapshot,
  parseWidgetSnapshot,
  widgetSnapshotChanged,
} from '@macrolog/core';

/**
 * Home-screen widget adapter — the impure half of the feature
 * (`apps/mobile/WIDGET.md`). The numbers and the render rules are pure
 * and shared in `@macrolog/core`'s `widget-snapshot`; everything here is
 * platform plumbing: *where* the blob is stored and *how* the OS is told to
 * redraw.
 *
 * Two different storages, because the two widget runtimes can't see the same
 * one:
 *   - **iOS** — the WidgetKit extension is a separate process with its own
 *     sandbox, so the only shared surface is the App Group container.
 *     `ExtensionStorage` (from `@bacons/apple-targets`) writes the App Group's
 *     `UserDefaults`, which the SwiftUI `TimelineProvider` reads back.
 *   - **Android** — `react-native-android-widget` runs the widget in a JS
 *     context inside our own app, so plain `AsyncStorage` is already shared.
 *
 * Native modules are **lazy-required inside each function** so Expo Go and the
 * react-native-web bundle never evaluate a module that isn't present — the
 * same guard `health.ts` uses. Everything here is `tsc`-verified only; the
 * actual widget round-trip needs an EAS dev build to QA (the build quota
 * resets Aug 2026 — see `STATUS.md` §3).
 */

/** App Group id. Must stay in lockstep with `ios.entitlements` in app.json and
 *  with `targets/widget/expo-target.config.js`. Changing it orphans the blob
 *  the installed widget is already reading. */
export const APP_GROUP = 'group.fit.ignia.app';

/** `name` in the `react-native-android-widget` plugin config, and the `kind`
 *  the SwiftUI widget declares. The reload calls address the widget by it. */
export const WIDGET_NAME = 'Today';

/**
 * The only key inside the WatchConnectivity application-context envelope. Must
 * equal `Glance.contextKey` in `targets/_shared/Glance.swift`.
 *
 * The value is the **already-serialized snapshot JSON**, byte-identical to what
 * `ExtensionStorage` writes into the App Group. Sending the eight fields as a
 * native dictionary instead would have created a second decode path in Swift
 * (dict→Snapshot alongside JSON→Snapshot) and made the dictionary's key set a
 * third thing to keep in step with the TS interface — the exact drift the
 * shared contract exists to prevent. With the envelope, the watch delegate does
 * `defaults.set(json, forKey:)` and nothing else, and the decoder count stays
 * at one (#38 §3).
 *
 * It lives here rather than in `@macrolog/core` because it is transport
 * plumbing, not domain: it never touches disk, never appears in a stored blob,
 * and has no bearing on the wire version.
 */
export const WATCH_CONTEXT_KEY = 'snapshot';

/** Expo Go has neither native module linked, and web has no home screen. */
const supported =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
  (Platform.OS === 'ios' || Platform.OS === 'android');

/**
 * Last blob we persisted this process. A cheap guard so the Today screen's
 * effect — which re-runs on every summary/target identity change — doesn't
 * turn every keystroke in a quantity field into a storage write plus an OS
 * reload request. WidgetKit meters reloads per day, so wasted ones are not
 * free. Process-local by design: a cold start writes once and re-primes it.
 */
let lastWritten: WidgetSnapshot | null = null;

async function persist(snapshot: WidgetSnapshot): Promise<void> {
  const json = JSON.stringify(snapshot);

  if (Platform.OS === 'ios') {
    const { ExtensionStorage } = require('@bacons/apple-targets');
    const storage = new ExtensionStorage(APP_GROUP);
    storage.set(WIDGET_SNAPSHOT_KEY, json);
    // Ask WidgetKit to rebuild the timeline now. Without this the widget would
    // only refresh on its own (slow, OS-chosen) cadence and a just-logged meal
    // wouldn't show up until much later.
    ExtensionStorage.reloadWidget(WIDGET_NAME);
    // Same bytes, one hop further out: the Apple Watch complication cannot read
    // this App Group (App Groups are per-device), so the blob is asserted to
    // the watch over WatchConnectivity. This rides the existing call site and
    // the existing `widgetSnapshotChanged` guard on purpose — one trigger, one
    // guard, both surfaces, no watch-specific notion of "changed" (#37 §5).
    // Never throws; a watch-less iPhone is the ordinary case.
    updateApplicationContext({ [WATCH_CONTEXT_KEY]: json });
    if (__DEV__) {
      // `UserDefaults(suiteName:)` returns nil when the process is not entitled
      // to the App Group, and the write then no-ops WITHOUT throwing. Reading
      // straight back is the only way to tell "wrote it" from "pretended to".
      // `@bacons/apple-targets` substitutes SILENT STUBS when its native module
      // is missing — `setString`/`reloadWidget` become no-ops and `get` returns
      // undefined — so an absent module is indistinguishable from a successful
      // write unless the module itself is probed. Check that FIRST; a read-back
      // miss means nothing if nothing was ever really written.
      const native = (globalThis as unknown as { expo?: { modules?: Record<string, unknown> } })
        .expo?.modules?.['ExtensionStorage'];
      const echo = storage.get(WIDGET_SNAPSHOT_KEY);
      if (!native) {
        const all = Object.keys(
          (globalThis as unknown as { expo?: { modules?: Record<string, unknown> } }).expo
            ?.modules ?? {},
        ).sort();
        console.warn(
          '[widget] ExtensionStorage NATIVE MODULE MISSING — set()/reloadWidget() are ' +
            'no-ops in this binary. Nothing was written; the widget cannot possibly update.',
        );
        // If the registry is well populated and only this one is absent, the
        // fault is package-specific (autolinking skipped it). If it is tiny or
        // empty, native modules as a whole did not link and the problem is the
        // build, not this package.
        console.warn('[widget] linked native modules (' + all.length + '): ' + all.join(', '));
      } else if (echo === json) {
        console.log('[widget] App Group round-trip OK — container is writable by the app');
      } else {
        console.warn(
          '[widget] native module present but read-back failed — likely not entitled to ' +
            APP_GROUP +
            ' (got ' +
            String(echo) +
            ')',
        );
      }
    }
    return;
  }

  await AsyncStorage.setItem(WIDGET_SNAPSHOT_KEY, json);
  const { requestWidgetUpdate } = require('react-native-android-widget');
  const { renderTodayWidget } = require('../widgets/render');
  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => renderTodayWidget(snapshot),
    // Nobody has added the widget to their home screen — the common case.
    // Not an error; there is simply nothing to redraw.
    widgetNotFound: () => {},
  });
}

/**
 * Write today's numbers where the widget can find them.
 *
 * Call this wherever today's totals can change: log add/edit/delete, target
 * recalculation, app foreground, and day rollover. It self-debounces via
 * {@link widgetSnapshotChanged}, so over-calling is cheap and under-calling is
 * the only real failure mode — prefer the noisy call site.
 *
 * Never throws. A widget that can't be updated is a cosmetic problem, and
 * letting it reject would surface as an unhandled rejection inside whatever
 * logging flow triggered it.
 */
export async function syncWidget(
  summary: DaySummary,
  targets: DailyTargets,
  todayKey: string,
  locale: string,
  nowMs: number = Date.now(),
  quickAdd: readonly QuickAddTarget[] = [],
): Promise<void> {
  if (!supported) {
    if (__DEV__) console.log('[widget] skipped: unsupported runtime (Expo Go or web)');
    return;
  }

  const next = buildWidgetSnapshot(summary, targets, todayKey, nowMs, locale, quickAdd);

  // A zero calorie target is the single most common reason the widget sits on
  // its empty state while everything else looks healthy: the Swift side treats
  // `kcalTarget <= 0` as "nothing to show". Call it out rather than letting it
  // look like a failed write.
  if (__DEV__ && next.kcalTarget <= 0) {
    console.warn('[widget] kcalTarget is 0 — the widget will render EMPTY by design', next);
  }

  if (!widgetSnapshotChanged(lastWritten, next)) {
    if (__DEV__) console.log('[widget] unchanged since last write, skipping', next);
    return;
  }

  try {
    await persist(next);
    lastWritten = next;
    if (__DEV__) console.log('[widget] wrote snapshot + requested reload', next);
  } catch (err) {
    // Leave `lastWritten` alone so the next call retries rather than assuming
    // the failed write landed. Swallowing this silently made a broken App Group
    // write indistinguishable from never having written at all.
    if (__DEV__) console.warn('[widget] write FAILED', err);
  }
}

/**
 * Storage-only snapshot write, for the Android task handler.
 *
 * The quick-add path (ADR-0020) needs to persist an optimistically-updated
 * snapshot *from inside* the widget task, where the redraw is `props.renderWidget`
 * rather than `requestWidgetUpdate` — asking the OS for an update from within
 * the update it already gave us is how a redraw loop starts. So this is
 * deliberately the plain persist with no reload request and no change guard: the
 * caller knows something changed, because it just wrote a log.
 *
 * `lastWritten` is advanced so the guard keeps describing what is actually on
 * disk. When the app is in the foreground the task handler shares its JS
 * runtime, and leaving the guard stale there makes the next real sync compare
 * against a snapshot that no longer exists.
 *
 * Android only — iOS's equivalent moment is a Swift intent writing the App
 * Group directly, and it never runs this JS.
 */
export async function saveWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await AsyncStorage.setItem(WIDGET_SNAPSHOT_KEY, JSON.stringify(snapshot));
    lastWritten = snapshot;
  } catch {
    /* The row is already in the ledger; a stale face corrects on next sync. */
  }
}

/**
 * Ask the OS to redraw any placed Android widget from a snapshot already on disk.
 *
 * For the Quick Settings tile (ADR-0020), which changes today's totals without
 * being a widget: nothing has redrawn the home screen, so it has to be asked.
 * The widget task handler must NOT use this — it already holds a `renderWidget`,
 * and requesting an update from inside the update the OS just handed us is how a
 * redraw loop starts.
 *
 * No-ops when the user has no widget placed, which is the common case.
 */
export async function requestWidgetRedraw(snapshot: WidgetSnapshot): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const { requestWidgetUpdate } = require('react-native-android-widget');
    const { renderTodayWidget } = require('../widgets/render');
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => renderTodayWidget(snapshot),
      widgetNotFound: () => {},
    });
  } catch {
    /* The row is already in the ledger; the face corrects on next sync. */
  }
}

/**
 * Android widget side: read the blob back inside the task handler. iOS never
 * calls this — its SwiftUI provider reads the App Group `UserDefaults`
 * directly, in Swift.
 */
export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    return parseWidgetSnapshot(await AsyncStorage.getItem(WIDGET_SNAPSHOT_KEY));
  } catch {
    return null;
  }
}

/**
 * Assert a snapshot to the WATCH only, without touching local storage or
 * asking WidgetKit for anything.
 *
 * Quick-add needs exactly this and had nothing to call (2026-08-11). A
 * quick-add does not go through `syncWidget`, so it never inherited the watch
 * push that lives inside `persist()`:
 *
 *   - `performQuickAdd` writes the optimistic snapshot with
 *     `saveWidgetSnapshot`, which is **Android-only** and pushes nowhere; and
 *   - on iOS the equivalent write is a Swift App Intent touching the App Group
 *     with no JS in the process at all.
 *
 * Either way the phone's own widget moved and the watch was never told, so the
 * complication kept yesterday's numbers until the app next opened Today and
 * `useWidgetSync` fired. Reported from a wrist: three green diagnostics, 44
 * wake-ups still in budget, and a quick-added meal that never reached the face.
 *
 * Deliberately does NOT advance `lastWritten`: that guard describes what is on
 * local storage, and this function writes none. Letting it move here would make
 * the next real `syncWidget` compare against a snapshot that was never stored
 * and skip a write that was needed.
 */
export function assertWatchSnapshot(snapshot: WidgetSnapshot): void {
  if (!supported || Platform.OS !== 'ios') return;
  try {
    updateApplicationContext({ [WATCH_CONTEXT_KEY]: JSON.stringify(snapshot) });
  } catch (err) {
    // A watch-less iPhone is the ordinary case, not a fault.
    if (__DEV__) console.warn('[widget] watch assert FAILED', err);
  }
}

/**
 * Drop the blob and forget the in-process guard. Used on sign-out and account
 * deletion: no glanceable surface may keep showing the previous account's
 * numbers after the app no longer has a session.
 *
 * **This is the only clear path, and it does not go through `persist()`** — so
 * the watch push here is not inherited from `syncWidget`, it has to be written
 * out. It is also unconditional: `widgetSnapshotChanged` is consulted only by
 * `syncWidget`, so the change guard can never swallow a clear (#44 §5).
 *
 * `auth.tsx` awaits this **before** `fbSignOut(auth)`, and that ordering is
 * load-bearing rather than incidental: `runDeleteAccount` deliberately swallows
 * `signOut()` failures ("the Auth user is already gone"), so a clear placed
 * after the Firebase sign-out would be skipped on exactly the fragile path
 * (#44 §4). Do not reorder it.
 *
 * On the watch, the honest bound is: **cleared on next contact, or at the
 * watch's local midnight, whichever comes first.** Application context cannot
 * be dropped in transit — it sits with the system daemon and is delivered on
 * next contact — but it also cannot be delivered to a watch that is not there.
 * The day-key guard in `Glance.swift` is the backstop, and it is a privacy
 * mechanism as much as a freshness one. A watch-side self-clear was declined:
 * it would infer "signed out" from silence, and silence has four innocent
 * causes (#44 §3).
 */
export async function clearWidget(): Promise<void> {
  lastWritten = null;
  if (!supported) return;

  if (Platform.OS === 'ios') {
    // Two separate privacy obligations on two separate devices. They used to
    // share one `try`; neither may be skipped because the other threw, which is
    // the same reasoning `CLAUDE.md` already applies to the hourly dispatcher's
    // `Promise.allSettled` (#44 §5.2).
    try {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      new ExtensionStorage(APP_GROUP).set(WIDGET_SNAPSHOT_KEY, undefined);
      ExtensionStorage.reloadWidget(WIDGET_NAME);
    } catch (err) {
      if (__DEV__) console.warn('[widget] App Group clear FAILED', err);
    }

    try {
      // The empty string, inside the same one-key envelope. It fails the decode
      // on the watch and collapses to the empty face exactly as an absent or
      // unreadable blob does — no fourth empty reason, no new key, no second
      // decode path. `Waiting for iPhone` is the face (#44 §2).
      updateApplicationContext({ [WATCH_CONTEXT_KEY]: '' });
    } catch (err) {
      if (__DEV__) console.warn('[widget] watch clear FAILED', err);
    }
    return;
  }

  try {
    await AsyncStorage.removeItem(WIDGET_SNAPSHOT_KEY);
    const { requestWidgetUpdate } = require('react-native-android-widget');
    const { renderTodayWidget } = require('../widgets/render');
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => renderTodayWidget(null),
      widgetNotFound: () => {},
    });
  } catch {
    // Best-effort; see syncWidget. Android has no second-device half — the
    // widget renders inside our own JS context, in the same process that owns
    // the session, and storage is cleared before the redraw is requested (#44 §7).
  }
}
