import { useEffect, useRef, useState } from 'react';
import type { DailyLog, LogEntry, MealPreset, MealType } from '@macrolog/core';
import { useToast } from '@/components/Toast';
import { useAddReceipt } from '@/hooks/useAddReceipt';
import type { AddReceipt } from '@/hooks/useLogWrites';
import type { LogWrites } from '@/hooks/useLogWrites';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { capitalizeFirst } from '@/i18n/grammar';
import { useAuth } from '@/lib/auth';
import { entryFromLog, isNoopEdit } from '@/lib/entry-from-log';
import type { EntryPrefill } from '@/lib/entry-prefill';
import * as haptics from '@/lib/haptics';
import { addPresetNow } from '@/lib/ledger';
import { addLogDurably } from '@/lib/pending-logs';
import { captureError } from '@/lib/sentry';

/** A meal slot's own word — the diary's slot headers use the same keys. */
const SLOT_WORD: Record<MealType, I18nKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
};

/**
 * The row a "Copy to today" writes: every field of `log` except its time and
 * its `createdAt` — it is a new meal, eaten now. The slot is kept when the
 * row had one (lunch copied at 9 PM is still lunch, a choice the user made);
 * an untagged row is left untagged so the write path slots it by the clock.
 * Exported for test.
 */
export function copyForToday(log: DailyLog, now: Date = new Date()): LogEntry {
  const { createdAt: _createdAt, ...rest } = entryFromLog(log);
  return { ...rest, timestamp: now };
}

export interface DiaryActionsOptions
  extends Pick<LogWrites, 'addEntry' | 'updateEntry' | 'deleteEntry' | 'deletePreset'> {
  /** The day the diary shows (`YYYY-MM-DD`). Carried for the caller's sheet;
   *  the writes themselves are dated by each entry's timestamp. */
  dateKey: string;
  /** The `where` tag every captured error carries — `today.*` or `history.*`. */
  where: 'today' | 'history';
  /** The rows on screen. The receipt's Edit reopens the LIVE row from here,
   *  because its closure is from the add. */
  dayLogs: readonly DailyLog[];
  /** For refusing a duplicate "Save to Quick add". */
  presets: readonly MealPreset[];
  /** The day's kcal left after adding `entry`, or null when there is nothing
   *  honest to say (no target; another day). Feeds the receipt (review U6). */
  remainingAfter?: (entry: LogEntry) => number | null;
  /**
   * Whether saving `entry` will close a target or extend the streak. When it
   * will, the save's haptic IS the celebration (one log, one haptic — review
   * #7); the ring's and the streak chip's own effects then stay quiet.
   */
  celebrates?: (entry: LogEntry) => boolean;
  /** Runs on every close of the sheet, after the hook's own reset. */
  onClose?: () => void;
}

/**
 * Everything a diary does with its rows: open the meal sheet (to add, to add
 * into a slot, to edit), save with a receipt, delete with Undo, and promote a
 * row to Quick add.
 *
 * ## Why one hook
 *
 * Today and the History day are the same screen for a different date, and
 * until UX_AUDIT Today review U2 they were two copies of this code that had
 * already drifted: History's list had no swipe-delete and no "Save to Quick
 * add", its sheet-delete inlined its own Undo, and a fix to one (the edit
 * receipt, the never-over-an-open-sheet rule for Edit) had to be made twice.
 * The writes were already shared (`useLogWrites`); this is the other half.
 *
 * It owns the sheet state (`sheetOpen`, `editing`, `prefill`) because the
 * receipt's Edit has to know whether a sheet is open, and that knowledge
 * split across a screen and a hook is how the two copies disagreed.
 *
 * ## The rules it keeps, each a bug that shipped once
 *
 * - **Edits and deletes are not awaited.** The SDK resolves only on the
 *   server's ack, so offline the sheet sat with Save disabled forever. The
 *   write is held by the SDK either way; a rejection says so in a toast.
 * - **Every write is undoable.** Add → `useAddReceipt`; edit → put the row
 *   back exactly as it was; delete → re-add durably at the same id and time.
 * - **The receipt's Edit never opens over an open sheet** — it would reset a
 *   form someone is typing in.
 * - **A delete is not a success.** It plays `haptics.removed` (review P6).
 */
export function useDiaryActions({
  where,
  dayLogs,
  presets,
  addEntry,
  updateEntry,
  deleteEntry,
  deletePreset,
  remainingAfter,
  celebrates,
  onClose,
}: DiaryActionsOptions) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const receipt = useAddReceipt();
  const { user } = useAuth();
  const uid = user?.uid;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DailyLog | null>(null);
  const [prefill, setPrefill] = useState<EntryPrefill | null>(null);

  // Latest values for callbacks that outlive the render they were made in
  // (the receipt's Edit, a context-menu preview's opener). Written in an
  // effect, never during render — a render-time ref write is what made the
  // React Compiler skip both screens (review #1).
  const dayLogsRef = useRef(dayLogs);
  const sheetOpenRef = useRef(sheetOpen);
  useEffect(() => {
    dayLogsRef.current = dayLogs;
    sheetOpenRef.current = sheetOpen;
  });

  /** Open the sheet to add — empty, on a carried-in draft, or into a slot. */
  function openAdd(seed: EntryPrefill | null = null) {
    setEditing(null);
    setPrefill(seed);
    setSheetOpen(true);
  }
  /** The diary's per-meal "+ Add" (review U3). */
  function openSlot(slot: MealType) {
    openAdd({ mealType: slot });
  }
  function openEdit(log: DailyLog) {
    setPrefill(null);
    setEditing(log);
    setSheetOpen(true);
  }
  /** Open the editor for row `id` if it is on screen — a context-menu
   *  preview's tap. False when it is not (the caller opens an empty add). */
  function openEditById(id: string | undefined): boolean {
    const log = id ? dayLogsRef.current.find((l) => l.id === id) : undefined;
    if (log) openEdit(log);
    return !!log;
  }
  function closeSheet() {
    setSheetOpen(false);
    setPrefill(null);
    onClose?.();
  }

  /** Reopen a just-added row from its receipt ("right food, wrong amount").
   *  The snapshot usually has it by the time Edit is tapped; if not, the row
   *  is rebuilt from what was written, under the same id. */
  function editAdded(id: string, entry: LogEntry) {
    if (sheetOpenRef.current) return;
    const live = dayLogsRef.current.find((l) => l.id === id);
    openEdit(live ?? { ...entry, id, date: entry.timestamp ?? new Date() });
  }

  async function onSave(entry: LogEntry): Promise<AddReceipt | void> {
    if (editing?.id) {
      const before = editing;
      // An untouched form's Save writes nothing and says nothing.
      if (isNoopEdit(before, entry)) return;
      updateEntry(editing.id, entry).catch((e) => {
        haptics.warning();
        toast.show(t('entry.updateFailed'));
        captureError(e, { where: `${where}.updateEntry` });
      });
      // An edit is undoable like an add or a delete: the receipt puts the row
      // back exactly as it was (same id, same fields).
      const label = entry.mealLabel?.trim() || before.mealLabel?.trim();
      toast.show(label ? t('entry.updatedNamed', { label }) : t('entry.updated'), {
        action: {
          label: t('common.undo'),
          onPress: () => {
            updateEntry(before.id!, entryFromLog(before)).catch((e) => {
              haptics.warning();
              toast.show(t('entry.updateFailed'));
              captureError(e, { where: `${where}.undoEdit` });
            });
          },
        },
      });
      haptics.success();
      return;
    }
    // Decided BEFORE the write: once the snapshot lands, the totals this
    // reads already include the add.
    const party = celebrates?.(entry) ?? false;
    const remaining = remainingAfter?.(entry) ?? null;
    // The receipt names what landed and carries Edit + Undo; a parked add
    // keeps the honest `offline.queued` copy (UX_AUDIT S18-12); a refused one
    // says so and plays its own warning.
    const r = await addEntry(entry);
    // Edit only when it can act: with the sheet kept open for a multi-add,
    // `editAdded` would return early and the button would do nothing.
    receipt.showAdded(
      r,
      { label: entry.mealLabel, calories: entry.calories, remaining },
      sheetOpenRef.current ? undefined : (id) => editAdded(id, entry),
    );
    if (r?.outcome === 'rejected') {
      // Refused by the server: what was typed is not lost — the form reopens
      // holding it, so the one wrong value can be fixed and saved again.
      if (!sheetOpenRef.current) {
        openAdd({
          calories: entry.calories,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
          mealLabel: entry.mealLabel,
          mealType: entry.mealType,
          note: entry.note,
          at: entry.timestamp?.getTime(),
        });
      }
      return r;
    }
    if (party) haptics.celebrate();
    else haptics.success();
    return r;
  }

  /** "Add all" from a described meal: N rows, ONE receipt, one Undo for all. */
  async function onSaveMany(entries: LogEntry[]) {
    // In parallel — offline, one at a time cost each row its own deadline.
    const receipts = await Promise.all(entries.map((entry) => addEntry(entry)));
    receipt.showAddedMany(
      receipts,
      entries.reduce((sum, e) => sum + e.calories, 0),
    );
    haptics.success();
  }

  function offerUndo(log: DailyLog) {
    const id = log.id;
    if (!id || !uid) return;
    toast.show(t('entry.deleted'), {
      durationMs: 5000,
      action: {
        label: t('common.undo'),
        onPress: () => {
          // Durable, like any add: the same id and every field when it can
          // reach the server, parked on disk when it cannot (a plain write
          // offline died with the process). Same id and timestamp, so the row
          // lands back on THIS day.
          addLogDurably(uid, entryFromLog(log), id).catch((e) => {
            haptics.warning();
            captureError(e, { where: `${where}.undoDelete` });
          });
        },
      },
    });
  }

  /**
   * Delete straight from the list — the row's swipe, its menu or its
   * screen-reader action. Delete first, offer Undo second (UX_AUDIT S18-6):
   * the reversal is exact, so a confirm would cost every intentional delete a
   * step to protect against the rare one.
   */
  function deleteFromList(log: DailyLog) {
    if (!log.id) return;
    deleteEntry(log.id).catch((e) => {
      haptics.warning();
      captureError(e, { where: `${where}.deleteEntry` });
    });
    offerUndo(log);
    haptics.removed();
  }

  /** The sheet's own Delete — same path, then the sheet closes. */
  function onDelete() {
    if (editing) deleteFromList(editing);
    closeSheet();
  }

  /**
   * Promote a logged row to a Quick add preset, from the row's menu, its
   * leading swipe or its screen-reader action. No confirm — each is an
   * explicit choice — but a duplicate is refused and the receipt carries an
   * Undo. Which presets fill the widget/tile slots is set in Settings, so
   * this cannot silently change what a blind tap logs.
   *
   * The haptic is OPTIMISTIC (review U9): success with the toast, a warning
   * if the write is later refused. It used to wait for the server's ack — a
   * buzz seconds after the toast, or never, offline — behind a leading tap.
   */
  function savePresetFromLog(log: DailyLog) {
    const name = log.mealLabel?.trim();
    if (!name || !uid) return;
    // Saving the same food twice made two identical presets in the strip.
    const key = name.toLowerCase();
    const protein = log.protein ?? 0;
    if (
      presets.some(
        (p) => p.name.trim().toLowerCase() === key && p.calories === log.calories && (p.protein ?? 0) === protein,
      )
    ) {
      haptics.warning();
      toast.show(t('today.presetExists', { name }));
      return;
    }
    // Id minted up front, so the receipt's Undo works offline too — the
    // write resolves only on the server's ack.
    const { id, written } = addPresetNow(uid, {
      name,
      calories: log.calories,
      protein,
      carbs: log.carbs ?? 0,
      fat: log.fat ?? 0,
    });
    haptics.success();
    toast.show(t('today.presetSavedSlot', { name }), {
      action: {
        label: t('common.undo'),
        onPress: () => {
          deletePreset(id).catch((e) => captureError(e, { where: `${where}.undoPreset` }));
        },
      },
    });
    written.catch((e) => {
      haptics.warning();
      toast.show(t('today.presetFailed', { name }));
      captureError(e, { where: `${where}.savePresetFromLog` });
    });
  }

  /**
   * Move a row to another meal on the same day — the row menu's "Move to…"
   * (Today re-score, Usability: every diary competitor has it, and the only
   * way here was open → change the meal chip → Save). The time does not
   * move: a slot is where the row is FILED, and the clock is a separate fact
   * the editor owns. Not awaited, like every edit (offline it never acks);
   * the receipt's Undo puts the slot back exactly as it was.
   */
  function moveToSlot(log: DailyLog, slot: MealType) {
    const id = log.id;
    if (!id || log.mealType === slot) return;
    const before = entryFromLog(log);
    const failed = (what: string) => (e: unknown) => {
      haptics.warning();
      toast.show(t('entry.updateFailed'));
      captureError(e, { where: `${where}.${what}` });
    };
    updateEntry(id, { ...before, mealType: slot }).catch(failed('moveEntry'));
    haptics.success();
    toast.show(t('entry.movedTo', { slot: capitalizeFirst(t(SLOT_WORD[slot]), locale) }), {
      action: {
        label: t('common.undo'),
        onPress: () => {
          updateEntry(id, before).catch(failed('undoMove'));
        },
      },
      testID: 'toast-moved',
    });
  }

  /**
   * Log a past day's row again, now — "Copy to today" on a History row. The
   * same receipt as any add (named, with Undo), through the same durable add,
   * so offline it parks rather than vanishing. No "Edit" on the receipt: the
   * row it would open is on Today, not on the day this screen shows.
   */
  async function copyToToday(log: DailyLog) {
    const entry = copyForToday(log);
    const r = await addEntry(entry);
    receipt.showAdded(r, { label: entry.mealLabel, calories: entry.calories });
    if (r?.outcome !== 'rejected') haptics.success();
  }

  return {
    sheetOpen,
    editing,
    prefill,
    openAdd,
    openSlot,
    openEdit,
    openEditById,
    closeSheet,
    onSave,
    onSaveMany,
    onDelete,
    deleteFromList,
    savePresetFromLog,
    moveToSlot,
    copyToToday,
  };
}

export type DiaryActions = ReturnType<typeof useDiaryActions>;
