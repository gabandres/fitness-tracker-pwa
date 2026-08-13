import { type WidgetSnapshot, localDateKey, widgetView } from '@macrolog/core';
import { TodayWidget } from './TodayWidget';

/**
 * The one place a snapshot becomes a rendered Android widget.
 *
 * Both entry points funnel through here — `src/lib/widget.ts` on a live update
 * from the app, and `widget-task-handler.tsx` when the OS wakes the widget on
 * its own schedule — so the staleness decision is made identically either way.
 *
 * `localDateKey(new Date())` is evaluated *at render time*, on purpose: an
 * OS-driven `WIDGET_UPDATE` after midnight has to compare against the new day,
 * which is exactly what makes yesterday's blob fall through to the empty state
 * instead of being drawn as today's.
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
  return <TodayWidget view={widgetView(snapshot, localDateKey(new Date()))} width={width} />;
}
