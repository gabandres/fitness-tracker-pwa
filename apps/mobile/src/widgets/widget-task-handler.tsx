import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { performQuickAdd } from '@/lib/quick-add';
import { readWidgetSnapshot } from '@/lib/widget';
import { QUICK_ADD_ACTION, quickAddSlotFrom } from './actions';
import { renderTodayWidget } from './render';

/**
 * Android widget task handler — the OS's way into our JS when the app itself
 * may not be running.
 *
 * It is registered in `index.js` (the custom entry point), *not* mounted in the
 * React tree, so it has no React context and no i18n. Everything it draws comes
 * from the snapshot the app last wrote to AsyncStorage; see `src/lib/widget.ts`
 * for why that's the only workable contract.
 *
 * **It does now have auth**, which is what makes the quick-add button possible
 * (ADR-0020): `firebase.ts` persists the session through AsyncStorage, so the
 * signed-in user rehydrates in this context too. That is the whole reason
 * Android needs no native write path while iOS does.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    // All three mean the same thing to us: draw the latest snapshot at this
    // instance's current width. There is no per-widget-instance state to
    // restore on add. `WIDGET_RESIZED` matters now — the widget became
    // resizable, and the width decides which face is drawn — where it used to
    // be a redraw of one fixed 2x2 layout.
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(
        renderTodayWidget(await readWidgetSnapshot(), props.widgetInfo.width),
      );
      break;

    // Nothing to clean up — the snapshot is app state, not widget state, and
    // it stays valid for the in-app UI and for any other widget instance.
    case 'WIDGET_DELETED':
      break;

    // A tap on the FACE is an `OPEN_URI` deep link handled by the OS and never
    // reaches us. A tap on a quick-add BUTTON does (see `TodayWidget`).
    case 'WIDGET_CLICK':
      await handleClick(props);
      break;

    default:
      break;
  }
}

/**
 * Log the tapped slot, then redraw with the new totals.
 *
 * The redraw is the receipt. There is no confirmation step by design — a
 * quick-add exists to be a single tap — so the only honest feedback available
 * on a home screen is the numbers moving, and they cannot move on their own:
 * the app that normally writes the snapshot is not running.
 *
 * Order matters, and `performQuickAdd` is awaited first: a face that has updated
 * is a face whose row is in the ledger, or parked under an id that will land.
 * Redrawing first would show a total the user might never get.
 *
 * Every decision about *what* a tap does lives in `performQuickAdd`, shared with
 * the Quick Settings tile. What is local to this handler is that the redraw goes
 * through the `renderWidget` the OS handed us — asking for a widget update from
 * inside one is how a redraw loop starts.
 */
async function handleClick(props: WidgetTaskHandlerProps): Promise<void> {
  const slot = props.clickAction === QUICK_ADD_ACTION ? quickAddSlotFrom(props.clickActionData) : null;

  // An unknown action: redraw from disk and write nothing.
  if (slot == null) {
    props.renderWidget(renderTodayWidget(await readWidgetSnapshot()));
    return;
  }

  // `snapshot` comes back untouched for a dead slot or a signed-out tap, and
  // incremented otherwise — so this one call covers both the receipt and making
  // a stale button disappear.
  const { snapshot } = await performQuickAdd(slot);
  props.renderWidget(renderTodayWidget(snapshot));
}
