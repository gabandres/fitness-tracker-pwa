import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { readWidgetSnapshot } from '@/lib/widget';
import { renderTodayWidget } from './render';

/**
 * Android widget task handler — the OS's way into our JS when the app itself
 * may not be running.
 *
 * It is registered in `index.js` (the custom entry point), *not* mounted in the
 * React tree, so it has no auth, no Firestore and no i18n context. Everything
 * it draws comes from the snapshot the app last wrote to AsyncStorage; see
 * `src/lib/widget.ts` for why that's the only workable contract.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    // All three mean the same thing to us: draw the latest snapshot. There is
    // no per-widget-instance state to restore on add, and no layout branch on
    // resize (the widget is one fixed 2x2 face).
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(renderTodayWidget(await readWidgetSnapshot()));
      break;

    // Nothing to clean up — the snapshot is app state, not widget state, and
    // it stays valid for the in-app UI and for any other widget instance.
    case 'WIDGET_DELETED':
      break;

    // Taps are handled by the OS as an `OPEN_URI` deep link (see TodayWidget),
    // so no click action reaches us here.
    default:
      break;
  }
}
