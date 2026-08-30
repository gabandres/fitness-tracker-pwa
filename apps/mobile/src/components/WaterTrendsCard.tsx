import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  WATER_CARD_MIN_DAYS,
  WATER_STRIP_CEILING_FLOZ,
  WATER_WINDOW_DAYS,
  waterBarFraction,
} from '@macrolog/core';
import type { WaterTrends } from '@/hooks/useWaterTrends';
import { useT, useLocale } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { StubLabel } from '@/components/StubLabel';
import { font, radius, space, type } from '@/theme';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';

/**
 * Water on Trends — a typical day, fourteen columns, a coverage line (#115 §3).
 *
 * ## Built to clear the bar the fasting card failed first
 *
 * The fasting card v1 rendered perfectly and was a bad chart: a real 16:8 habit
 * drew twelve bars between 65% and 73% of the strip — a barcode with no axis,
 * and the median line drawn in `faint` vanished into the bars. What fixed it was
 * three things, and all three are copied here deliberately rather than
 * rediscovered: **a sentence the chart cannot say** (a range — pure description),
 * **the median drawn in `ink` ON TOP** of the bars, and **a labelled axis** so a
 * bar height means something.
 *
 * Water is *more* prone to that failure than fasting, not less. Someone who
 * drinks consistently produces fourteen near-identical bars by definition, so
 * the range sentence is carrying most of the meaning and the strip is what makes
 * it checkable.
 *
 * ## What it refuses to draw
 *
 * **No goal, no ring, no streak, and no "you are behind".** Ignia holds no daily
 * water target, does not ask for one, and this card must not imply one — the
 * same call ADR-0032 made for fasting protocols and ADR-0028 made for soreness.
 * The reference line is the user's own median. The axis tops out at 100 fl oz
 * rather than at a gallon precisely so the scale is not read as a verdict; the
 * argument is in `water-history.ts` and a test defends it.
 *
 * **A day with no water logged is a hairline at the baseline**, never a
 * zero-height bar. Ignia cannot tell a day nobody logged from a day nobody
 * drank, and a zero would pick the second reading — a claim about the user
 * rather than about the data.
 *
 * ## The stub row is the feature for nine users in ten
 *
 * Measured, not assumed: 34 of 43 accounts (79%) have no water in a fourteen-day
 * window and 5 more are short of the bar (`scripts/trends-water-states.mjs`).
 * So this row, not the chart, is what almost everyone meets. It goes to Today,
 * where the water row and its quick pills are — the only place the emptiness can
 * actually be resolved — and `replace` rather than `push`, because Today is a
 * SIBLING TAB and pushing a tab route stacks a second copy of it over Trends.
 */
export function WaterTrendsCard({
  water,
  hideHeader = false,
}: {
  water: WaterTrends;
  /** True when this card is one face of a consolidated panel, whose tab strip
   *  already names it (ADR-0034 decision 4). Two labels for one card reads as a
   *  mistake. */
  hideHeader?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [stubDismissed, dismissStub] = useDismissedStub('trends.stub.water.dismissed');

  // The unit lives in one place across three locales — es-PR says `oz` where
  // the other two say `fl oz`.
  const unit = t('water.unit');

  if (water.kind === 'pending') return null;

  if (water.kind === 'empty') {
    // Dismissed rows render NOTHING — not a collapsed row, not a hairline.
    // A residue of the thing you asked to remove is worse than the thing.
    if (stubDismissed) return null;
    return (
      <View testID="water-empty-row">
        <View style={styles.hairline} />
        <View style={styles.stubRow}>
          <PressScale
            style={styles.linkRow}
            testID="water-empty-link"
            onPress={() => {
              haptics.tap();
              router.replace('/(app)');
            }}
          >
            <StubLabel
              text={
                water.recorded > 0
                  ? t('trends.waterEmptyProgress', {
                      n: formatNumber(water.recorded, locale),
                      need: formatNumber(WATER_CARD_MIN_DAYS, locale),
                    })
                  : t('trends.waterEmpty')
              }
            />
            <Ionicons name="chevron-forward" size={16} color={colors.faint} />
          </PressScale>
          {/* Dismiss sits OUTSIDE the navigating pressable rather than inside
              it — nesting one touchable in another makes which one fired depend
              on a few pixels, and the two actions here are opposites. */}
          <PressScale
            style={styles.stubDismiss}
            testID="water-stub-dismiss"
            accessibilityLabel={t('trends.stubDismiss')}
            onPress={() => {
              haptics.tap();
              dismissStub();
            }}
          >
            <Ionicons name="close" size={16} color={colors.faint} />
          </PressScale>
        </View>
        <View style={styles.hairline} />
      </View>
    );
  }

  const { window } = water;
  const median = Math.round(window.medianFlOz);

  return (
    <View testID="water-card">
      {hideHeader ? null : <Text style={styles.section}>{t('trends.waterTitle')}</Text>}
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.value} testID="water-median">
            {t('trends.waterHeadline', { n: formatNumber(median, locale), u: unit })}
          </Text>
          <Text style={styles.caption}>
            {t('trends.waterCaption', {
              n: formatNumber(window.daysLogged, locale),
              total: formatNumber(WATER_WINDOW_DAYS, locale),
            })}
          </Text>
        </View>

        <View style={styles.stripRow}>
          <View style={styles.strip} testID="water-strip">
            {window.days.map((day) => (
              <View key={day.dateKey} style={styles.col}>
                <View style={styles.track}>
                  {day.flOz == null ? (
                    <View style={styles.gap} />
                  ) : (
                    <View
                      style={[
                        styles.bar,
                        { height: `${Math.max(4, waterBarFraction(day.flOz) * 100)}%` },
                      ]}
                    />
                  )}
                </View>
              </View>
            ))}
            {/* Drawn AFTER the bars so it sits on top of them, and in `ink`
                rather than `faint`. This is what makes the chart readable at
                all: what a person can read is whether the bar TOPS hug a line,
                not whether fourteen similar heights differ. */}
            {window.medianFlOz > 0 ? (
              <View
                pointerEvents="none"
                style={[
                  styles.medianLine,
                  { bottom: `${waterBarFraction(window.medianFlOz) * 100}%` },
                ]}
              />
            ) : null}
          </View>
          {/* The axis. Without it no bar height means anything. Bare numbers —
              the unit is named once, in the legend, because 30dp does not hold
              "100 fl oz" at `font.tiny` and a clipped axis is worse than none. */}
          <View style={styles.axis} pointerEvents="none">
            <Text style={styles.axisLabel} testID="water-axis-max">
              {formatNumber(WATER_STRIP_CEILING_FLOZ, locale)}
            </Text>
            <Text style={styles.axisLabel}>{formatNumber(0, locale)}</Text>
          </View>
        </View>
        <Text style={styles.legend}>
          {t('trends.waterLegend', { n: formatNumber(median, locale), u: unit })}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.claim} testID="water-range">
          {t('trends.waterRange', {
            n: formatNumber(window.daysLogged, locale),
            low: formatNumber(Math.round(window.lowestFlOz), locale),
            high: formatNumber(Math.round(window.highestFlOz), locale),
            u: unit,
          })}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.foot} testID="water-coverage">
          {t('trends.waterCoverage', {
            n: formatNumber(window.daysLogged, locale),
            total: formatNumber(WATER_WINDOW_DAYS, locale),
          })}
        </Text>
      </View>
    </View>
  );
}

/** Strip height, in dp, shared by the bars, their tracks and the axis column —
 *  three boxes that MUST agree, or the axis stops naming the gridline it sits
 *  on and the median line lands at the wrong fraction. Matches the fasting
 *  card: the two sit behind one tab strip and a face that changes height when
 *  you switch tabs reads as a bug. */
const STRIP_H = 96;

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
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
    head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
    // A quantity in the display face, never a score.
    value: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    caption: { fontSize: font.small, color: colors.muted },
    stripRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: space.sm },
    strip: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', height: STRIP_H },
    col: { flex: 1, alignItems: 'center' },
    track: { width: '58%', height: STRIP_H, justifyContent: 'flex-end' },
    // Rounded at the TOP only: the bar grows off a baseline, and rounding its
    // foot makes it look like it is floating above the axis.
    bar: {
      width: '100%',
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      // `teal` is what the water row on Today already uses (`DailyMetrics`
      // `waterValue`), so the metric keeps one colour across two screens.
      backgroundColor: colors.teal,
    },
    gap: { width: '100%', height: 1, backgroundColor: colors.line },
    medianLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.ink,
      opacity: 0.55,
    },
    axis: {
      width: 30,
      height: STRIP_H,
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingLeft: space.xs,
    },
    // `lineHeight` equal to the font size, and NOT larger: the two labels are
    // pinned to the top and bottom of the strip, so any leading pushes them off
    // the gridline they are naming and the axis reads as approximate.
    axisLabel: { fontSize: font.tiny, color: colors.faint, lineHeight: font.tiny },
    legend: { fontSize: font.tiny, color: colors.faint },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
    claim: { fontSize: font.body, color: colors.ink, lineHeight: 22 },
    foot: { fontSize: font.tiny, color: colors.faint },
    // The under-threshold row: one line, hairline-bounded, no card.
    hairline: { height: 1, backgroundColor: colors.line },
    linkRow: {
      // `flex: 1` because this row shares a line with the dismiss. Without it
      // the row takes its intrinsic width and shoves the X past the scroll
      // body's padding, hard against the screen edge — caught on a device,
      // invisible to RNTL, which runs no Yoga pass.
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.md,
    },
    stubRow: { flexDirection: 'row', alignItems: 'center' },
    // Generous padding, small glyph: the target is 40dp tall against a 16dp
    // icon, because this is a one-way action sitting a few pixels from a
    // navigating one.
    stubDismiss: { paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.md },
  });
