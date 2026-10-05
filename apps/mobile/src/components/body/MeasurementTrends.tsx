import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  type DatedWeight,
  type Measurement,
  type UnitSystem,
  MIDNIGHT,
  dayKeyAt,
  measureUnit,
  parseYmd,
  toDisplayMeasure,
} from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';
import { MEASURE_FIELDS, type MeasureKey } from './MeasurementSheet';
import { weightChartGeometry } from './weight-chart-geometry';

const SPARK_HEIGHT = 32;
const SPARK_PAD = { padL: 2, padR: 2, padT: 4, padB: 4 };

/**
 * One tape site's readings, oldest first, one per day (the newest of a day
 * wins — `measurements` arrives newest first). Shaped as `DatedWeight` so the
 * weight chart's geometry can lay it out; the "weight" here is inches.
 */
export function measurementSeries(measurements: readonly Measurement[], key: MeasureKey): DatedWeight[] {
  const byDay = new Map<string, number>();
  for (const m of measurements) {
    const v = m[key];
    if (v == null || !Number.isFinite(v)) continue;
    const day = dayKeyAt(m.date, MIDNIGHT);
    if (!byDay.has(day)) byDay.set(day, v);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dateKey, weightLb]) => ({ dateKey, weightLb }));
}

/**
 * Per-site tape trends under the Measurements header (Body re-score: "the
 * measurements have no trend"). MacroFactor and Happy Scale both chart these;
 * here a site with two or more dated readings gets a card — its latest value,
 * the change since the first reading, and a sparkline on a TIME axis (the
 * weight chart's geometry, so a two-month gap is drawn as one).
 *
 * The change is neutral grey, like the weigh-in deltas: a smaller waist is
 * good news on a cut and a bigger arm is good news on a bulk, and a colour
 * that praises one direction is wrong for half the people reading it.
 *
 * Each card is ONE accessible element with the whole sentence; the line itself
 * is decoration to a screen reader, because the sentence already says what it
 * shows.
 *
 * With `onOpen` each card is a button that opens that site's full chart and
 * readings (`MeasurementSiteSheet`, re-score 3) — the drill-down MacroFactor
 * and Apple Health have, and the thing people tap a sparkline expecting.
 */
export function MeasurementTrends({
  measurements,
  unitSystem,
  onOpen,
}: {
  measurements: readonly Measurement[];
  unitSystem: UnitSystem;
  /** Open one site's chart. Absent = the cards are not buttons. */
  onOpen?: (site: MeasureKey) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const sites = MEASURE_FIELDS.map((f) => ({ field: f, series: measurementSeries(measurements, f.key) })).filter(
    (s) => s.series.length >= 2,
  );
  if (sites.length === 0) return null;
  const unit = measureUnit(unitSystem);
  return (
    <View style={styles.grid} testID="measure-trends">
      {sites.map(({ field, series }) => {
        const first = series[0];
        const last = series[series.length - 1];
        const shownLast = toDisplayMeasure(last.weightLb, unitSystem);
        const d = shownLast - toDisplayMeasure(first.weightLb, unitSystem);
        const n = formatNumber(Math.abs(d), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const short = Math.abs(d) < 0.05 ? '±0' : `${d < 0 ? '−' : '+'}${n}`;
        const spoken =
          Math.abs(d) < 0.05 ? t('body.deltaSame') : t(d < 0 ? 'body.deltaDown' : 'body.deltaUp', { n, unit });
        const date = formatDate(parseYmd(first.dateKey), locale, { month: 'short', day: 'numeric' });
        const value = formatNumber(shownLast, locale);
        const label = t(field.labelKey);
        return (
          <TouchableOpacity
            key={field.key}
            style={styles.card}
            disabled={!onOpen}
            onPress={onOpen ? () => onOpen(field.key) : undefined}
            accessible
            accessibilityRole={onOpen ? 'button' : 'text'}
            accessibilityLabel={t('body.measureTrendA11y', { field: label, value, unit, change: spoken, date })}
            accessibilityHint={onOpen ? t('body.measureTrendHint') : undefined}
            testID={`measure-trend-${field.key}`}
          >
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.value} maxFontSizeMultiplier={1.4}>
              {value} <Text style={styles.unit}>{unit}</Text>
            </Text>
            <Spark series={series} />
            <Text style={styles.since} numberOfLines={2}>
              {t('body.measureTrendSince', { delta: `${short} ${unit}`, date })}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Spark({ series }: { series: DatedWeight[] }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const geometry = weightChartGeometry(series, series, { width, height: SPARK_HEIGHT, ...SPARK_PAD });
  return (
    <View
      style={{ height: SPARK_HEIGHT }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {geometry?.trendPath ? (
        <Svg width={width} height={SPARK_HEIGHT}>
          <Path
            d={geometry.trendPath}
            stroke={colors.tealSolid}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}

const createStyles = ({ colors, scheme }: Theme) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    // Two to a row, like the sheet's fields; `flexGrow` lets an odd last card
    // take the full width instead of leaving a hole.
    card: {
      flexGrow: 1,
      flexBasis: '45%',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      // Framed in dark like the history rows (re-score 3): card on paper is
      // 1.09:1 there, and the hairline alone did not show the edge.
      borderColor: scheme === 'dark' ? `${colors.lineStrong}80` : colors.line,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      gap: 2,
    },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    value: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
    unit: { fontSize: font.small, color: colors.muted },
    since: { fontSize: font.tiny, color: colors.muted },
  });
