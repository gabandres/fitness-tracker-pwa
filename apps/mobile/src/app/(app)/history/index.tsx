import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type DaySummary, localDateKey, monthGrid, parseYmd } from '@macrolog/core';
import { useHistory } from '@/hooks/useHistory';
import { useT } from '@/i18n';
import { colors, font, radius, space } from '@/theme';

// Narrow weekday letters, locale-aware (Jan 1 2023 was a Sunday).
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
);

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function HistoryCalendar() {
  const t = useT();
  const { loading, error, days } = useHistory();
  const router = useRouter();
  // A date within the viewed month; starts on the current month.
  const [view, setView] = useState(() => new Date());

  const byDate = useMemo(() => {
    const m = new Map<string, DaySummary>();
    for (const d of days) m.set(d.dateKey, d);
    return m;
  }, [days]);

  const cells = useMemo(() => monthGrid(view), [view]);
  const todayKey = localDateKey(new Date());
  const monthLabel = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  function shiftMonth(delta: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>{t('nav.history')}</Text>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{t('history.loadErr')}</Text> : null}

          <View style={styles.monthNav}>
            <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} testID="month-prev">
              <Ionicons name="chevron-back" size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable onPress={() => shiftMonth(1)} hitSlop={12} testID="month-next">
              <Ionicons name="chevron-forward" size={22} color={colors.ink} />
            </Pressable>
          </View>

          <View style={styles.weekHead}>
            {WEEKDAYS.map((w, i) => (
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
              return (
                <Pressable
                  key={cell.key}
                  style={styles.cell}
                  onPress={() => router.push(`/history/${cell.key}`)}
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
                    testID={`recent-${d.dateKey}`}
                  >
                    <View style={styles.recentLeft}>
                      <Text style={styles.recentDate}>{dayLabel(d.dateKey)}</Text>
                      <Text style={styles.recentSub}>
                        {d.mealCount} {d.mealCount === 1 ? t('history.entryOne') : t('history.entryMany')}
                        {d.exercised ? `  ·  ${t('history.exercised')}` : ''}
                        {d.weightLb != null ? `  ·  ${d.weightLb} lb` : ''}
                      </Text>
                    </View>
                    <Text style={styles.recentKcal}>{d.totalCalories.toLocaleString()}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
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
