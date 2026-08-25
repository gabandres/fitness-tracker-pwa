import { type WidgetSnapshot, calendarDateKey, widgetView } from '@macrolog/core';
import { TodayWidget } from './TodayWidget';

/**
 * The one place a snapshot becomes a rendered Android widget.
 *
 * Both entry points funnel through here — `src/lib/widget.ts` on a live update
 * from the app, and `widget-task-handler.tsx` when the OS wakes the widget on
 * its own schedule — so the staleness decision is made identically either way.
 *
 * The clock is read *at render time*, on purpose: an OS-driven `WIDGET_UPDATE`
 * after the day ends has to compare against the new one, which is exactly what
 * makes yesterday's blob fall through to the empty state instead of being drawn
 * as today's.
 *
 * **Both arguments are passed because the day is not the calendar date.** Since
 * ADR-0030 a user can start their day at 03:00, and a widget that compared only
 * `calendarDateKey` would call the previous day's totals "today" from midnight
 * until then. `widgetView` prefers the snapshot's own `dayEndsMs` — computed
 * phone-side with the user's boundary — and falls back to the calendar
 * comparison for blobs written before that field existed. Neither this file nor
 * `Glance.swift` re-derives a day; the app ships the answer.
 */
/**
 * `width` is the widget's current width in dp, from `widgetInfo.width`. It
 * decides which face is drawn — see `WIDE_MIN_DP` in `TodayWidget`.
 *
 * Optional because the live-update path in `src/lib/widget.ts` writes a snapshot
 * without knowing any instance's size; omitting it draws the narrow face, which
 * is the safe default and what every instance rendered before the widget became
 * resizable. The OS re-renders with a real width on `WIDGET_RESIZED`.
 */
export function renderTodayWidget(snapshot: WidgetSnapshot | null, width?: number) {
  const now = new Date();
  return (
    <TodayWidget
      view={widgetView(snapshot, calendarDateKey(now), now.getTime())}
      width={width}
    />
  );
}
