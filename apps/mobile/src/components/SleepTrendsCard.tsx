import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  SLEEP_MIN_NIGHTS,
  SLEEP_STRIP_CEILING_HOURS,
  SLEEP_WINDOW_DAYS,
  parseYmd,
  sleepBarFraction,
  sleepHoursParts,
} from '@macrolog/core';
import type { SleepTrends } from '@/hooks/useSleepTrends';
import { useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useLocale } from '@/i18n';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { StubLabel } from '@/components/StubLabel';
import { font, radius, space, type } from '@/theme';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { GapMarker, MedianLine } from '@/components/charts/StripParts';
import { Glyph } from '@/components/charts/Glyph';
import { useAdjustableDays } from '@/components/charts/useAdjustableDays';

/** Axis numerals are glyphs in a fixed-height strip: they scale with the OS
 *  text size, but only this far, or they overrun the gridline they name. */
const AXIS_MAX_SCALE = 1.3;

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
 * in `colors.habitSleep` (sleep's identity violet — it was `info` until the
 * habit hues landed, 2026-08-30) AND outlined in `ink` — the hue alone measured
 * 1.22:1 against its neighbours — and every other night in `lineStrong`, over the same
 * fourteen days the sentence is computed from — so the chart is the claim drawn
 * rather than decoration beside it. That property is why the window is 14 for
 * both (see `sleep-intake.ts`).
 *
 * **A missing night is a dashed mark at the baseline** — never a zero, never
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

  // The strip as one adjustable element (summary + a night at a time). Built
  // before the early returns so the hook order never changes with the state.
  const nights = sleep.kind === 'card' ? sleep.window.nights : [];
  const shortKeys = new Set(sleep.kind === 'card' ? (sleep.contrast?.shortKeys ?? []) : []);
  const median = sleep.kind === 'card' ? sleepHoursParts(sleep.window.medianHours) : { hours: 0, minutes: 0 };
  const stepper = useAdjustableDays(
    nights.length,
    sleep.kind === 'card'
      ? t('trends.chart.sleepSummary', {
          n: formatNumber(SLEEP_WINDOW_DAYS, locale),
          h: formatNumber(median.hours, locale),
          m: formatNumber(median.minutes, locale),
          count: formatNumber(sleep.window.nightsWithReading, locale),
        })
      : '',
    (i) => {
      const night = nights[i];
      if (!night) return '';
      const date = formatDate(parseYmd(night.dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' });
      if (night.hours == null) return t('trends.chart.noReading', { date });
      const p = sleepHoursParts(night.hours);
      return t(shortKeys.has(night.dateKey) ? 'trends.chart.sleepPointShort' : 'trends.chart.sleepPoint', {
        date,
        h: formatNumber(p.hours, locale),
        m: formatNumber(p.minutes, locale),
      });
    },
  );

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
          accessibilityRole="link"
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
          <Glyph ios="chevron.right" android="chevron-forward" size={16} color={colors.faint} />
        </PressScale>
        {/* Dismiss sits OUTSIDE the navigating pressable rather than inside
            it — nesting one touchable in another makes which one fired
            depend on a few pixels, and the two actions here are opposites.
            The hit box is padded well past the glyph for the same reason. */}
        <PressScale
          style={styles.stubDismiss}
          testID="sleep-stub-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t('trends.stubDismiss')}
          onPress={() => {
            haptics.tap();
            dismissStub();
          }}
        >
          <Glyph ios="xmark" android="close" size={16} color={colors.faint} />
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
      {hideHeader ? null : <Text style={styles.section} accessibilityRole="header">{t('trends.sleepTitle')}</Text>}
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

        <View style={styles.stripRow}>
        <View {...stepper.a11y} style={styles.strip} testID="sleep-strip">
          {window.nights.map((night) => {
            const fraction = sleepBarFraction(night.hours);
            return (
              <View key={night.dateKey} style={styles.col}>
                <View style={styles.track}>
                  {night.hours == null ? (
                    // The gap. A dashed mark at the baseline says "no reading"
                    // where a zero-height bar would say nothing at all and a
                    // full-height one would invent a night.
                    <GapMarker />
                  ) : (
                    <View
                      style={[
                        styles.bar,
                        // The highlighted nights carry an OUTLINE as well as
                        // the violet: violet against the other nights' grey
                        // measured 1.22:1 light / 1.29:1 dark, so the
                        // highlight was a hue change most eyes could not see.
                        // The others are `lineStrong`, which clears 3:1 on the
                        // card where `faint` sat next to the violet.
                        short.has(night.dateKey)
                          ? [styles.barShort, { backgroundColor: colors.habitSleep }]
                          : { backgroundColor: colors.lineStrong },
                        { height: `${Math.max(4, fraction * 100)}%` },
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
            <MedianLine bottomPct={sleepBarFraction(window.medianHours) * 100} />
          ) : null}
        </View>
          {/* The axis its two siblings already carry (fasting, water). Without
              it no bar height means anything: the headline says 7h 10m and
              nothing on the strip lets you check it against the ceiling. */}
          {/* Hidden from screen readers: the strip's own label and per-night
              values already say what the scale says. */}
          <View style={styles.axis} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.axisLabel} testID="sleep-axis-max" maxFontSizeMultiplier={AXIS_MAX_SCALE}>
              {t('trends.sleepAxisHours', { h: formatNumber(SLEEP_STRIP_CEILING_HOURS, locale) })}
            </Text>
            <Text style={styles.axisLabel} maxFontSizeMultiplier={AXIS_MAX_SCALE}>
              {t('trends.sleepAxisHours', { h: formatNumber(0, locale) })}
            </Text>
          </View>
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

/** Strip height, in dp, shared by the bars, their tracks and the axis column. */
const STRIP_H = 64;

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
    stripRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: space.xs },
    // `overflow: visible` on purpose — the median line is positioned against
    // this box and must be allowed to sit on its own edge.
    strip: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', height: STRIP_H },
    col: { flex: 1, alignItems: 'center' },
    track: { width: '62%', height: STRIP_H, justifyContent: 'flex-end' },
    // The strip, its tracks and the axis column MUST share one height, or the
    // axis stops naming the gridline it sits on (same rule as the siblings).
    // `minWidth`, not `width`: at a larger text size "10h" outgrows 30dp and a
    // fixed width clipped it. The height stays fixed — it IS the scale.
    axis: {
      minWidth: 30,
      height: STRIP_H,
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingLeft: space.xs,
    },
    // `lineHeight` equal to the font size, and NOT larger: the two labels are
    // pinned to the top and bottom of the strip, so any leading pushes them off
    // the gridline they are naming and the axis reads as approximate.
    axisLabel: { fontSize: font.tiny, color: colors.faint, lineHeight: font.tiny },
    bar: { width: '100%', borderRadius: 2 },
    barShort: { borderWidth: 1.5, borderColor: colors.ink },
    // Sentence-length copy reads in `muted`; `faint` (AA since S18-2) is kept
    // for the two-character axis numerals and glyphs.
    legend: { fontSize: font.tiny, color: colors.muted },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
    claim: { fontSize: font.body, color: colors.ink, lineHeight: 22 },
    qualify: { fontSize: font.small, color: colors.muted },
    progress: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    foot: { fontSize: font.tiny, color: colors.muted },
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
