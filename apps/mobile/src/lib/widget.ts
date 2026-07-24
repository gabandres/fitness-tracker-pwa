import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import {
  WIDGET_SNAPSHOT_KEY,
  type DailyTargets,
  type DaySummary,
  type WidgetSnapshot,
  buildWidgetSnapshot,
  parseWidgetSnapshot,
  widgetSnapshotChanged,
} from '@macrolog/core';

/**
 * Home-screen widget adapter — the impure half of the feature
 * (`apps/mobile/WIDGET_PLAN.md`). The numbers and the render rules are pure
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
 * resets Aug 2026 — see `docs/aug-2026-build-batch.md`).
 */

/** App Group id. Must stay in lockstep with `ios.entitlements` in app.json and
 *  with `targets/widget/expo-target.config.js`. Changing it orphans the blob
 *  the installed widget is already reading. */
export const APP_GROUP = 'group.fit.ignia.app';

/** `name` in the `react-native-android-widget` plugin config, and the `kind`
 *  the SwiftUI widget declares. The reload calls address the widget by it. */
export const WIDGET_NAME = 'Today';

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
): Promise<void> {
  if (!supported) return;

  const next = buildWidgetSnapshot(summary, targets, todayKey, nowMs, locale);
  if (!widgetSnapshotChanged(lastWritten, next)) return;

  try {
    await persist(next);
    lastWritten = next;
  } catch {
    // Leave `lastWritten` alone so the next call retries rather than assuming
    // the failed write landed.
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
 * Drop the blob and forget the in-process guard. Used on sign-out and account
 * deletion: the widget must not keep showing the previous account's numbers on
 * a home screen after the app no longer has a session.
 */
export async function clearWidget(): Promise<void> {
  lastWritten = null;
  if (!supported) return;
  try {
    if (Platform.OS === 'ios') {
      const { ExtensionStorage } = require('@bacons/apple-targets');
      new ExtensionStorage(APP_GROUP).set(WIDGET_SNAPSHOT_KEY, undefined);
      ExtensionStorage.reloadWidget(WIDGET_NAME);
      return;
    }
    await AsyncStorage.removeItem(WIDGET_SNAPSHOT_KEY);
    const { requestWidgetUpdate } = require('react-native-android-widget');
    const { renderTodayWidget } = require('../widgets/render');
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: () => renderTodayWidget(null),
      widgetNotFound: () => {},
    });
  } catch {
    // Best-effort; see syncWidget.
  }
}
