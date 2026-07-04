import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type TdeeResult, parseYmd } from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { Sparkline } from '@/components/Sparkline';
import { ProUpsell } from '@/components/ProUpsell';
import { WeeklyReportCard } from '@/components/WeeklyReportCard';
import { useTrends } from '@/hooks/useTrends';
import { useSubscription } from '@/lib/subscription';
import { type I18nKey, useT } from '@/i18n';
import { CountUpText, enterUp } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekdayNarrow(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'narrow' });
}

const TDEE_MODE: Record<TdeeResult['source'], { labelKey: I18nKey; hintKey: I18nKey }> = {
  measured: { labelKey: 'trends.measured', hintKey: 'trends.measuredHint' },
  formula: { labelKey: 'trends.formula', hintKey: 'trends.formulaHint' },
  seed: { labelKey: 'trends.estimate', hintKey: 'trends.seedHint' },
};

export default function Trends() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { loading, error, insights, tdee, targetCalories, weightSeries, budget } = useTrends();
  const { isPro } = useSubscription();
  const mode = TDEE_MODE[tdee.source];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.trends')}</Text>
        <HeaderAvatar />
      </View>
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={styles.error}>{t('trends.loadErr')}</Text> : null}

          {/* Hero panel — the Today skeleton (ADR-0014 §7): adaptive maintenance
              is the one big number; daily target + weight trend live inside as
              supporting chips. No celebration — Trends is a reading surface. */}
          <Animated.View style={styles.heroPanel} entering={enterUp(0)} testID="tdee-card">
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t(mode.labelKey)}</Text>
            </View>
            <Text style={styles.heroCaption}>{t('trends.maintenance')}</Text>
            <View style={styles.hero}>
              {tdee.trueTdee > 0 ? (
                <CountUpText value={tdee.trueTdee} style={styles.heroValue} testID="tdee-value" />
              ) : (
                <Text style={styles.heroValue} testID="tdee-value">—</Text>
              )}
              <Text style={styles.heroUnit}>kcal</Text>
            </View>
            <Text style={styles.heroHint}>{t(mode.hintKey)}</Text>
            {tdee.source === 'measured' && tdee.loggingCompletenessPct != null ? (
              <Text style={styles.heroSub}>
                {t('trends.completeness', { pct: Math.round(tdee.loggingCompletenessPct) })}
                {tdee.reliable ? '' : t('trends.logMore')}
              </Text>
            ) : null}
            <View style={styles.heroChips}>
              <Text style={styles.trendChip}>
                {t('trends.dailyTarget')}  <Text style={styles.trendChipValue}>
                  {targetCalories > 0 ? `${targetCalories.toLocaleString()} kcal` : '—'}
                </Text>
              </Text>
              {weightSeries.length >= 2 && insights?.weightSlopeLbPerWeek != null ? (
                <Text style={styles.trendChip}>
                  {t('trends.weightTrend')}  <Text style={styles.trendChipValue}>
                    {Math.abs(insights.weightSlopeLbPerWeek) < 0.1
                      ? t('body.holdingSteady')
                      : `${insights.weightSlopeLbPerWeek < 0 ? '−' : '+'}${Math.abs(insights.weightSlopeLbPerWeek).toFixed(1)} lb/wk`}
                  </Text>
                </Text>
              ) : null}
            </View>
          </Animated.View>

          {/* AI coach — free (server-side 3/day quota); grounded in the log. */}
          <Animated.View entering={enterUp(1)}>
            <TouchableOpacity style={styles.coachBtn} onPress={() => router.push('/coach' as Href)} testID="coach-entry">
              <Ionicons name="sparkles-outline" size={18} color={colors.onInk} />
              <Text style={styles.coachBtnText}>{t('coach.entry')}</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Pro AI weekly report (upsell for free users). */}
          <Animated.View entering={enterUp(2)}>
            <WeeklyReportCard />
          </Animated.View>

          {/* Weight chart */}
          {weightSeries.length >= 2 ? (
            <Animated.View entering={enterUp(3)}>
              <Text style={styles.section}>{t('trends.weightTrend')}</Text>
              <View style={styles.card} testID="trends-weight-chart">
                <Sparkline values={weightSeries} width={300} height={70} color={colors.ink} />
              </View>
            </Animated.View>
          ) : null}

          {/* Weekly insights + budget — Pro (basic maintenance + weight chart
              above stay free). */}
          {!isPro ? (
            <Animated.View style={{ marginTop: space.lg }} entering={enterUp(4)}>
              <ProUpsell feature={t('pro.advancedTrends')} />
            </Animated.View>
          ) : (
          <Animated.View entering={enterUp(4)}>
          <Text style={styles.section}>{t('trends.thisWeek')}</Text>
          {insights ? (
            <View style={styles.card} testID="insights-card">
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>{t('trends.avgIntake')}</Text>
                <Text style={styles.kvValue}>{insights.avgCalories.toLocaleString()} kcal</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>{insights.avgDeficit >= 0 ? t('trends.avgDeficit') : t('trends.avgSurplus')}</Text>
                <Text style={[styles.kvValue, { color: insights.avgDeficit >= 0 ? colors.accent : colors.danger }]}>
                  {Math.abs(insights.avgDeficit).toLocaleString()} kcal
                </Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>{t('trends.bestDay')}</Text>
                <Text style={styles.kvValue}>{dayLabel(insights.bestDay.dateKey)}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>{t('trends.offDay')}</Text>
                <Text style={styles.kvValue}>{dayLabel(insights.worstDay.dateKey)}</Text>
              </View>
              {insights.weightSlopeLbPerWeek != null ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.kv}>
                    <Text style={styles.kvLabel}>{t('trends.weightTrend')}</Text>
                    <Text style={styles.kvValue}>
                      {Math.abs(insights.weightSlopeLbPerWeek) < 0.1
                        ? t('body.holdingSteady')
                        : `${insights.weightSlopeLbPerWeek < 0 ? '−' : '+'}${Math.abs(insights.weightSlopeLbPerWeek).toFixed(1)} lb/wk`}
                    </Text>
                  </View>
                </>
              ) : null}
              <Text style={styles.sub}>{t('trends.daysLogged', { n: insights.loggedDays })}</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.empty}>{t('trends.empty')}</Text>
            </View>
          )}

          {/* Weekly calorie budget / banking */}
          {budget ? (
            <>
              <Text style={styles.section}>{t('trends.budgetTitle')}</Text>
              <View style={styles.card} testID="budget-card">
                <View style={styles.kv}>
                  <Text style={styles.kvLabel}>{t('trends.budgetUsed')}</Text>
                  <Text style={styles.kvValue}>
                    {Math.round(budget.consumed).toLocaleString()} / {budget.weeklyBudget.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.barStrip}>
                  {budget.bars.map((b) => {
                    const h =
                      b.calories > 0 && budget.dailyTarget > 0
                        ? Math.max(6, Math.min(100, (b.calories / budget.dailyTarget) * 70))
                        : 0;
                    const over = b.calories > budget.dailyTarget;
                    return (
                      <View key={b.dateKey} style={styles.barCol}>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                height: `${h}%`,
                                backgroundColor: over ? colors.danger : colors.ring,
                                opacity: b.elapsed ? 1 : 0.3,
                              },
                            ]}
                          />
                        </View>
                        <Text style={styles.barDay}>{weekdayNarrow(b.dateKey)}</Text>
                      </View>
                    );
                  })}
                </View>
                <View style={styles.divider} />
                <View style={styles.kv}>
                  <Text style={styles.kvLabel}>{t('trends.budgetRemaining')}</Text>
                  <Text style={[styles.kvValue, { color: budget.remaining < 0 ? colors.danger : colors.accent }]}>
                    {budget.remaining < 0 ? '−' : ''}
                    {Math.abs(Math.round(budget.remaining)).toLocaleString()} kcal
                  </Text>
                </View>
                {budget.pacePerRemainingDay != null ? (
                  <View style={styles.kv}>
                    <Text style={styles.kvLabel}>{t('trends.budgetPerDay')}</Text>
                    <Text style={styles.kvValue}>
                      {budget.pacePerRemainingDay < 0
                        ? t('trends.budgetOver')
                        : `${budget.pacePerRemainingDay.toLocaleString()} kcal`}
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
          </Animated.View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.sm },
  error: { color: colors.danger, fontSize: font.small },
  // Hero panel — the Today skeleton (ADR-0014 §7): shared dark canvas, the one
  // big number (adaptive maintenance) with supporting chips beneath.
  heroPanel: {
    backgroundColor: colors.heroPanel,
    borderRadius: radius.xl,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.xs,
    ...shadow.e2,
  },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
  heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
  heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
  heroHint: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs },
  heroSub: { textAlign: 'center', color: colors.heroMuted, fontSize: font.tiny, opacity: 0.8 },
  heroChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
  trendChip: {
    fontSize: font.small,
    color: colors.heroMuted,
    backgroundColor: colors.heroTrack,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  trendChipValue: { color: colors.heroText, fontFamily: type.heading },
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
  coachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.lg,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.md,
  },
  coachBtnText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
  badge: { backgroundColor: colors.heroTrack, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 },
  badgeText: { color: colors.heroText, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sub: { fontSize: font.tiny, color: colors.faint, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kvLabel: { fontSize: font.body, color: colors.muted },
  kvValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  empty: { fontSize: font.small, color: colors.muted },
  barStrip: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 84, marginVertical: space.xs },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { width: '55%', height: 64, borderRadius: radius.sm, backgroundColor: colors.line, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: radius.sm },
  barDay: { fontSize: font.tiny, color: colors.faint, textTransform: 'uppercase' },
});
