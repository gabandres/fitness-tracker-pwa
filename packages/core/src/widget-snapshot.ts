/**
 * Home-screen widget snapshot — the pure half of the widget feature
 * (`apps/mobile/WIDGET_PLAN.md`).
 *
 * ## Why a snapshot instead of a subscription
 * A widget process cannot hold our Firestore `onSnapshot` listeners. It wakes
 * briefly on an OS timeline, reads whatever is already on disk, renders, and
 * dies. So the contract is **snapshot, not subscribe**: the app writes a tiny
 * JSON blob to storage shared with the widget on every relevant change, and
 * the widget renders that blob without any network or auth.
 *
 * This module owns both ends of that contract:
 *   - {@link buildWidgetSnapshot} — app side, turns `DaySummary` + `DailyTargets`
 *     into the wire blob.
 *   - {@link parseWidgetSnapshot} / {@link widgetView} — widget side, turns an
 *     untrusted string off disk into the exact numbers to draw.
 *
 * ## Who consumes which end
 * The Android widget runs in a JS context (`react-native-android-widget`) and
 * calls `widgetView` directly. The iOS widget is SwiftUI and **cannot** call
 * this — its `TimelineProvider` mirrors these rules in Swift. That mirroring is
 * the reason the rules live here as small, exhaustively-tested pure functions
 * rather than being inlined per platform: this file is the spec the Swift side
 * is written against. Keep the two in step; the tests here are the reference.
 *
 * Pure by construction — no storage, no Date.now(), no platform imports. The
 * caller injects `nowMs` and `todayKey`.
 */

import type { DaySummary } from './day-summary';
import type { DailyTargets } from './targets';

/**
 * Wire-format version. Bump only on a **breaking** shape change, and bump
 * {@link WIDGET_SNAPSHOT_KEY} with it so an old widget binary never decodes a
 * new blob — during an app update the two halves are briefly out of step
 * (the app updates first; the widget extension keeps running the old code
 * until the OS reloads it).
 */
export const WIDGET_SNAPSHOT_VERSION = 1;

/**
 * Key the snapshot is stored under, in the iOS App Group `UserDefaults` and in
 * Android `AsyncStorage`. Versioned so v1 and v2 blobs can coexist.
 */
export const WIDGET_SNAPSHOT_KEY = 'ignia.widget.snapshot.v1';

/**
 * The blob on disk. Deliberately tiny and flat — iOS decodes it in Swift with
 * `Codable`, so every field is a primitive and every number is a rounded
 * integer (no float formatting differences between JS and Swift).
 */
export interface WidgetSnapshot {
  /** {@link WIDGET_SNAPSHOT_VERSION} at write time. */
  v: number;
  /** Local `YYYY-MM-DD` the numbers describe. The staleness guard — after
   *  midnight this no longer matches "today" and the widget blanks rather
   *  than showing yesterday's totals as if they were today's. */
  dateKey: string;
  kcalConsumed: number;
  kcalTarget: number;
  proteinConsumed: number;
  proteinTarget: number;
  /** Epoch ms of the write. Not rendered; used to break timeline ties and to
   *  debug "is the app actually writing?" on device. */
  updatedMs: number;
  /**
   * The app's active locale at write time (`'en'`, `'es-PR'`, …). Typed as a
   * bare string to keep this module free of any frontend's locale union.
   *
   * It travels in the blob because the widget cannot derive it: our locale
   * comes from `profile.preferredLocale`, which lives behind auth + Firestore,
   * and a widget process has neither. Falling back to the *device* locale
   * would be wrong — a user who set the app to Spanish on an English phone
   * would get an English widget. Each widget keeps its own tiny string table
   * and maps an unrecognized value back to English.
   */
  locale: string;
}

/** One rendered number: how far from target, and which side of it. */
export interface WidgetMetric {
  /** Always `>= 0`. Remaining when `over` is false, excess when it's true. */
  value: number;
  /** True once consumed has passed target — the label flips to "over". */
  over: boolean;
  /** `consumed / target`, clamped to `0..1`. For the deferred ring; the
   *  text-first widget ignores it. */
  progress: number;
}

/** Why there is nothing to draw. Both render the same "Open Ignia" prompt;
 *  they are distinguished so tests (and on-device debugging) can tell an app
 *  that has never run from one that simply hasn't been opened today. */
export type WidgetEmptyReason =
  /** No blob on disk, or it was unreadable / a foreign version. */
  | 'no-snapshot'
  /** The blob describes a different day than the one being rendered. */
  | 'stale'
  /** Onboarding isn't finished, so there is no calorie target to count down
   *  from. Showing "0 left" here would read as "you've eaten your whole day". */
  | 'no-targets';

export type WidgetView =
  | { state: 'empty'; reason: WidgetEmptyReason }
  | {
      state: 'ready';
      dateKey: string;
      kcal: WidgetMetric;
      protein: WidgetMetric;
      updatedMs: number;
      locale: string;
    };

/** Round to a non-negative integer, mapping any non-finite input to 0. The
 *  widget must never render `NaN`, and Swift's `Codable` would throw on it. */
function safeInt(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

/**
 * App side: build the blob to persist. `dateKey` is passed explicitly rather
 * than read off `summary` because the writer (the Today screen) is the
 * authority on which day is "today" — if the two ever disagree, the screen is
 * right and the summary is a stale render.
 */
export function buildWidgetSnapshot(
  summary: DaySummary,
  targets: DailyTargets,
  dateKey: string,
  nowMs: number,
  locale = 'en',
): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    dateKey,
    kcalConsumed: safeInt(summary.totalCalories),
    kcalTarget: safeInt(targets.calorieTarget),
    proteinConsumed: safeInt(summary.totalProtein),
    proteinTarget: safeInt(targets.proteinTarget),
    updatedMs: Number.isFinite(nowMs) ? Math.round(nowMs) : 0,
    locale,
  };
}

function isSnapshot(x: unknown): x is WidgetSnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o['v'] !== WIDGET_SNAPSHOT_VERSION) return false;
  if (typeof o['dateKey'] !== 'string' || o['dateKey'] === '') return false;
  if (typeof o['locale'] !== 'string') return false;
  const nums = ['kcalConsumed', 'kcalTarget', 'proteinConsumed', 'proteinTarget', 'updatedMs'];
  return nums.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}

/**
 * Widget side: decode whatever was on disk. Everything unexpected — absent,
 * truncated by a mid-write kill, hand-edited, written by a newer app version —
 * collapses to `null`, which {@link widgetView} renders as the empty state. A
 * widget that throws shows the OS "unable to load" placeholder, which looks
 * like a crashed app, so this never throws.
 */
export function parseWidgetSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isSnapshot(parsed) ? parsed : null;
}

function metric(consumed: number, target: number): WidgetMetric {
  const over = consumed > target;
  return {
    value: Math.abs(target - consumed),
    over,
    progress: target > 0 ? Math.min(1, Math.max(0, consumed / target)) : 0,
  };
}

/**
 * Widget side: the snapshot plus "what day is it right now" gives exactly what
 * to draw. `todayKey` comes from the widget's own clock at render time, which
 * is why staleness is decided here and not baked into the blob — the blob
 * outlives the day it was written for.
 */
export function widgetView(snapshot: WidgetSnapshot | null, todayKey: string): WidgetView {
  if (!snapshot) return { state: 'empty', reason: 'no-snapshot' };
  if (snapshot.dateKey !== todayKey) return { state: 'empty', reason: 'stale' };
  if (snapshot.kcalTarget <= 0) return { state: 'empty', reason: 'no-targets' };
  return {
    state: 'ready',
    dateKey: snapshot.dateKey,
    kcal: metric(snapshot.kcalConsumed, snapshot.kcalTarget),
    protein: metric(snapshot.proteinConsumed, snapshot.proteinTarget),
    updatedMs: snapshot.updatedMs,
    locale: snapshot.locale,
  };
}

/**
 * True when `next` differs from `prev` in any rendered way. The Today screen
 * writes on every summary/target change, but a widget reload is an OS-metered
 * favor — WidgetKit budgets them per day — so we skip writes that would redraw
 * the identical face. `updatedMs` is excluded on purpose: it always differs
 * and is never drawn.
 */
export function widgetSnapshotChanged(
  prev: WidgetSnapshot | null,
  next: WidgetSnapshot,
): boolean {
  if (!prev) return true;
  return (
    prev.dateKey !== next.dateKey ||
    prev.kcalConsumed !== next.kcalConsumed ||
    prev.kcalTarget !== next.kcalTarget ||
    prev.proteinConsumed !== next.proteinConsumed ||
    prev.proteinTarget !== next.proteinTarget ||
    prev.locale !== next.locale
  );
}
