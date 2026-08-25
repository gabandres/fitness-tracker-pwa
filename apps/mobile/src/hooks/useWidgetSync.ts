import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  type DailyTargets,
  type DaySummary,
  type MealPreset,
  type DayBoundary,
  dayBoundaryOf,
  dayKeyAt,
  dayRange,
  resolveQuickAddTargets,
} from '@macrolog/core';
import { useLocale } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  flushPendingLogs,
  getQuickAddSlots,
  subscribeQuickAddSlots,
  syncQuickAddTile,
  watchQuickAddCredentials,
} from '@/lib/quick-add';
import { syncWidget } from '@/lib/widget';

/**
 * Keeps the home-screen widget's snapshot in step with today's numbers, and
 * lands anything the widget parked while offline.
 *
 * Mounted on Today, which already holds `summary` + `targets` + `presets`, so
 * this deliberately takes them as arguments instead of opening its own
 * listeners — a second subscription for data the screen has in hand is exactly
 * the duplication ADR-0016's focus-gating budget doesn't cover.
 *
 * Three triggers, because a widget can go stale three ways:
 *   1. **The numbers changed** — the effect re-runs whenever `summary` or
 *      `targets` do, which covers every log add/edit/delete and any target
 *      recalculation, since both flow from the Today `onSnapshot`.
 *   2. **The app came back to the foreground** — the widget may have been
 *      showing a snapshot written before a background sync landed.
 *   3. **Midnight passed** — handled by (2), plus each platform's own timeline
 *      backstop. The `dateKey` in the blob is what makes a missed rollover
 *      render as empty rather than as yesterday's numbers dressed as today's.
 *
 * A fourth input arrived with quick-add (ADR-0020): the designated slots, which
 * ride in the same blob so a widget process can draw a labelled button and write
 * the row without auth. They change from Settings, on a different screen, which
 * is why they are subscribed rather than read once.
 *
 * Fire-and-forget: `syncWidget` never rejects, and a stale widget must not be
 * able to disturb the screen that's drawing the real thing.
 */
/**
 * The day the blob describes, and the instant that day ends.
 *
 * Both come from the user's boundary (ADR-0030), and shipping the second is
 * what lets every widget decide staleness without re-deriving a day. Before
 * this, the snapshot was stamped `calendarDateKey(new Date())` while `summary`
 * came from `useToday`, which is boundary-aware — so a user on `dayStartHour: 3`
 * had the widget label the previous day's totals as today's from midnight until
 * 03:00, and a widget quick-add in that window filed against a different day
 * than the same food logged in the app.
 */
function dayStamp(boundary: DayBoundary, at: Date): { key: string; endsMs: number } {
  const key = dayKeyAt(at, boundary);
  return { key, endsMs: dayRange(key, boundary).end.getTime() };
}

export function useWidgetSync(
  summary: DaySummary,
  targets: DailyTargets,
  presets: readonly MealPreset[] = [],
): void {
  const locale = useLocale();
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  const [slots, setSlots] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void getQuickAddSlots().then((s) => {
      if (alive) setSlots(s);
    });
    const unsub = subscribeQuickAddSlots(setSlots);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Resolved here rather than in the widget: a slot whose preset was deleted has
  // to disappear from the blob, or the button outlives what it logs.
  const quickAdd = useMemo(() => resolveQuickAddTargets(slots, presets), [slots, presets]);

  // Read through a ref inside the AppState listener so the subscription is
  // registered once instead of being torn down and rebuilt on every keystroke
  // that moves a total.
  const latest = useRef({ summary, targets, locale, quickAdd, uid, boundary });
  latest.current = { summary, targets, locale, quickAdd, uid, boundary };

  useEffect(() => {
    const { key, endsMs } = dayStamp(boundary, new Date());
    void syncWidget(summary, targets, key, locale, Date.now(), quickAdd, endsMs);
  }, [summary, targets, locale, quickAdd, boundary]);

  // The Quick Settings tile's label mirror (ADR-0020). Driven from the same
  // resolved slots as the snapshot above, so the tile and the widget can never
  // name different presets. Android-only and a silent no-op elsewhere.
  useEffect(() => {
    void syncQuickAddTile(quickAdd, uid != null, locale);
  }, [quickAdd, uid, locale]);

  // iOS's half: the Keychain envelope an App Intent reads to write over REST
  // (ADR-0020). iOS-only, silent no-op on Android.
  //
  // Subscribed, NOT keyed on the uid. `onAuthStateChanged` sets the uid the
  // moment a session is restored, and `user.refreshToken` can still be empty at
  // that point — which makes `syncQuickAddCredentials` clear the envelope. Keyed
  // on the uid, that clear was terminal: nothing re-ran for the rest of the
  // session, and every widget tap silently did nothing. `onIdTokenChanged` also
  // fires on the refresh that follows, which is the event that was missing. See
  // `watchQuickAddCredentials`.
  useEffect(() => watchQuickAddCredentials(), []);

  // Land whatever a tile or widget button parked while the device was offline.
  // On mount and on every foreground: those are the two moments the app has both
  // a session and, most likely, a network again. The rows arrive through the
  // Today listener like any other write, so nothing here touches the screen.
  useEffect(() => {
    if (!uid) return;
    void flushPendingLogs(uid);
  }, [uid]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { summary: s, targets: tg, locale: l, quickAdd: qa, uid: u, boundary: b } = latest.current;
      // Recomputed here rather than captured: after a rollover the app can
      // resume on a different day than the one this effect mounted on — and
      // with a boundary that day is not the calendar one.
      const { key, endsMs } = dayStamp(b, new Date());
      void syncWidget(s, tg, key, l, Date.now(), qa, endsMs);
      if (u) void flushPendingLogs(u);
    });
    return () => sub.remove();
  }, []);
}
