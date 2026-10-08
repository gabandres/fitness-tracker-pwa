import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams, useScrollToTop } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureAndShare } from '@/lib/shareCapture';
import type { DateKey, MealSlot } from '@macrolog/core';
import { addDays, calendarDateKey, fastLengthHours, maintenanceView, parseYmd } from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';
import { Flame } from '@/components/Flame';
import { useToast } from '@/components/Toast';
import { useAddReceipt } from '@/hooks/useAddReceipt';
import { useSetParamsWhenReady } from '@/lib/route-params';
import { DailyMetrics } from '@/components/DailyMetrics';
import { SkeletonMetricsCard, SkeletonRows } from '@/components/DaySkeleton';
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
import { capitalizeFirst } from '@/i18n/grammar';
import { remainingAfterAdd, willCelebrate } from '@/lib/celebration';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { releaseTour } from '@/lib/tour';
import { parseEntryPrefill } from '@/lib/entry-prefill';
import { refreshImports } from '@/lib/today-refresh';
import { warmFoodIndex } from '@/lib/foodSearch';
import { useDayFasts } from '@/hooks/useDayFasts';
import { useDiaryActions } from '@/hooks/useDiaryActions';
import { useFastActivity } from '@/hooks/useFastActivity';
import { useIntentInbox } from '@/hooks/useIntentInbox';
import { useReminderSync } from '@/hooks/useReminderSync';
import { performQuickAdd } from '@/lib/quick-add';
import { useMilestones } from '@/hooks/useMilestones';
import { useToday } from '@/hooks/useToday';
import { useTodayNudge } from '@/hooks/useTodayNudge';
import { useRecalibration } from '@/hooks/useRecalibration';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { enterUp, PressScale, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, headerTitle, radius, space, TARGET, type } from '@/theme';
import { formatDate } from '@/lib/date-format';
import { TAB_SCROLL_BAND } from '@/lib/glass';
import { useLargeTitle } from '@/lib/font-scale';

/** After Today mounts, before the food index is decoded in idle time — long
 *  enough for the first paint and the listeners' first answers to land. */
const FOOD_INDEX_WARM_DELAY_MS = 2500;

/** Streak length below which a streak extension is too early to read as
 *  "this app is working for me" — see reviewPrompt.ts for the full policy. */
const MIN_STREAK_FOR_REVIEW = 3;

/** Vertical-only slop that lifts a 40–44dp control to Android's 48dp target.
 *  Vertical only, because horizontally these controls have neighbours. */
const ICON_SLOP = { top: 4, bottom: 4 } as const;

/** The streak chip is 26dp tall (an 18dp flame, 3+3 padding, the border), so
 *  `ICON_SLOP` left it a ~34dp target (Today re-score 3, Accessibility 6).
 *  This lifts it to 44pt on iOS and 48dp on Android; the header row is 44 tall
 *  with nothing above or below the chip, so the slop overlaps nothing. */
const STREAK_SLOP = Platform.select({
  android: { top: 11, bottom: 11 },
  default: { top: 9, bottom: 9 },
});

/** The previous-day chevron beside the date (`prevDayBtn`): a 16dp glyph
 *  centred in a 24dp-wide box stretched to the ~20dp date line. Slop makes
 *  up the rest of the platform target in BOTH directions — it measured
 *  ~36x44 when the box was the bare glyph (Impeccable audit, S20). The
 *  vertical reach goes up over the title, which is not interactive; the
 *  horizontal reach goes left into the screen's margin and right over the
 *  start of the date, whose text does nothing on a tap. */
const PREV_DAY_W = 24;
const PREV_DAY_H = 20;
const PREV_DAY_SLOP = {
  top: Math.ceil((TARGET - PREV_DAY_H) * 0.6),
  bottom: Math.floor((TARGET - PREV_DAY_H) * 0.4),
  left: (TARGET - PREV_DAY_W) / 2,
  right: (TARGET - PREV_DAY_W) / 2,
};

/** Scroll distance over which the header's hairline fades in — the iOS
 *  scroll-edge cue that content is passing under a fixed bar. */
const HEADER_EDGE_FADE = 12;

/** The date line under the title grows with text size only this far — past
 *  it, it ellipsizes rather than pushing the header's controls off the row. */
const HEADER_DATE_MAX_SCALE = 1.35;

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

/** The History day route for the day before `dayKey` — the calendar icon's
 *  "Yesterday" shortcut. From the day KEY, so under a 01:00 boundary it is the
 *  day before the one the ring describes. Exported for test. */
export function yesterdayHref(dayKey: DateKey): Href {
  return `/history/${calendarDateKey(addDays(parseYmd(dayKey), -1))}` as Href;
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

/**
 * The cold-start placeholder: the hero's empty rings, the metrics card's
 * three rows and two diary rows, in the shapes they will fill (review V5).
 * It used to be the hero alone, so the first real frame still pushed
 * everything below it into place. Hidden from the reader as one busy node —
 * the hero skeleton carries the "Loading today" label.
 */
function TodaySkeleton({ inline = false }: { inline?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={inline ? styles.skeletonInline : styles.skeletonBody}
      testID="today-skeleton"
      // Under a load error it is a placeholder for content that is NOT
      // coming, so it does not announce itself as loading.
      importantForAccessibility={inline ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={inline}
    >
      <HeroRingsSkeleton />
      <SkeletonMetricsCard />
      <SkeletonRows count={2} />
    </View>
  );
}

function TodayScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const toast = useToast();
  // Water and sleep are fire-and-forget taps; a refused write (rules, a bad
  // value) said nothing and surfaced as an unhandled rejection (Body review 12).
  function metricFailed(e: unknown, where: string) {
    haptics.warning();
    toast.show(t('metrics.saveFailed'));
    captureError(e, { where });
  }
  const receipt = useAddReceipt();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  // At accessibility sizes the header wraps: the title takes the first line
  // at up to 2.1x, the icons the next (`lib/font-scale.ts`, S21).
  const largeTitle = useLargeTitle();
  const { user } = useAuth();
  const {
    loading,
    error,
    hasData,
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
    measurement,
  } = useToday();
  // The single Nudge slot this screen is allowed to fill. One digest feeds both
  // the slot and the card (`RecalibrationCard`).
  const recalibration = useRecalibration();
  const nudge = useTodayNudge(recalibration.digest.shouldSurface);
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

  // Every diary action — the sheet's state, save/edit/delete with their
  // receipts and Undo, Save to Quick add — is shared with the History day
  // (review U2). Today adds the two things only it can know: what is left of
  // the day after an add, and whether the add is a moment.
  const diary = useDiaryActions({
    where: 'today',
    dateKey: todayKey,
    dayLogs: todayLogs,
    presets,
    addEntry,
    updateEntry,
    deleteEntry,
    deletePreset,
    remainingAfter: (entry) =>
      remainingAfterAdd({
        kcal: entry.calories,
        timestamp: entry.timestamp,
        todayKey,
        boundary,
        consumed: summary.totalCalories,
        target: targets.calorieTarget,
      }),
    celebrates: (entry) =>
      willCelebrate({
        entry,
        todayKey,
        boundary,
        todayFoodRows: todayLogs.length,
        proteinSoFar: summary.totalProtein,
        proteinTarget: targets.proteinTarget,
      }),
    // The guided tour is held while onboarding's first-log sheet is up, and
    // every close of the sheet is its release.
    onClose: releaseTour,
  });

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
  // Built once per change of its two inputs rather than inline in the hero's
  // props on every render (review, Performance).
  const maintenance = useMemo(
    () => maintenanceView(targets.tdee, summary.totalCalories),
    [targets.tdee, summary.totalCalories],
  );
  const [repeating, setRepeating] = useState(false);
  const shareRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Re-tapping the focused Today tab scrolls back to the top — the platform
  // convention on both OSes (review A9). The tab bar announces it.
  useScrollToTop(scrollRef);
  // The header is fixed and drawn here, not a native large-title bar, so the
  // scroll-edge cue is ours to give (Today re-score 3, Platform 11): a
  // hairline that fades in once the diary passes under the header, on the UI
  // thread — the scroll never round-trips through JS.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const headerEdge = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HEADER_EDGE_FADE], [0, 1], Extrapolation.CLAMP),
  }));

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

  // The diary's latest actions, for callbacks registered once (the sheet
  // opener) or fired from a param effect. Written in an effect — a render-time
  // ref write made the React Compiler skip this whole screen (review #1).
  const diaryRef = useRef(diary);
  useEffect(() => {
    diaryRef.current = diary;
  });

  // The tab bar's Log button navigates here with a fresh `openAdd` nonce —
  // each new value opens the add sheet (see AppTabBar in the tab layout).
  const {
    openAdd: openAddParam,
    quickAddSlot: quickAddSlotParam,
    prefill: prefillParam,
    fast: fastParam,
  } = useLocalSearchParams<{
    openAdd?: string;
    quickAddSlot?: string;
    prefill?: string;
    fast?: string;
  }>();
  // Clearing a one-shot param waits for the root navigator: on a cold start
  // from the widget these effects run before it is ready (lib/route-params).
  const setParamsWhenReady = useSetParamsWhenReady();
  // A tap on the fasting Live Activity (`ignia://?fast=1`, FastActivityWidget):
  // open the fast sheet, where a running fast's start can be corrected — the
  // one thing the Lock Screen cannot do. The param is a constant, not a nonce,
  // so it is cleared once handled; otherwise a second tap would change nothing
  // and open nothing.
  useEffect(() => {
    if (!fastParam) return;
    setFastSheetOpen(true);
    setParamsWhenReady({ fast: undefined });
  }, [fastParam, setParamsWhenReady]);
  // A draft carried in beside the nonce — the scan screen's repeat suggestion
  // (ADR-0029, settled 2026-09-08). Parsed once per nonce; a bad param opens
  // the sheet empty rather than not at all.
  //
  // Cleared once handled, like `fast` above (Today re-score, bug 3): the nonce
  // stayed on the route, so Retry — which remounts this screen — and a
  // pull-to-refresh from the error state both popped the sheet open again.
  // The Log button mints a fresh nonce per tap, so clearing loses nothing.
  useEffect(() => {
    if (!openAddParam) return;
    diaryRef.current.openAdd(parseEntryPrefill(prefillParam));
    setParamsWhenReady({ openAdd: undefined, prefill: undefined });
  }, [openAddParam, prefillParam, setParamsWhenReady]);

  // The Quick Settings tile's FALLBACK path (ADR-0020). Its tap normally logs
  // without opening anything; when Android refuses the background service start
  // the tile opens the app with this param instead, so the tap still lands. Not
  // the promised experience — but a visible slower one beats a silent dead tile,
  // which is exactly how the Android widget stayed broken for a month.
  //
  // The param is cleared once handled (Today re-score, bug 2). The ref alone
  // guarded one MOUNT, but Retry remounts this screen with a new key while the
  // param is still on the route — so the remount logged the tile's food a
  // second time. Clearing it also means a later tile tap with the same slot
  // is a change of param, and lands, where the ref would have swallowed it.
  const quickAddDone = useRef<string | null>(null);
  useEffect(() => {
    if (!quickAddSlotParam) {
      quickAddDone.current = null;
      return;
    }
    if (quickAddDone.current === quickAddSlotParam) return;
    quickAddDone.current = quickAddSlotParam;
    setParamsWhenReady({ quickAddSlot: undefined });
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
  }, [quickAddSlotParam, setParamsWhenReady]);

  // Celebration: the flame chip bounces when the streak extends mid-session
  // (null-first ref so it doesn't fire on mount). The bounce is skipped under
  // reduce motion (`usePulse`); the haptic stays, and is the save's own when
  // the save caused the extension — `celebrateIfQuiet` (review #7).
  const [streakPulse, triggerStreakPulse] = usePulse(1.3);
  const prevStreak = useRef<number | null>(null);
  useEffect(() => {
    // Not while the feed is loading: `streak` is 0 until the logs land, so the
    // 0 → N step on every cold start read as an extension and fired the bounce,
    // the haptic and a review-prompt beat on mount.
    if (loading) return;
    if (prevStreak.current !== null && streak > prevStreak.current) {
      haptics.celebrateIfQuiet();
      triggerStreakPulse();
      // Extending a streak is the other reliable "this is working" beat
      // (the first is finishing a workout). Held back until the streak is
      // long enough to mean something — a day-2 user has no opinion yet.
      if (streak >= MIN_STREAK_FOR_REVIEW) void recordPositiveMoment();
    }
    prevStreak.current = streak;
  }, [streak, loading, triggerStreakPulse]);

  // The share card is mounted only while a share is being captured (review,
  // Performance): it was an off-screen tree re-rendered on every snapshot for
  // a button pressed a few times a month. One frame after mounting is enough
  // for the capture to see it laid out.
  const [sharing, setSharing] = useState(false);
  function onShare() {
    if (sharing) return;
    haptics.tap();
    setSharing(true);
  }
  useEffect(() => {
    if (!sharing) return;
    const id = requestAnimationFrame(() => {
      captureAndShare(shareRef, t('today.shareCard'))
        .catch(() => {
          /* capture/share failed or user dismissed — no-op */
        })
        .then(() => setSharing(false));
    });
    return () => cancelAnimationFrame(id);
  }, [sharing, t]);

  // Decode the bundled food index once Today has settled, in idle time. Left
  // to `FoodSearch`'s mount it landed in the add sheet's opening frames — the
  // first add of every session paid a 1.4 MB decode on the JS thread while the
  // sheet presented and the keyboard waited. Logging food is what this screen
  // is for, so the user who never searches is not the case to optimise.
  useEffect(() => {
    let cancelIdle: (() => void) | undefined;
    const delay = setTimeout(() => {
      const g = globalThis as {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (h: number) => void;
      };
      if (g.requestIdleCallback && g.cancelIdleCallback) {
        const h = g.requestIdleCallback(warmFoodIndex);
        cancelIdle = () => g.cancelIdleCallback?.(h);
      } else warmFoodIndex();
    }, FOOD_INDEX_WARM_DELAY_MS);
    return () => {
      clearTimeout(delay);
      cancelIdle?.();
    };
  }, []);

  // Pull to refresh runs the Health / Oura imports — the only part of Today
  // that is not already live (`lib/today-refresh.ts`, review U7). From the
  // error state it is also Retry: a fresh mount re-opens every listener.
  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    haptics.selection();
    setRefreshing(true);
    // `refreshImports` settles every branch and never rejects; no try/finally
    // (the React Compiler cannot compile one — see `onCopySlot`).
    await refreshImports(user?.uid);
    setRefreshing(false);
    if (error) onRetry();
  }

  // Slots copied today, keyed to the day. A copied chip must go even when the
  // copy does not land in its slot: unslotted ("other") rows have no stored
  // slot and file by the clock, so the "Other" chip never cleared on its own
  // and a second tap duplicated the copy.
  const [copied, setCopied] = useState<{ day: string; slots: MealSlot[] }>({ day: '', slots: [] });
  const copiedToday = copied.day === todayKey ? copied.slots : [];
  const copySlots = yesterdaySlots.filter((s) => !copiedToday.includes(s));
  /**
   * A copy that fails says so (review #2): it used to end in `finally` with
   * no `catch`, so a refused write cleared the busy state and nothing else —
   * no rows, no message, and an unhandled rejection.
   *
   * No `finally` here at all, deliberately: the React Compiler cannot lower a
   * `try` with a finalizer and skipped this ENTIRE screen for it (review #1).
   * The `catch` handles every rejection, so the line after it always runs.
   */
  function copyFailed(e: unknown, where: string) {
    haptics.warning();
    toast.show(t('today.copyFailed'));
    captureError(e, { where });
  }
  async function onCopySlot(slot: MealSlot) {
    if (repeating) return;
    // The press is acknowledged only if the copy is slow; a quick one is a
    // single success beat (review P6).
    haptics.tapThenOutcome();
    setRepeating(true);
    try {
      const ids = await repeatYesterday(slot);
      haptics.success();
      setCopied((c) => ({ day: todayKey, slots: [...(c.day === todayKey ? c.slots : []), slot] }));
      // Undo puts the chip back: hidden until tomorrow was a mis-tap's cost.
      receipt.showCopied(ids, () =>
        setCopied((c) => ({ ...c, slots: c.slots.filter((x) => x !== slot) })),
      );
    } catch (e) {
      copyFailed(e, 'today.copySlot');
    }
    setRepeating(false);
  }
  async function onRepeatYesterday() {
    if (repeating) return;
    haptics.tapThenOutcome();
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
    } catch (e) {
      copyFailed(e, 'today.repeatYesterday');
    }
    setRepeating(false);
  }

  /**
   * End the fast, then offer Undo — the button sits beside the water pills and
   * a mis-tap used to close a 16-hour fast for good (the only repair was
   * re-typing both instants in History).
   *
   * The start comes from the profile listener, so `breakFast` writes without
   * reading and the toast appears at once, offline too; a refused commit
   * still raises the failure toast (round-3 review B2).
   */
  function onBreakFast(endedAt?: Date) {
    return breakFast(endedAt)
      .then((fastReceipt) => {
        // Local-first since round 3: the receipt is back before the server
        // has it. A later refusal still says so.
        fastReceipt?.committed?.catch((e) => {
          haptics.warning();
          toast.show(t('metrics.fastEndFailed'));
          captureError(e, { where: 'today.breakFast.commit' });
        });
        toast.show(t('metrics.fastEnded'), {
          action: fastReceipt?.startedAt
            ? {
                label: t('common.undo'),
                onPress: () => {
                  undoBreakFast(fastReceipt).catch((e) => {
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

  /** One sheet, three jobs — see the FastSheet below. `startFast` REWRITES
   *  `fastStartedAt`, which is what correcting a running fast is: the live
   *  fast is a scalar on the profile, not a document. */
  async function onSaveFast(startedAt: Date, endedAt: Date) {
    if (fastStartedAt) await startFast(startedAt);
    else if (editableFast?.id) await updateFast(editableFast.id, startedAt, endedAt);
    else await addFast(startedAt, endedAt);
  }
  function onDeleteFast() {
    const id = editableFast?.id;
    if (!id) return;
    confirm({
      title: t('fast.deleteTitle'),
      body: t('fast.deleteBody'),
      confirmText: t('common.remove'),
      destructive: true,
      onConfirm: () => {
        deleteFast(id).catch((e) => {
          haptics.warning();
          captureError(e, { where: 'today.deleteFast' });
        });
        setFastSheetOpen(false);
      },
    });
  }

  // What the Lock Screen and Siri left for Today: the fasting Live Activity's
  // End, and the spoken Start fast / End fast / Log weight. Each runs the same
  // path a tap here does — `onBreakFast` (archive + Undo toast), `startFast`,
  // the fast sheet, Body's weigh-in sheet. Held until the profile has loaded,
  // or a Lock Screen End would be judged against "no fast running".
  useIntentInbox({
    ready: !loading,
    fastStartedAt,
    onEndFast: onBreakFast,
    // Caught here, like the Start button's (Today re-score 3, Accessibility
    // 9): a Siri or Lock Screen start that the write refused was swallowed by
    // the inbox's own catch, so the fast the user asked for silently never
    // began.
    onStartFast: (at) => startFast(at).catch((e) => metricFailed(e, 'today.intentStartFast')),
    onShowFast: () => setFastSheetOpen(true),
    onLogWeight: (value) =>
      router.navigate({
        pathname: '/body',
        params: { weigh: String(Date.now()), ...(value != null ? { weighValue: String(value) } : {}) },
      } as Href),
  });

  // A failed feed with nothing cached has no true numbers to draw: the hero
  // would say "0 kcal" of a target nobody loaded, and the diary would say the
  // day is empty. Skeleton plus the error instead (review #4).
  const blank = !!error && !hasData;
  // Light mode: the ember hue measured 2.85:1 on the chip's card; `warn` is
  // the same amber family at 4.5:1. Dark keeps the brighter ember (review A8).
  const flameTint = scheme === 'light' ? colors.warn : colors.habitFasting;

  const errorRow = error ? (
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
  ) : null;

  return (
    <SafeAreaView
      style={styles.screen}
      edges={['top']}
      // VoiceOver's Magic Tap (two-finger double-tap) runs the live toast's
      // action — "Undo" from anywhere, instead of a hunt for a button that is
      // timing out (review A6). Nothing else on Today claims the gesture.
      onMagicTap={() => {
        toast.act();
      }}
    >
      <View style={[styles.header, largeTitle.rowStyle]}>
        {/* Shrinkable, and the ONLY shrinkable thing in this row — see
            `headerTitleBlock`. The date is what makes the block wide (448px of
            a 1,080px screen on a OnePlus 8T), so it is what has to give. */}
        <View style={[styles.headerTitleBlock, largeTitle.titleStyle]}>
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
              `header-title-fit.test.ts`. At accessibility sizes the block
              takes the whole row instead and the cap rises to 2.1x
              (`useLargeTitle`), so the floor no longer binds. */}
          <Text
            style={styles.title}
            {...largeTitle.titleProps}
            accessibilityRole="header"
          >
            {t('nav.today')}
          </Text>
          {/* "‹ Sun, Oct 5": the step to the day before, where every diary
              puts it (Today re-score 3, Usability 1 — MyFitnessPal,
              Cronometer and MacroFactor all have it on the date). Yesterday
              was a long-press on the calendar icon, which Android gave no
              sign of. It opens the History day, whose own arrows carry on
              from there; there is no "next" on Today, which is the last day
              there is. */}
          <View style={styles.dateRow}>
            <TouchableOpacity
              onPress={() => {
                haptics.selection();
                router.push(yesterdayHref(todayKey));
              }}
              style={styles.prevDayBtn}
              hitSlop={PREV_DAY_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('history.prevDay')}
              testID="today-prev-day"
            >
              <Ionicons name="chevron-back" size={16} color={colors.muted} />
            </TouchableOpacity>
            {/* Ellipsizes rather than wraps, and stops growing at 1.35×: two
                lines of date would push the hero down for no information the
                title has not already given (review A1). */}
            <Text
              style={styles.date}
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={HEADER_DATE_MAX_SCALE}
            >
              {todayLabel(todayKey, locale)}
            </Text>
          </View>
        </View>
        <View style={[styles.headerRight, largeTitle.trailingStyle]}>
          {streak > 0 ? (
            <Animated.View style={streakPulse}>
              {/* A button now (review U4): the streak is a milestone in the
                  making, and the milestones screen is where it is explained.
                  It stays a compact chip — the header row has ~5dp to spare at
                  360dp — so "day streak" is spoken, not printed. */}
              <PressScale
                scaleTo={0.92}
                style={[styles.streakChip, streak >= 100 && styles.streakChipWide]}
                hitSlop={STREAK_SLOP}
                onPress={() => {
                  haptics.tap();
                  router.push('/milestones' as Href);
                }}
                testID="streak-chip"
                accessibilityRole="button"
                accessibilityLabel={t('today.streakA11y', { n: streak })}
                accessibilityHint={t('today.streakHint')}
                accessibilityShowsLargeContentViewer
                accessibilityLargeContentTitle={t('today.streakA11y', { n: streak })}
              >
                {/* The brand ember, not a platform emoji that renders differently
                    on every OS (UX_AUDIT S18-17). Still, so a chip does not
                    flicker in the corner of every Today; tinted in the streak/
                    fasting hue because here it is a data mark, not the logo. */}
                <Flame size={18} flicker={false} tint={flameTint} />
                {/* Capped like the title: the header row has ~5dp to spare at
                    360dp, and an uncapped digit at a large text size pushed the
                    avatar off the edge. The chip's spoken label is unaffected. */}
                <Text style={styles.streakNum} maxFontSizeMultiplier={headerTitle.maxFontScale}>
                  {streak}
                </Text>
              </PressScale>
            </Animated.View>
          ) : null}
          {/* The icons do not grow with Dynamic Type (the row has no room), so
              each offers iOS's large-content viewer instead — press and hold
              at an accessibility text size (review A2). Two icons, not three,
              since the re-score: Share moved onto the hero it shares, which
              is what let these reach a full 44pt (`iconBtn`).

              The calendar holds the "Yesterday" shortcut every diary has
              (Today re-score, Usability): a long-press opens the system menu
              on iOS (Yesterday · History), goes straight to yesterday on
              Android, and is a named action for a screen reader. It gives up
              the large-content viewer on iOS — both are a long-press, and the
              menu's own text already scales with Dynamic Type. */}
          <ContextMenu
            actions={[
              {
                key: 'yesterday',
                title: t('today.openYesterday'),
                icon: 'arrow.uturn.backward',
                onPress: () => router.push(yesterdayHref(todayKey)),
              },
              { key: 'history', title: t('nav.history'), icon: 'calendar', onPress: () => router.push('/history') },
            ]}
          >
            <TouchableOpacity
              onPress={() => { haptics.tap(); router.push('/history'); }}
              onLongPress={
                CONTEXT_MENUS
                  ? undefined
                  : () => {
                      haptics.tap();
                      router.push(yesterdayHref(todayKey));
                    }
              }
              testID="open-history"
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={t('nav.history')}
              accessibilityActions={[{ name: 'yesterday', label: t('today.openYesterdayA11y') }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'yesterday') router.push(yesterdayHref(todayKey));
              }}
              accessibilityShowsLargeContentViewer={!CONTEXT_MENUS}
              accessibilityLargeContentTitle={t('nav.history')}
            >
              <Ionicons name="calendar-outline" size={22} color={colors.muted} />
            </TouchableOpacity>
          </ContextMenu>
          {/* UX_AUDIT F6. The hero right below this reads `0 / 2,323 kcal` over
              `Maintenance 2,723` and the app defined neither word anywhere.
              Same icon, same place, same sheet as the Train tab's "?" — one
              affordance across three tabs rather than a third way to explain
              something. */}
          <TouchableOpacity
            onPress={() => { haptics.tap(); setGlossaryOpen(true); }}
            testID="today-glossary-open"
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('numbers.glossaryOpen')}
            accessibilityShowsLargeContentViewer
            accessibilityLargeContentTitle={t('numbers.glossaryOpen')}
          >
            <Ionicons name="help-circle-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <HeaderAvatar />
        </View>
        <Animated.View style={[styles.headerEdge, headerEdge]} />
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
        onSave={onSaveFast}
        onDelete={!fastStartedAt && editableFast?.id ? onDeleteFast : undefined}
        onClose={() => setFastSheetOpen(false)}
      />

      {/* Off-screen capture target for the share card (native share only),
          mounted only while a share is in flight. */}
      {sharing ? (
        <View style={[styles.shareCapture, { pointerEvents: 'none' }]}>
          <View ref={shareRef} collapsable={false}>
            <ShareCard stats={shareStats} />
          </View>
        </View>
      ) : null}

      {/* A cold cache paints the screen's shape where the content will be,
          rather than a spinner in the middle of nothing — the first real frame
          fills it instead of replacing it. A failed feed with nothing cached
          keeps the shape and says why above it. */}
      {loading ? (
        <TodaySkeleton />
      ) : blank ? (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        >
          {errorRow}
          <OfflineBanner />
          <TodaySkeleton inline />
        </ScrollView>
      ) : (
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        >
          {errorRow}

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
              maintenance={maintenance}
              progress={measurement}
              // The rings explain themselves on a tap, as Apple Fitness's
              // drill in (Today re-score) — the same sheet as the header "?".
              onPress={() => {
                haptics.tap();
                setGlossaryOpen(true);
              }}
              onShare={onShare}
              sharing={sharing}
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

          <RecalibrationCard recalibration={recalibration} suppressed={nudge !== 'recalibration'} />

          <Animated.View entering={enterUp(1)}>
            <DailyMetrics
              water={water}
              sleep={sleep}
              activity={activity}
              fastStartedAt={fastStartedAt}
              onEditFast={() => setFastSheetOpen(true)}
              fastedTodayHours={fastedTodayHours}
              onAddWater={(v) => void setWater(v).catch((e) => metricFailed(e, 'today.water'))}
              onSetSleep={(v) => void setSleep(v).catch((e) => metricFailed(e, 'today.sleep'))}
              // Caught like water and sleep (Today re-score, bug 5): a refused
              // write was an unhandled rejection with no word to the user.
              onStartFast={() => void startFast().catch((e) => metricFailed(e, 'today.startFast'))}
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
          {/* "Repeat yesterday" on an empty day, one chip per meal yesterday
              had and today has not once it has begun — copied with a receipt
              and an Undo. Above the list, not under it: at the foot of a long
              day it was the one thing nobody scrolled to. Only when there is
              something to copy: on day 1 it used to buzz success and do
              nothing. */}
          {todayLogs.length === 0 && yesterdayCount > 0 ? (
            <Animated.View entering={enterUp(3)}>
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
            </Animated.View>
          ) : null}
          {todayLogs.length > 0 && copySlots.length > 0 ? (
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
                    {/* Sentence case per locale, not `capitalize` (review #3). */}
                    <Text style={styles.copyChipText}>{capitalizeFirst(t(SLOT_LABEL[slot]), locale)}</Text>
                  </PressScale>
                ))}
              </View>
            </View>
          ) : null}
          {/* The four meals are always on screen, each with its own "+ Add"
              (review U3) — so an empty day is the diary waiting to be filled,
              where it used to be "No entries yet" and a hint pointing at the
              + button. */}
          <Animated.View entering={enterUp(todayLogs.length === 0 ? 4 : 3)}>
            <MealEntries
              logs={todayLogs}
              onPress={diary.openEdit}
              onSavePreset={diary.savePresetFromLog}
              onDelete={diary.deleteFromList}
              onAddToSlot={diary.openSlot}
              onMove={diary.moveToSlot}
            />
          </Animated.View>
          {/* Clears the + button at the foot of the list. */}
          <View style={{ height: TAB_SCROLL_BAND }} />
        </Animated.ScrollView>
      )}

      <EntrySheet
        visible={diary.sheetOpen}
        editing={diary.editing}
        onSave={diary.onSave}
        onSaveMany={diary.onSaveMany}
        onDelete={diary.editing ? diary.onDelete : undefined}
        // Undo is offered here, so the sheet's delete fires at once (S18-6).
        deleteUndoable
        onClose={diary.closeSheet}
        presets={presets}
        recentEntries={recentEntries}
        onSavePreset={addPreset}
        onDeletePreset={deletePreset}
        onHideRecent={hideRecent}
        customFoods={customFoods}
        onSaveCustomFood={addCustomFood}
        onDeleteCustomFood={deleteCustomFood}
        unitSystem={unitSystem}
        initialPrefill={diary.prefill}
      />
    </SafeAreaView>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    skeletonBody: { paddingHorizontal: space.xl, gap: space.lg },
    skeletonInline: { gap: space.lg },
    // The card and row placeholders themselves live in `DaySkeleton`, shared
    // with the History day (Today re-score 3, Visual 14).
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.sm,
    },
    // Pinned to the header's foot; its opacity follows the scroll (`headerEdge`).
    // The tab bar's own top rule, so the diary scrolls between two matching
    // edges.
    headerEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.line, pointerEvents: 'none' },
    title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    // `flexShrink` so the date ellipsizes beside the chevron instead of
    // pushing past the block's edge.
    date: { flexShrink: 1, fontSize: font.body, color: colors.muted },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
    prevDayBtn: { alignSelf: 'stretch', minWidth: PREV_DAY_W, minHeight: PREV_DAY_H, alignItems: 'center', justifyContent: 'center' },
    // paddingBottom is load-bearing, not cosmetic: without it the LAST diary
    // row ends flush with the tab bar and is clipped by the screen edge — the
    // newest entry, which is the one a user most wants to tap. Measured
    // 2026-08-18 from a Maestro hierarchy dump on the iPhone 17 simulator: the
    // row's bounds were [24,813][378,878] against an 874pt screen, so its
    // centre fell on the bar and the tap that should open the editor did
    // nothing at all. Every other tab already pads (body.tsx uses `padding`).
    // `flexGrow: 1` keeps short content filling the viewport, so pull to
    // refresh works on an empty day too. (It also served the old centred
    // empty state, UX_AUDIT F5 — that state is the four slot rows now, which
    // sit in the flow and clear the + button with the tail spacer.)
    body: { flexGrow: 1, paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
    error: { color: colors.danger, fontSize: font.small, flex: 1 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    // 44pt tall (iOS); `ICON_SLOP` takes the hit area to 48dp (Android).
    retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: TARGET, justifyContent: 'center' },
    retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
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
    // 355dp since 2026-10-04, when the icons became 38dp targets, and 325dp
    // since the re-score moved Share onto the hero and left two 44dp icons.
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
    // Android's 48. They were 38 WIDE while there were three of them (the row
    // had no more at 360dp); with Share moved onto the hero there are two, and
    // both are a full 44 square — 30dp under the row's budget (see
    // `headerTitleBlock`).
    // Since S21 a full platform target on its own box — 48dp square on
    // Android, where they were 44 wide with vertical-only slop. Two icons at
    // +4dp each still leave the row ~22dp under budget at 360dp.
    iconBtn: { minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' },
    shareCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
    streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    streakNum: { fontSize: font.small, fontWeight: '800', color: colors.ink },
    // A third digit costs ~8dp the header does not have at 360dp; the chip's
    // own padding and icon gap give it back.
    streakChipWide: { paddingHorizontal: 4, gap: 1 },
    // minHeight 40 + `ICON_SLOP` = a 48dp target with the pill barely taller
    // than it was (~34dp of padding and text).
    repeatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', gap: space.xs, borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 40 },
    repeatBtnDisabled: { opacity: 0.5 },
    repeatText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    copyRow: { marginBottom: space.md, gap: space.xs },
    copyLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    copyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    copyChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.inputBg },
    copyChipText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  });
}
