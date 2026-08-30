import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  SLEEP_MIN_NIGHTS,
  SLEEP_WINDOW_DAYS,
  sleepBarFraction,
  sleepHoursParts,
} from '@macrolog/core';
import type { SleepTrends } from '@/hooks/useSleepTrends';
import { useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useLocale } from '@/i18n';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { StubLabel } from '@/components/StubLabel';
import { font, radius, space, type } from '@/theme';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';

/**
 * Sleep on Trends — one number, one strip, one sentence (ADR-0033, issue #81).
 *
 * ## What this renders, and what it refuses to
 *
 * A duration headline, fourteen columns, and — only once the evidence bar is
 * cleared — a single paired comparison of the user's own days. **No score, no
 * correlation coefficient, no causal sentence.** Those are not omissions to be
 * filled in later; ADR-0033 rules each out by name, and the reason is that
 * `dailySleep` holds one scalar per night. Every scored sleep app builds its
 * number from sensor signals Ignia does not have, and a 0–100 from a duration
 * alone implies sub-components that do not exist.
 *
 * ## Two details that carry the design
 *
 * **The highlighted bars ARE the sentence.** The short group's nights are drawn
 * in `colors.info` and every other night in `colors.faint`, over the same
 * fourteen days the sentence is computed from — so the chart is the claim drawn
 * rather than decoration beside it. That property is why the window is 14 for
 * both (see `sleep-intake.ts`).
 *
 * **A missing night is a hairline at the baseline** — never a zero, never
 * interpolated — and the footer says the coverage out loud. A zero-height bar
 * would read as "did not sleep", which is a claim about the user rather than
 * about the data.
 *
 * ## The layout deliberately does not jump
 *
 * From the third night the headline, the strip and the footer are present and
 * unchanged; crossing the bar adds one paragraph where the progress line was.
 * A sentence cannot ramp the way `measuredConfidence` does, so what ramps is
 * the card around it — the cliff is confined to the one element that is
 * inherently binary.
 */
export function SleepTrendsCard({
  sleep,
  hideHeader = false,
}: {
  sleep: SleepTrends;
  /** True when this card is one face of a consolidated panel, whose tab strip
   *  already names it (ADR-0034 decision 4). Two labels for one card reads as
   *  a mistake. */
  hideHeader?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [stubDismissed, dismissStub] = useDismissedStub('trends.stub.sleep.dismissed');

  if (sleep.kind === 'pending') return null;

  // 0–2 nights: a row, not a card, and no section header. Trends already
  // carries a hero, an activity correction, This Week, Budget and Coach; a
  // permanently empty sleep widget on top of that is the generic-dashboard
  // failure, and the sleep row on Today is already the right place to invite a
  // first entry.
  if (sleep.kind === 'empty') {
    // Dismissed rows render NOTHING — not a collapsed row, not a hairline.
    // A residue of the thing you asked to remove is worse than the thing.
    if (stubDismissed) return null;
    return (
      <View testID="sleep-empty-row">
        <View style={styles.hairline} />
        <View style={styles.stubRow}>
        <PressScale
          style={styles.linkRow}
          testID="sleep-empty-link"
          onPress={() => {
            haptics.tap();
            // The chevron is a promise. It was inert in the first device build
            // and that reads as a broken row rather than as a decoration —
            // Connected apps is where both halves of this sentence live.
            router.push('/connected-apps');
          }}
        >
          <StubLabel
            text={t(
              sleep.connectedTo === 'oura'
                ? 'trends.sleepEmptyOura'
                : sleep.connectedTo === 'health'
                  ? 'trends.sleepEmptyHealth'
                  : 'trends.sleepEmpty',
            )}
          />
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </PressScale>
        {/* Dismiss sits OUTSIDE the navigating pressable rather than inside
            it — nesting one touchable in another makes which one fired
            depend on a few pixels, and the two actions here are opposites.
            The hit box is padded well past the glyph for the same reason. */}
        <PressScale
          style={styles.stubDismiss}
          testID="sleep-stub-dismiss"
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

  const { window, contrast } = sleep;
  const parts = sleepHoursParts(window.meanHours);
  const short = new Set(contrast?.shortKeys ?? []);
  const full = window.nightsWithReading === SLEEP_WINDOW_DAYS;

  return (
    <View testID="sleep-card">
      {hideHeader ? null : <Text style={styles.section}>{t('trends.sleepTitle')}</Text>}
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.value} testID="sleep-mean">
            {t('trends.sleepHeadline', {
              h: formatNumber(parts.hours, locale),
              m: formatNumber(parts.minutes, locale),
            })}
          </Text>
          <Text style={styles.caption}>
            {full
              ? t('trends.sleepCaption', { n: formatNumber(SLEEP_WINDOW_DAYS, locale) })
              : t('trends.sleepCaptionFew', {
                  n: formatNumber(window.nightsWithReading, locale),
                })}
          </Text>
        </View>

        <View style={styles.strip} testID="sleep-strip">
          {window.nights.map((night) => {
            const fraction = sleepBarFraction(night.hours);
            return (
              <View key={night.dateKey} style={styles.col}>
                <View style={styles.track}>
                  {night.hours == null ? (
                    // The gap. A hairline at the baseline says "no reading"
                    // where a zero-height bar would say nothing at all and a
                    // full-height one would invent a night.
                    <View style={styles.gap} />
                  ) : (
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${Math.max(4, fraction * 100)}%`,
                          backgroundColor: short.has(night.dateKey) ? colors.info : colors.faint,
                        },
                      ]}
                    />
                  )}
                </View>
              </View>
            );
          })}
          {/* The reference line is the user's OWN median, never a population
              7- or 8-hour standard — Ignia has no authority to assert one. */}
          {window.medianHours > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.medianLine,
                { bottom: `${sleepBarFraction(window.medianHours) * 100}%` },
              ]}
            />
          ) : null}
        </View>
        <Text style={styles.legend}>{t('trends.sleepLegend')}</Text>

        <View style={styles.divider} />

        {contrast ? (
          <>
            <Text style={styles.claim} testID="sleep-claim">
              {t(
                contrast.differenceKcal > 0 ? 'trends.sleepClaimMore' : 'trends.sleepClaimLess',
                {
                  short: formatNumber(contrast.shortCount, locale),
                  long: formatNumber(contrast.longCount, locale),
                  kcal: formatNumber(contrast.shortMeanKcal, locale),
                  diff: formatNumber(Math.abs(contrast.differenceKcal), locale),
                },
              )}
            </Text>
            {/* Says out loud that this is a description of days that already
                happened. The card is forbidden from Garmin's coaching voice. */}
            <Text style={styles.qualify}>{t('trends.sleepQualifier')}</Text>
            <View style={styles.divider} />
            <Text style={styles.foot}>
              {t('trends.sleepCoverage', {
                n: formatNumber(window.nightsWithReading, locale),
                total: formatNumber(SLEEP_WINDOW_DAYS, locale),
              })}
              {window.provenance ? ` · ${t(PROVENANCE_KEY[window.provenance])}` : ''}
            </Text>
          </>
        ) : (
          // Names the exact threshold. A silent wait reads as "nothing
          // happened", and that is how a Health connection gets revoked.
          <Text style={styles.progress} testID="sleep-progress">
            {t('trends.sleepProgress', {
              n: formatNumber(window.nightsWithReading, locale),
              need: formatNumber(SLEEP_MIN_NIGHTS, locale),
            })}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Window-level provenance only — `dailySleep` has no `provider`, so the card
 *  can never honestly say "via Oura" the way a cardio block can. */
const PROVENANCE_KEY = {
  imported: 'trends.sleepSourceImported',
  typed: 'trends.sleepSourceTyped',
  both: 'trends.sleepSourceBoth',
} as const;

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
    // `overflow: visible` on purpose — the median line is positioned against
    // this box and must be allowed to sit on its own edge.
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
    claim: { fontSize: font.body, color: colors.ink, lineHeight: 22 },
    qualify: { fontSize: font.small, color: colors.muted },
    progress: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    foot: { fontSize: font.tiny, color: colors.faint },
    // The 0–2 nights row: one line, hairline-bounded, no card.
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
    // The stub row's label lives in `StubLabel` now — shared with the fasting
    // card, which renders the identical shape.
    stubRow: { flexDirection: 'row', alignItems: 'center' },
    // Generous padding, small glyph: the target is 40dp tall against a
    // 16dp icon, because this is a one-way action sitting a few pixels
    // from a navigating one.
    stubDismiss: { paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.md },
  });
