import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DayBoundary, type DaySummary, LOG_WINDOW_ROWS, formatBodyWeight, dayKeyAt, monthGrid, parseYmd } from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { useHistory } from '@/hooks/useHistory';
import { useUnitSystem } from '@/lib/use-unit-system';
import { type Locale, useLocale, useT } from '@/i18n';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatDate, formatNumber } from '@/lib/date-format';

// Narrow weekday letters (Jan 1 2023 was a Sunday). Built per locale, not
// once at module load — the app language can differ from the device's.
const weekdayLetters = (locale: Locale) =>
  Array.from({ length: 7 }, (_, i) => formatDate(new Date(2023, 0, 1 + i), locale, { weekday: 'narrow' }));

function dayLabel(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Does the viewed month reach past what the 400-row window loaded?
 *
 * `useHistory` subscribes to the newest `LOG_WINDOW_ROWS` rows and the
 * calendar pages back forever, so a month older than the window rendered as
 * empty — indistinguishable from a month with nothing logged (UX_AUDIT S18-13).
 * The rule: when the window is FULL (there may be more rows behind it) and the
 * first day of the viewed month is older than the oldest row on hand, some of
 * that month is not loaded. A window with room to spare loaded everything, so
 * an empty old month is genuinely empty and no note is shown.
 */
export function olderThanLoaded(
  view: Date,
  oldestLoadedKey: string | null,
  loadedRows: number,
  windowRows: number = LOG_WINDOW_ROWS,
): boolean {
  if (oldestLoadedKey == null || loadedRows < windowRows) return false;
  const y = view.getFullYear();
  const m = String(view.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01` < oldestLoadedKey;
}

/** The oldest day key among the loaded rows, under the user's boundary. */
export function oldestLogKey(logs: readonly { date: Date }[], boundary: DayBoundary): string | null {
  let oldest: string | null = null;
  for (const l of logs) {
    const k = dayKeyAt(l.date, boundary);
    if (oldest == null || k < oldest) oldest = k;
  }
  return oldest;
}

/** Remount boundary for Retry — see Today for why a `key` bump is the
 *  mechanism (the feed hooks expose no reload; UX_AUDIT S18-7). */
export default function HistoryCalendar() {
  const [attempt, setAttempt] = useState(0);
  return <HistoryCalendarScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

function HistoryCalendarScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { loading, error, days, logs, boundary } = useHistory();
  const unitSystem = useUnitSystem();
  const router = useRouter();
  // A date within the viewed month; starts on the current month.
  const [view, setView] = useState(() => new Date());

  const byDate = useMemo(() => {
    const m = new Map<string, DaySummary>();
    for (const d of days) m.set(d.dateKey, d);
    return m;
  }, [days]);

  const cells = useMemo(() => monthGrid(view), [view]);
  const weekdays = useMemo(() => weekdayLetters(locale), [locale]);
  const todayKey = dayKeyAt(new Date(), boundary);
  const monthLabel = formatDate(view, locale, { month: 'long', year: 'numeric' });
  const oldestLoaded = useMemo(() => oldestLogKey(logs, boundary), [logs, boundary]);
  const partial = olderThanLoaded(view, oldestLoaded, logs.length);

  function shiftMonth(delta: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.history')}</Text>
        <HeaderAvatar />
      </View>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.error}>{t('history.loadErr')}</Text>
              <Pressable
                onPress={onRetry}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.monthNav}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              hitSlop={12}
              testID="month-prev"
              accessibilityRole="button"
              accessibilityLabel={t('history.prevMonthA11y')}
            >
              <Ionicons name="chevron-back" size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable
              onPress={() => shiftMonth(1)}
              hitSlop={12}
              testID="month-next"
              accessibilityRole="button"
              accessibilityLabel={t('history.nextMonthA11y')}
            >
              <Ionicons name="chevron-forward" size={22} color={colors.ink} />
            </Pressable>
          </View>

          <View style={styles.weekHead}>
            {weekdays.map((w, i) => (
              <Text key={i} style={styles.weekHeadCell}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((cell) => {
              const summary = byDate.get(cell.key);
              const logged = (summary?.totalCalories ?? 0) > 0;
              const weighed = summary?.weightLb != null;
              const isToday = cell.key === todayKey;
              // The dots are the only cue on a sighted cell; a reader gets the
              // date plus what each dot means (UX_AUDIT S18-5).
              const a11y = [
                dayLabel(cell.key, locale),
                logged ? t('history.logged') : null,
                weighed ? t('history.weighIn') : null,
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <Pressable
                  key={cell.key}
                  style={styles.cell}
                  onPress={() => router.push(`/history/${cell.key}`)}
                  accessibilityRole="button"
                  accessibilityLabel={a11y}
                  accessibilityState={{ selected: isToday }}
                  testID={`day-${cell.key}`}
                >
                  <View style={[styles.cellInner, isToday && styles.cellToday]}>
                    <Text style={[styles.cellNum, !cell.inMonth && styles.cellOut, isToday && styles.cellNumToday]}>
                      {parseInt(cell.key.slice(8), 10)}
                    </Text>
                    <View style={styles.dotRow}>
                      {logged ? <View style={styles.dot} /> : null}
                      {weighed ? <View style={styles.dotWeight} /> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Says when the month on screen reaches past the loaded window, so
              an empty old month is not mistaken for an empty record. */}
          {partial ? (
            <Text style={styles.partialNote} testID="history-older-not-loaded">
              {t('history.olderNotLoaded')}
            </Text>
          ) : null}

          {/* Names what the two dot colors mean — the encoding was unexplained
              anywhere on screen (UX_AUDIT S16-4). */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={styles.dot} />
              <Text style={styles.legendText}>{t('history.legendLogged')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={styles.dotWeight} />
              <Text style={styles.legendText}>{t('history.legendWeighed')}</Text>
            </View>
          </View>

          {days.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('history.emptyTitle')}</Text>
              <Text style={styles.emptyHint}>{t('history.emptyHint')}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.recentHead}>{t('history.recent')}</Text>
              <View style={styles.recentList}>
                {days.slice(0, 10).map((d) => (
                  <Pressable
                    key={d.dateKey}
                    style={styles.recentRow}
                    onPress={() => router.push(`/history/${d.dateKey}`)}
                    accessibilityRole="button"
                    accessibilityLabel={[
                      dayLabel(d.dateKey, locale),
                      d.totalCalories > 0 ? t('history.logged') : null,
                      d.weightLb != null ? t('history.weighIn') : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    testID={`recent-${d.dateKey}`}
                  >
                    <View style={styles.recentLeft}>
                      <Text style={styles.recentDate}>{dayLabel(d.dateKey, locale)}</Text>
                      <Text style={styles.recentSub}>
                        {d.mealCount} {d.mealCount === 1 ? t('history.entryOne') : t('history.entryMany')}
                        {d.exercised ? `  ·  ${t('history.exercised')}` : ''}
                        {d.weightLb != null ? `  ·  ${formatBodyWeight(d.weightLb, unitSystem)}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.recentKcal}>{formatNumber(d.totalCalories, locale)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const CELL = `${100 / 7}%`;

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center' },
  retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  partialNote: { fontSize: font.small, color: colors.muted, textAlign: 'center', marginTop: space.xs },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm },
  monthLabel: { fontSize: font.h3, fontWeight: '800', color: colors.ink, textTransform: 'capitalize' },
  weekHead: { flexDirection: 'row' },
  weekHeadCell: { width: CELL, textAlign: 'center', fontSize: font.tiny, color: colors.faint, fontWeight: '700', textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, gap: 3 },
  cellToday: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent },
  cellNum: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
  cellNumToday: { color: colors.accent, fontWeight: '800' },
  cellOut: { color: colors.faint }, // adjacent-month days: dimmer, still tappable
  dotRow: { flexDirection: 'row', gap: 3, height: 6, alignItems: 'center' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendText: { fontSize: font.tiny, color: colors.faint },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  dotWeight: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.teal },
  empty: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  emptyText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  emptyHint: { fontSize: font.small, color: colors.faint },
  recentHead: {
    fontSize: font.small,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
  },
  recentList: { gap: space.sm },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  recentLeft: { flex: 1, gap: 2 },
  recentDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  recentSub: { fontSize: font.small, color: colors.muted },
  recentKcal: { fontSize: font.body, fontWeight: '700', color: colors.ink },
});
