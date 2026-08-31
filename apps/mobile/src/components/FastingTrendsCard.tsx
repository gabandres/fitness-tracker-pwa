import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  FASTING_CARD_MIN_FASTS,
  FASTING_STRIP_CEILING_HOURS,
  FASTING_WINDOW_DAYS,
  fastHoursParts,
  fastingBarFraction,
} from '@macrolog/core';
import type { FastingTrends } from '@/hooks/useFastingTrends';
import { useT, useLocale } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { StubLabel } from '@/components/StubLabel';
import { font, radius, space, type } from '@/theme';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';

/**
 * Fasting on Trends — a typical length, fourteen columns, a coverage line
 * (ADR-0034, issue #98).
 *
 * ## What it refuses to draw, and why the list is long
 *
 * **No metabolic-stage timeline.** "Ketosis at 12h, autophagy at 16h" is the
 * single most common feature in this category and ADR-0032 rules it out by
 * name: the claims behind it are not supportable at the confidence a labelled
 * timeline implies. Same call ADR-0028 made about stretching and soreness, and
 * for the same reason — this product is positioned on measured honesty.
 *
 * **No goal, no protocol, no streak, no ring.** There is no 16:8 target here to
 * fall short of. Phase 1 is the record and the read; a target invented by the
 * app would turn a description into a judgement, and ADR-0032 defers the goal
 * deliberately rather than by omission.
 *
 * **No causal sentence.** The sleep card earns one paired claim from a median
 * split; fasting has nothing to pair against that this app can honestly assert,
 * so it says what happened and stops. That is not a gap waiting to be filled.
 *
 * ## Two details carrying the design, both inherited
 *
 * **A day with no fast is a hairline at the baseline**, never a zero-height bar
 * and never interpolated — a zero would read as "you fasted for no time", which
 * is a claim about the user rather than about the data. The footer says the
 * coverage out loud for the same reason.
 *
 * **The reference line is the user's OWN median**, never a population standard.
 * Ignia has no authority to assert what a fast should be, which is exactly the
 * authority a 16-hour line drawn across this strip would claim.
 *
 * ## The stub row has three sentences, not one
 *
 * ADR-0034: a stub row must act, and must not lie about why it is empty. All
 * three go to Today, where the timer is — the only place the emptiness can
 * actually be resolved. See `useFastingTrends` for what separates them; the one
 * worth naming here is that a user who fasted for months before #97 shipped
 * needs to be told Ignia keeps fasts *from now on*, or an empty card reads as
 * data loss.
 */
export function FastingTrendsCard({
  fasting,
  hideHeader = false,
}: {
  fasting: FastingTrends;
  /** True when this card is one face of a consolidated panel, whose tab strip
   *  already names it (ADR-0034 decision 4). */
  hideHeader?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [stubDismissed, dismissStub] = useDismissedStub('trends.stub.fasting.dismissed');

  if (fasting.kind === 'pending') return null;

  if (fasting.kind === 'empty') {
    // Dismissed rows render NOTHING — not a collapsed row, not a hairline.
    // A residue of the thing you asked to remove is worse than the thing.
    if (stubDismissed) return null;
    return (
      <View testID="fasting-empty-row">
        <View style={styles.hairline} />
        <View style={styles.stubRow}>
        <PressScale
          style={styles.linkRow}
          testID="fasting-empty-link"
          onPress={() => {
            haptics.tap();
            // The chevron is a promise. ADR-0033's Amendment 2 shipped one that
            // was inert and it read as a broken row — worse than not drawing it.
            //
            // `replace`, not `push`, and that is the established idiom here
            // rather than a preference: Today is a SIBLING TAB, and pushing a
            // tab route stacks a second copy of it over Trends instead of
            // switching tabs. Every other in-app return to Today — `scan.tsx`
            // twice, `tour.tsx`, the auth gate — uses `replace`.
            router.replace('/(app)');
          }}
        >
          <StubLabel text={
            fasting.fastRunning
              ? t('trends.fastingEmptyRunning')
              : fasting.recorded > 0
                ? t('trends.fastingEmptyProgress', {
                    n: formatNumber(fasting.recorded, locale),
                    need: formatNumber(FASTING_CARD_MIN_FASTS, locale),
                  })
                : t('trends.fastingEmpty')
          } />
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </PressScale>
        {/* Dismiss sits OUTSIDE the navigating pressable rather than inside
            it — nesting one touchable in another makes which one fired
            depend on a few pixels, and the two actions here are opposites.
            The hit box is padded well past the glyph for the same reason. */}
        <PressScale
          style={styles.stubDismiss}
          testID="fasting-stub-dismiss"
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

  const { window, fastCount } = fasting;
  const parts = fastHoursParts(window.medianHours);
  const longest = fastHoursParts(window.longestHours);
  const shortest = fastHoursParts(window.shortestHours);

  return (
    <View testID="fasting-card">
      {hideHeader ? null : <Text style={styles.section}>{t('trends.fastingTitle')}</Text>}
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.value} testID="fasting-median">
            {t('trends.fastingHeadline', {
              h: formatNumber(parts.hours, locale),
              m: formatNumber(parts.minutes, locale),
            })}
          </Text>
          <Text style={styles.caption}>
            {t('trends.fastingCaption', {
              n: formatNumber(fastCount, locale),
              days: formatNumber(FASTING_WINDOW_DAYS, locale),
            })}
          </Text>
        </View>

        <View style={styles.stripRow}>
          <View style={styles.strip} testID="fasting-strip">
            {window.days.map((day) => (
              <View key={day.dateKey} style={styles.col}>
                <View style={styles.track}>
                  {day.hours == null ? (
                    <View style={styles.gap} />
                  ) : (
                    <View
                      style={[
                        styles.bar,
                        { height: `${Math.max(4, fastingBarFraction(day.hours) * 100)}%` },
                      ]}
                    />
                  )}
                </View>
              </View>
            ))}
            {/* Drawn AFTER the bars so it sits on top of them, and in `ink`
                rather than `faint`.

                This is what makes the chart readable at all, and the first
                device build proved it by omission: with a real 16:8 habit every
                bar lands between 65% and 73% of a 24-hour strip, so the bars
                alone are a wall of identical blocks. What a person can actually
                read is whether the bar TOPS hug this line — and a faint line in
                the same tone as the bars was invisible against them. */}
            {window.medianHours > 0 ? (
              <View
                pointerEvents="none"
                style={[
                  styles.medianLine,
                  { bottom: `${fastingBarFraction(window.medianHours) * 100}%` },
                ]}
              />
            ) : null}
          </View>
          {/* The axis. Without it no bar height means anything: the headline
              says 16h and nothing on the strip lets you check it. */}
          <View style={styles.axis} pointerEvents="none">
            <Text style={styles.axisLabel}>
              {t('trends.fastingAxisHours', {
                h: formatNumber(FASTING_STRIP_CEILING_HOURS, locale),
              })}
            </Text>
            <Text style={styles.axisLabel}>
              {t('trends.fastingAxisHours', { h: formatNumber(0, locale) })}
            </Text>
          </View>
        </View>
        <Text style={styles.legend}>
          {t('trends.fastingLegend', {
            h: formatNumber(parts.hours, locale),
            m: formatNumber(parts.minutes, locale),
          })}
        </Text>

        <View style={styles.divider} />

        {/* The sentence the chart cannot say on its own.

            The sleep card's chart is decoration for ITS sentence — the
            highlighted bars are the claim. Fasting has no comparison it can
            honestly make, so without this line the card asks the reader to
            infer consistency from twelve bars that all look the same. A range
            is pure description: no goal, no streak, and no judgement about
            which end of it is the better one to be at. */}
        <Text style={styles.claim} testID="fasting-range">
          {t('trends.fastingRange', {
            n: formatNumber(fastCount, locale),
            sh: formatNumber(shortest.hours, locale),
            sm: formatNumber(shortest.minutes, locale),
            lh: formatNumber(longest.hours, locale),
            lm: formatNumber(longest.minutes, locale),
          })}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.foot} testID="fasting-coverage">
          {t('trends.fastingCoverage', {
            days: formatNumber(window.daysWithFast, locale),
            total: formatNumber(FASTING_WINDOW_DAYS, locale),
          })}
        </Text>
      </View>
    </View>
  );
}

/**
 * Strip height, in dp, and it is shared by four styles that MUST agree.
 *
 * The bars, their tracks and the axis column are three separate boxes that all
 * have to be the same height, or the axis stops naming the gridline it sits on
 * and the median line lands at the wrong fraction. It was three literal `80`s
 * before a device pass; one constant is what stops the next edit moving one of
 * them.
 */
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
    // A duration in the display face, never a score.
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
      // Fasting's identity amber (`lib/habit-identity`) — it used to share
      // `info` with the sleep card, and the two fourteen-column strips were
      // indistinguishable at a glance (in-app feedback, 2026-08-30).
      backgroundColor: colors.habitFasting,
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
      // `flex: 1` because this row now shares a line with the dismiss.
      // Without it the row takes its intrinsic width and shoves the X
      // past the scroll body's padding, hard against the screen edge —
      // caught on a device, invisible to RNTL, which runs no Yoga pass.
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.md,
    },
    // The stub row's label lives in `StubLabel` now — both this card and the
    // sleep card render the identical shape, which is the "two want it, extract
    // it" threshold rather than one.
    stubRow: { flexDirection: 'row', alignItems: 'center' },
    // Generous padding, small glyph: the target is 40dp tall against a
    // 16dp icon, because this is a one-way action sitting a few pixels
    // from a navigating one.
    stubDismiss: { paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.md },
  });
