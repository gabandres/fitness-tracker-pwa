import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DaySummary, formatBodyWeight, dayKeyAt, monthGrid, parseYmd } from '@macrolog/core';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useHistory } from '@/hooks/useHistory';
import { useUnitSystem } from '@/lib/use-unit-system';
import { type Locale, useLocale, useT } from '@/i18n';
import { capitalizeFirst } from '@/i18n/grammar';
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

// The window predicate and the oldest-row helper moved to `lib/history-paging`
// with the on-demand month fetch (UX_AUDIT S18-13); re-exported so the seam
// this screen used to own keeps its name.
export { oldestLogKey, olderThanLoaded } from '@/lib/history-paging';

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
  const { loading, error, days, boundary, ensureMonthLoaded, olderMonths } = useHistory();
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
  // Sentence case, not `textTransform: 'capitalize'`, which title-cased
  // pt-BR's "outubro de 2026" into "Outubro De 2026" (review #3).
  const monthLabel = capitalizeFirst(formatDate(view, locale, { month: 'long', year: 'numeric' }), locale);
  // Page back past the 400-row window and the month is fetched once, on
  // demand (S18-13). The hook decides whether anything is needed; this effect
  // only says which month is on screen — and re-asks when the window itself
  // answers, since the first call lands before any row is loaded.
  useEffect(() => {
    ensureMonthLoaded(view);
  }, [view, ensureMonthLoaded]);

  function shiftMonth(delta: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* A pushed screen now (root stack, review P1), so it leads with back —
          the edge-swipe and hardware back do the same. The avatar it carried
          as a tab is gone: Settings is one back away, on Today. A cold deep
          link has nothing beneath it and goes to Today instead. */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)'))}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="history-back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">
          {t('nav.history')}
        </Text>
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

          {/* A state readout, same slot it has on Today (UX_AUDIT S18-12) — the
              calendar now paints from disk, so offline it shows data plus this. */}
          <OfflineBanner />

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

          {/* A month behind the window is being fetched; when that fails, say
              so, so an empty old month is not mistaken for an empty record. */}
          {olderMonths.loading ? (
            <View style={styles.partialRow} accessibilityLiveRegion="polite" testID="history-older-loading">
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={styles.partialNote}>{t('history.olderLoading')}</Text>
            </View>
          ) : olderMonths.error ? (
            <Text style={styles.partialNote} accessibilityLiveRegion="polite" testID="history-older-not-loaded">
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
  title: { flexShrink: 1, fontSize: font.h1, fontWeight: '800', color: colors.ink },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.md },
  // 44pt tall, the chevron's 26dp plus `hitSlop` for the rest of the target.
  backBtn: { minHeight: 44, justifyContent: 'center' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center' },
  retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  partialNote: { fontSize: font.small, color: colors.muted, textAlign: 'center', marginTop: space.xs },
  partialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm },
  monthLabel: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
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
