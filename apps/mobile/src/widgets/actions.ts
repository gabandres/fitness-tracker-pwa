/**
 * The click contract between the Android widget's rendered tree and the task
 * handler that receives its taps.
 *
 * `clickAction` is an untyped string on the wire and `clickActionData` an
 * untyped record, delivered by the OS through a `PendingIntent`. Both sides
 * therefore have to agree by convention, and a typo produces a button that
 * silently does nothing — the same class of invisible widget failure as the
 * `useMemoCache` defect. Keeping the name and the parse in one small module is
 * what makes the agreement checkable.
 *
 * `.ts`, not `.tsx`, on purpose: nothing here renders.
 */

/** Tap on a quick-add button. Any other value is not ours. */
export const QUICK_ADD_ACTION = 'QUICK_ADD';

/** Which quick-add slot was tapped, or `null` for anything that isn't a slot
 *  index we could act on. Nothing about the payload is trustworthy: it survived
 *  a trip through a `PendingIntent` extras bundle, and it may have been minted
 *  by a widget instance placed before this app version existed. */
export function quickAddSlotFrom(data: Record<string, unknown> | undefined): number | null {
  const raw = data?.['slot'];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
