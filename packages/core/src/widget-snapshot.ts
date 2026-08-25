/**
 * Home-screen widget snapshot — the pure half of the widget feature
 * (`apps/mobile/WIDGET.md`).
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
import { QUICK_ADD_MAX, type QuickAddTarget } from './quick-add';
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
  /**
   * The user's designated quick-add presets, flattened (ADR-0020). Present so
   * an interactive surface can draw a labelled button and write the row without
   * auth or Firestore — the same reason `locale` travels here.
   *
   * **Additive and optional, and the wire version is deliberately NOT bumped.**
   * A bump would make already-shipped Swift reject an otherwise-valid blob, and
   * the visible result of that is a blank widget on iOS build 25 — the same
   * class of silent breakage as the `useMemoCache` defect in vc 4/6/8. Absent
   * means "no buttons", which is exactly what an older writer produces.
   */
  quickAdd?: QuickAddTarget[];
  /**
   * Epoch ms at which this snapshot's day ENDS — the exclusive end of
   * `dayRange(dateKey, boundary)` (ADR-0030).
   *
   * **The staleness guard, and the reason `dateKey` alone stopped being one.**
   * Since ADR-0030 `dateKey` is the *user's* day, which is not the calendar
   * date: on `dayStartHour: 3` a user is still on yesterday at 01:00. A widget
   * comparing `dateKey` against its own calendar date therefore calls a
   * previous day's totals "today" for the whole 00:00-03:00 window.
   *
   * The alternative was to re-derive the user's day in each widget — Swift and
   * the Android renderer both — which means two more implementations of
   * `dayKeyAt`'s boundary history, changeover day included. The app already
   * computed the answer, so it ships the answer, and every consumer compares
   * two instants instead of reasoning about calendars.
   *
   * **Additive and optional, and the wire version is deliberately NOT bumped**
   * — same reasoning as `quickAdd`. A blob written before this field falls back
   * to the calendar comparison, which is what that writer meant.
   */
  dayEndsMs?: number;
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
  /** `locale` is carried here too: the empty state is a *sentence*, and the
   *  renderers previously had nothing to key it off and so hardcoded English.
   *  It is the snapshot's locale whenever a snapshot was readable, and falls
   *  back to `'en'` only for `no-snapshot`, where there is genuinely nothing
   *  to read a preference from. */
  | { state: 'empty'; reason: WidgetEmptyReason; locale: string }
  | {
      state: 'ready';
      dateKey: string;
      kcal: WidgetMetric;
      protein: WidgetMetric;
      updatedMs: number;
      locale: string;
      /**
       * Quick-add buttons to draw, in slot order; `[]` when the user has
       * designated none (ADR-0020). Only the `ready` state carries them: an
       * empty face is showing "Open Ignia to start", and a button on it would
       * be logging into a day the widget is explicitly declining to describe.
       */
      quickAdd: QuickAddTarget[];
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
  quickAdd: readonly QuickAddTarget[] = [],
  dayEndsMs?: number,
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
    // Omitted entirely when empty, so a user with no quick-add slots produces
    // the byte-identical blob an older binary wrote. That keeps
    // `widgetSnapshotChanged` from reporting a change on first write after an
    // update, which would spend a metered WidgetKit reload on nothing.
    ...(quickAdd.length > 0 ? { quickAdd: quickAdd.slice(0, QUICK_ADD_MAX) } : {}),
    // Omitted rather than zeroed when the caller does not know it, for the same
    // byte-identity reason as `quickAdd`: a writer that cannot supply it must
    // produce the blob an older writer produced, so consumers take the
    // documented fallback instead of reading a `0` as "expired in 1970".
    ...(typeof dayEndsMs === 'number' && Number.isFinite(dayEndsMs) && dayEndsMs > 0
      ? { dayEndsMs: Math.round(dayEndsMs) }
      : {}),
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
 * Keep only the quick-add entries a button can actually be drawn and written
 * from. A malformed `quickAdd` **must not** invalidate the whole blob: the
 * numbers are the primary payload and a missing button is a smaller failure
 * than a widget that has gone blank. Returns `undefined` when nothing survives,
 * so the field disappears rather than becoming an empty array.
 */
function sanitizeQuickAdd(x: unknown): QuickAddTarget[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: QuickAddTarget[] = [];
  for (const item of x) {
    if (out.length >= QUICK_ADD_MAX) break;
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const cal = o['calories'];
    if (typeof o['presetId'] !== 'string' || o['presetId'] === '') continue;
    if (typeof o['name'] !== 'string' || o['name'] === '') continue;
    if (typeof cal !== 'number' || !Number.isFinite(cal) || cal <= 0) continue;
    const macro = (k: string): number | undefined => {
      const v = o[k];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
    };
    out.push({
      presetId: o['presetId'],
      name: o['name'],
      calories: cal,
      ...(macro('protein') != null ? { protein: macro('protein') as number } : {}),
      ...(macro('carbs') != null ? { carbs: macro('carbs') as number } : {}),
      ...(macro('fat') != null ? { fat: macro('fat') as number } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
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
  if (!isSnapshot(parsed)) return null;
  const { quickAdd: rawQuickAdd, dayEndsMs: rawEnds, ...rest } = parsed;
  const quickAdd = sanitizeQuickAdd(rawQuickAdd);
  // A malformed `dayEndsMs` must DROP to the fallback, never survive: a NaN
  // comparison is false, so a garbage value would make the widget render a day
  // that never expires. Same posture as `sanitizeQuickAdd` — a bad optional
  // field costs its own feature and not the whole blob.
  const dayEndsMs =
    typeof rawEnds === 'number' && Number.isFinite(rawEnds) && rawEnds > 0 ? rawEnds : undefined;
  const base = dayEndsMs === undefined ? rest : { ...rest, dayEndsMs };
  return quickAdd ? { ...base, quickAdd } : base;
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
 * Has this snapshot's day ended?
 *
 * Prefers the day's own end instant, which the app computed with the user's
 * boundary (ADR-0030) and shipped in the blob. That comparison is total, needs
 * no calendar, and stays correct across the changeover day that runs 27 hours.
 *
 * Falls back to the calendar-date comparison for blobs written before
 * `dayEndsMs` existed, or when the caller has no clock to offer. The fallback
 * is WRONG under a non-midnight boundary — it calls the previous user-day
 * "today" between midnight and the boundary — but a blob without the field came
 * from a writer that had no boundary either, so it matches what produced it.
 */
function isStale(snapshot: WidgetSnapshot, todayKey: string, nowMs?: number): boolean {
  const ends = snapshot.dayEndsMs;
  if (typeof ends === 'number' && typeof nowMs === 'number' && Number.isFinite(nowMs)) {
    return nowMs >= ends;
  }
  return snapshot.dateKey !== todayKey;
}

/**
 * Widget side: the snapshot plus "what day is it right now" gives exactly what
 * to draw. `todayKey` comes from the widget's own clock at render time, which
 * is why staleness is decided here and not baked into the blob — the blob
 * outlives the day it was written for.
 */
export function widgetView(
  snapshot: WidgetSnapshot | null,
  todayKey: string,
  nowMs?: number,
): WidgetView {
  if (!snapshot) return { state: 'empty', reason: 'no-snapshot', locale: 'en' };
  if (isStale(snapshot, todayKey, nowMs))
    return { state: 'empty', reason: 'stale', locale: snapshot.locale };
  if (snapshot.kcalTarget <= 0)
    return { state: 'empty', reason: 'no-targets', locale: snapshot.locale };
  return {
    state: 'ready',
    dateKey: snapshot.dateKey,
    kcal: metric(snapshot.kcalConsumed, snapshot.kcalTarget),
    protein: metric(snapshot.proteinConsumed, snapshot.proteinTarget),
    updatedMs: snapshot.updatedMs,
    locale: snapshot.locale,
    quickAdd: snapshot.quickAdd ?? [],
  };
}

/**
 * Fold a just-written quick-add into the snapshot on disk, so the surface that
 * was tapped redraws with the new totals.
 *
 * This is the **receipt** the quick-add design promises in place of a
 * confirmation step: nothing else can move those numbers, because the app that
 * normally writes the snapshot is not running when a tile or a widget button is
 * tapped. It is deliberately an optimistic local edit and not a recomputation —
 * the widget process has one day's totals and no log list — so it is *close*,
 * not authoritative. The next `syncWidget` from the app overwrites it with the
 * real summary, and any drift dies there.
 *
 * Returns `null` when there is no snapshot to fold into: a tap that lands
 * before the app has ever written one has nothing to increment, and inventing a
 * blob here would put a fabricated `kcalTarget` on the home screen.
 */
export function applyQuickAddToSnapshot(
  snapshot: WidgetSnapshot | null,
  target: QuickAddTarget,
  nowMs: number,
): WidgetSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    kcalConsumed: safeInt(snapshot.kcalConsumed + target.calories),
    proteinConsumed: safeInt(snapshot.proteinConsumed + (target.protein ?? 0)),
    updatedMs: Number.isFinite(nowMs) ? Math.round(nowMs) : snapshot.updatedMs,
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
    prev.locale !== next.locale ||
    // The buttons are rendered, so a slot change is a redraw — renaming a
    // preset must not leave a stale caption on a tappable button.
    quickAddKey(prev.quickAdd) !== quickAddKey(next.quickAdd) ||
    // Not rendered, but it decides WHEN the face expires. Changing the day
    // boundary can move this and nothing else — a user with no logs inside the
    // shifted window keeps identical totals — and skipping that write would
    // leave the widget expiring on the old day for the rest of the day. One
    // extra reload on a rare, deliberate settings change is the cheaper error.
    prev.dayEndsMs !== next.dayEndsMs
  );
}

/** Every rendered *and* written field of the quick-add slots, flattened for
 *  comparison. Includes the macros because the button writes them: a preset
 *  edited from 180 to 200 kcal looks identical and logs differently. */
function quickAddKey(list: QuickAddTarget[] | undefined): string {
  if (!list || list.length === 0) return '';
  return list
    .map((t) => [t.presetId, t.name, t.calories, t.protein ?? '', t.carbs ?? '', t.fat ?? ''].join(''))
    .join('');
}
