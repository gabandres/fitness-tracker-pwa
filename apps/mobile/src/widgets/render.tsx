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
export function renderTodayWidget(snapshot: WidgetSnapshot | null) {
  return <TodayWidget view={widgetView(snapshot, localDateKey(new Date()))} />;
}
