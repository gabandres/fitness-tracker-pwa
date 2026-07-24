import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { type DailyTargets, type DaySummary, localDateKey } from '@macrolog/core';
import { useLocale } from '@/i18n';
import { syncWidget } from '@/lib/widget';

/**
 * Keeps the home-screen widget's snapshot in step with today's numbers.
 *
 * Mounted on Today, which already holds `summary` + `targets`, so this
 * deliberately takes them as arguments instead of opening its own listeners —
 * a second subscription for data the screen has in hand is exactly the
 * duplication ADR-0016's focus-gating budget doesn't cover.
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
 * Fire-and-forget: `syncWidget` never rejects, and a stale widget must not be
 * able to disturb the screen that's drawing the real thing.
 */
export function useWidgetSync(summary: DaySummary, targets: DailyTargets): void {
  const locale = useLocale();

  // Read through a ref inside the AppState listener so the subscription is
  // registered once instead of being torn down and rebuilt on every keystroke
  // that moves a total.
  const latest = useRef({ summary, targets, locale });
  latest.current = { summary, targets, locale };

  useEffect(() => {
    void syncWidget(summary, targets, localDateKey(new Date()), locale);
  }, [summary, targets, locale]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { summary: s, targets: tg, locale: l } = latest.current;
      // Recomputed here rather than captured: after a rollover the app can
      // resume on a different calendar day than the one this effect mounted on.
      void syncWidget(s, tg, localDateKey(new Date()), l);
    });
    return () => sub.remove();
  }, []);
}
