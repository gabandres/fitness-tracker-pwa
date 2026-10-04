import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureAndShare } from '@/lib/shareCapture';
import type { DailyLog, DateKey, LogEntry, MealSlot } from '@macrolog/core';
import { fastLengthHours, maintenanceView, parseYmd } from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { Flame } from '@/components/Flame';
import { useToast } from '@/components/Toast';
import { useAddReceipt } from '@/hooks/useAddReceipt';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { NumbersGlossary } from '@/components/NumbersGlossary';
import { EntrySheet } from '@/components/EntrySheet';
import { FastSheet } from '@/components/FastSheet';
import { HeroRings, HeroRingsSkeleton } from '@/components/HeroRings';
import { MealEntries } from '@/components/MealEntries';
import { MilestoneNote } from '@/components/MilestoneNote';
import { OfflineBanner } from '@/components/OfflineBanner';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { RecalibrationCard } from '@/components/RecalibrationCard';
import { ShareCard } from '@/components/ShareCard';
import { UpdateBanner } from '@/components/UpdateBanner';
import { type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { releaseTour } from '@/lib/tour';
import { parseEntryPrefill, type EntryPrefill } from '@/lib/entry-prefill';
import { useDayFasts } from '@/hooks/useDayFasts';
import { useFastActivity } from '@/hooks/useFastActivity';
import { useReminderSync } from '@/hooks/useReminderSync';
import { performQuickAdd } from '@/lib/quick-add';
import { addLogDurably } from '@/lib/pending-logs';
import { addPresetNow } from '@/lib/ledger';
import { entryFromLog, isNoopEdit } from '@/lib/entry-from-log';
import { useMilestones } from '@/hooks/useMilestones';
import { useToday } from '@/hooks/useToday';
import { useTodayNudge } from '@/hooks/useTodayNudge';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { enterUp, PressScale, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { FAB_BAND, font, headerTitle, radius, space, type } from '@/theme';
import { formatDate } from '@/lib/date-format';

/** Streak length below which a streak extension is too early to read as
 *  "this app is working for me" — see reviewPrompt.ts for the full policy. */
const MIN_STREAK_FOR_REVIEW = 3;

/** Vertical-only slop that lifts a 40–44dp control to Android's 48dp target.
 *  Vertical only, because horizontally these controls have neighbours. */
const ICON_SLOP = { top: 4, bottom: 4 } as const;

/** The header's three icons are 38dp wide (the row has no more at 360dp —
 *  `iconBtn`); 3dp of side slop makes each a 44dp target, overlapping its
 *  neighbour's by under a dp of the 4dp gap. */
const HEADER_ICON_SLOP = { top: 4, bottom: 4, left: 3, right: 3 } as const;

/** Slot names for the copy-from-yesterday chips — the diary's own words. */
const SLOT_LABEL: Record<MealSlot, I18nKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
  other: 'meal.other',
};

/**
 * "Fri, Sep 4" — abbreviated on purpose.
 *
 * The long form ("Friday, September 4") measured **448px of a 1,080px screen**
 * on a OnePlus 8T, which is what pushed the header over its width and clipped
 * the avatar off the right edge. `flexShrink` on the title block stops the
 * clipping, but with the long form still in place it simply moved the damage
 * to the date, which rendered as "Friday, Septe…".
 *
 * So the shrink is the SAFETY NET and this is the actual fix: at ~190px the
 * row has slack again and nothing truncates. `short` also degrades better
 * across locales than `long` does — es-PR's "viernes, 4 de septiembre" is
 * wider than the English it was tuned against, and Intl handles the
 * abbreviation per locale rather than us guessing at one.
 *
 * Nothing is lost: the screen is titled "Today", so the year and the full
 * weekday were never carrying information the user needed here.
 *
 * Formatted from the day KEY, not `new Date()`: the key is what re-renders at
 * rollover (`useDayKey`), and under a day boundary at 01:00 it is still
 * yesterday — which is the day the ring below is describing.
 */
function todayLabel(dayKey: DateKey, locale: Locale): string {
  return formatDate(parseYmd(dayKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Remount boundary for Retry (UX_AUDIT S18-7).
 *
 * The feed hooks expose no reload — `useLedgerFeed` re-opens on focus and
 * resets its error only for a NEW account — so the honest retry is a fresh
 * mount: every listener closes and reopens, `error` starts null, and the
 * spinner/cached-paint logic runs exactly as on a cold open. A `key` bump is
 * the whole mechanism; nothing about the hooks changes (ADR-0016).
 */
export default function Today() {
  const [attempt, setAttempt] = useState(0);
  return <TodayScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

function TodayScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const toast = useToast();
  const receipt = useAddReceipt();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user } = useAuth();
  const {
    loading,
    error,
    summary,
    targets,
    activity,
    todayLogs,
    presets,
    recentEntries,
    addEntry,
    updateEntry,
    deleteEntry,
    addPreset,
    deletePreset,
    customFoods,
    addCustomFood,
    deleteCustomFood,
    hideRecent,
    unitSystem,
    water,
    sleep,
    setWater,
    setSleep,
    fastStartedAt,
    startFast,
    breakFast,
    undoBreakFast,
    boundary,
    todayKey,
    streak,
    repeatYesterday,
    yesterdayCount,
    yesterdaySlots,
    shareStats,
    hasWeighIn,
    hasPhotoScan,
    hasPriorLogs,
    measurement,
  } = useToday();
  // The single Nudge slot this screen is allowed to fill.
  const nudge = useTodayNudge();
  // Milestones are evaluated here because this is where the streak already
  // exists. Deliberately NOT part of `useTodayNudge`'s union — the note asks
  // for nothing, so it is a state readout and does not compete for that slot.
  // See MilestoneNote.tsx for why that classification is honest.
  const { todays: todaysMilestones } = useMilestones({
    uid: user?.uid,
    streak,
    hasWeighIn,
    hasPhotoScan,
    boundary,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [fastSheetOpen, setFastSheetOpen] = useState(false);
  /**
   * **Always subscribed, reversing the gating this shipped with.**
   *
   * It was gated on the sheet being open, to keep one more listener off the
   * app's most visited tab for a guard that fires almost never. That reasoning
   * was sound about COST and wrong about the product: with no fasts on Today,
   * the row could only ever say "Not fasting", so a user who logged a completed
   * fast from this very row saw no acknowledgement, decided it had not saved,
   * and logged it again — straight into an overlap warning against their own
   * record. Reported from a device with a screenshot.
   *
   * The listener is bounded on `endedAt` to a few days either side of today, so
   * this is a handful of documents per focus, not an open read. That is the
   * price of the row telling the truth.
   */
  const {
    dayFasts: todayFasts,
    fasts: nearbyFasts,
    addFast,
    updateFast,
    deleteFast,
  } = useDayFasts(todayKey, boundary);
  /** The fast the row is describing, and therefore the one a tap edits. */
  const editableFast = todayFasts[0] ?? null;
  const fastedTodayHours = useMemo(
    () => todayFasts.reduce((sum, f) => sum + fastLengthHours(f), 0),
    [todayFasts],
  );
  // Memoised so its identity cannot churn: `FastSheet` seeds its fields from
  // this, and an inline object rebuilt every render is what silently discarded
  // a typed correction before the seed effect was keyed on instants instead.
  const runningFast = useMemo(
    () => (fastStartedAt ? { startedAt: fastStartedAt, endedAt: fastStartedAt } : null),
    [fastStartedAt],
  );
  const [repeating, setRepeating] = useState(false);
  const shareRef = useRef<View>(null);

  // Keep on-device smart reminders in sync with today's state (runs on Today
  // focus + after every log). No-op unless the user enabled reminders.
  useReminderSync();

  // Push today's totals to the home-screen widget's shared storage, and land
  // anything a widget button parked while offline. No-op unless the widget's
  // native module is present (dev/production build only). `presets` rides along
  // so the widget can draw the user's quick-add buttons (ADR-0020).
  useWidgetSync(summary, targets, presets);

  // Keep the fasting Live Activity in step with the fast (N3). It reconciles
  // rather than reacts, because iOS ends an Activity at 8 hours and the user can
  // swipe it away — see the hook. iOS-only; a no-op everywhere else.
  useFastActivity(fastStartedAt);

  /**
   * Promote a logged entry to a quick-add preset, from the row's long-press
   * menu or its screen-reader action. No confirm — both are explicit choices —
   * but a duplicate is refused and the receipt carries an Undo. A new preset
   * joins the list; which presets fill the widget/tile slots is set in
   * Settings, so this cannot silently change what a blind tap logs.
   */
  const savePresetFromLog = useCallback(
    (log: DailyLog) => {
      const name = log.mealLabel?.trim();
      const uid = user?.uid;
      if (!name || !uid) return;
      // No confirm: this is reached from the row's menu ("Save preset") or its
      // screen-reader action — both an explicit choice, where the confirm was
      // there for the old bare long-press. Asking again was a second step, and
      // a confirm presented as the menu closed could be dropped outright
      // (Android: the menu sheet's own host took it, then unmounted).
      haptics.tap();
      // Saving the same food twice made two identical presets in the strip.
      const key = name.toLowerCase();
      const protein = log.protein ?? 0;
      if (
        presets.some(
          (p) => p.name.trim().toLowerCase() === key && p.calories === log.calories && (p.protein ?? 0) === protein,
        )
      ) {
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
      let undone = false;
      toast.show(t('today.presetSavedSlot', { name }), {
        action: {
          label: t('common.undo'),
          onPress: () => {
            undone = true;
            deletePreset(id).catch((e) => captureError(e, { where: 'today.undoPreset' }));
          },
        },
      });
      written
        .then(() => {
          if (!undone) haptics.success();
        })
        .catch((e) => {
          haptics.warning();
          captureError(e, { where: 'today.savePresetFromLog' });
        });
    },
    [user?.uid, presets, deletePreset, t, toast],
  );

  // The tab bar's Log button navigates here with a fresh `openAdd` nonce —
  // each new value opens the add sheet (see AppTabBar in the tab layout).
  const { openAdd: openAddParam, quickAddSlot: quickAddSlotParam, prefill: prefillParam } = useLocalSearchParams<{
    openAdd?: string;
    quickAddSlot?: string;
    prefill?: string;
  }>();
  // A draft carried in beside the nonce — the scan screen's repeat suggestion
  // (ADR-0029, settled 2026-09-08). Parsed once per nonce; a bad param opens
  // the sheet empty rather than not at all.
  const [sheetPrefill, setSheetPrefill] = useState<EntryPrefill | null>(null);
  useEffect(() => {
    if (!openAddParam) return;
    setEditing(null);
    setSheetPrefill(parseEntryPrefill(prefillParam));
    setSheetOpen(true);
  }, [openAddParam, prefillParam]);

  // The Quick Settings tile's FALLBACK path (ADR-0020). Its tap normally logs
  // without opening anything; when Android refuses the background service start
  // the tile opens the app with this param instead, so the tap still lands. Not
  // the promised experience — but a visible slower one beats a silent dead tile,
  // which is exactly how the Android widget stayed broken for a month.
  const quickAddDone = useRef<string | null>(null);
  useEffect(() => {
    if (!quickAddSlotParam || quickAddDone.current === quickAddSlotParam) return;
    quickAddDone.current = quickAddSlotParam;
    const slot = Number(quickAddSlotParam);
    if (!Number.isInteger(slot) || slot < 0) return;
    // Counted here and not in `performQuickAdd`, because that function's normal
    // home is a headless task with no session bound to analytics — a count
    // recorded there would be dropped. So this measures the FALLBACK path only
    // and under-counts real widget/tile use. It is still the honest number for
    // the question it answers: how often the tile has to open the app instead
    // of logging silently.
    track('quick_add');
    performQuickAdd(slot).catch((e) => captureError(e, { where: 'today.quickAddFallback' }));
  }, [quickAddSlotParam]);

  // Celebration: the flame chip bounces when the streak extends mid-session
  // (null-first ref so it doesn't fire on mount).
  const [streakPulse, triggerStreakPulse] = usePulse(1.3);
  const prevStreak = useRef<number | null>(null);
  useEffect(() => {
    // Not while the feed is loading: `streak` is 0 until the logs land, so the
    // 0 → N step on every cold start read as an extension and fired the bounce,
    // the haptic and a review-prompt beat on mount.
    if (loading) return;
    if (prevStreak.current !== null && streak > prevStreak.current) {
      haptics.tap();
      triggerStreakPulse();
      // Extending a streak is the other reliable "this is working" beat
      // (the first is finishing a workout). Held back until the streak is
      // long enough to mean something — a day-2 user has no opinion yet.
      if (streak >= MIN_STREAK_FOR_REVIEW) void recordPositiveMoment();
    }
    prevStreak.current = streak;
  }, [streak, loading, triggerStreakPulse]);

  async function onShare() {
    haptics.tap();
    try {
      await captureAndShare(shareRef, t('today.shareCard'));
    } catch {
      /* capture/share failed or user dismissed — no-op */
    }
  }

  // Slots copied today, keyed to the day. A copied chip must go even when the
  // copy does not land in its slot: unslotted ("other") rows have no stored
  // slot and file by the clock, so the "Other" chip never cleared on its own
  // and a second tap duplicated the copy.
  const [copied, setCopied] = useState<{ day: string; slots: MealSlot[] }>({ day: '', slots: [] });
  const copiedToday = copied.day === todayKey ? copied.slots : [];
  const copySlots = yesterdaySlots.filter((s) => !copiedToday.includes(s));
  async function onCopySlot(slot: MealSlot) {
    if (repeating) return;
    haptics.tap();
    setRepeating(true);
    try {
      const ids = await repeatYesterday(slot);
      haptics.success();
      setCopied((c) => ({ day: todayKey, slots: [...(c.day === todayKey ? c.slots : []), slot] }));
      // Undo puts the chip back: hidden until tomorrow was a mis-tap's cost.
      receipt.showCopied(ids, () =>
        setCopied((c) => ({ ...c, slots: c.slots.filter((x) => x !== slot) })),
      );
    } finally {
      setRepeating(false);
    }
  }
  async function onRepeatYesterday() {
    if (repeating) return;
    haptics.tap();
    setRepeating(true);
    try {
      const ids = await repeatYesterday();
      haptics.success();
      // Only "Other" needs marking: every slotted copy lands in its own slot,
      // which clears that chip by itself (and brings it back if the copies are
      // deleted by hand). Unslotted rows file by the clock, so the "Other" chip
      // would stay up and a tap on it copied them twice.
      setCopied({ day: todayKey, slots: ['other'] });
      // "Copied 3 entries · Undo" — the copy used to land with a bare haptic,
      // and a mis-tap meant deleting each row by hand.
      receipt.showCopied(ids, () => setCopied({ day: todayKey, slots: [] }));
    } finally {
      setRepeating(false);
    }
  }
  const [editing, setEditing] = useState<DailyLog | null>(null);

  function openEdit(log: DailyLog) {
    setEditing(log);
    setSheetOpen(true);
  }
  // The latest list, for the receipt's Edit — its closure is from the add.
  const todayLogsRef = useRef(todayLogs);
  todayLogsRef.current = todayLogs;
  // A ref, not the state: the receipt's closure is from the save, when the
  // sheet was still open.
  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
  /** Reopen a just-added row from its receipt ("right food, wrong amount").
   *  The snapshot usually has it by the time Edit is tapped; if not, the row
   *  is rebuilt from what was written, under the same id. */
  function editAdded(id: string, entry: LogEntry) {
    // A receipt outliving its sheet: if a new add is already open, Edit would
    // reset that form and drop what is typed in it.
    if (sheetOpenRef.current) return;
    const live = todayLogsRef.current.find((l) => l.id === id);
    openEdit(live ?? { ...entry, id, date: entry.timestamp ?? new Date() });
  }
  async function onSave(entry: LogEntry) {
    if (editing?.id) {
      const before = editing;
      // An untouched form's Save writes nothing and says nothing.
      if (isNoopEdit(before, entry)) return;
      // Not awaited: the SDK resolves an update only on the server's ack, so
      // offline the sheet sat with Save disabled forever while the banner
      // promised "will sync". The SDK holds the patch either way; the sheet
      // closes now, and a rejection (rules, a deleted row) says so in a toast
      // rather than rolling the row back behind a lone haptic.
      updateEntry(editing.id, entry).catch((e) => {
        haptics.warning();
        toast.show(t('entry.updateFailed'));
        captureError(e, { where: 'today.updateEntry' });
      });
      // An edit is undoable like an add or a delete: the receipt puts the row
      // back exactly as it was (same id, same fields) — "I changed the wrong
      // entry" no longer means re-typing the old numbers from memory.
      const label = entry.mealLabel?.trim() || before.mealLabel?.trim();
      toast.show(label ? t('entry.updatedNamed', { label }) : t('entry.updated'), {
        action: {
          label: t('common.undo'),
          onPress: () => {
            updateEntry(before.id!, entryFromLog(before)).catch((e) => {
              haptics.warning();
              toast.show(t('entry.updateFailed'));
              captureError(e, { where: 'today.undoEdit' });
            });
          },
        },
      });
    } else {
      // The receipt names what landed and carries Edit + Undo; a parked add
      // keeps the honest `offline.queued` copy (UX_AUDIT S18-12).
      const r = await addEntry(entry);
      receipt.showAdded(r, { label: entry.mealLabel, calories: entry.calories }, (id) =>
        editAdded(id, entry),
      );
    }
    haptics.success();
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
  /**
   * Delete first, offer Undo second (UX_AUDIT S18-6). No confirm sheet: a
   * mis-tap costs one more tap to reverse, and the reversal is exact — same
   * id, same timestamp — so nothing about the day changes except the row
   * coming back. A confirm would cost every intentional delete a step to
   * protect against the rare one.
   */
  async function onDelete() {
    const log = editing;
    if (log?.id) {
      // Fire, then Undo at once — awaiting the server's ack left the sheet
      // open and the Undo unshown for as long as the device was offline.
      deleteEntry(log.id).catch((e) => {
        haptics.warning();
        captureError(e, { where: 'today.deleteEntry' });
      });
      offerUndo(log);
    }
    haptics.success();
    closeSheet();
  }
  /** Delete straight from the list — the row's swipe or its screen-reader
   *  action. Same fire-then-Undo path as the sheet's delete. */
  function deleteFromList(log: DailyLog) {
    if (!log.id) return;
    deleteEntry(log.id).catch((e) => {
      haptics.warning();
      captureError(e, { where: 'today.deleteEntry' });
    });
    offerUndo(log);
    haptics.success();
  }
  /**
   * End the fast, then offer Undo — the button sits beside the water pills and
   * a mis-tap used to close a 16-hour fast for good (the only repair was
   * re-typing both instants in History).
   *
   * The toast waits for the commit (see the body): Undo needs the id the
   * write minted, and a receipt for a write that failed would be a lie.
   */
  function onBreakFast() {
    // The toast waits for the commit: `breakFast` reads the profile first, and
    // with no SDK persistence that read fails offline — an Undo offered up
    // front would be a receipt for a fast that never ended.
    breakFast()
      .then((receipt) => {
        toast.show(t('metrics.fastEnded'), {
          action: receipt?.startedAt
            ? {
                label: t('common.undo'),
                onPress: () => {
                  undoBreakFast(receipt).catch((e) => {
                    haptics.warning();
                    captureError(e, { where: 'today.undoBreakFast' });
                  });
                },
              }
            : undefined,
          testID: 'toast-fast-ended',
        });
      })
      .catch((e) => {
        haptics.warning();
        // `breakFast` reads the profile before it commits, and with no SDK
        // persistence that read fails offline — say so, rather than a lone buzz.
        toast.show(t('metrics.fastEndFailed'));
        captureError(e, { where: 'today.breakFast' });
      });
  }
  function offerUndo(log: DailyLog) {
    const id = log.id;
    const uid = user?.uid;
    if (!id || !uid) return;
    toast.show(t('entry.deleted'), {
      durationMs: 5000,
      action: {
        label: t('common.undo'),
        onPress: () => {
          // Durable, like any add: the same id and every field when it can reach
          // the server, parked on disk when it cannot (a plain write offline died
          // with the process).
          addLogDurably(uid, entryFromLog(log), id).catch((e) => {
            haptics.warning();
            captureError(e, { where: 'today.undoDelete' });
          });
        },
      },
    });
  }
  /** Every way the add sheet closes goes through here: the guided tour is
   *  held while onboarding's first-log sheet is up, and this is its release. */
  function closeSheet() {
    setSheetOpen(false);
    setSheetPrefill(null);
    releaseTour();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        {/* Shrinkable, and the ONLY shrinkable thing in this row — see
            `headerTitleBlock`. The date is what makes the block wide (448px of
            a 1,080px screen on a OnePlus 8T), so it is what has to give. */}
        <View style={styles.headerTitleBlock}>
          {/* The title deliberately carries NO `numberOfLines`. With it, Yoga
              sized this block to the date and ellipsized the title inside it —
              "Tod…" on the LG at 360dp, while the same 81dp block fit "Today"
              on the OnePlus, because the two render the face at slightly
              different widths. The screen's own name is the last thing that
              should be abbreviated; the date already has the constraint. */}
          {/* The cap is what keeps the block's `minWidth` floor honest — the
              floor is fixed dp and the text scales, so without it the title
              outgrows the floor and hard-clips. Both numbers live in
              `theme.headerTitle` and are pinned together by
              `header-title-fit.test.ts`. */}
          <Text
            style={styles.title}
            maxFontSizeMultiplier={headerTitle.maxFontScale}
            accessibilityRole="header"
          >
            {t('nav.today')}
          </Text>
          <Text style={styles.date} numberOfLines={1}>{todayLabel(todayKey, locale)}</Text>
        </View>
        <View style={styles.headerRight}>
          {streak > 0 ? (
            <Animated.View
              style={[styles.streakChip, streak >= 100 && styles.streakChipWide, streakPulse]}
              testID="streak-chip"
              // `accessible` is what makes the label count: without it the
              // View is not a focusable node and VoiceOver read the bare
              // digit inside it, not "12-day streak".
              accessible
              accessibilityRole="text"
              accessibilityLabel={t('today.streakA11y', { n: streak })}
            >
              {/* The brand ember, not a platform emoji that renders differently
                  on every OS (UX_AUDIT S18-17). Still, so a chip does not
                  flicker in the corner of every Today; tinted in the streak/
                  fasting hue because here it is a data mark, not the logo. */}
              <Flame size={18} flicker={false} tint={colors.habitFasting} />
              {/* Capped like the title: the header row has ~5dp to spare at
                  360dp, and an uncapped digit at a large text size pushed the
                  avatar off the edge. The chip's spoken label is unaffected. */}
              <Text style={styles.streakNum} maxFontSizeMultiplier={headerTitle.maxFontScale}>
                {streak}
              </Text>
            </Animated.View>
          ) : null}
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/history'); }}
            testID="open-history"
            style={styles.iconBtn}
            hitSlop={HEADER_ICON_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('nav.history')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onShare}
            testID="share-progress"
            style={styles.iconBtn}
            hitSlop={HEADER_ICON_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('today.shareA11y')}
          >
            <Ionicons name="share-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          {/* UX_AUDIT F6. The hero right below this reads `0 / 2,323 kcal` over
              `maintenance 2,723` and the app defined neither word anywhere.
              Same icon, same place, same sheet as the Train tab's "?" — one
              affordance across three tabs rather than a third way to explain
              something. */}
          <TouchableOpacity
            onPress={() => { haptics.tap(); setGlossaryOpen(true); }}
            testID="today-glossary-open"
            style={styles.iconBtn}
            hitSlop={HEADER_ICON_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('numbers.glossaryOpen')}
          >
            <Ionicons name="help-circle-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <HeaderAvatar />
        </View>
      </View>

      <NumbersGlossary visible={glossaryOpen} onClose={() => setGlossaryOpen(false)} />

      {/* One sheet, three jobs, and the row's own value picks which — tapping
          a number edits the thing that number describes.

          Running: correct the start, the only part of a fast in progress that
          can be wrong yet. A fast that ended today: edit or delete THAT, which
          is the case a user reaches by logging it slightly wrong. Neither:
          log one the timer never saw. Before this, a tap always meant "add",
          so the only way to fix a fast logged from Today was to find it in
          History — and the row gave no sign it existed to be fixed. */}
      <FastSheet
        visible={fastSheetOpen}
        mode={fastStartedAt ? 'running' : editableFast ? 'edit' : 'add'}
        editing={fastStartedAt ? runningFast : editableFast}
        fasts={nearbyFasts}
        onSave={async (startedAt, endedAt) => {
          // `startFast` REWRITES `fastStartedAt`, which is what correcting a
          // running fast is — the live fast is a scalar on the profile, not a
          // document, so there is nothing else to update.
          if (fastStartedAt) await startFast(startedAt);
          else if (editableFast?.id) await updateFast(editableFast.id, startedAt, endedAt);
          else await addFast(startedAt, endedAt);
        }}
        onDelete={
          !fastStartedAt && editableFast?.id
            ? () => {
                confirm({
                  title: t('fast.deleteTitle'),
                  body: t('fast.deleteBody'),
                  confirmText: t('common.remove'),
                  destructive: true,
                  onConfirm: () => {
                    deleteFast(editableFast.id as string).catch((e) => {
                      haptics.warning();
                      captureError(e, { where: 'today.deleteFast' });
                    });
                    setFastSheetOpen(false);
                  },
                });
              }
            : undefined
        }
        onClose={() => setFastSheetOpen(false)}
      />

      {/* Off-screen capture target for the share card (native share only). */}
      <View style={[styles.shareCapture, { pointerEvents: 'none' }]}>
        <View ref={shareRef} collapsable={false}>
          <ShareCard stats={shareStats} />
        </View>
      </View>

      {/* A cold cache paints the hero's empty tracks where the hero will be,
          rather than a spinner in the middle of nothing — the screen keeps its
          shape, and the first real frame fills it instead of replacing it. */}
      {loading ? (
        <View style={styles.skeletonBody}>
          <HeroRingsSkeleton />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.error}>{t('today.loadErr')}</Text>
              <TouchableOpacity
                onPress={onRetry}
                style={styles.retryBtn}
                hitSlop={ICON_SLOP}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* A state readout, not a Nudge — above the banners that are, and
              never competing with them for the one-at-a-time slot. */}
          <OfflineBanner />

          {/* At most ONE Nudge, ever (UX_AUDIT §S14 TD1). `useTodayNudge` owns
              the priority; each card still owns whether it has anything to say,
              so a suppressed one renders nothing rather than an empty frame. */}
          <UpdateBanner suppressed={nudge !== 'update'} />

          <Animated.View entering={enterUp(0)}>
            <HeroRings
              calConsumed={summary.totalCalories}
              calTarget={targets.calorieTarget || 0}
              protConsumed={summary.totalProtein}
              protTarget={targets.proteinTarget || 0}
              carbs={summary.totalCarbs}
              fat={summary.totalFat}
              maintenance={maintenanceView(targets.tdee, summary.totalCalories)}
              progress={measurement}
            />
          </Animated.View>

          {/* Below the hero on purpose. It is not in the Nudge queue, so
              placing it above would let a milestone visually outrank an update
              banner without ever having been ranked against one — the exact
              outcome `useTodayNudge`'s ordering exists to prevent. Here it
              reads as what it is: your numbers, then what they added up to. */}
          <MilestoneNote
            keys={todaysMilestones}
            dayKey={todayKey}
            onOpen={() => router.push('/milestones' as Href)}
          />

          <RecalibrationCard suppressed={nudge !== 'recalibration'} />

          <Animated.View entering={enterUp(1)}>
            <DailyMetrics
              water={water}
              sleep={sleep}
              activity={activity}
              fastStartedAt={fastStartedAt}
              onEditFast={() => setFastSheetOpen(true)}
              fastedTodayHours={fastedTodayHours}
              onAddWater={setWater}
              onSetSleep={setSleep}
              onStartFast={startFast}
              onBreakFast={onBreakFast}
            />
          </Animated.View>

          <Animated.Text
            style={styles.sectionTitle}
            entering={enterUp(2)}
            accessibilityRole="header"
          >
            {t('today.entries')}
          </Animated.Text>
          {todayLogs.length === 0 ? (
            <Animated.View style={styles.empty} entering={enterUp(3)}>
              <Text style={styles.emptyText}>{t('today.emptyTitle')}</Text>
              {/* "your first meal" is day-1 copy; said every empty morning to
                  someone with weeks of history, it reads as the app forgetting
                  them. */}
              <Text style={styles.emptyHint}>
                {t(hasPriorLogs ? 'today.emptyHintReturning' : 'today.emptyHint')}
              </Text>
              {/* Only when there is something to copy: on day 1 — the first
                  screen every new user sees — it used to buzz success and do
                  nothing. */}
              {yesterdayCount > 0 ? (
              <PressScale
                style={[styles.repeatBtn, repeating && styles.repeatBtnDisabled]}
                onPress={onRepeatYesterday}
                disabled={repeating}
                hitSlop={ICON_SLOP}
                accessibilityRole="button"
                accessibilityState={{ disabled: repeating, busy: repeating }}
                testID="repeat-yesterday"
              >
                <Ionicons name="refresh" size={15} color={colors.ink} />
                <Text style={styles.repeatText}>
                  {repeating ? t('common.saving') : t('today.repeatYesterday')}
                </Text>
              </PressScale>
              ) : null}
            </Animated.View>
          ) : (
            <>
              {/* "Repeat yesterday" used to exist only on an EMPTY day, so the
                  person who eats the same breakfast every morning lost it the
                  moment they logged anything. One chip per meal yesterday had
                  and today has not — copied with a receipt and an Undo. Above
                  the list, not under it: at the foot of a long day it was the
                  one thing nobody scrolled to. */}
              {copySlots.length > 0 ? (
                <View style={styles.copyRow} testID="copy-from-yesterday">
                  <Text style={styles.copyLabel}>{t('today.copyFromYesterday')}</Text>
                  <View style={styles.copyChips}>
                    {copySlots.map((slot) => (
                      <PressScale
                        key={slot}
                        style={[styles.copyChip, repeating && styles.repeatBtnDisabled]}
                        onPress={() => onCopySlot(slot)}
                        disabled={repeating}
                        hitSlop={ICON_SLOP}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: repeating }}
                        accessibilityLabel={t('today.copySlotA11y', { slot: t(SLOT_LABEL[slot]) })}
                        accessibilityHint={slot === 'other' ? t('today.copyOtherHint') : undefined}
                        testID={`copy-slot-${slot}`}
                      >
                        <Ionicons name="refresh" size={14} color={colors.ink} />
                        <Text style={styles.copyChipText}>{t(SLOT_LABEL[slot])}</Text>
                      </PressScale>
                    ))}
                  </View>
                </View>
              ) : null}
              <MealEntries
                logs={todayLogs}
                onPress={openEdit}
                onSavePreset={savePresetFromLog}
                onDelete={deleteFromList}
              />
            </>
          )}
          {/* Clears the + button for the SCROLLING case (a populated list).
              The empty state handles itself — see `styles.empty`. */}
          <View style={{ height: FAB_BAND }} />
        </ScrollView>
      )}

      <EntrySheet
        visible={sheetOpen}
        editing={editing}
        onSave={onSave}
        onSaveMany={onSaveMany}
        onDelete={editing ? onDelete : undefined}
        // Undo is offered here, so the sheet's delete fires at once (S18-6).
        deleteUndoable
        onClose={closeSheet}
        presets={presets}
        recentEntries={recentEntries}
        onSavePreset={addPreset}
        onDeletePreset={deletePreset}
        onHideRecent={hideRecent}
        customFoods={customFoods}
        onSaveCustomFood={addCustomFood}
        onDeleteCustomFood={deleteCustomFood}
        unitSystem={unitSystem}
        initialPrefill={sheetPrefill}
      />
    </SafeAreaView>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    skeletonBody: { paddingHorizontal: space.xl },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.sm,
    },
    title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    date: { fontSize: font.body, color: colors.muted, marginTop: 2 },
    // paddingBottom is load-bearing, not cosmetic: without it the LAST diary
    // row ends flush with the tab bar and is clipped by the screen edge — the
    // newest entry, which is the one a user most wants to tap. Measured
    // 2026-08-18 from a Maestro hierarchy dump on the iPhone 17 simulator: the
    // row's bounds were [24,813][378,878] against an 874pt screen, so its
    // centre fell on the bar and the tap that should open the editor did
    // nothing at all. Every other tab already pads (body.tsx uses `padding`).
    // `flexGrow: 1` is what makes the empty-state fix below deterministic:
    // with it, short content still fills the viewport, so `styles.empty` can
    // claim the leftover height and centre itself inside a region that
    // excludes the + button's band. Without it that block simply sits wherever
    // the content above happens to end — which at 360x720dp is directly under
    // the FAB (UX_AUDIT F5).
    body: { flexGrow: 1, paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
    error: { color: colors.danger, fontSize: font.small, flex: 1 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    // 44pt tall (iOS); `ICON_SLOP` takes the hit area to 48dp (Android).
    retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center' },
    retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
    // UX_AUDIT F5: the orange + button was drawn straight over "Repeat
    // yesterday", which rendered as `Repe(+)sterday` on a 360x720dp screen —
    // and the empty state is the one screen every new user sees first.
    //
    // The 96px tail spacer below the list only ever helped the SCROLLING case.
    // On a first run the content is shorter than the viewport, so nothing
    // scrolls and the spacer sits below the button instead of lifting it.
    //
    // `flex: 1` (against the container's `flexGrow: 1`) makes this block take
    // all remaining height and centre its contents in it; `paddingBottom`
    // reserves the FAB's band out of that centring, so the CTA is pushed above
    // the button rather than into it. Deterministic at any screen height,
    // where "add some padding" is a guess that holds at one.
    empty: {
      // NOT `flex: 1`. In RN that is `flexBasis: 0`, so the block contributes
      // nothing to the content height and takes only what is left over — and
      // when the hero and the metrics card already fill the viewport there is
      // nothing left, so it collapses and the CTA falls off the bottom.
      // Measured on the device, which is the only place it shows.
      // Grow into spare room, never shrink below the content.
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: space.xl,
      paddingBottom: FAB_BAND,
      gap: space.xs,
    },
    emptyText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
    emptyHint: { fontSize: font.small, color: colors.faint },
    // The header row overflowed and the overflow fell off the right edge,
    // taking most of the avatar with it (measured on a OnePlus 8T, 360dp:
    // 1,200px of content in 1,080px). `space-between` distributes free space
    // but does nothing when there is none — with no child allowed to shrink,
    // the last one is simply clipped.
    //
    // So exactly one child may shrink and it is this one: a shortened date is
    // recoverable, a clipped tap target is not.
    //
    // **`minWidth` is explicit and is the actual fix.** The tempting reasoning
    // is that a flex item cannot shrink below its min-content width, so the
    // word "Today" is its own floor. That is WEB flexbox (`min-width: auto`).
    // **Yoga does not implement it** — a React Native flex item shrinks below
    // its content freely — so relying on it produced three wrong fixes in a
    // row: the block took the DATE's width and the title rendered "Tod…", then
    // hard-clipped to "Toda" once the ellipsis was removed.
    //
    // The number is measured, not guessed. Ink extents off a device screenshot
    // where the title rendered intact: "Today" occupies **86.7dp**, and the
    // block was handing it 80.7dp — the width of "Fri, Sep 4". 96dp clears the
    // title with room for a heavier face, and the row still fits: 96 + 203
    // (streak + 3 icons + avatar + gaps) + 48 (padding) = 347dp of 360dp —
    // 355dp since 2026-10-04, when the icons became 38dp targets (`iconBtn`).
    //
    // `flexShrink` stays as the safety net for a locale wider than this one,
    // but it can no longer eat the title.
    // **The floor alone was not enough, and the gap was an accessibility one.**
    // It is fixed dp; the text scales with the OS setting, so at
    // `fontScale >= 96/87.15 = 1.102` the title outgrew the floor and — with no
    // `numberOfLines`, deliberately — HARD-CLIPPED. Reproduced on the LG at
    // `font_scale 1.15` on 2026-09-04: block pinned at 96dp, header read
    // "Toda". Two notches of iOS *Larger Text* reaches it. The other half of
    // the fix is `maxFontSizeMultiplier` on the title above; see
    // `theme.headerTitle` for the measurement both numbers come from.
    headerTitleBlock: { flexShrink: 1, minWidth: headerTitle.minWidth },
    // `gap` is xs, not md, because the icon buttons now carry their own 8dp of
    // side padding (`iconBtn`): visually the icons sit 12dp from the streak
    // chip and the avatar as before, and 16dp from each other.
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 },
    // The header icons were 22dp glyphs with 10dp of slop — a 42dp target,
    // under both platforms' floor. 44 tall is iOS's; `ICON_SLOP` reaches
    // Android's 48. WIDTH is 38, not 44, and that is the header's budget, not
    // an oversight: the row measured 347 of 360dp before this (see
    // `headerTitleBlock`), these three add 8dp net, and 44 would overflow it
    // by 5dp and clip the avatar again. Horizontal slop cannot make up the
    // rest without overlapping the neighbouring icon's target.
    iconBtn: { minWidth: 38, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    shareCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
    streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    streakNum: { fontSize: font.small, fontWeight: '800', color: colors.ink },
    // A third digit costs ~8dp the header does not have at 360dp; the chip's
    // own padding and icon gap give it back.
    streakChipWide: { paddingHorizontal: 4, gap: 1 },
    // minHeight 40 + `ICON_SLOP` = a 48dp target with the pill barely taller
    // than it was (~34dp of padding and text).
    repeatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, marginTop: space.sm, borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 40 },
    repeatBtnDisabled: { opacity: 0.5 },
    repeatText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    copyRow: { marginBottom: space.md, gap: space.xs },
    copyLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    copyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    copyChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.inputBg },
    copyChipText: { fontSize: font.small, fontWeight: '700', color: colors.ink, textTransform: 'capitalize' },
  });
}
