import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { markTourSeen } from '@/lib/tour';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

/**
 * The guided tour — F0 in `UX_AUDIT.md`, and the one thing a real user
 * actually asked for: *"she needs some kind of tutorial or something. Like a
 * walkthrough of the app."*
 *
 * ## Why it is CARDS and not coach marks on the live UI
 *
 * A spotlight overlay has to measure real elements and drive real navigation
 * across four tabs. Two things in this repo say do not: `jest` renders the
 * element tree and never runs a Yoga layout pass, so nothing here would catch a
 * misplaced spotlight; and `uiautomator` reports UNTRANSFORMED bounds, so the
 * device harness cannot verify one either. A coach mark that lands 90px off is
 * invisible to every check we own. Cards are laid out by the same flexbox as
 * every other screen and fail visibly or not at all.
 *
 * ## What each card is for
 *
 * The content is not a feature list. Each card answers a question that stops a
 * cautious person from trying anything, and the shape comes from GenderMag's
 * facets rather than from taste:
 *
 *  - `map` — comprehensive information processing: the WHOLE app before the
 *    first step, so it can be understood as a shape rather than met one
 *    surprise at a time.
 *  - `numbers` — the two most-viewed numbers in the app are `kcal` and
 *    `maintenance`, and neither is defined anywhere else (UX_AUDIT F6).
 *  - `log` — the food search is labelled "Manual entry" on the speed dial,
 *    which is the most discouraging possible name for the easiest path
 *    (UX_AUDIT F4). Until that is renamed, this card is what says it exists.
 *  - `body`, `targets` — what the app does on its own, and how to overrule it.
 *  - `done` — reversibility, stated plainly. Low computer self-efficacy and
 *    risk aversion are two more facets, and "can I undo this?" is the question
 *    they ask. Almost everything here IS reversible and nothing said so.
 *
 * Skippable from any step and replayable from Settings → How Ignia works.
 * A tour that cannot be re-opened punishes whoever dismissed it before they
 * understood it.
 */

/** One labelled row inside a card: icon, bold label, explanation. */
interface Row {
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: I18nKey;
  subKey: I18nKey;
}

interface Step {
  id: string;
  titleKey: I18nKey;
  /** Optional lead paragraph above the rows. */
  bodyKey?: I18nKey;
  rows?: Row[];
  /** Optional reassurance panel below the rows — the "you can undo this" note. */
  noteKeys?: I18nKey[];
}

const STEPS: Step[] = [
  {
    id: 'map',
    titleKey: 'tour.map.title',
    bodyKey: 'tour.map.body',
    rows: [
      { icon: 'today-outline', labelKey: 'tour.map.today', subKey: 'tour.map.todaySub' },
      { icon: 'barbell-outline', labelKey: 'tour.map.train', subKey: 'tour.map.trainSub' },
      { icon: 'trending-up-outline', labelKey: 'tour.map.trends', subKey: 'tour.map.trendsSub' },
      { icon: 'body-outline', labelKey: 'tour.map.bodyTab', subKey: 'tour.map.bodySub' },
      { icon: 'add-circle', labelKey: 'tour.map.add', subKey: 'tour.map.addSub' },
    ],
  },
  {
    id: 'numbers',
    titleKey: 'tour.numbers.title',
    rows: [
      { icon: 'flame-outline', labelKey: 'tour.numbers.calories', subKey: 'tour.numbers.caloriesSub' },
      { icon: 'egg-outline', labelKey: 'tour.numbers.protein', subKey: 'tour.numbers.proteinSub' },
      { icon: 'speedometer-outline', labelKey: 'tour.numbers.maintenance', subKey: 'tour.numbers.maintenanceSub' },
    ],
  },
  {
    id: 'log',
    titleKey: 'tour.log.title',
    rows: [
      { icon: 'search-outline', labelKey: 'tour.log.search', subKey: 'tour.log.searchSub' },
      { icon: 'camera-outline', labelKey: 'tour.log.photo', subKey: 'tour.log.photoSub' },
      { icon: 'create-outline', labelKey: 'tour.log.manual', subKey: 'tour.log.manualSub' },
    ],
    noteKeys: ['tour.log.undo'],
  },
  {
    id: 'body',
    titleKey: 'tour.body.title',
    bodyKey: 'tour.body.body',
    noteKeys: ['tour.body.trend'],
  },
  {
    id: 'targets',
    titleKey: 'tour.targets.title',
    bodyKey: 'tour.targets.body',
    noteKeys: ['tour.targets.custom', 'tour.targets.refine'],
  },
  {
    id: 'done',
    titleKey: 'tour.done.title',
    bodyKey: 'tour.done.body',
    noteKeys: ['tour.done.replay'],
  },
];

export default function Tour() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  /** Both exits mark it seen. Skipping is a decision; re-offering it next
   *  launch would override that decision, which is how a helpful tour becomes
   *  an obstacle. `replace` so hardware back cannot land back inside a tour
   *  the user just left.
   *
   *  Deliberately NOT tracked. `USAGE_EVENTS` in `packages/core` is a closed
   *  list that exists to answer four named questions and is validated by
   *  `firestore.rules`, so a `tour_complete` event would mean editing the list,
   *  deploying rules BEFORE any client writes it, and widening a surface the
   *  repo keeps narrow on purpose — all to measure a screen whose value does
   *  not depend on the measurement. */
  function leave() {
    haptics.tap();
    void markTourSeen();
    router.replace('/(app)');
  }

  function go(delta: 1 | -1) {
    haptics.tap();
    setDir(delta);
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  }

  const entering = (dir === 1 ? FadeInRight : FadeInLeft)
    .duration(motion.dur.base)
    .reduceMotion(ReduceMotion.System);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* Top bar: progress dots + a skip that is available on every step. */}
      <View style={styles.topBar}>
        <View style={styles.dots}>
          {STEPS.map((s, i) => (
            <View key={s.id} style={[styles.dot, i === index && styles.dotOn, i < index && styles.dotDone]} />
          ))}
        </View>
        <PressScale
          style={styles.skip}
          scaleTo={0.94}
          onPress={leave}
          accessibilityRole="button"
          testID="tour-skip"
        >
          <Text style={styles.skipText}>{t('tour.skip')}</Text>
        </PressScale>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View key={step.id} entering={entering} style={styles.card} testID={`tour-step-${step.id}`}>
          <Text style={styles.counter}>
            {t('tour.progress', { n: index + 1, total: STEPS.length })}
          </Text>
          <Text style={styles.title}>{t(step.titleKey)}</Text>
          {step.bodyKey ? <Text style={styles.body}>{t(step.bodyKey)}</Text> : null}

          {step.rows ? (
            <View style={styles.rows}>
              {step.rows.map((r) => (
                <View key={r.labelKey} style={styles.row}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={r.icon} size={20} color={colors.ink} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{t(r.labelKey)}</Text>
                    <Text style={styles.rowSub}>{t(r.subKey)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {step.noteKeys?.length ? (
            <View style={styles.notes}>
              {step.noteKeys.map((k) => (
                <Text key={k} style={styles.note}>
                  {t(k)}
                </Text>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>

      {/* Footer sits inside the tab layout, so it clears the tab bar rather
          than the safe-area inset — `edges` deliberately omits 'bottom'. */}
      <View style={styles.footer}>
        {index > 0 ? (
          <PressScale
            style={styles.back}
            scaleTo={0.97}
            onPress={() => go(-1)}
            accessibilityRole="button"
            testID="tour-back"
          >
            <Text style={styles.backText}>{t('tour.back')}</Text>
          </PressScale>
        ) : null}
        <PressScale
          style={styles.cta}
          scaleTo={0.98}
          onPress={last ? leave : () => go(1)}
          accessibilityRole="button"
          testID={last ? 'tour-done' : 'tour-next'}
        >
          <Text style={styles.ctaText}>{last ? t('tour.done') : t('tour.next')}</Text>
        </PressScale>
      </View>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      // minHeight, not height: a fixed 44 cropped the descender on "Skip" —
      // it rendered as "Skin" on the LG G6. Font scaling makes that worse,
      // never better, so the row has to be free to grow.
      minHeight: 44,
    },
    dots: { flexDirection: 'row', gap: space.xs },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line },
    dotOn: { width: 22, backgroundColor: colors.ink },
    dotDone: { backgroundColor: colors.accent },
    skip: { paddingVertical: space.sm, paddingHorizontal: space.sm },
    skipText: { fontSize: font.body, lineHeight: font.body * 1.4, color: colors.muted },
    // flexGrow centres a short card and scrolls a tall one — the map step is
    // five rows and overflows a 360x720dp screen.
    // flexGrow centres a short card and scrolls a tall one. The bottom pad is
    // load-bearing rather than cosmetic: the map step is five rows and overflows
    // a 360x720dp screen, and without it the fifth row sat under the pinned CTA
    // — on the device it simply was not there.
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: space.xl,
      paddingTop: space.lg,
      paddingBottom: space.xxl,
    },
    card: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: space.md },
    counter: { fontSize: font.tiny, color: colors.faint, letterSpacing: 0.6, textTransform: 'uppercase' },
    title: { fontFamily: type.display, fontSize: 28, color: colors.ink, lineHeight: 34 },
    body: { fontSize: font.body, color: colors.muted, lineHeight: font.body * 1.45 },
    rows: { gap: space.md, marginTop: space.xs },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
    rowIcon: {
      width: 38,
      height: 38,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
    rowSub: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
    notes: {
      gap: space.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.lg,
      marginTop: space.xs,
    },
    note: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.45 },
    footer: {
      flexDirection: 'row',
      gap: space.md,
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.md,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
    back: {
      paddingVertical: space.lg,
      paddingHorizontal: space.xl,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    cta: {
      flex: 1,
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
      ...shadow.e2,
    },
    ctaText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  });
