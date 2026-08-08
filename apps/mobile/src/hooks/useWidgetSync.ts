import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  type DailyTargets,
  type DaySummary,
  type MealPreset,
  localDateKey,
  resolveQuickAddTargets,
} from '@macrolog/core';
import { useLocale } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  flushPendingLogs,
  getQuickAddSlots,
  subscribeQuickAddSlots,
  syncQuickAddTile,
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
export function useWidgetSync(
  summary: DaySummary,
  targets: DailyTargets,
  presets: readonly MealPreset[] = [],
): void {
  const locale = useLocale();
  const { user } = useAuth();
  const uid = user?.uid;
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
  const latest = useRef({ summary, targets, locale, quickAdd, uid });
  latest.current = { summary, targets, locale, quickAdd, uid };

  useEffect(() => {
    void syncWidget(summary, targets, localDateKey(new Date()), locale, Date.now(), quickAdd);
  }, [summary, targets, locale, quickAdd]);

  // The Quick Settings tile's label mirror (ADR-0020). Driven from the same
  // resolved slots as the snapshot above, so the tile and the widget can never
  // name different presets. Android-only and a silent no-op elsewhere.
  useEffect(() => {
    void syncQuickAddTile(quickAdd, uid != null, locale);
  }, [quickAdd, uid, locale]);

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
      const { summary: s, targets: tg, locale: l, quickAdd: qa, uid: u } = latest.current;
      // Recomputed here rather than captured: after a rollover the app can
      // resume on a different calendar day than the one this effect mounted on.
      void syncWidget(s, tg, localDateKey(new Date()), l, Date.now(), qa);
      if (u) void flushPendingLogs(u);
    });
    return () => sub.remove();
  }, []);
}
