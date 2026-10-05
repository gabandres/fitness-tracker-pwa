import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Line as SvgLine } from 'react-native-svg';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type TdeeResult,
  type WeeklyBudget,
  type WeeklyInsights,
  TARGET_STREAK_MIN_DAYS,
  TDEE_SERIES_MAX_DAYS,
  TDEE_SERIES_PRO_MAX_DAYS,
  activityMultiplier as activityMultiplierFor,
  balanceVerdict,
  parseYmd,
} from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { OfflineBanner } from '@/components/OfflineBanner';
import { NumbersGlossary } from '@/components/NumbersGlossary';
import { SleepTrendsCard } from '@/components/SleepTrendsCard';
import { FastingTrendsCard } from '@/components/FastingTrendsCard';
import { WaterTrendsCard } from '@/components/WaterTrendsCard';
import { WeeklyReportCard } from '@/components/WeeklyReportCard';
import { ContextMenu, CONTEXT_MENUS } from '@/components/ContextMenu';
import { Glyph } from '@/components/charts/Glyph';
import { MedianLine, useStripAudioGraph } from '@/components/charts/StripParts';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import {
  ExpenditureCard,
  ProteinTrendCard,
  TREND_RANGES,
  type TrendRange,
  WeightTrendCard,
  rangeDays,
  rangesFor,
} from '@/components/charts/TrendsCharts';
import { maintenanceLine, slopeLabel, targetLine } from '@/components/charts/trend-copy';
import { useAdjustableDays } from '@/components/charts/useAdjustableDays';
import { useTrends } from '@/hooks/useTrends';
import { usePersistedTab } from '@/hooks/usePersistedTab';
import { HABIT_TABS, TRENDS_HABIT_TAB_KEY, habitColor } from '@/lib/habit-identity';
import { useActivitySuggestion } from '@/lib/activity-suggestion';
import { useAuth } from '@/lib/auth';
import { useSubscription, PRO_ENABLED } from '@/lib/subscription';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import * as haptics from '@/lib/haptics';
import { announce } from '@/lib/a11y';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { FAB_BAND, font, radius, space, type } from '@/theme';
import { formatDate, formatNumber } from '@/lib/date-format';
import { CompositionLine, RecompCard } from '@/components/CompositionCards';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useCountViewPerFocus } from '@/hooks/useCountViewPerFocus';

function dayLabel(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekdayNarrow(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { weekday: 'narrow' });
}

function shortDay(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { month: 'short', day: 'numeric' });
}

/** Past this OS font scale the two stat tiles stack instead of sharing a row:
 *  two 30pt display numerals side by side stop fitting a phone well before
 *  the largest accessibility sizes. */
const STACK_TILES_AT_FONT_SCALE = 1.5;
/** Axis numerals and day letters are glyphs in a fixed-size chart, not prose —
 *  they scale, but only this far, or they overrun the columns they name. */
const CHART_TEXT_MAX_SCALE = 1.3;

// seed/formula both read as "Estimate" to the user; measured is "Adaptive".
/** Bucket → the label the activity-correction card names it by (shared with
 *  the Refine Targets picker, so both surfaces say the same word). */
const TDEE_MODE: Record<TdeeResult['source'], { badgeKey: I18nKey; hintKey: I18nKey }> = {
  measured: { badgeKey: 'trends.measured', hintKey: 'trends.measuredHint' },
  formula: { badgeKey: 'trends.estimate', hintKey: 'trends.formulaHint' },
  seed: { badgeKey: 'trends.estimate', hintKey: 'trends.seedHint' },
};

/** Remount boundary for Retry — see Today for why a `key` bump is the
 *  mechanism (the feed hooks expose no reload; UX_AUDIT S18-7). Pull-to-
 *  refresh is NOT a remount any more (review S20): a remount replayed every
 *  entry animation and threw away the scroll position, for listeners that are
 *  live anyway. It re-fetches the older rows and re-runs the replay instead —
 *  the only two things on this screen that are not already live. */
export default function Trends() {
  const [attempt, setAttempt] = useState(0);
  return <TrendsScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

function TrendsScreen({ onRetry }: { onRetry: () => void }) {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { isPro } = useSubscription();
  // The chart cap: `CHART_HISTORY_DAYS_FREE` says "Pro sees all-time", and v1
  // forces `isPro` true — yet every chart stopped at 90 days, so 3M and All
  // were usually the same chart while Body offered 1Y (review S20). A year is
  // Body's reach.
  const cap = isPro ? TDEE_SERIES_PRO_MAX_DAYS : TDEE_SERIES_MAX_DAYS;
  // The expenditure/weight range, remembered like the panel tabs below. A
  // stored 6M/1Y under a 90-day cap falls back to 3M rather than selecting a
  // chip that is not drawn.
  const [rangeRaw, setRange] = usePersistedTab('trends.range', TREND_RANGES, '1m');
  const range: TrendRange = rangesFor(cap).includes(rangeRaw as TrendRange) ? (rangeRaw as TrendRange) : '3m';
  // `historyDays` is only known after the first pass; the hook clamps, so
  // asking for the cap on "All" and trimming at render is equivalent.
  const requestedDays = rangeDays(range, cap, cap);
  // Pull-to-refresh: a generation number the hook re-fetches and re-replays
  // on, and the spinner holds until it reports that generation settled.
  const [refreshKey, setRefreshKey] = useState(0);
  const [pulling, setPulling] = useState(false);
  const {
    loading, error, insights, loggedThisWeek, proteinTarget, tdee, targetCalories, budget, basalKcal,
    activityLevel, sleep, fasting, water, composition, chartKeys, weightSeries, intakeSeries,
    proteinSeries, historyClip, insightWindow, streak, settledKey,
    expenditure, historyDays, milestones, progress,
  } = useTrends(requestedDays, { maxDays: cap, refreshKey });
  // Clipped to the days the cache covers in full when the older rows could
  // not be fetched — "nothing logged" over logged days is worse than a
  // shorter chart that says why.
  const fullDays = rangeDays(range, historyDays, cap);
  const shownDays = historyClip ? Math.min(fullDays, historyClip.days) : fullDays;
  useEffect(() => {
    if (!pulling || settledKey !== refreshKey) return;
    setPulling(false);
    // A screen reader heard nothing when the spinner went away.
    announce(t('trends.refreshed'));
  }, [pulling, settledKey, refreshKey, t]);
  const onPullRefresh = useCallback(() => {
    setPulling(true);
    setRefreshKey((k) => k + 1);
  }, []);
  const compUnits = useUnitSystem();
  // One `composition_view` per Trends focus in which the composition line is
  // actually on screen (ADR-0043) — the number that says whether anyone reads
  // it before the flag goes past the owner. Nothing is counted for anyone else.
  useCountViewPerFocus('composition_view', !loading && composition.enabled && composition.composition != null);
  // A Today habit chip lands here with `?habits=<nonce>` — scroll the strip
  // into view so the user sees what they tapped for instead of the hero
  // (UX_AUDIT S16-6). A nonce, not a flag: expo-router keeps a visited Trends
  // MOUNTED and `router.replace` re-focuses the live instance, so only a
  // changing value re-fires (the same contract as Today's `openAdd`).
  const scrollRef = useRef<ScrollView>(null);
  const habitsY = useRef(0);
  const pendingHabitsScroll = useRef<string | null>(null);
  const { habits: habitsNonce } = useLocalSearchParams<{ habits?: string }>();
  // Two-sided handshake, because the two arrival orders are both real
  // (device-found 2026-08-31: a rAF-next-frame version scrolled to y=0 on a
  // fresh mount — the param lands while `loading` still shows the spinner, so
  // no ScrollView exists and no layout has happened):
  //  - LIVE instance: the effect fires with the layout already measured → go.
  //  - FRESH mount: park the nonce; the panel's onLayout completes it.
  // Reduce Motion jumps instead of gliding — a long programmatic scroll is
  // exactly the kind of large movement the setting exists to stop.
  useEffect(() => {
    if (!habitsNonce) return;
    pendingHabitsScroll.current = habitsNonce;
    if (habitsY.current > 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ y: habitsY.current, animated: !reduceMotion });
      pendingHabitsScroll.current = null;
    }
  }, [habitsNonce, reduceMotion]);
  function onHabitsLayout(y: number) {
    habitsY.current = y;
    if (pendingHabitsScroll.current && y > 0) {
      scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
      pendingHabitsScroll.current = null;
    }
  }
  // Remembered per device, in AsyncStorage — a cache, not a setting.
  //
  // No profile field and therefore no `firestore.rules` change, which is the
  // whole reason this is cheap: ADR-0034's option C stores hidden-card ids on
  // the PROFILE, and `hasOnly` is evaluated against the merged document, so
  // that deploy is cross-frontend and can reject the frozen web's writes too.
  // Remembering which tab you were on costs none of that, and losing it on
  // reinstall costs one tap.
  const [weeklyTab, setWeeklyTab] = usePersistedTab('trends.tab.weekly', WEEKLY_TABS, 'week');
  // `HABIT_TABS` — the full list, not the faces present right now — is what the
  // stored value is validated against, deliberately. A tab you were on last week
  // whose card has since gone quiet is still a *valid preference*; forgetting it
  // because today's data is thin would silently move you every time a card came
  // and went. Presence is handled at the render site instead, by `activeHabit`.
  // The key and tab list live in `lib/habit-identity` because the Today
  // shortcut writes this same key (`setPersistedTab`) to land on a face.
  const [habitTab, setHabitTab] = usePersistedTab(TRENDS_HABIT_TAB_KEY, HABIT_TABS, 'sleep');
  // Which habit faces actually have a card right now, in a fixed order so the
  // strip does not reshuffle under the user's thumb as data arrives.
  const habitFaces = useMemo(
    () =>
      HABIT_TABS.filter((k) =>
        (k === 'sleep' ? sleep.kind : k === 'fasting' ? fasting.kind : water.kind) === 'card',
      ),
    [sleep.kind, fasting.kind, water.kind],
  );
  // The stored tab may name a face that has no card today — and `usePersistedTab`
  // keeps a module-level memo, so it cannot re-validate on its own once seeded.
  // Falling back to the first present face is what stops the panel rendering an
  // empty body under a strip that does not contain the active key.
  const activeHabit = habitFaces.includes(habitTab as (typeof HABIT_TABS)[number])
    ? habitTab
    : habitFaces[0];
  const { user } = useAuth();
  const mode = TDEE_MODE[tdee.source];

  // Activity-level correction.
  //
  // Historically pre-measured ONLY: in measured mode energy balance already
  // contains every training calorie, so folding activity in would double-count
  // it (`docs/activity-informed-tdee-spec.md`).
  //
  // **That reasoning expired on 2026-08-19.** `measuredConfidence` now blends a
  // thin measured estimate toward the Mifflin x activity anchor, so the bucket
  // moves the number for measured-mode users too — and this card, the only
  // surface that corrects the bucket, is hidden from exactly them. It is not a
  // double-count: the anchor SUBSTITUTES for measurement in proportion to how
  // little of it there is, rather than being added to it.
  //
  // It was held behind a dark flag while the suggestion was worse than the
  // setting it replaced (-17.9% against a 2,385 benchmark, versus +6.1% for
  // the stored bucket). The continuous multiplier fixed that: the stored value
  // is now 1.40 (-4.2%) and the label names that value rather than the raw
  // one, so the card says "light" and produces a target consistent with it.
  const { suggestion, guidance, decline, evidence } = useActivitySuggestion({
    uid: user?.uid,
    basalKcal,
    currentBucket: activityLevel,
    // Measured mode INCLUDED since 2026-08-20. The old exclusion was right
    // while the bucket did not touch measured targets; `measuredConfidence`
    // made it touch them, so hiding the only corrective surface from measured
    // users became the bug rather than the safeguard.
    enabled: activityLevel != null,
  });

  /**
   * The daily burn the card promises, computed from the SAME clamped
   * multiplier the accept flow would store — so the number shown and the
   * number saved cannot drift apart. Null when there is no window to compute
   * from, which is also when the card has nothing to claim.
   */
  const suggestedBurn = (() => {
    if (!evidence?.meanActiveKcal || !(basalKcal > 0)) return null;
    const m = activityMultiplierFor(evidence.meanActiveKcal, basalKcal);
    return m == null ? null : Math.round(basalKcal * m);
  })();

  // Body is a sibling TAB: `navigate`, not `push` — pushing a tab route stacks
  // a second copy of it (the reasoning `FastingTrendsCard` records for Today).
  // Both are stable: they go into the `memo`'d chart cards, and a fresh
  // function per render re-rendered both charts on every Trends render.
  const openBody = useCallback(() => router.navigate('/body' as Href), [router]);
  const openDay = useCallback(
    (dateKey: string) => {
      haptics.tap();
      router.push(`/history/${dateKey}` as Href);
    },
    [router],
  );

  // The hero's uncertainty, in the words Today already uses for the same
  // states (`HeroRings`), so the two screens cannot describe one estimate two
  // ways. `holding` first: it subsumes the softer caveats.
  const ci95 = tdee.source === 'measured' && tdee.ci95Tdee != null ? tdee.ci95Tdee : null;
  const holding = tdee.source === 'measured' && tdee.estimateState === 'holding';
  const outliers = tdee.source === 'measured' ? tdee.outliersDropped : 0;
  const heroA11y =
    tdee.trueTdee > 0
      ? ci95 != null
        ? t('trends.heroA11yCi', { mode: t(mode.badgeKey), kcal: formatNumber(tdee.trueTdee, locale), ci: formatNumber(ci95, locale) })
        : t('trends.heroA11y', { mode: t(mode.badgeKey), kcal: formatNumber(tdee.trueTdee, locale) })
      : t('trends.maintenance');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">{t('nav.trends')}</Text>
        {/* UX_AUDIT F6. Same icon, same place, same sheet as the Train tab's
            "?" — this screen leads with a MEASURED badge, a maintenance
            estimate and a completeness percentage, and defined none of them. */}
        <TouchableOpacity
          onPress={() => { haptics.tap(); setGlossaryOpen(true); }}
          accessibilityRole="button"
          accessibilityLabel={t('numbers.glossaryOpen')}
          hitSlop={10}
          style={styles.headerHelp}
          testID="trends-glossary-open"
        >
          <Glyph ios="questionmark.circle" android="help-circle-outline" size={24} color={colors.muted} />
        </TouchableOpacity>
        <HeaderAvatar />
      </View>
      <NumbersGlossary visible={glossaryOpen} onClose={() => setGlossaryOpen(false)} composition={composition.enabled} />
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('a11y.loadingTrends')} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          testID="trends-scroll"
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPullRefresh} tintColor={colors.muted} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.error}>{t('trends.loadErr')}</Text>
              <TouchableOpacity
                onPress={onRetry}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="retry"
              >
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* A state readout, same slot it has on Today (UX_AUDIT S18-12). */}
          <OfflineBanner />

          {/* 1. Maintenance hero — the anchor, always populated with at least
              a formula estimate (never a dash once onboarding is done). */}
          <Animated.View style={styles.heroPanel} entering={enterUp(0)} testID="tdee-card">
            {/* One element for a screen reader — "Maintenance estimate,
                measured, 2,450 kcal, plus or minus 180" — instead of four
                fragments, and a door to Body, where the weight behind it
                lives. */}
            <PressScale
              style={styles.heroTop}
              accessibilityRole="button"
              accessibilityLabel={heroA11y}
              accessibilityHint={t('a11y.opensBody')}
              onPress={() => { haptics.tap(); openBody(); }}
              testID="tdee-open-body"
            >
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
              {ci95 != null ? (
                <Text style={styles.heroCi} testID="tdee-ci">{t('trends.ci95', { n: formatNumber(ci95, locale) })}</Text>
              ) : null}
            </PressScale>
            <Text style={styles.heroHint}>{t(mode.hintKey)}</Text>
            {holding ? (
              <Text style={styles.heroSub} testID="tdee-holding">{t('today.maintenanceHolding')}</Text>
            ) : tdee.source === 'measured' && tdee.loggingCompletenessPct != null ? (
              <Text style={styles.heroSub}>
                {tdee.reliable
                  ? t('trends.completeness', { pct: Math.round(tdee.loggingCompletenessPct) })
                  : t('trends.completenessThin', { pct: Math.round(tdee.loggingCompletenessPct) })}
              </Text>
            ) : null}
            {outliers > 0 ? (
              <Text style={styles.heroSub} testID="tdee-outliers">
                {outliers === 1 ? t('today.maintenanceOutlier') : t('today.maintenanceOutliers', { n: outliers })}
              </Text>
            ) : null}
            {/* Formula mode: how far the measured burn is — the same readout
                as Today's hero footer, off the same thresholds. */}
            {progress && tdee.source === 'formula' ? (
              <Text style={styles.heroSub} testID="tdee-progress">
                {progress.daysToGo > 0
                  ? t('today.measureNext', { n: progress.daysToGo })
                  : plural(t, locale, 'today.measureWeighIns', progress.weighInsToGo)}
              </Text>
            ) : null}
            {/* ADR-0043: UNDER the maintenance number, never instead of it,
                and display-only — `targetCalories` above never reads it. */}
            {composition.enabled && composition.composition ? (
              <CompositionLine result={composition.composition} unitSystem={compUnits} female={composition.female} />
            ) : null}
            <View style={styles.heroChips}>
              {/* Label and value are two Texts in a row, not one string with
                  two spaces glued between them; the row reads as one sentence
                  to a screen reader. */}
              <View
                style={styles.trendChip}
                accessible
                accessibilityLabel={targetCalories > 0 ? t('trends.dailyTargetA11y', { kcal: formatNumber(targetCalories, locale) }) : t('trends.dailyTarget')}
              >
                <Text style={styles.trendChipLabel}>{t('trends.dailyTarget')}</Text>
                <Text style={styles.trendChipValue}>
                  {targetCalories > 0 ? `${formatNumber(targetCalories, locale)} kcal` : '—'}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* 1a. The hero's HISTORY — what the estimate said each day, with
              intake and the target against it (review 2026-10-04: "Trends
              draws no line over time"). Directly under the number it
              explains. */}
          <Animated.View entering={enterUp(1)}>
            <ExpenditureCard
              keys={chartKeys}
              intake={intakeSeries}
              series={expenditure}
              days={shownDays}
              target={targetCalories}
              milestones={milestones}
              range={range}
              onRange={setRange}
              cap={cap}
              onOpenDay={openDay}
              t={t}
              locale={locale}
            />
            {historyClip && shownDays < fullDays ? (
              <Text style={styles.clipNote} testID="trends-history-clip">
                {t('trends.chart.clipped', { n: historyClip.days })}
              </Text>
            ) : null}
          </Animated.View>

          {composition.enabled && composition.recomp ? (
            <RecompCard signal={composition.recomp} unitSystem={compUnits} lastTapeAt={composition.lastTapeAt} female={composition.female} />
          ) : null}

          {/* 1b. Activity correction — sits under the hero and its history
              because it changes the number above it. Distinct from
              RecalibrationCard (measured mode only): this one corrects the
              self-reported activity bucket the FORMULA estimate rests on.
              Confirm-not-silent — tapping opens Refine Targets pre-filled; the
              user still saves. */}
          {suggestion ? (
            <Animated.View style={styles.correctionCard} entering={enterUp(1)} testID="activity-correction">
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.correctionTitle} accessibilityRole="header">{t('trends.activityCorrectionTitle')}</Text>
                {/* Leads with the BURN, not the bucket. Naming a bucket was
                    the copy bug: accepting stores a continuous multiplier the
                    ladder cannot express, so "switch to sedentary" described
                    neither the value stored nor the target produced. The kcal
                    figure is the thing the user can check against their own
                    sense of themselves, and it is what the target is built
                    on. */}
                <Text style={styles.correctionBody}>
                  {t('trends.activityCorrectionBody', {
                    burn: suggestedBurn != null ? formatNumber(suggestedBurn, locale) : '—',
                  })}
                </Text>
                {/* The window behind the suggestion, so it can be argued with
                    rather than only obeyed — a card that states a number and no
                    evidence gives the user no way to spot a fortnight of watch
                    downtime. */}
                {evidence ? (
                  <Text style={styles.correctionEvidence} testID="activity-correction-evidence">
                    {t('trends.activityCorrectionEvidence', {
                      kcal: formatNumber(evidence.meanActiveKcal, locale),
                      steps: formatNumber(evidence.meanSteps, locale),
                      days: String(evidence.usableDays),
                      window: String(evidence.windowDays),
                    })}
                  </Text>
                ) : null}
                <View style={styles.correctionActions}>
                  <PressScale
                    style={styles.correctionPrimary}
                    accessibilityRole="button"
                    onPress={() => {
                      haptics.tap();
                      // `from=trends` is how Refine Targets knows where "back"
                      // and "save" return to — it is a hidden TAB route, and a
                      // tab navigator's back goes to its first route (Today),
                      // not to the screen that opened it.
                      router.push(`/refine-targets?suggested=${suggestion}&from=trends` as Href);
                    }}
                    testID="activity-correction-review"
                  >
                    <Text style={styles.correctionPrimaryText}>{t('trends.activityCorrectionCta')}</Text>
                  </PressScale>
                  <PressScale
                    style={styles.correctionDismiss}
                    accessibilityRole="button"
                    onPress={() => { haptics.tap(); decline(); }}
                    testID="activity-correction-dismiss"
                  >
                    <Text style={styles.correctionDismissText}>{t('trends.activityCorrectionDismiss')}</Text>
                  </PressScale>
                </View>
              </View>
            </Animated.View>
          ) : null}

          {/* 1c. Accrual line — a four-week wait with no visible progress reads
              as "nothing happened", which is how a Health connection gets
              revoked. Deliberately NOT a connect prompt: that ask belongs in
              Refine Targets, where the user is actually asking the question it
              answers. Here it would be an abstraction with no context. */}
          {guidance.kind === 'progress' ? (
            <Text style={styles.activityProgress} testID="activity-progress">
              {t('activity.windowProgress', {
                days: String(guidance.usableDays),
                needed: String(guidance.needed),
              })}
            </Text>
          ) : null}

          {/* 1d. Weight — the trend line through the scale readings. The
              estimate above is built from this line's slope; showing the two
              together is what makes the maintenance number checkable. */}
          <Animated.View entering={enterUp(2)}>
            <WeightTrendCard
              keys={chartKeys}
              series={weightSeries}
              days={shownDays}
              unitSystem={compUnits}
              milestones={milestones}
              onOpenBody={openBody}
              onOpenDay={openDay}
              t={t}
              locale={locale}
            />
          </Animated.View>

          {/* 1e. Protein over time, on the same range — the half of the macro
              story the calorie line cannot tell (review S20). */}
          <Animated.View entering={enterUp(2)}>
            <ProteinTrendCard
              keys={chartKeys}
              protein={proteinSeries}
              days={shownDays}
              target={proteinTarget}
              milestones={milestones}
              onOpenDay={openDay}
              t={t}
              locale={locale}
            />
          </Animated.View>

          {/* 2. WEEKLY PANEL — Last 7 days ⇄ Budget behind one tab strip.
              ADR-0034 decision 4: consolidation is the lever to reach for
              before configuration, and this is the mobile half of the merge the
              web already did (`CONTEXT.md` → Weekly panel).

              **Two different windows, and the labels now say so.** The first
              face is the TRAILING seven days (the insight gate needs three
              logged days, which a Monday-start week cannot offer until
              Wednesday); the budget is the Mon–Sun week, because banking only
              means something inside a fixed week. Both were labelled "week"
              until 2026-10-04, so one tab strip promised one window and showed
              two.

              Both faces are "always render, never blank", so the strip is
              unconditional here. The tabs sit where the two uppercase section
              labels used to, which is what keeps the page rhythm intact — one
              label slot, one card, instead of two of each. */}
          <Animated.View entering={enterUp(3)}>
            <PanelTabs
              tabs={[
                { key: 'week', label: t('trends.last7Days') },
                { key: 'budget', label: t('trends.budgetTitle') },
              ]}
              active={weeklyTab}
              onSelect={setWeeklyTab}
              styles={styles}
            />
            {weeklyTab === 'week' ? (
              <ThisWeek
                insights={insights}
                loggedThisWeek={loggedThisWeek}
                window={insightWindow}
                streak={streak}
                proteinTarget={proteinTarget}
                isPro={isPro}
                onUpsell={() => router.push('/coach' as Href)}
                onOpenBody={openBody}
                styles={styles}
                colors={colors}
                t={t}
                locale={locale}
              />
            ) : (
              <Budget budget={budget} onOpenDay={openDay} styles={styles} colors={colors} t={t} locale={locale} />
            )}
          </Animated.View>

          {/* 3. HABITS PANEL — Sleep ⇄ Fasting ⇄ Water.
              These were the strongest case for consolidating anything on this
              screen: each draws a fourteen-column strip with a median line and a
              headline number, so stacked they read as one chart rendered three
              times.

              **The strip carries exactly the faces that HAVE a card**, which is
              the three-state contract respected rather than worked around: a tab
              leading to a stub row is a tab promising something it cannot show.
              With one card it renders alone with its own header; with none, the
              stub rows render exactly as they did before.

              That rule is a GENERALISATION of the two-face version, not a change
              of policy — and generalising it is what made a third face safe to
              add. #115 warned that a third tab would bury two faces instead of
              one, and it would have, under the old all-or-nothing condition:
              only 4 of 43 accounts have a water card and 2 have a fasting one,
              so demanding all three would have shut the strip for everybody and
              a face short of its bar would have taken the other two down with
              it. Selecting on presence means the strip only ever holds tabs that
              lead somewhere, and a user sees two tabs, or three, or none.

              Faces WITHOUT a card still render below the panel — their stub rows
              are how you learn the feature exists at all, and #115 §0 measured
              that those rows are what ~90% of accounts actually meet. */}
          {habitFaces.length >= 2 ? (
            <>
              <Animated.View
                entering={enterUp(4)}
                onLayout={(e) => onHabitsLayout(e.nativeEvent.layout.y)}
              >
                <PanelTabs
                  // Each face carries its identity dot — the same hue that
                  // tints the habit's shortcut chip on Today and its chart
                  // bars below, so the colour follows the metric across
                  // screens (user-requested, 2026-08-30).
                  tabs={habitFaces.map((key) => ({
                    key,
                    label: t(HABIT_TAB_LABEL[key]),
                    dot: habitColor(colors, key),
                  }))}
                  active={activeHabit}
                  onSelect={setHabitTab}
                  styles={styles}
                />
                {activeHabit === 'sleep' ? (
                  <SleepTrendsCard sleep={sleep} hideHeader />
                ) : activeHabit === 'fasting' ? (
                  <FastingTrendsCard fasting={fasting} hideHeader />
                ) : (
                  <WaterTrendsCard water={water} hideHeader />
                )}
              </Animated.View>
              {/* Each card self-gates, so these render a stub row or nothing.
                  Guarded on `kind` anyway rather than relying on that: a face
                  already drawn inside the panel above must not also appear
                  below it, and `hideHeader` is not what decides that. */}
              <Animated.View entering={enterUp(5)}>
                {sleep.kind !== 'card' ? <SleepTrendsCard sleep={sleep} /> : null}
                {fasting.kind !== 'card' ? <FastingTrendsCard fasting={fasting} /> : null}
                {water.kind !== 'card' ? <WaterTrendsCard water={water} /> : null}
              </Animated.View>
            </>
          ) : (
            <>
              <Animated.View
                entering={enterUp(4)}
                onLayout={(e) => onHabitsLayout(e.nativeEvent.layout.y)}
              >
                <SleepTrendsCard sleep={sleep} />
              </Animated.View>
              <Animated.View entering={enterUp(5)}>
                <FastingTrendsCard fasting={fasting} />
              </Animated.View>
              <Animated.View entering={enterUp(6)}>
                <WaterTrendsCard water={water} />
              </Animated.View>
            </>
          )}

          {/* 6. Coach — the Pro AI action. */}
          <Animated.View entering={enterUp(6)}>
            {isPro ? (
              <PressScale
                style={styles.coachBtn}
                accessibilityRole="button"
                onPress={() => { haptics.tap(); router.push('/coach' as Href); }}
                testID="coach-entry"
              >
                <Glyph ios="sparkles" android="sparkles-outline" size={18} color={colors.onInk} />
                <Text style={styles.coachBtnText}>{t('coach.entry')}</Text>
              </PressScale>
            ) : (
              <PressScale
                style={styles.proCard}
                accessibilityRole="button"
                onPress={() => { haptics.tap(); router.push('/coach' as Href); }}
                testID="coach-locked"
              >
                <View style={styles.proIcon}>
                  <Glyph ios="sparkles" android="sparkles" size={18} color={colors.onInk} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.proCardTitle}>{t('coach.entry')}</Text>
                  <Text style={styles.proCardSub}>{t('trends.coachPro')}</Text>
                </View>
                <View style={styles.proPill}>
                  <Glyph ios="lock.fill" android="lock-closed" size={11} color={colors.onInk} />
                  <Text style={styles.proPillText}>PRO</Text>
                </View>
              </PressScale>
            )}
          </Animated.View>

          {/* 6. Weekly report — Pro + server-entitled AI feature; hidden in
              the free v1 (no IAP → its "PRO" tag + generate would dead-end). */}
          {PRO_ENABLED ? (
            <Animated.View entering={enterUp(6)}>
              <WeeklyReportCard />
            </Animated.View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Panel tabs ─────────────────────────────────────────────────
/**
 * The consolidated-panel tab strip (ADR-0034 decision 4).
 *
 * It sits in the slot the uppercase section label used to occupy, and that is
 * the whole trick: the label named the card beneath it, and so does this. Two
 * labelled cards become one labelled card with two faces, and the page rhythm
 * is unchanged — nothing new is introduced above the fold, one thing is
 * removed.
 *
 * **Ephemeral by design.** `useState`, nothing persisted, nothing synced, no
 * profile field and therefore no `firestore.rules` change. That is what makes
 * consolidation the cheap lever ADR-0034 says to reach for BEFORE a settings
 * screen: option C needs a rules deploy that would reject the frozen web's
 * profile writes if it were got wrong, and this needs none of it.
 */
/** The keys each panel's tab strip may store. Declared at module scope so the
 *  arrays are referentially stable — a fresh literal per render would re-run
 *  the hook's effect on every frame. They are also what `usePersistedTab`
 *  validates a stored value against, so a renamed tab falls back instead of
 *  selecting a face that no longer exists. */
const WEEKLY_TABS = ['week', 'budget'] as const;
// HABIT_TABS moved to `lib/habit-identity` — the Today shortcut needs the same
// list and storage key, and two copies is how they drift.

/** The strip's label per face. A map rather than a ternary chain because the
 *  tabs are now built from a filtered list, and a chain that has to stay in
 *  step with `HABIT_TABS` is the thing that goes stale when a fourth face
 *  arrives. */
const HABIT_TAB_LABEL: Record<(typeof HABIT_TABS)[number], I18nKey> = {
  sleep: 'trends.sleepTitle',
  fasting: 'trends.fastingTitle',
  water: 'trends.waterTitle',
};

function PanelTabs({
  tabs,
  active,
  onSelect,
  styles,
}: {
  /** `dot` — an optional identity colour rendered as a small disc before the
   *  label (the Habits strip passes it; Weekly has no identities). Colour is
   *  identity here, never state: the dot keeps its hue whether or not the tab
   *  is active, because it names the metric, not the selection. */
  tabs: readonly { key: string; label: string; dot?: string }[];
  active: string;
  onSelect: (key: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    // `tablist` so a screen reader announces "tab, 1 of 2" rather than a row of
    // unrelated buttons; wraps rather than overflowing at large text sizes.
    <View style={styles.tabs} accessibilityRole="tablist" testID="panel-tabs">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <PressScale
            key={tab.key}
            style={[styles.tab, on && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`panel-tab-${tab.key}`}
            onPress={() => {
              if (on) return;
              haptics.tap();
              onSelect(tab.key);
            }}
          >
            {tab.dot ? <View style={[styles.tabDot, { backgroundColor: tab.dot }]} /> : null}
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

// ─── Last-7-days adherence ──────────────────────────────────────
function ThisWeek({
  insights,
  loggedThisWeek,
  window,
  streak,
  proteinTarget,
  isPro,
  onUpsell,
  onOpenBody,
  styles,
  colors,
  t,
  locale,
}: {
  insights: WeeklyInsights | null;
  loggedThisWeek: number;
  /** The seven complete days the face reads — named, like the budget's week. */
  window: { from: string; to: string };
  /** Complete days in a row at or under target (`targetStreak`). */
  streak: number;
  proteinTarget: number;
  isPro: boolean;
  onUpsell: () => void;
  onOpenBody: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
  locale: Locale;
}) {
  const unitSystem = useUnitSystem();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_TILES_AT_FONT_SCALE;
  // Names the window: seven COMPLETE days, ending yesterday — today joins once
  // it is over (a half-logged day dragged every average down).
  const windowLine = window?.from ? (
    <Text style={styles.sub} testID="insights-window">
      {t('trends.last7Window', { from: shortDay(window.from, locale), to: shortDay(window.to, locale) })}
    </Text>
  ) : null;
  // Below the 3-day insight gate: a preview skeleton + a "keep logging" nudge,
  // so day zero still says what the card will show and prompts the next log.
  if (!insights) {
    return (
      <View style={styles.card} testID="insights-card">
        {windowLine}
        <View style={[styles.tileRow, stacked && styles.tileRowStacked]}>
          <StatTile label={t('trends.avgIntake')} faded styles={styles} />
          <View style={stacked ? styles.divider : styles.tileDivider} />
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

  // The deficit is against the MEASURED maintenance (the hero's number) when
  // there is one; the target line is labelled as such and is the only line in
  // formula/seed mode. Owner, on device 2026-10-04: "'−1 Avg deficit' is
  // misleading. It compares intake against your 1,850 target, not against
  // maintenance." Whole sentences per side — no sign glyph glued to a noun.
  const vsTarget = balanceVerdict(insights.avgUnderTarget);
  const vsMaint = insights.avgUnderMaintenance != null ? balanceVerdict(insights.avgUnderMaintenance) : null;
  // `good` against `danger`, and the WORDS carry the direction, so neither
  // depends on colour (light `accent` and `danger` are 1.13:1 apart — UX_AUDIT
  // S18, 2026-09-28). Maintenance is a fact, not a verdict: it reads in ink.
  const targetColor = vsTarget.kind === 'over' ? colors.danger : colors.good;
  return (
    <View style={styles.card} testID="insights-card">
      {windowLine}
      <View style={[styles.tileRow, stacked && styles.tileRowStacked]}>
        <StatTile
          label={t('trends.avgIntake')}
          value={formatNumber(insights.avgCalories, locale)}
          unit="kcal"
          sub={vsMaint ? maintenanceLine(vsMaint, t, locale) : targetLine(vsTarget, t, locale)}
          subColor={vsMaint ? colors.ink : targetColor}
          sub2={vsMaint ? targetLine(vsTarget, t, locale) : undefined}
          sub2Color={targetColor}
          testID="insights-intake"
          styles={styles}
        />
        <View style={stacked ? styles.divider : styles.tileDivider} />
        <StatTile
          label={t('trends.avgProtein')}
          value={formatNumber(insights.avgProtein, locale)}
          unit="g"
          sub={proteinTarget > 0 ? t('trends.proteinDays', { hit: insights.proteinGoalDays, days: insights.loggedDays }) : undefined}
          // `good`, not `protein`: the macro green is a DATA colour tuned for
          // fills and measures 2.72:1 as text on light paper (UX_AUDIT S18-2).
          subColor={colors.good}
          styles={styles}
        />
      </View>

      <View style={styles.divider} />
      <Text style={styles.sub}>{t('trends.daysLogged', { n: insights.loggedDays })}</Text>
      {/* The panel's one celebratory line, and only when there is something
          to celebrate — a run that ended says nothing (UX_AUDIT §S12). */}
      {streak >= TARGET_STREAK_MIN_DAYS ? (
        <View style={styles.streakRow} testID="insights-streak">
          <Glyph ios="flame.fill" android="flame" size={14} color={colors.good} />
          <Text style={styles.streakText}>{t('trends.targetStreak', { n: formatNumber(streak, locale) })}</Text>
        </View>
      ) : null}

      {/* Deeper insight rows — Pro. */}
      <View style={styles.divider} />
      {isPro ? (
        <>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>{t('trends.bestDay')}</Text>
            <Text style={styles.kvValue}>{dayLabel(insights.bestDay.dateKey, locale)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>{t('trends.offDay')}</Text>
            <Text style={styles.kvValue}>{dayLabel(insights.worstDay.dateKey, locale)}</Text>
          </View>
          {insights.weightSlopeLbPerWeek != null ? (
            // The row names a trend the Body tab draws — so it goes there.
            <PressScale
              style={[styles.kv, styles.kvLink]}
              accessibilityRole="link"
              accessibilityHint={t('a11y.opensBody')}
              onPress={() => { haptics.tap(); onOpenBody(); }}
              testID="weight-trend-row"
            >
              <Text style={styles.kvLabel}>{t('trends.weightTrend')}</Text>
              <View style={styles.kvLinkValue}>
                <Text style={styles.kvValue}>{slopeLabel(insights.weightSlopeLbPerWeek, unitSystem, t, locale)}</Text>
                <Glyph ios="chevron.right" android="chevron-forward" size={14} color={colors.faint} />
              </View>
            </PressScale>
          ) : null}
        </>
      ) : (
        <PressScale
          style={styles.proRow}
          accessibilityRole="button"
          onPress={() => { haptics.tap(); onUpsell(); }}
          testID="deeper-pro"
        >
          <Glyph ios="lock.fill" android="lock-closed" size={13} color={colors.muted} />
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
  sub2,
  sub2Color,
  faded,
  testID,
  styles,
}: {
  label: string;
  value?: string;
  unit?: string;
  sub?: string;
  subColor?: string;
  /** A second, independent line (the vs-target line under vs-maintenance). */
  sub2?: string;
  sub2Color?: string;
  faded?: boolean;
  testID?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.tile} testID={testID}>
      <Text style={styles.tileLabel}>{label}</Text>
      {faded ? (
        <View style={styles.tileSkeleton} />
      ) : (
        <View style={styles.tileValueRow}>
          {/* One line, shrinking to fit rather than wrapping a numeral in
              half — at the largest text sizes "2,450" stays one number. */}
          <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</Text>
          {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
        </View>
      )}
      {sub ? <Text style={[styles.tileSub, subColor ? { color: subColor } : null]}>{sub}</Text> : faded ? <View style={styles.tileSkeletonSub} /> : null}
      {sub2 ? <Text style={[styles.tileSub, sub2Color ? { color: sub2Color } : null]}>{sub2}</Text> : null}
    </View>
  );
}

// ─── Weekly budget ──────────────────────────────────────────────
function Budget({
  budget,
  onOpenDay,
  styles,
  colors,
  t,
  locale,
}: {
  budget: WeeklyBudget | null;
  onOpenDay: (dateKey: string) => void;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
  locale: Locale;
}) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const menuLabel = menuKey ? t('trends.chart.openDay', { date: dayLabel(menuKey, locale) }) : null;
  // The pill, announced — the same rule as the line charts' pill.
  useEffect(() => {
    if (menuLabel) announce(menuLabel);
  }, [menuLabel]);
  const bars = budget?.bars ?? [];
  const todayIdx = budget ? budget.daysElapsed - 1 : -1;
  const labelAt = (i: number) => {
    const b = bars[i];
    if (!b || !budget) return '';
    const date = dayLabel(b.dateKey, locale);
    const kcal = formatNumber(Math.round(b.calories), locale);
    if (!b.elapsed) return t('trends.chart.budgetPointFuture', { date });
    if (b.assumed) return t('trends.chart.budgetPointAssumed', { date });
    if (i === todayIdx) return t('trends.chart.budgetPointToday', { date, kcal });
    return b.calories > budget.dailyTarget
      ? t('trends.chart.budgetPointOver', { date, kcal })
      : t('trends.chart.budgetPoint', { date, kcal });
  };
  const stepper = useAdjustableDays(
    bars.length,
    budget
      ? t('a11y.chart.budget', {
          logged: bars.filter((b) => b.calories > 0).length,
          over: bars.filter((b) => b.calories > budget.dailyTarget).length,
          target: formatNumber(budget.dailyTarget, locale),
        })
      : '',
    labelAt,
    {
      actions: [
        { name: 'openDay', label: t('trends.chart.openDayAction'), run: (i) => bars[i] && onOpenDay(bars[i].dateKey) },
      ],
    },
  );

  // The audio graph the line charts have (iOS VoiceOver's rotor), from the
  // stepper's own sentences. An assumed or future day is silence, not the
  // target and not a zero — it was never eaten.
  const budgetKeys = useMemo(() => bars.map((b) => b.dateKey), [bars]);
  const budgetValues = useMemo(() => bars.map((b) => (b.elapsed && !b.assumed ? Math.round(b.calories) : null)), [bars]);
  const budgetLabels = bars.map((_, i) => labelAt(i));
  const descriptor = useStripAudioGraph({
    title: t('trends.budgetTitle'),
    summary: typeof stepper.a11y.accessibilityLabel === 'string' ? stepper.a11y.accessibilityLabel : '',
    xTitle: t('entry.date'),
    unit: 'kcal',
    dateKeys: budgetKeys,
    values: budgetValues,
    pointLabels: budgetLabels,
    locale,
  });

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

  const used = t('trends.budgetUsedValue', {
    used: formatNumber(Math.round(budget.consumed), locale),
    total: formatNumber(budget.weeklyBudget, locale),
  });
  return (
    <View style={styles.card} testID="budget-card">
      {/* Names the window: this face is the Mon–Sun week, the other is the
          trailing seven days. */}
      <Text style={styles.sub} testID="budget-week">
        {t('trends.budgetWeek', {
          from: shortDay(bars[0].dateKey, locale),
          to: shortDay(bars[bars.length - 1].dateKey, locale),
        })}
      </Text>
      <View style={styles.kv} accessible accessibilityLabel={`${t('trends.budgetUsed')}, ${used}`}>
        <Text style={styles.kvLabel}>{t('trends.budgetUsed')}</Text>
        <Text style={styles.kvValue}>{used}</Text>
      </View>
      {/* One adjustable element, not seven bars — a reader hears the week in a
          sentence and can step a day at a time (UX_AUDIT S18-5 made it one
          image; the review asked for the days back). The hairline is the
          target height (the bars scale so that target = 70% of the track),
          and its value is printed at the right end. An over-target day carries
          an outline and an underlined day letter as well as the red, so the
          cue survives colour-blindness; an unlogged past day is a dashed
          outline AT the target, because that is what the arithmetic assumed.
          Tap a day to open it in History (it was long-press only, and nothing
          said so); long-press is the system context menu on iOS. */}
      <View style={styles.barArea}>
        <AccessibleChart {...stepper.a11y} descriptor={descriptor} style={styles.barStrip} testID="budget-strip">
          {bars.map((b, i) => {
            const h = b.calories > 0 && budget.dailyTarget > 0 ? Math.max(6, Math.min(100, (b.calories / budget.dailyTarget) * 70)) : 0;
            const over = b.calories > budget.dailyTarget;
            const column = (
              <Pressable
                key={b.dateKey}
                style={styles.barCol}
                onPress={() => onOpenDay(b.dateKey)}
                onLongPress={CONTEXT_MENUS ? undefined : () => { haptics.tap(); setMenuKey(b.dateKey); }}
                // Inside the adjustable element above, so never a separate stop.
                accessible={false}
                testID={`budget-bar-${b.dateKey}`}
              >
                <View style={styles.barTrack}>
                  {b.assumed ? (
                    <View style={styles.barAssumed} testID={`budget-bar-assumed-${b.dateKey}`} />
                  ) : (
                    <View
                      style={[
                        styles.barFill,
                        // `good` on the track instead of the bright `ring`:
                        // light `ring` on the track measured 2.26:1, under the
                        // 3:1 a graphical object needs (WCAG 1.4.11).
                        { height: `${h}%`, backgroundColor: over ? colors.danger : colors.good, opacity: b.elapsed ? 1 : 0.3 },
                        over && styles.barFillOver,
                      ]}
                      testID={over ? `budget-bar-over-${b.dateKey}` : undefined}
                    />
                  )}
                  {/* The target, as the habit strips draw their median: a full-
                      strength ink line over a card-colour halo. `ink` at 55%
                      measured 2.07:1 over a `good` bar — gone exactly where
                      it mattered (WCAG 1.4.11). */}
                  <MedianLine bottomPct={70} />
                </View>
                <Text style={[styles.barDay, over && styles.barDayOver]} maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE}>
                  {weekdayNarrow(b.dateKey, locale)}
                </Text>
              </Pressable>
            );
            if (!CONTEXT_MENUS) return column;
            // iOS: the system menu, the day's sentence as its preview. The
            // outer View keeps the column's share of the row — the menu's
            // native wrapper would otherwise size to its content.
            return (
              <View key={b.dateKey} style={styles.barSlot}>
                <ContextMenu
                  title={dayLabel(b.dateKey, locale)}
                  actions={[{ key: 'open', title: t('trends.chart.openDayAction'), icon: 'calendar', onPress: () => onOpenDay(b.dateKey) }]}
                  preview={
                    <View style={styles.menuPreview}>
                      <Text style={styles.menuPreviewText}>{labelAt(i)}</Text>
                    </View>
                  }
                  previewSize={{ width: 300, height: 88 }}
                  onPreviewPress={() => onOpenDay(b.dateKey)}
                >
                  {column}
                </ContextMenu>
              </View>
            );
          })}
        </AccessibleChart>
        <Text style={styles.barTargetLabel} maxFontSizeMultiplier={CHART_TEXT_MAX_SCALE} accessibilityElementsHidden importantForAccessibility="no">
          {t('trends.chart.targetLabel', { kcal: formatNumber(budget.dailyTarget, locale) })}
        </Text>
      </View>
      {menuKey && !CONTEXT_MENUS ? (
        <View style={styles.menu}>
          <PressScale
            style={styles.menuBtn}
            accessibilityRole="button"
            onPress={() => { const k = menuKey; setMenuKey(null); onOpenDay(k); }}
            testID="budget-open-day"
          >
            <Text style={styles.menuText}>{menuLabel}</Text>
          </PressScale>
          <PressScale style={styles.menuClose} accessibilityRole="button" accessibilityLabel={t('a11y.close')} onPress={() => setMenuKey(null)}>
            <Svg width={12} height={12}>
              <SvgLine x1={1} y1={1} x2={11} y2={11} stroke={colors.muted} strokeWidth={1.5} />
              <SvgLine x1={11} y1={1} x2={1} y2={11} stroke={colors.muted} strokeWidth={1.5} />
            </Svg>
          </PressScale>
        </View>
      ) : null}
      {budget.unloggedDays > 0 ? (
        <Text style={styles.weekHint} testID="budget-assumed">
          {plural(t, locale, 'trends.budgetAssumed', budget.unloggedDays)}
        </Text>
      ) : null}
      <View style={styles.divider} />
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>{t('trends.budgetRemaining')}</Text>
        {/* Same pair as the insights tile: `good`, not `accent`, against
            `danger` — the sign glyph below is the non-colour cue. */}
        <Text style={[styles.kvValue, { color: budget.remaining < 0 ? colors.danger : colors.good }]}>
          {budget.remaining < 0 ? '−' : ''}
          {formatNumber(Math.abs(Math.round(budget.remaining)), locale)} kcal
        </Text>
      </View>
      {/* Today is IN the divisor (its intake is already in "remaining"), and
          the label says so. */}
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>{t('trends.budgetPerDayInclToday')}</Text>
        <Text style={styles.kvValue} testID="budget-per-day">
          {budget.perDayInclToday < 0 ? t('trends.budgetOver') : `${formatNumber(budget.perDayInclToday, locale)} kcal`}
        </Text>
      </View>
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
    // Pushes the "?" up against the avatar instead of leaving it stranded in
    // the middle of the row, which `space-between` would otherwise do.
    headerHelp: { marginLeft: 'auto', marginRight: space.md },
    title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // `paddingBottom` is FAB_BAND, not `space.xl`: the floating + button
    // overhangs the scroll area, and 24 dp left the last element under it.
    // That is #96 — the Coach row was untappable — and it caught the fasting
    // card's footer too once #98 added a sixth element below Coach.
    body: { padding: space.xl, paddingBottom: FAB_BAND, gap: space.sm },
    error: { color: colors.danger, fontSize: font.small, flex: 1 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    retryBtn: { borderWidth: 1, borderColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center' },
    retryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    // Hero
    heroPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.xs, ...shadow.e2 },
    heroTop: { alignItems: 'center', gap: space.xs, alignSelf: 'stretch' },
    hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
    heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
    heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
    heroCi: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, fontVariant: ['tabular-nums'] },
    heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
    heroHint: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs },
    heroSub: { textAlign: 'center', color: colors.heroMuted, fontSize: font.tiny, opacity: 0.8 },
    heroChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
    trendChip: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, backgroundColor: colors.heroTrack, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
    trendChipLabel: { fontSize: font.small, color: colors.heroMuted },
    trendChipValue: { fontSize: font.small, color: colors.heroText, fontFamily: type.heading },
    badge: { backgroundColor: colors.heroTrack, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3 },
    badgeText: { color: colors.heroText, fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    section: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space.lg, marginBottom: space.xs },
    card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm },
    // Panel tabs. Sized to content and left-aligned rather than stretched, so
    // the strip reads as a label for the card below it — which is the slot it
    // replaced — rather than as a form control the user is being asked to
    // operate. Full-width buttons (the Settings `segment` style) look like a
    // question; these look like a heading. Wraps at large text sizes rather
    // than running off the screen.
    tabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignSelf: 'flex-start',
      gap: space.xs,
      marginTop: space.lg,
      marginBottom: space.xs,
      padding: 3,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
    },
    // 44pt tall (WCAG 2.5.5 / Apple HIG). The transparent border keeps an
    // inactive tab the same size as the active one, which carries a real one.
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent' },
    // In dark mode `card` and `inputBg` are the SAME colour (#1d1b18), so the
    // selected tab was invisible against its strip (1.00:1). The `lineStrong`
    // border is the selection cue in both themes; the fill is a bonus in light.
    tabOn: { backgroundColor: colors.card, borderColor: colors.lineStrong },
    // Identity dot — sized to read as a mark beside the label, not a badge.
    tabDot: { width: 7, height: 7, borderRadius: radius.pill },
    tabText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    tabTextOn: { color: colors.ink, fontWeight: '700' },
    // Stat tiles
    tileRow: { flexDirection: 'row', alignItems: 'stretch' },
    tileRowStacked: { flexDirection: 'column', gap: space.sm },
    tileDivider: { width: 1, backgroundColor: colors.line, marginHorizontal: space.md },
    tile: { flex: 1, gap: space.xs },
    tileLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    tileValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
    tileValue: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, flexShrink: 1 },
    tileUnit: { fontSize: font.small, color: colors.muted, marginBottom: 4 },
    tileSub: { fontSize: font.small, color: colors.muted },
    tileSkeleton: { height: 30, width: '70%', borderRadius: radius.sm, backgroundColor: colors.line, marginVertical: 2 },
    tileSkeletonSub: { height: 12, width: '50%', borderRadius: radius.sm, backgroundColor: colors.line, opacity: 0.6 },
    weekNudge: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    weekHint: { fontSize: font.small, color: colors.muted },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
    kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    kvLink: { minHeight: 44 },
    kvLinkValue: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    kvLabel: { fontSize: font.body, color: colors.muted, flexShrink: 1 },
    kvValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
    sub: { fontSize: font.small, color: colors.faint },
    // Pro row / cards
    proRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
    proRowText: { flex: 1, fontSize: font.small, color: colors.muted, fontWeight: '600' },
    activityProgress: { fontSize: font.small, color: colors.muted, marginTop: space.sm, paddingHorizontal: space.xs },
    // Activity-level correction card (sits directly under the hero it changes)
    correctionCard: { flexDirection: 'row', gap: space.md, marginTop: space.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg },
    correctionTitle: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    correctionBody: { fontSize: font.small, color: colors.muted },
    correctionEvidence: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs, opacity: 0.85 },
    correctionActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.md },
    // Both 44pt — they were ~33.
    correctionPrimary: { backgroundColor: colors.ink, borderRadius: radius.md, minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
    correctionPrimaryText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
    correctionDismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md },
    correctionDismissText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
    proCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg },
    proIcon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
    proCardTitle: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    proCardSub: { fontSize: font.small, color: colors.muted, marginTop: 1 },
    proPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
    proPillText: { color: colors.onInk, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.5 },
    // Coach button
    coachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.lg, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.md, minHeight: 44 },
    coachBtnText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
    // Budget bars. The strip grows with its day letters (no fixed outer
    // height) so a larger text size cannot clip them; the TRACK stays fixed,
    // because the bar heights are fractions of it.
    barArea: { marginVertical: space.xs },
    barStrip: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    barCol: { flex: 1, alignItems: 'center', gap: 4 },
    barTrack: { width: '55%', height: 64, borderRadius: radius.sm, backgroundColor: colors.line, justifyContent: 'flex-end', overflow: 'hidden' },
    barFill: { width: '100%', borderRadius: radius.sm },
    barFillOver: { borderWidth: 1.5, borderColor: colors.ink },
    // An unlogged past day: an outline at the target height (70%), dashed —
    // "assumed", drawn as exactly what the arithmetic assumed.
    barAssumed: { width: '100%', height: '70%', borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.lineStrong },
    // A column's share of the row when it is wrapped in a native context menu.
    barSlot: { flex: 1 },
    barTargetLabel: { alignSelf: 'flex-end', fontSize: font.tiny, color: colors.muted, fontWeight: '700', marginTop: 2 },
    barDayOver: { textDecorationLine: 'underline', fontWeight: '800', color: colors.ink },
    barDay: { fontSize: font.tiny, color: colors.faint, textTransform: 'uppercase' },
    menu: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.xs },
    menuBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.ink },
    menuText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
    menuClose: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    menuPreview: { flex: 1, justifyContent: 'center', padding: space.md, backgroundColor: colors.card },
    menuPreviewText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
    clipNote: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs, paddingHorizontal: space.xs },
    streakRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    streakText: { fontSize: font.small, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  });
