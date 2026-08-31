import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type TdeeResult,
  type WeeklyBudget,
  type WeeklyInsights,
  activityMultiplier as activityMultiplierFor,
  parseYmd,
} from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { NumbersGlossary } from '@/components/NumbersGlossary';
import { SleepTrendsCard } from '@/components/SleepTrendsCard';
import { FastingTrendsCard } from '@/components/FastingTrendsCard';
import { WaterTrendsCard } from '@/components/WaterTrendsCard';
import { WeeklyReportCard } from '@/components/WeeklyReportCard';
import { useTrends } from '@/hooks/useTrends';
import { usePersistedTab } from '@/hooks/usePersistedTab';
import { HABIT_TABS, TRENDS_HABIT_TAB_KEY, habitColor } from '@/lib/habit-identity';
import { useActivitySuggestion } from '@/lib/activity-suggestion';
import { useAuth } from '@/lib/auth';
import { useSubscription, PRO_ENABLED } from '@/lib/subscription';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { FAB_BAND, font, radius, space, type } from '@/theme';
import { formatDate, formatNumber } from '@/lib/date-format';

function dayLabel(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekdayNarrow(dateKey: string, locale: Locale): string {
  return formatDate(parseYmd(dateKey), locale, { weekday: 'narrow' });
}

function slopeLabel(slope: number, t: TFn): string {
  if (Math.abs(slope) < 0.1) return t('body.holdingSteady');
  return `${slope < 0 ? '−' : '+'}${Math.abs(slope).toFixed(1)} ${t('refine.paceUnit')}`;
}

// seed/formula both read as "Estimate" to the user; measured is "Adaptive".
/** Bucket → the label the activity-correction card names it by (shared with
 *  the Refine Targets picker, so both surfaces say the same word). */
const TDEE_MODE: Record<TdeeResult['source'], { badgeKey: I18nKey; hintKey: I18nKey }> = {
  measured: { badgeKey: 'trends.measured', hintKey: 'trends.measuredHint' },
  formula: { badgeKey: 'trends.estimate', hintKey: 'trends.formulaHint' },
  seed: { badgeKey: 'trends.estimate', hintKey: 'trends.seedHint' },
};

export default function Trends() {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { loading, error, insights, loggedThisWeek, proteinTarget, tdee, targetCalories, budget, basalKcal, activityLevel, sleep, fasting, water } = useTrends();
  // A Today habit chip lands here with `?habits=<nonce>` — scroll the strip
  // into view so the user sees what they tapped for instead of the hero
  // (UX_AUDIT S16-6). A nonce, not a flag: expo-router keeps a visited Trends
  // MOUNTED and `router.replace` re-focuses the live instance, so only a
  // changing value re-fires (the same contract as Today's `openAdd`).
  const scrollRef = useRef<ScrollView>(null);
  const habitsY = useRef(0);
  const { habits: habitsNonce } = useLocalSearchParams<{ habits?: string }>();
  useEffect(() => {
    if (!habitsNonce) return;
    // Next frame: a fresh mount has not laid out yet when the param arrives.
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: habitsY.current, animated: true });
    });
    return () => cancelAnimationFrame(id);
  }, [habitsNonce]);
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
  const { isPro } = useSubscription();
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.trends')}</Text>
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
          <Ionicons name="help-circle-outline" size={24} color={colors.muted} />
        </TouchableOpacity>
        <HeaderAvatar />
      </View>
      <NumbersGlossary visible={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      {loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
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
                  {targetCalories > 0 ? `${formatNumber(targetCalories, locale)} kcal` : '—'}
                </Text>
              </Text>
            </View>
          </Animated.View>

          {/* 1b. Activity correction — sits under the hero because it changes
              the number above it. Distinct from RecalibrationCard (measured
              mode only): this one corrects the self-reported activity bucket
              the FORMULA estimate rests on. Confirm-not-silent — tapping opens
              Refine Targets pre-filled; the user still saves. */}
          {suggestion ? (
            <Animated.View style={styles.correctionCard} entering={enterUp(1)} testID="activity-correction">
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.correctionTitle}>{t('trends.activityCorrectionTitle')}</Text>
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
                    onPress={() => {
                      haptics.tap();
                      router.push(`/refine-targets?suggested=${suggestion}` as Href);
                    }}
                    testID="activity-correction-review"
                  >
                    <Text style={styles.correctionPrimaryText}>{t('trends.activityCorrectionCta')}</Text>
                  </PressScale>
                  <PressScale
                    style={styles.correctionDismiss}
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

          {/* 2. WEEKLY PANEL — This week ⇄ Budget behind one tab strip.
              ADR-0034 decision 4: consolidation is the lever to reach for
              before configuration, and this is the mobile half of the merge the
              web already did (`CONTEXT.md` → Weekly panel).

              Both faces are "always render, never blank", so the strip is
              unconditional here. The tabs sit where the two uppercase section
              labels used to, which is what keeps the page rhythm intact — one
              label slot, one card, instead of two of each. */}
          <Animated.View entering={enterUp(1)}>
            <PanelTabs
              tabs={[
                { key: 'week', label: t('trends.thisWeek') },
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
                proteinTarget={proteinTarget}
                isPro={isPro}
                onUpsell={() => router.push('/coach' as Href)}
                styles={styles}
                colors={colors}
                t={t}
                locale={locale}
              />
            ) : (
              <Budget budget={budget} styles={styles} colors={colors} t={t} locale={locale} />
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
                entering={enterUp(2)}
                onLayout={(e) => { habitsY.current = e.nativeEvent.layout.y; }}
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
              <Animated.View entering={enterUp(3)}>
                {sleep.kind !== 'card' ? <SleepTrendsCard sleep={sleep} /> : null}
                {fasting.kind !== 'card' ? <FastingTrendsCard fasting={fasting} /> : null}
                {water.kind !== 'card' ? <WaterTrendsCard water={water} /> : null}
              </Animated.View>
            </>
          ) : (
            <>
              <Animated.View
                entering={enterUp(2)}
                onLayout={(e) => { habitsY.current = e.nativeEvent.layout.y; }}
              >
                <SleepTrendsCard sleep={sleep} />
              </Animated.View>
              <Animated.View entering={enterUp(3)}>
                <FastingTrendsCard fasting={fasting} />
              </Animated.View>
              <Animated.View entering={enterUp(4)}>
                <WaterTrendsCard water={water} />
              </Animated.View>
            </>
          )}

          {/* 6. Coach — the Pro AI action. */}
          <Animated.View entering={enterUp(5)}>
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

          {/* 6. Weekly report — Pro + server-entitled AI feature; hidden in
              the free v1 (no IAP → its "PRO" tag + generate would dead-end). */}
          {PRO_ENABLED ? (
            <Animated.View entering={enterUp(5)}>
              <WeeklyReportCard />
            </Animated.View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── This-week adherence ────────────────────────────────────────
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
    <View style={styles.tabs} testID="panel-tabs">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <PressScale
            key={tab.key}
            style={[styles.tab, on && styles.tabOn]}
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

function ThisWeek({
  insights,
  loggedThisWeek,
  proteinTarget,
  isPro,
  onUpsell,
  styles,
  colors,
  t,
  locale,
}: {
  insights: WeeklyInsights | null;
  loggedThisWeek: number;
  proteinTarget: number;
  isPro: boolean;
  onUpsell: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
  locale: Locale;
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
          value={`${formatNumber(insights.avgCalories, locale)}`}
          unit="kcal"
          sub={`${formatNumber(Math.abs(deficit), locale)} ${deficit >= 0 ? t('trends.avgDeficit') : t('trends.avgSurplus')}`}
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
            <Text style={styles.kvValue}>{dayLabel(insights.bestDay.dateKey, locale)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.kvLabel}>{t('trends.offDay')}</Text>
            <Text style={styles.kvValue}>{dayLabel(insights.worstDay.dateKey, locale)}</Text>
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
  locale,
}: {
  budget: WeeklyBudget | null;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  t: TFn;
  locale: Locale;
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
          {formatNumber(Math.round(budget.consumed), locale)} / {formatNumber(budget.weeklyBudget, locale)}
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
              <Text style={styles.barDay}>{weekdayNarrow(b.dateKey, locale)}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.divider} />
      <View style={styles.kv}>
        <Text style={styles.kvLabel}>{t('trends.budgetRemaining')}</Text>
        <Text style={[styles.kvValue, { color: budget.remaining < 0 ? colors.danger : colors.accent }]}>
          {budget.remaining < 0 ? '−' : ''}
          {formatNumber(Math.abs(Math.round(budget.remaining)), locale)} kcal
        </Text>
      </View>
      {budget.pacePerRemainingDay != null ? (
        <View style={styles.kv}>
          <Text style={styles.kvLabel}>{t('trends.budgetPerDay')}</Text>
          <Text style={styles.kvValue}>
            {budget.pacePerRemainingDay < 0 ? t('trends.budgetOver') : `${formatNumber(budget.pacePerRemainingDay, locale)} kcal`}
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
    // Panel tabs. Sized to content and left-aligned rather than stretched, so
    // the strip reads as a label for the card below it — which is the slot it
    // replaced — rather than as a form control the user is being asked to
    // operate. Full-width buttons (the Settings `segment` style) look like a
    // question; these look like a heading.
    tabs: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      gap: space.xs,
      marginTop: space.lg,
      marginBottom: space.xs,
      padding: 3,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
    },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.sm },
    tabOn: { backgroundColor: colors.card },
    // Identity dot — sized to read as a mark beside the label, not a badge.
    tabDot: { width: 7, height: 7, borderRadius: radius.pill },
    tabText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    tabTextOn: { color: colors.ink, fontWeight: '700' },
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
    activityProgress: { fontSize: font.small, color: colors.muted, marginTop: space.sm, paddingHorizontal: space.xs },
    // Activity-level correction card (sits directly under the hero it changes)
    correctionCard: { flexDirection: 'row', gap: space.md, marginTop: space.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg },
    correctionTitle: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    correctionBody: { fontSize: font.small, color: colors.muted },
    correctionEvidence: { fontSize: font.tiny, color: colors.muted, marginTop: space.xs, opacity: 0.85 },
    correctionActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
    correctionPrimary: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.lg },
    correctionPrimaryText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
    correctionDismiss: { paddingVertical: space.sm, paddingHorizontal: space.md },
    correctionDismissText: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
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
