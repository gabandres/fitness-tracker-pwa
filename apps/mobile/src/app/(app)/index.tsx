import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureAndShare } from '@/lib/shareCapture';
import type { DailyLog, LogEntry } from '@macrolog/core';
import { fastLengthHours, maintenanceView } from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { NumbersGlossary } from '@/components/NumbersGlossary';
import { EntrySheet } from '@/components/EntrySheet';
import { FastSheet } from '@/components/FastSheet';
import { HeroRings } from '@/components/HeroRings';
import { MealEntries } from '@/components/MealEntries';
import { MilestoneNote } from '@/components/MilestoneNote';
import { OfflineBanner } from '@/components/OfflineBanner';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth';
import { RecalibrationCard } from '@/components/RecalibrationCard';
import { ShareCard } from '@/components/ShareCard';
import { UpdateBanner } from '@/components/UpdateBanner';
import { WhatsNewBanner } from '@/components/WhatsNewBanner';
import { type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { releaseTour } from '@/lib/tour';
import { useDayFasts } from '@/hooks/useDayFasts';
import { useFastActivity } from '@/hooks/useFastActivity';
import { useReminderSync } from '@/hooks/useReminderSync';
import { performQuickAdd } from '@/lib/quick-add';
import { useMilestones } from '@/hooks/useMilestones';
import { useToday } from '@/hooks/useToday';
import { useTodayNudge } from '@/hooks/useTodayNudge';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { enterUp, PressScale, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { FAB_BAND, font, radius, space, type } from '@/theme';
import { formatDate } from '@/lib/date-format';

/** Streak length below which a streak extension is too early to read as
 *  "this app is working for me" — see reviewPrompt.ts for the full policy. */
/** Vertical band at the bottom of Today that the raised + button occupies —
 *  the FAB itself plus the tab bar it sits above. Nothing tappable may be laid
 *  out inside it. Was a bare `96` in one place and absent where it mattered
 *  most (UX_AUDIT F5). */
// Was defined here, and that is exactly why the other three tabs never got
// it (#96). It now lives in `@/theme` and is imported.

const MIN_STREAK_FOR_REVIEW = 3;

function todayLabel(locale: Locale): string {
  return formatDate(new Date(), locale, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function Today() {
  const t = useT();
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
    boundary,
    todayKey,
    streak,
    repeatYesterday,
    shareStats,
    hasWeighIn,
    hasPhotoScan,
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
   * Long-press a logged entry to promote it to a quick-add preset.
   *
   * Confirms first, because a preset is not a private note: slot 1 is what the
   * home-screen widget button and the Quick Settings tile fire, so creating one
   * silently would change what a blind tap on another surface logs.
   */
  const savePresetFromLog = useCallback(
    (log: DailyLog) => {
      const name = log.mealLabel?.trim();
      if (!name) return;
      haptics.tap();
      confirm({
        title: t('today.savePresetTitle'),
        body: t('today.savePresetBody', { name }),
        confirmText: t('entry.savePresetShort'),
        onConfirm: () => {
          void addPreset({
            name,
            calories: log.calories,
            protein: log.protein ?? 0,
            carbs: log.carbs ?? 0,
            fat: log.fat ?? 0,
          });
          haptics.success();
        },
      });
    },
    [addPreset, t],
  );

  // The tab bar's Log button navigates here with a fresh `openAdd` nonce —
  // each new value opens the add sheet (see AppTabBar in the tab layout).
  const { openAdd: openAddParam, quickAddSlot: quickAddSlotParam } = useLocalSearchParams<{
    openAdd?: string;
    quickAddSlot?: string;
  }>();
  useEffect(() => {
    if (!openAddParam) return;
    setEditing(null);
    setSheetOpen(true);
  }, [openAddParam]);

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
    void performQuickAdd(slot);
  }, [quickAddSlotParam]);

  // Celebration: the flame chip bounces when the streak extends mid-session
  // (null-first ref so it doesn't fire on mount).
  const [streakPulse, triggerStreakPulse] = usePulse(1.3);
  const prevStreak = useRef<number | null>(null);
  useEffect(() => {
    if (prevStreak.current !== null && streak > prevStreak.current) {
      haptics.tap();
      triggerStreakPulse();
      // Extending a streak is the other reliable "this is working" beat
      // (the first is finishing a workout). Held back until the streak is
      // long enough to mean something — a day-2 user has no opinion yet.
      if (streak >= MIN_STREAK_FOR_REVIEW) void recordPositiveMoment();
    }
    prevStreak.current = streak;
  }, [streak, triggerStreakPulse]);

  async function onShare() {
    haptics.tap();
    try {
      await captureAndShare(shareRef, t('today.shareCard'));
    } catch {
      /* capture/share failed or user dismissed — no-op */
    }
  }

  async function onRepeatYesterday() {
    if (repeating) return;
    haptics.tap();
    setRepeating(true);
    try {
      await repeatYesterday();
      haptics.success();
    } finally {
      setRepeating(false);
    }
  }
  const [editing, setEditing] = useState<DailyLog | null>(null);

  function openEdit(log: DailyLog) {
    setEditing(log);
    setSheetOpen(true);
  }
  async function onSave(entry: LogEntry) {
    if (editing?.id) await updateEntry(editing.id, entry);
    else await addEntry(entry);
    haptics.success();
  }
  async function onDelete() {
    if (editing?.id) await deleteEntry(editing.id);
    haptics.success();
    closeSheet();
  }
  /** Every way the add sheet closes goes through here: the guided tour is
   *  held while onboarding's first-log sheet is up, and this is its release. */
  function closeSheet() {
    setSheetOpen(false);
    releaseTour();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        {/* Shrinkable, and the ONLY shrinkable thing in this row — see
            `headerTitleBlock`. The date is what makes the block wide (448px of
            a 1,080px screen on a OnePlus 8T), so it is what has to give. */}
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>{t('nav.today')}</Text>
          <Text style={styles.date} numberOfLines={1}>{todayLabel(locale)}</Text>
        </View>
        <View style={styles.headerRight}>
          {streak > 0 ? (
            <Animated.View
              style={[styles.streakChip, streakPulse]}
              testID="streak-chip"
              accessibilityRole="text"
              accessibilityLabel={t('today.streakA11y', { n: streak })}
            >
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakNum}>{streak}</Text>
            </Animated.View>
          ) : null}
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/history'); }}
            testID="open-history"
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('nav.history')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onShare}
            testID="share-progress"
            hitSlop={10}
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
            hitSlop={10}
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
                    void deleteFast(editableFast.id as string);
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

      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{t('today.loadErr')}</Text> : null}

          {/* A state readout, not a Nudge — above the banners that are, and
              never competing with them for the one-at-a-time slot. */}
          <OfflineBanner />

          {/* At most ONE Nudge, ever (UX_AUDIT §S14 TD1). `useTodayNudge` owns
              the priority; each card still owns whether it has anything to say,
              so a suppressed one renders nothing rather than an empty frame. */}
          <UpdateBanner suppressed={nudge !== 'update'} />

          <WhatsNewBanner suppressed={nudge !== 'whatsNew'} />

          <Animated.View entering={enterUp(0)}>
            <HeroRings
              calConsumed={summary.totalCalories}
              calTarget={targets.calorieTarget || 0}
              protConsumed={summary.totalProtein}
              protTarget={targets.proteinTarget || 0}
              carbs={summary.totalCarbs}
              fat={summary.totalFat}
              maintenance={maintenanceView(targets.tdee, summary.totalCalories)}
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
              onBreakFast={breakFast}
            />
          </Animated.View>

          <Animated.Text style={styles.sectionTitle} entering={enterUp(2)}>
            {t('today.entries')}
          </Animated.Text>
          {todayLogs.length === 0 ? (
            <Animated.View style={styles.empty} entering={enterUp(3)}>
              <Text style={styles.emptyText}>{t('today.emptyTitle')}</Text>
              <Text style={styles.emptyHint}>{t('today.emptyHint')}</Text>
              <PressScale
                style={[styles.repeatBtn, repeating && styles.repeatBtnDisabled]}
                onPress={onRepeatYesterday}
                disabled={repeating}
                testID="repeat-yesterday"
              >
                <Ionicons name="refresh" size={15} color={colors.ink} />
                <Text style={styles.repeatText}>
                  {repeating ? t('common.saving') : t('today.repeatYesterday')}
                </Text>
              </PressScale>
            </Animated.View>
          ) : (
            <MealEntries logs={todayLogs} onPress={openEdit} onSavePreset={savePresetFromLog} />
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
        onDelete={editing ? onDelete : undefined}
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
      />
    </SafeAreaView>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    error: { color: colors.danger, fontSize: font.small },
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
    // So exactly one child shrinks and it is this one, because a truncated
    // date is recoverable (the screen is titled "Today" and the date appears
    // again in the diary) and a truncated tap target is not. `minWidth: 0` is
    // required alongside `flexShrink`: without it a flex item will not shrink
    // below its content's intrinsic width and the whole thing is a no-op.
    //
    // It is not a narrow-screen edge case — es-PR's "viernes, 4 de septiembre"
    // is longer than "Friday, September 4", so the wider the locale the worse
    // it gets. A fixed width here would only move the failure.
    headerTitleBlock: { flexShrink: 1, minWidth: 0 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 0 },
    shareCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
    streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    streakFlame: { fontSize: font.small },
    streakNum: { fontSize: font.small, fontWeight: '800', color: colors.ink },
    repeatBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm, borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
    repeatBtnDisabled: { opacity: 0.5 },
    repeatText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  });
}
