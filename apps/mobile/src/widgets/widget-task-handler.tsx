import { applyQuickAddToSnapshot, type WidgetSnapshot } from '@macrolog/core';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { logQuickAdd } from '@/lib/quick-add';
import { readWidgetSnapshot, saveWidgetSnapshot } from '@/lib/widget';
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
 * Order matters. The write is awaited before the redraw, so a face that has
 * updated is a face whose row is in the ledger (or parked under an id that will
 * land). Redrawing first would show a total the user might never get.
 */
async function handleClick(props: WidgetTaskHandlerProps): Promise<void> {
  const snapshot = await readWidgetSnapshot();
  const slot = props.clickAction === QUICK_ADD_ACTION ? quickAddSlotFrom(props.clickActionData) : null;
  const target = slot != null ? snapshot?.quickAdd?.[slot] : undefined;

  // An unknown action, or a slot whose preset vanished between the last snapshot
  // write and the tap. Redraw from disk so the button disappears rather than
  // staying tappable-and-dead.
  if (!target || !snapshot) {
    props.renderWidget(renderTodayWidget(snapshot));
    return;
  }

  const result = await logQuickAdd(target);

  // 'signed-out' writes nothing anywhere: the tap is dropped and the face is
  // redrawn unchanged. Incrementing the totals for a row that was never written
  // — and, being unattributable, never will be — is the one outcome worse than
  // doing nothing, because the home screen would then disagree with the app.
  const next: WidgetSnapshot | null =
    result === 'signed-out' ? snapshot : applyQuickAddToSnapshot(snapshot, target, Date.now());

  if (next && next !== snapshot) await saveWidgetSnapshot(next);
  props.renderWidget(renderTodayWidget(next));
}
