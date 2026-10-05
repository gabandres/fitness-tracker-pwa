import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { useLocale, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { undoAdds } from '@/lib/pending-logs';
import { captureError } from '@/lib/sentry';
import type { AddReceipt } from './useLogWrites';

/**
 * The receipt for an add: "Logged Oatmeal · 300 kcal · 1,050 left · Edit · Undo".
 *
 * The remaining figure is the number the user was going to look up next — it
 * is the hero's headline, and the ring is behind the sheet that is closing.
 * Said only when the caller knows it (a target exists, and the add landed on
 * the day the ring describes); a History add to last Tuesday omits it.
 *
 * Before this, delete was the only reversible write on Today — an add closed
 * the sheet with a haptic and nothing else, so a mis-tapped recent cost
 * open → Delete → close, and a VoiceOver user got no confirmation at all. One
 * hook, so every add surface (sheet save, one-tap quick log, scan, repeat
 * yesterday, "Add all") says the same thing and undoes the same way:
 * `undoAdds` drops the rows from the offline queue if they parked and deletes
 * the docs if they landed — in ONE queue write, so a batch undo cannot lose
 * rows to its own parallel read-modify-writes.
 *
 * A batch is ONE receipt with one Undo for every row. N receipts in a row each
 * replaced the last, VoiceOver read all N, and the Undo that survived removed
 * only the final item.
 *
 * A parked add keeps the honest `offline.queued` copy (UX_AUDIT S18-12) and
 * still gets the Undo — the row is on screen either way.
 */
export function useAddReceipt() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { user } = useAuth();
  const uid = user?.uid;

  // `undone` is said once the Undo has taken ("Removed Oatmeal"): the receipt
  // vanished on the tap and nothing confirmed the reversal (B7). A toast, so
  // it is drawn AND announced.
  const undoAction = useCallback(
    (ids: readonly string[], onUndo?: () => void, undone?: string) =>
      uid && ids.length
        ? {
            label: t('common.undo'),
            onPress: () => {
              onUndo?.();
              undoAdds(uid, ids)
                .then(() => {
                  if (undone) toast.show(undone, { testID: 'toast-undone' });
                })
                .catch((e) => {
                  haptics.warning();
                  captureError(e, { where: 'receipt.undoAdd' });
                });
            },
          }
        : undefined,
    [uid, t, toast],
  );

  /**
   * One row added. `label`/`calories` are what the receipt names; `onEdit`,
   * when given, adds an "Edit" button that reopens the row — the fix for "right
   * food, wrong amount" without hunting for it in the list. `remaining`, when
   * given, is the day's kcal left AFTER this add (negative = over).
   */
  const showAdded = useCallback(
    (
      receipt: AddReceipt | undefined,
      what: { label?: string; calories: number; remaining?: number | null },
      onEdit?: (id: string) => void,
    ) => {
      if (!receipt) return;
      const n = formatNumber(Math.round(what.calories), locale);
      const label = what.label?.trim();
      if (receipt.outcome === 'rejected') {
        // Refused by the rules — nothing was saved, so no Undo and no Edit
        // (there is no row to act on). Never "Saved offline" (C3).
        haptics.warning();
        toast.show(label ? t('entry.rejectedNamed', { label }) : t('entry.rejected'), { testID: 'toast-rejected' });
        return;
      }
      const base = label ? t('entry.logged', { label, n }) : t('entry.loggedKcal', { n });
      const left =
        what.remaining == null
          ? null
          : what.remaining >= 0
            ? t('entry.loggedLeft', { n: formatNumber(Math.round(what.remaining), locale) })
            : t('entry.loggedOver', { n: formatNumber(Math.round(-what.remaining), locale) });
      const message =
        receipt.outcome === 'queued' ? t('offline.queued') : left ? `${base} · ${left}` : base;
      const action = undoAction(
        [receipt.id],
        undefined,
        label ? t('entry.removedNamed', { label }) : t('entry.removed'),
      );
      toast.show(message, {
        action,
        secondaryAction:
          action && onEdit ? { label: t('common.edit'), onPress: () => onEdit(receipt.id) } : undefined,
        testID: 'toast-added',
      });
    },
    [t, locale, toast, undoAction],
  );

  /** Several rows added in one gesture ("Add all" from a described meal). */
  const showAddedMany = useCallback(
    (receipts: readonly (AddReceipt | undefined)[], totalCalories: number) => {
      const got = receipts.filter((r): r is AddReceipt => r != null);
      if (got.length === 0) return;
      if (got.length === 1) {
        showAdded(got[0], { calories: totalCalories });
        return;
      }
      const landed = got.filter((r) => r.outcome !== 'rejected');
      const refused = got.length - landed.length;
      if (refused) haptics.warning();
      const message = refused
        ? t('entry.rejectedSome', { n: refused, total: got.length })
        : got.some((r) => r.outcome === 'queued')
          ? t('offline.queued')
          : t('entry.loggedMany', {
              n: got.length,
              kcal: formatNumber(Math.round(totalCalories), locale),
            });
      const ids = landed.map((r) => r.id);
      toast.show(message, {
        action: undoAction(ids, undefined, ids.length === 1 ? t('entry.removed') : t('entry.removedMany', { n: ids.length })),
        testID: refused ? 'toast-rejected' : 'toast-added',
      });
    },
    [t, locale, toast, undoAction, showAdded],
  );

  /** Several rows copied at once (repeat yesterday). `onUndo` lets the screen
   *  put back whatever the copy hid (its "From yesterday" chip). */
  const showCopied = useCallback(
    (ids: readonly string[], onUndo?: () => void) => {
      if (!ids.length) return;
      const message =
        ids.length === 1 ? t('today.repeatedOne') : t('today.repeatedN', { n: ids.length });
      toast.show(message, { action: undoAction(ids, onUndo), testID: 'toast-copied' });
    },
    [t, toast, undoAction],
  );

  return { showAdded, showAddedMany, showCopied };
}
