import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  FASTING_CARD_MIN_FASTS,
  FASTING_WINDOW_DAYS,
  fastHoursParts,
  fastingBarFraction,
} from '@macrolog/core';
import type { FastingTrends } from '@/hooks/useFastingTrends';
import { useT, useLocale } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
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
export function FastingTrendsCard({ fasting }: { fasting: FastingTrends }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();

  if (fasting.kind === 'pending') return null;

  if (fasting.kind === 'empty') {
    return (
      <View testID="fasting-empty-row">
        <View style={styles.hairline} />
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
          <Text style={styles.linkLabel}>
            {fasting.fastRunning
              ? t('trends.fastingEmptyRunning')
              : fasting.recorded > 0
                ? t('trends.fastingEmptyProgress', {
                    n: formatNumber(fasting.recorded, locale),
                    need: formatNumber(FASTING_CARD_MIN_FASTS, locale),
                  })
                : t('trends.fastingEmpty')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </PressScale>
        <View style={styles.hairline} />
      </View>
    );
  }

  const { window, fastCount } = fasting;
  const parts = fastHoursParts(window.medianHours);
  const longest = fastHoursParts(window.longestHours);

  return (
    <View testID="fasting-card">
      <Text style={styles.section}>{t('trends.fastingTitle')}</Text>
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
                      {
                        height: `${Math.max(4, fastingBarFraction(day.hours) * 100)}%`,
                        backgroundColor: colors.info,
                      },
                    ]}
                  />
                )}
              </View>
            </View>
          ))}
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
        <Text style={styles.legend}>{t('trends.fastingLegend')}</Text>

        <View style={styles.divider} />

        {/* Descriptive, and deliberately so — see the header. The longest fast
            is a fact about days that already happened, not a target. */}
        <Text style={styles.foot} testID="fasting-coverage">
          {t('trends.fastingCoverage', {
            days: formatNumber(window.daysWithFast, locale),
            total: formatNumber(FASTING_WINDOW_DAYS, locale),
            h: formatNumber(longest.hours, locale),
            m: formatNumber(longest.minutes, locale),
          })}
        </Text>
      </View>
    </View>
  );
}

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
    strip: { flexDirection: 'row', alignItems: 'flex-end', height: 64, marginTop: space.xs },
    col: { flex: 1, alignItems: 'center' },
    track: { width: '62%', height: 64, justifyContent: 'flex-end' },
    bar: { width: '100%', borderRadius: 2 },
    gap: { width: '100%', height: 1, backgroundColor: colors.line },
    medianLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.faint,
      opacity: 0.6,
    },
    legend: { fontSize: font.tiny, color: colors.faint },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
    foot: { fontSize: font.tiny, color: colors.faint },
    // The under-threshold row: one line, hairline-bounded, no card.
    hairline: { height: 1, backgroundColor: colors.line },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.md,
    },
    linkLabel: { flex: 1, fontSize: font.small, color: colors.muted },
  });
