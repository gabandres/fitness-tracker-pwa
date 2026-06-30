import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type TdeeResult, parseYmd } from '@macrolog/core';
import { useTrends } from '@/hooks/useTrends';
import { colors, font, radius, space } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const TDEE_MODE: Record<TdeeResult['source'], { label: string; hint: string }> = {
  measured: { label: 'Measured', hint: 'From your logged intake + weight trend' },
  formula: { label: 'Formula', hint: 'Mifflin–St Jeor estimate from your profile' },
  seed: { label: 'Estimate', hint: 'Default until you log ~14 days' },
};

export default function Trends() {
  const { loading, error, insights, tdee, targetCalories } = useTrends();
  const mode = TDEE_MODE[tdee.source];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text style={styles.title}>Trends</Text>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>Couldn't load your trends.</Text> : null}

          {/* Adaptive TDEE */}
          <View style={styles.card} testID="tdee-card">
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Maintenance estimate</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{mode.label}</Text>
              </View>
            </View>
            <Text style={styles.bigValue} testID="tdee-value">
              {tdee.trueTdee > 0 ? `${tdee.trueTdee.toLocaleString()} kcal` : '—'}
            </Text>
            <Text style={styles.hint}>{mode.hint}</Text>
            {tdee.source === 'measured' && tdee.loggingCompletenessPct != null ? (
              <Text style={styles.sub}>
                {Math.round(tdee.loggingCompletenessPct)}% logging completeness
                {tdee.reliable ? '' : ' · log more days to sharpen this'}
              </Text>
            ) : null}
            <View style={styles.divider} />
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>Daily target</Text>
              <Text style={styles.kvValue}>{targetCalories > 0 ? `${targetCalories.toLocaleString()} kcal` : '—'}</Text>
            </View>
          </View>

          {/* Weekly insights */}
          <Text style={styles.section}>This week</Text>
          {insights ? (
            <View style={styles.card} testID="insights-card">
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Avg intake</Text>
                <Text style={styles.kvValue}>{insights.avgCalories.toLocaleString()} kcal</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>{insights.avgDeficit >= 0 ? 'Avg deficit' : 'Avg surplus'}</Text>
                <Text style={[styles.kvValue, { color: insights.avgDeficit >= 0 ? colors.accent : colors.danger }]}>
                  {Math.abs(insights.avgDeficit).toLocaleString()} kcal
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Best day</Text>
                <Text style={styles.kvValue}>{dayLabel(insights.bestDay.dateKey)}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Off day</Text>
                <Text style={styles.kvValue}>{dayLabel(insights.worstDay.dateKey)}</Text>
              </View>
              {insights.weightSlopeLbPerWeek != null ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.kv}>
                    <Text style={styles.kvLabel}>Weight trend</Text>
                    <Text style={styles.kvValue}>
                      {Math.abs(insights.weightSlopeLbPerWeek) < 0.1
                        ? 'Holding steady'
                        : `${insights.weightSlopeLbPerWeek < 0 ? '−' : '+'}${Math.abs(insights.weightSlopeLbPerWeek).toFixed(1)} lb/wk`}
                    </Text>
                  </View>
                </>
              ) : null}
              <Text style={styles.sub}>{insights.loggedDays} of 7 days logged</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.empty}>Log at least 3 days this week to see insights.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.sm },
  error: { color: colors.danger, fontSize: font.small },
  section: {
    fontSize: font.small,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  badge: { backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 2 },
  badgeText: { color: colors.white, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  bigValue: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  hint: { fontSize: font.small, color: colors.muted },
  sub: { fontSize: font.tiny, color: colors.faint, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kvLabel: { fontSize: font.body, color: colors.muted },
  kvValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  empty: { fontSize: font.small, color: colors.muted },
});
