import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureAndShare } from '@/lib/shareCapture';
import type { DailyLog, LogEntry } from '@macrolog/core';
import { maintenanceView } from '@macrolog/core';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { EntrySheet } from '@/components/EntrySheet';
import { HeroRings } from '@/components/HeroRings';
import { MealEntries } from '@/components/MealEntries';
import { OfflineBanner } from '@/components/OfflineBanner';
import { track } from '@/lib/analytics';
import { RecalibrationCard } from '@/components/RecalibrationCard';
import { ShareCard } from '@/components/ShareCard';
import { UpdateBanner } from '@/components/UpdateBanner';
import { WhatsNewBanner } from '@/components/WhatsNewBanner';
import { type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useFastActivity } from '@/hooks/useFastActivity';
import { useReminderSync } from '@/hooks/useReminderSync';
import { performQuickAdd } from '@/lib/quick-add';
import { useToday } from '@/hooks/useToday';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { enterUp, PressScale, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';
import { formatDate } from '@/lib/date-format';

/** Streak length below which a streak extension is too early to read as
 *  "this app is working for me" — see reviewPrompt.ts for the full policy. */
const MIN_STREAK_FOR_REVIEW = 3;

function todayLabel(locale: Locale): string {
  return formatDate(new Date(), locale, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function Today() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
    streak,
    repeatYesterday,
    shareStats,
  } = useToday();
  const [sheetOpen, setSheetOpen] = useState(false);
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
      Alert.alert(t('today.savePresetTitle'), t('today.savePresetBody', { name }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('entry.savePresetShort'),
          onPress: () => {
            void addPreset({
              name,
              calories: log.calories,
              protein: log.protein ?? 0,
              carbs: log.carbs ?? 0,
              fat: log.fat ?? 0,
            });
            haptics.success();
          },
        },
      ]);
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
    setSheetOpen(false);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('nav.today')}</Text>
          <Text style={styles.date}>{todayLabel(locale)}</Text>
        </View>
        <View style={styles.headerRight}>
          {streak > 0 ? (
            <Animated.View style={[styles.streakChip, streakPulse]} testID="streak-chip">
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakNum}>{streak}</Text>
            </Animated.View>
          ) : null}
          <TouchableOpacity
            onPress={() => { haptics.tap(); router.push('/history'); }}
            testID="open-history"
            hitSlop={10}
            accessibilityLabel={t('nav.history')}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onShare} testID="share-progress" hitSlop={10}>
            <Ionicons name="share-outline" size={22} color={colors.muted} />
          </TouchableOpacity>
          <HeaderAvatar />
        </View>
      </View>

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

          {/* A state readout, not a Nudge — above the two banners that are, and
              never competing with them for the one-at-a-time slot. */}
          <OfflineBanner />

          <UpdateBanner />

          <WhatsNewBanner />

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

          <RecalibrationCard />

          <Animated.View entering={enterUp(1)}>
            <DailyMetrics
              water={water}
              sleep={sleep}
              activity={activity}
              fastStartedAt={fastStartedAt}
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
          <View style={{ height: 96 }} />
        </ScrollView>
      )}

      <EntrySheet
        visible={sheetOpen}
        editing={editing}
        onSave={onSave}
        onDelete={editing ? onDelete : undefined}
        onClose={() => setSheetOpen(false)}
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
    body: { paddingHorizontal: space.xl, gap: space.lg },
    error: { color: colors.danger, fontSize: font.small },
    sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
    empty: { alignItems: 'center', paddingVertical: space.xl, gap: space.xs },
    emptyText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
    emptyHint: { fontSize: font.small, color: colors.faint },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    shareCapture: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
    streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    streakFlame: { fontSize: font.small },
    streakNum: { fontSize: font.small, fontWeight: '800', color: colors.ink },
    repeatBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm, borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
    repeatBtnDisabled: { opacity: 0.5 },
    repeatText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  });
}
