import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addDays,
  calendarDateKey,
  dailyTargets,
  type Fast,
  fastHoursParts,
  fastLengthHours,
  formatBodyWeight,
  dayKeyAt,
  parseYmd,
  summarizeDay,
} from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { SkeletonRows, SkeletonTotals } from '@/components/DaySkeleton';
import { EntrySheet } from '@/components/EntrySheet';
import { FastSheet, type FastSheetMode } from '@/components/FastSheet';
import { MealEntries } from '@/components/MealEntries';
import { useToast } from '@/components/Toast';
import { useDayFasts } from '@/hooks/useDayFasts';
import { useDiaryActions } from '@/hooks/useDiaryActions';
import { useHistory } from '@/hooks/useHistory';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useAuth } from '@/lib/auth';
import { type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';

// Re-exported: the helper moved to `lib/` (Today imported it from this route),
// and the undo tests still reach it here.
export { entryFromLog } from '@/lib/entry-from-log';

/**
 * "Sun, Sep 20" — and "Sun, Sep 20, 2025" only when the year is not this one
 * (review, Copy). The title was the long form with the year always on
 * ("Sunday, September 20, 2026"), which ellipsized in the header on a 360dp
 * phone and spent its width on the one part a user already knew. Exported
 * for test.
 */
export function dayTitle(dateKey: string, locale: Locale, now: Date = new Date()): string {
  const d = parseYmd(dateKey);
  return formatDate(d, locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

/**
 * The days either side of `dateKey`, for the header's arrows — `next` is null
 * once `dateKey` is today or later: a future day has nothing to log against
 * and nothing to look back at. Exported for test.
 */
export function adjacentDays(dateKey: string, todayKey: string): { prev: string; next: string | null } {
  const d = parseYmd(dateKey);
  return {
    prev: calendarDateKey(addDays(d, -1)),
    next: dateKey < todayKey ? calendarDateKey(addDays(d, 1)) : null,
  };
}

/** The platform's touch floor: 44pt on iOS, Material's 48dp on Android. */
const TARGET = Platform.OS === 'android' ? 48 : 44;

/**
 * Remount boundary for Retry — the same mechanism as Today and the calendar
 * (UX_AUDIT S18-7): the feed hooks expose no reload, so a `key` bump closes
 * and reopens every listener with `error` back at null.
 */
export default function DayDetail() {
  const [attempt, setAttempt] = useState(0);
  return <DayDetailScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

/**
 * One day of the diary. Since UX_AUDIT Today review U2 it is the SAME diary as
 * Today — the same `MealEntries` with swipe-delete, Save to Quick add and the
 * per-meal "+ Add", and the same `useDiaryActions` behind it — for a
 * different date. It used to be a read-mostly copy whose save/delete/Undo
 * had been pasted from Today and had drifted.
 */
function DayDetailScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useAuth();
  const { date } = useLocalSearchParams<{ date: string }>();
  const dateKey = String(date);
  const router = useRouter();
  // A deep link can carry anything here. `parseYmd('foo')` is an Invalid Date,
  // which titled the screen "Invalid Date" and stamped a new entry with a
  // timestamp Firestore rejects — so a malformed key goes back to the list.
  const validKey = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && !Number.isNaN(parseYmd(dateKey).getTime());
  useEffect(() => {
    if (!validKey) router.replace('/history');
  }, [validKey, router]);
  const { loading, error, logs, weights, presets, customFoods, boundary, addEntry, updateEntry, deleteEntry, addPreset, deletePreset, addCustomFood, deleteCustomFood, ensureMonthLoaded, olderMonths } = useHistory();
  // A day behind the 400-row window (a tap-through from a paged-back month, or
  // a deep link) fetches its month once, the same way the calendar does
  // (S18-13). This route mounts its own `useHistory`, so the calendar's fetched
  // rows are not here — one bounded read is the price of not sharing state.
  useEffect(() => {
    if (validKey) ensureMonthLoaded(parseYmd(dateKey));
  }, [validKey, dateKey, ensureMonthLoaded]);
  const unitSystem = useUnitSystem();
  // Fasting is its own listener rather than a widening of `useHistory`
  // (ADR-0016): the day list needs a few days EITHER SIDE of this one so the
  // editor can see the neighbours a proposed interval might collide with, and
  // `useHistory`'s window is a different shape entirely.
  const {
    dayFasts,
    fasts,
    addFast,
    updateFast,
    deleteFast,
  } = useDayFasts(dateKey, boundary);
  const [fastSheet, setFastSheet] = useState<{ mode: FastSheetMode; fast: Fast | null } | null>(null);

  // Memoised on their inputs (review, Performance): both walk the whole
  // window — up to 400 rows plus any fetched months — and ran on every render,
  // including every keystroke-driven re-render under an open sheet.
  const summary = useMemo(
    () => summarizeDay(dateKey, logs, weights, boundary),
    [dateKey, logs, weights, boundary],
  );
  const dayLogs = useMemo(
    () =>
      logs
        .filter((l) => dayKeyAt(l.date, boundary) === dateKey && l.calories > 0)
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [logs, boundary, dateKey],
  );

  /**
   * The calorie target under the day's total — "of 2,100" (Today re-score 3,
   * Usability 4: a past day read as bare totals with nothing to hold them
   * against; MyFitnessPal shows the goal on every day).
   *
   * The CURRENT effective target, through the same `dailyTargets` chain and
   * the same inputs Today's hero uses — the profile off the auth context and
   * this screen's own rows and weights, so it opens no listener (ADR-0016).
   * There is no per-day target record to read instead: targets are derived,
   * not stored. Rows this screen fetched for older months only ever reach
   * further back than the estimator's 42-day window, so they cannot move it.
   * Null until the profile is there: with no profile `dailyTargets` returns a
   * plausible SEED target, which is the number `useDailyTargets` exists to
   * keep off screen.
   */
  const calorieTarget = useMemo(
    () => (profile ? dailyTargets(profile, logs, weights).calorieTarget : null),
    [profile, logs, weights],
  );

  // A failed load is said, not drawn as an empty day (UX_AUDIT S21): the
  // diary below used to render its four empty meal slots under "0" totals
  // when the feed or this day's month fetch failed, which reads as a real,
  // empty day. With rows from the disk cache the day still renders under
  // the message — those rows are true, just possibly not the newest.
  const failed = error ?? olderMonths.error;
  const blank = !!failed && dayLogs.length === 0;

  const diary = useDiaryActions({
    where: 'history',
    dateKey,
    dayLogs,
    presets,
    addEntry,
    updateEntry,
    deleteEntry,
    deletePreset,
  });

  function openAdd() {
    haptics.tap();
    diary.openAdd();
  }
  const g = (n: number) => t('unit.grams', { n: formatNumber(n, locale) });

  /** Where a hand-logged fast is anchored when there is nothing to copy.
   *  Local noon on the day being viewed: a fast that ends around midday and
   *  started the evening before is the ordinary shape, so the prefill lands one
   *  nudge away from what most people mean instead of at a day boundary. */
  function noonOfDay(): Date {
    const d = parseYmd(dateKey);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function confirmDeleteFast(fast: Fast) {
    confirm({
      title: t('fast.deleteTitle'),
      body: t('fast.deleteBody'),
      confirmText: t('common.remove'),
      destructive: true,
      onConfirm: () => {
        if (fast.id) {
          deleteFast(fast.id).catch((e) => {
            haptics.warning();
            captureError(e, { where: 'history.deleteFast' });
          });
        }
        setFastSheet(null);
      },
    });
  }

  const title = dayTitle(dateKey, locale);
  // Today by the day boundary — the arrows stop here, and a row on any other
  // day can be copied to it.
  const todayKey = dayKeyAt(new Date(), boundary);
  const days = adjacentDays(dateKey, todayKey);
  /** Step a day without stacking a screen per step: the route's own param
   *  changes, so back still goes to the calendar (Today re-score — every
   *  diary competitor has previous/next day; here it was back, find, tap). */
  function goToDay(key: string) {
    haptics.selection();
    router.setParams({ date: key });
  }

  return (
    <View
      style={styles.screen}
      testID="day-detail"
      // VoiceOver's Magic Tap runs the live toast's action, as on Today (Today
      // re-score 3, Accessibility 8): this diary posts the same receipts —
      // "Deleted · Undo", "Moved · Undo" — and the Undo was a hunt here.
      onMagicTap={() => {
        toast.act();
      }}
    >
      {/* The native stack header since the Today re-score (Platform): the
          system back button — with its swipe, its long-press history and the
          iOS 26 glass — instead of a drawn chevron. The title is flanked by
          the day arrows, the diary convention (MyFitnessPal, Cronometer), so
          they never sit beside the back chevron and read as a second one. */}
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          // Hidden by `minimal`, but it is what VoiceOver reads: without it the
          // back button took the calendar route's NAME and announced "index"
          // (Maestro hierarchy, 2026-10-05).
          headerBackTitle: t('common.back'),
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          title,
          headerTitle: () => (
            <View style={styles.headerTitleRow}>
              <TouchableOpacity
                onPress={() => goToDay(days.prev)}
                style={styles.dayArrow}
                accessibilityRole="button"
                accessibilityLabel={t('history.prevDay')}
                testID="day-prev"
              >
                <Ionicons name="chevron-back" size={20} color={colors.muted} />
              </TouchableOpacity>
              <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
              <TouchableOpacity
                onPress={() => days.next && goToDay(days.next)}
                disabled={!days.next}
                style={[styles.dayArrow, !days.next && styles.dayArrowOff]}
                accessibilityRole="button"
                accessibilityLabel={t('history.nextDay')}
                accessibilityState={{ disabled: !days.next }}
                testID="day-next"
              >
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      {/* The month fetch counts as loading here: a day behind the window would
          otherwise read "no entries" for the beat before its rows land. It
          loads into the day's own shape — the totals card and diary rows —
          rather than a centred spinner, so a step into a month not yet
          fetched changes the numbers instead of blanking the screen (Today
          re-score 3, Visual 14). One "loading" node for the reader. */}
      {loading || olderMonths.loading ? (
        <View
          style={styles.body}
          accessible
          accessibilityLabel={t('a11y.loadingDay')}
          accessibilityState={{ busy: true }}
          testID="day-skeleton"
        >
          <SkeletonTotals />
          <SkeletonRows count={3} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}>
          {failed ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="day-error">
              <Text style={styles.error}>{t('history.dayLoadErr')}</Text>
              <TouchableOpacity
                onPress={() => {
                  haptics.tap();
                  onRetry();
                }}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="day-retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {blank ? (
            // The day's shape, inert — a placeholder for rows that did not
            // arrive, not an announcement that the day is empty.
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <SkeletonTotals />
              <SkeletonRows count={3} />
            </View>
          ) : (
          <>
          <View style={styles.totals}>
            <Total
              label={t('today.calories')}
              value={formatNumber(summary.totalCalories, locale)}
              sub={calorieTarget ? t('history.ofTarget', { n: formatNumber(calorieTarget, locale) }) : undefined}
            />
            <Total label={t('history.protein')} value={g(summary.totalProtein)} />
            <Total label={t('today.carbs')} value={g(summary.totalCarbs)} />
            <Total label={t('today.fat')} value={g(summary.totalFat)} />
          </View>
          {summary.weightLb != null ? (
            <Text style={styles.weight}>
              {t('history.weightLine', { w: formatBodyWeight(summary.weightLb, unitSystem) })}
            </Text>
          ) : null}

          <Text style={styles.sectionTitle} accessibilityRole="header">{t('today.entries')}</Text>
          {/* Today's diary, for this date: four meal slots each with "+ Add",
              swipe to delete or save to Quick add (review U2/U3). */}
          <MealEntries
            logs={dayLogs}
            onPress={(log) => {
              haptics.tap();
              diary.openEdit(log);
            }}
            onSavePreset={diary.savePresetFromLog}
            onDelete={diary.deleteFromList}
            onAddToSlot={diary.openSlot}
            onMove={diary.moveToSlot}
            // A past day's row can be logged again now — the "same lunch as
            // Tuesday" case. Not on today itself, where it would be a duplicate.
            onCopyToToday={dateKey !== todayKey ? diary.copyToToday : undefined}
          />

          {/* Fasting. Below the meals because meals are what this screen is
              for, and a fast is the thing you come back to CORRECT — the case
              ADR-0032 decision 3 exists for. The rows are the fasts that ENDED
              on this day, which is the same attribution the headline number
              uses; an overnight fast therefore appears on the day it was
              broken and on no other, so editing it is unambiguous. */}
          <View style={styles.fastHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('fast.sectionTitle')}</Text>
            <TouchableOpacity
              onPress={() => {
                haptics.tap();
                setFastSheet({ mode: 'add', fast: null });
              }}
              hitSlop={10}
              accessibilityRole="button"
              testID="fast-add"
            >
              <Text style={styles.fastAdd}>{t('fast.add')}</Text>
            </TouchableOpacity>
          </View>
          {dayFasts.length === 0 ? (
            <Text style={styles.empty}>{t('fast.none')}</Text>
          ) : (
            <View style={styles.list}>
              {dayFasts.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.entry}
                  onPress={() => {
                    haptics.tap();
                    setFastSheet({ mode: 'edit', fast: f });
                  }}
                  accessibilityRole="button"
                  accessibilityHint={t('fast.editHint')}
                  testID={`fast-row-${f.id}`}
                >
                  <View style={styles.entryMain}>
                    <Text style={styles.entryLabel}>
                      {t('fast.length', {
                        h: formatNumber(fastHoursParts(fastLengthHours(f)).hours, locale),
                        m: formatNumber(fastHoursParts(fastLengthHours(f)).minutes, locale),
                      })}
                    </Text>
                    <Text style={styles.entryMacros}>
                      {t('fast.range', {
                        from: formatTime(f.startedAt, locale),
                        to: formatTime(f.endedAt, locale),
                      })}
                      {/* The source is shown only when it is `manual`. A timer
                          fast needs no label — it is the default story — and
                          tagging both would be noise on every row. */}
                      {f.source === 'manual' ? ` · ${t('fast.byHand')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          </>
          )}
        </ScrollView>
      )}

      {/* The same coral + as Today's (review V4) — it was an ink circle, so
          the one action that means "log food" looked like two different
          buttons depending on the date. Same size, glyph and colour pair. */}
      {/* Lifted by the home-indicator inset: at a flat 24pt its lower half sat
          in the gesture area on every Face ID iPhone (Today re-score, bug 4). */}
      {!loading ? (
        <PressScale
          style={[styles.fab, { bottom: insets.bottom + space.lg }]}
          onPress={openAdd}
          testID="add-food-day"
          accessibilityRole="button"
          accessibilityLabel={t('log.manual')}
          accessibilityShowsLargeContentViewer
          accessibilityLargeContentTitle={t('log.manual')}
        >
          <Ionicons name="add" size={32} color={colors.heroPanel} />
        </PressScale>
      ) : null}

      <EntrySheet
        visible={diary.sheetOpen}
        editing={diary.editing}
        onSaveMany={diary.onSaveMany}
        dateKey={dateKey}
        presets={presets}
        onSave={diary.onSave}
        onDelete={diary.editing ? diary.onDelete : undefined}
        // Undo is offered here, so the sheet's delete fires at once (S18-6).
        deleteUndoable
        onClose={diary.closeSheet}
        initialPrefill={diary.prefill}
        onSavePreset={addPreset}
        onDeletePreset={deletePreset}
        customFoods={customFoods}
        onSaveCustomFood={addCustomFood}
        onDeleteCustomFood={deleteCustomFood}
      />

      <FastSheet
        visible={fastSheet != null}
        mode={fastSheet?.mode ?? 'add'}
        editing={fastSheet?.fast ?? null}
        // The WHOLE window, not `dayFasts` — the neighbour a new interval is
        // most likely to collide with is the fast that ended yesterday.
        fasts={fasts}
        anchorEnd={noonOfDay()}
        onSave={async (startedAt, endedAt) => {
          if (fastSheet?.mode === 'edit' && fastSheet.fast?.id) {
            await updateFast(fastSheet.fast.id, startedAt, endedAt);
          } else {
            await addFast(startedAt, endedAt);
          }
        }}
        onDelete={
          fastSheet?.mode === 'edit' && fastSheet.fast
            ? () => confirmDeleteFast(fastSheet.fast as Fast)
            : undefined
        }
        onClose={() => setFastSheet(null)}
      />
    </View>
  );
}

/** One total, read as ONE stop — "Calories, 1,200" — where the number and its
 *  label were two (Today re-score, Accessibility). `sub` is the target line
 *  under the label ("of 2,100"), read in the same stop. */
function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.total} accessible accessibilityLabel={[`${label}, ${value}`, sub].filter(Boolean).join(' ')}>
      <Text style={styles.totalValue}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
      {/* Under the label, so the four figures and the four labels still
          line up across the card and only Calories grows a line. */}
      {sub ? (
        <Text style={styles.totalSub} numberOfLines={1} testID="day-calorie-target">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** The scroll's tail padding that clears the + button over the last row —
 *  the home-indicator inset is added on top at render. */
const FAB_CLEARANCE = 96;

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  // The native header's title slot: arrow · day · arrow.
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  headerTitle: { flexShrink: 1, textAlign: 'center', fontSize: font.body, fontWeight: '700', color: colors.ink },
  dayArrow: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: font.small, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: TARGET, justifyContent: 'center' },
  retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  dayArrowOff: { opacity: 0.35 },
  body: { padding: space.xl, gap: space.lg },
  totals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  total: { alignItems: 'center', flex: 1 },
  totalValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  totalLabel: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  totalSub: { fontSize: font.tiny, color: colors.faint, fontWeight: '600', marginTop: 2 },
  weight: { fontSize: font.body, color: colors.muted },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
  fastHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  fastAdd: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  empty: { fontSize: font.body, color: colors.muted },
  list: { gap: space.sm },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  entryMain: { flex: 1, gap: 2 },
  entryLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
  entryMacros: { fontSize: font.small, color: colors.muted },
  entryKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginLeft: space.md },
  fab: {
    position: 'absolute',
    right: space.xl,
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.ring,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.e3,
  },
});
