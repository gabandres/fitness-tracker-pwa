import { performQuickAdd } from '@/lib/quick-add';
import { requestWidgetRedraw } from '@/lib/widget';

/**
 * The JS the Quick Settings tile wakes (ADR-0020).
 *
 * Registered in `index.js` under the name
 * `QuickAddTileTaskService.TASK_NAME` — the two strings must match exactly, and a
 * mismatch is silent: the service starts, finds no registered task, and stops.
 *
 * Like the widget task handler this runs with no React tree, no i18n and no
 * `useToday`. Unlike it, there is no `renderWidget` to call: a tile is not a
 * widget, so any placed widget has to be asked to redraw separately — that call
 * is the only difference between the two entry points, and everything else lives
 * in `performQuickAdd`.
 *
 * Never throws. A rejection here is reported by Android as a crashed headless
 * task, which is a far louder failure than a tap that did not log.
 */
export async function quickAddTileTask(data?: { slot?: number }): Promise<void> {
  try {
    // The tile only ever fires slot 1. The extra is read anyway rather than
    // hardcoded, so a second tile (or a future long-press target) needs no change
    // here — and an absent extra falls back to the slot the tile is labelled with.
    const slot = typeof data?.slot === 'number' ? data.slot : 0;
    const outcome = await performQuickAdd(slot);

    // Nothing was written and nothing changed — do not spend a widget update.
    if (outcome.result === 'no-target' || outcome.result === 'signed-out') return;

    // The user may also have the widget on a home screen showing the same
    // numbers. It is not the surface that was tapped, so nothing has redrawn it.
    if (outcome.snapshot) await requestWidgetRedraw(outcome.snapshot);
  } catch {
    /* See above: a lost tap beats a reported crash. */
  }
}
