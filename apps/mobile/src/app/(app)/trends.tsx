import { Ionicons } from '@expo/vector-icons';
import { type Href, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type TdeeResult, type WeeklyBudget, type WeeklyInsights, parseYmd } from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { WeeklyReportCard } from '@/components/WeeklyReportCard';
import { useTrends } from '@/hooks/useTrends';
import { useSubscription } from '@/lib/subscription';
import { type I18nKey, type TFn, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

function dayLabel(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekdayNarrow(dateKey: string): string {
  return parseYmd(dateKey).toLocaleDateString(undefined, { weekday: 'narrow' });
}

function slopeLabel(slope: number, t: TFn): string {
  if (Math.abs(slope) < 0.1) return t('body.holdingSteady');
  return `${slope < 0 ? '−' : '+'}${Math.abs(slope).toFixed(1)} lb/wk`;
}

// seed/formula both read as "Estimate" to the user; measured is "Adaptive".
const TDEE_MODE: Record<TdeeResult['source'], { badgeKey: I18nKey; hintKey: I18nKey }> = {
  measured: { badgeKey: 'trends.measured', hintKey: 'trends.measuredHint' },
  formula: { badgeKey: 'trends.estimate', hintKey: 'trends.formulaHint' },
  seed: { badgeKey: 'trends.estimate', hintKey: 'trends.seedHint' },
};

export default function Trends() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { loading, error, insights, loggedThisWeek, proteinTarget, tdee, targetCalories, budget } = useTrends();
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

          {/* 1. Maintenance hero — the anchor, always populated with at least
              a formula estimate (never a dash once onboarding is done). */}
          <Animated.View style={styles.heroPanel} entering={enterUp(0)} testID="tdee-card">
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{t(mode.badgeKey)}</Text>
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
            </View>
          </Animated.View>

          {/* 2. This week — adherence (calories + protein), free, never blank. */}
          <Animated.View entering={enterUp(1)}>
            <Text style={styles.section}>{t('trends.thisWeek')}</Text>
            <ThisWeek
              insights={insights}
              loggedThisWeek={loggedThisWeek}
              proteinTarget={proteinTarget}
              isPro={isPro}
              onUpsell={() => router.push('/coach' as Href)}
              styles={styles}
              colors={colors}
              t={t}
            />
          </Animated.View>

          {/* 3. Weekly budget — free, never blank (bars are the illustration). */}
          <Animated.View entering={enterUp(2)}>
            <Text style={styles.section}>{t('trends.budgetTitle')}</Text>
            <Budget budget={budget} styles={styles} colors={colors} t={t} />
          </Animated.View>

          {/* 4. Coach — the Pro AI action. */}
          <Animated.View entering={enterUp(3)}>
            {isPro ? (
              <PressScale style={styles.coachBtn} onPress={() => { haptics.tap(); router.push('/coach' as Href); }} testID="coach-entry">
                <Ionicons name="sparkles-outline" size={18} color={colors.onInk} />
                <Text style={styles.coachBtnText}>{t('coach.entry')}</Text>
              </PressScale>
            ) : (
              <PressScale style={styles.proCard} onPress={() => { haptics.tap(); router.push('/coach' as Href); }} testID="coach-locked">
                <View style={styles.proIcon}>
                  <Ionicons name="sparkles" size={18} color={colors.onInk} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.proCardTitle}>{t('coach.entry')}</Text>
                  <Text style={styles.proCardSub}>{t('trends.coachPro')}</Text>
                </View>
                <View style={styles.proPill}>
                  <Ionicons name="lock-closed" size={11} color={colors.onInk} />
                  <Text style={styles.proPillText}>PRO</Text>
                </View>
              </PressScale>
            )}
          </Animated.View>

          {/* 5. Weekly report — deepest Pro layer (self-gating card). */}
          <Animated.View entering={enterUp(4)}>
            <WeeklyReportCard />
          </Animated.View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── This-week adherence ────────────────────────────────────────
function ThisWeek({
  insights,
  loggedThisWeek,
  proteinTarget,
  isPro,
  onUpsell,
  styles,
  colors,
  t,
}: {
  insights: WeeklyInsights | null;
  loggedThisWeek: number;
  proteinTarget: number;
  isPro: boolean;
  onUpsell: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
}) {
  // Below the 3-day insight gate: a preview skeleton + a "keep logging" nudge,
  // so day zero still says what the card will show and prompts the next log.
  if (!insights) {
    return (
      <View style={styles.card} testID="insights-card">
        <View style={styles.tileRow}>
          <StatTile label={t('trends.avgIntake')} faded styles={styles} />
          <View style={styles.tileDivider} />
          <StatTile label={t('trends.avgProtein')} faded styles={styles} />
        </View>
        <View style={styles.divider} />
        <Text style={styles.weekNudge}>
          {loggedThisWeek > 0 ? t('trends.daysLogged', { n: loggedThisWeek }) : t('trends.weekStart')}
        </Text>
        <Text style={styles.weekHint}>{t('trends.weekLowHint')}</Text>
      </View>
    );
  }

  const deficit = insights.avgDeficit;
  return (
    <View style={styles.card} testID="insights-card">
      <View style={styles.tileRow}>
        <StatTile
          label={t('trends.avgIntake')}
          value={`${insights.avgCalories.toLocaleString()}`}
          unit="kcal"
          sub={`${Math.abs(deficit).toLocaleString()} ${deficit >= 0 ? t('trends.avgDeficit') : t('trends.avgSurplus')}`}
          subColor={deficit >= 0 ? colors.accent : colors.danger}
          styles={styles}
        />
        <View style={styles.tileDivider} />
        <StatTile
          label={t('trends.avgProtein')}
          value={`${insights.avgProtein}`}
          unit="g"
          sub={proteinTarget > 0 ? t('trends.proteinDays', { hit: insights.proteinGoalDays, days: insights.loggedDays }) : undefined}
          subColor={colors.protein}
          styles={styles}
        />
      </View>

      <View style={styles.divider} />
      <Text style={styles.sub}>{t('trends.daysLogged', { n: insights.loggedDays })}</Text>

      {/* Deeper insight rows — Pro. */}
      <View style={styles.divider} />
      {isPro ? (
        <>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>{t('trends.bestDay')}</Text>
            <Text style={styles.kvValue}>{dayLabel(insights.bestDay.dateKey)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>{t('trends.offDay')}</Text>
            <Text style={styles.kvValue}>{dayLabel(insights.worstDay.dateKey)}</Text>
          </View>
          {insights.weightSlopeLbPerWeek != null ? (
            <View style={styles.kv}>
              <Text style={styles.kvLabel}>{t('trends.weightTrend')}</Text>
              <Text style={styles.kvValue}>{slopeLabel(insights.weightSlopeLbPerWeek, t)}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <PressScale style={styles.proRow} onPress={() => { haptics.tap(); onUpsell(); }} testID="deeper-pro">
          <Ionicons name="lock-closed" size={13} color={colors.muted} />
          <Text style={styles.proRowText}>{t('trends.deeperPro')}</Text>
          <View style={styles.proPill}>
            <Text style={styles.proPillText}>PRO</Text>
          </View>
        </PressScale>
      )}
    </View>
  );
}

function StatTile({
  label,
  value,
  unit,
  sub,
  subColor,
  faded,
  styles,
}: {
  label: string;
  value?: string;
  unit?: string;
  sub?: string;
  subColor?: string;
  faded?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {faded ? (
        <View style={styles.tileSkeleton} />
      ) : (
        <View style={styles.tileValueRow}>
          <Text style={styles.tileValue}>{value}</Text>
          {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
        </View>
      )}
      {sub ? <Text style={[styles.tileSub, subColor ? { color: subColor } : null]}>{sub}</Text> : faded ? <View style={styles.tileSkeletonSub} /> : null}
    </View>
  );
}

// ─── Weekly budget ──────────────────────────────────────────────
function Budget({
  budget,
  styles,
  colors,
  t,
}: {
  budget: WeeklyBudget | null;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
}) {
  // No target/logs yet: faded 7-column placeholder — the bars ARE the
  // illustration of what this fills into.
  if (!budget) {
    return (
      <View style={styles.card} testID="budget-card">
        <View style={styles.barStrip}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View key={i} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${20 + (i % 3) * 12}%`, backgroundColor: colors.line }]} />
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.weekNudge}>{t('trends.budgetEmpty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="budget-card">
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>{t('trends.budgetUsed')}</Text>
        <Text style={styles.kvValue}>
          {Math.round(budget.consumed).toLocaleString()} / {budget.weeklyBudget.toLocaleString()}
        </Text>
      </View>
      <View style={styles.barStrip}>
        {budget.bars.map((b) => {
          const h = b.calories > 0 && budget.dailyTarget > 0 ? Math.max(6, Math.min(100, (b.calories / budget.dailyTarget) * 70)) : 0;
          const over = b.calories > budget.dailyTarget;
          return (
            <View key={b.dateKey} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${h}%`, backgroundColor: over ? colors.danger : colors.ring, opacity: b.elapsed ? 1 : 0.3 }]} />
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
            {budget.pacePerRemainingDay < 0 ? t('trends.budgetOver') : `${budget.pacePerRemainingDay.toLocaleString()} kcal`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
    title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    body: { padding: space.xl, gap: space.sm },
    error: { color: colors.danger, fontSize: font.small },
    // Hero
    heroPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.xs, ...shadow.e2 },
    hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
    heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
    heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
    heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
    heroHint: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs },
    heroSub: { textAlign: 'center', color: colors.heroMuted, fontSize: font.tiny, opacity: 0.8 },
    heroChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
    trendChip: { fontSize: font.small, color: colors.heroMuted, backgroundColor: colors.heroTrack, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, overflow: 'hidden' },
    trendChipValue: { color: colors.heroText, fontFamily: type.heading },
    badge: { backgroundColor: colors.heroTrack, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 },
    badgeText: { color: colors.heroText, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    section: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space.lg, marginBottom: space.xs },
    card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm },
    // Stat tiles
    tileRow: { flexDirection: 'row', alignItems: 'stretch' },
    tileDivider: { width: 1, backgroundColor: colors.line, marginHorizontal: space.md },
    tile: { flex: 1, gap: space.xs },
    tileLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    tileValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
    tileValue: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    tileUnit: { fontSize: font.small, color: colors.muted, marginBottom: 4 },
    tileSub: { fontSize: font.small, color: colors.muted },
    tileSkeleton: { height: 30, width: '70%', borderRadius: radius.sm, backgroundColor: colors.line, marginVertical: 2 },
    tileSkeletonSub: { height: 12, width: '50%', borderRadius: radius.sm, backgroundColor: colors.line, opacity: 0.6 },
    weekNudge: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    weekHint: { fontSize: font.small, color: colors.muted },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
    kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kvLabel: { fontSize: font.body, color: colors.muted },
    kvValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
    sub: { fontSize: font.small, color: colors.faint },
    // Pro row / cards
    proRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    proRowText: { flex: 1, fontSize: font.small, color: colors.muted, fontWeight: '600' },
    proCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg },
    proIcon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
    proCardTitle: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    proCardSub: { fontSize: font.small, color: colors.muted, marginTop: 1 },
    proPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    proPillText: { color: colors.onInk, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.5 },
    // Coach button
    coachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.lg, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.md },
    coachBtnText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
    // Budget bars
    barStrip: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 84, marginVertical: space.xs },
    barCol: { flex: 1, alignItems: 'center', gap: 4 },
    barTrack: { width: '55%', height: 64, borderRadius: radius.sm, backgroundColor: colors.line, justifyContent: 'flex-end', overflow: 'hidden' },
    barFill: { width: '100%', borderRadius: radius.sm },
    barDay: { fontSize: font.tiny, color: colors.faint, textTransform: 'uppercase' },
  });
