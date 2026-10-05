import { useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import {
  type DatedWeight,
  type Measurement,
  type UnitSystem,
  measureUnit,
  parseYmd,
  toDisplayMeasure,
} from '@macrolog/core';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space, type } from '@/theme';
import { MEASURE_FIELDS, type MeasureKey } from './MeasurementSheet';
import { measurementSeries } from './MeasurementTrends';
import { dotsPath, weightChartGeometry } from './weight-chart-geometry';

const HEIGHT = 160;
/** The weight chart's gutter: the axis numbers sit beside the plot, not on it. */
const GUTTER = 40;
const PAD = { padL: GUTTER, padR: 8, padT: 12, padB: 12 };

/** One reading for the list: the day, the value, and the change from the one
 *  before it (null on the oldest). Newest first. Pure — tested. */
export function siteRows(series: readonly DatedWeight[]): { dateKey: string; value: number; delta: number | null }[] {
  return series
    .map((p, i) => ({ dateKey: p.dateKey, value: p.weightLb, delta: i === 0 ? null : p.weightLb - series[i - 1].weightLb }))
    .reverse();
}

/**
 * One tape site, opened up (re-score 3, Usability): every reading of that
 * site on a time axis, and the readings themselves, newest first. The trend
 * cards under Measurements were a dead end — a sparkline and a "since" line —
 * where MacroFactor and Apple Health open a full chart per site.
 *
 * The chart is the weight chart's geometry (`weightChartGeometry`, dates on X)
 * with the same left gutter for its numbers, and like every chart here it is
 * ONE accessible element whose label is the whole sentence. The rows are plain
 * text — editing stays on the measurement rows, which own a whole entry; one
 * site's value is a slice of several.
 *
 * Neutral, never green-for-down, for the reason `MeasurementTrends` gives.
 */
export function MeasurementSiteSheet({
  site,
  measurements,
  unitSystem,
  onClose,
}: {
  /** The site being shown; null = closed. */
  site: MeasureKey | null;
  measurements: readonly Measurement[];
  unitSystem: UnitSystem;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { height: windowH } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // Held while closing, so the sheet does not empty under its own exit.
  const [shownSite, setShownSite] = useState<MeasureKey | null>(site);
  if (site != null && site !== shownSite) setShownSite(site);

  const field = MEASURE_FIELDS.find((f) => f.key === shownSite) ?? null;
  const series = shownSite ? measurementSeries(measurements, shownSite) : [];
  const unit = measureUnit(unitSystem);
  const num = (v: number) =>
    formatNumber(toDisplayMeasure(v, unitSystem), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const day = (key: string, year = false) =>
    formatDate(parseYmd(key), locale, { month: 'short', day: 'numeric', year: year ? 'numeric' : undefined });

  const geometry = weightChartGeometry(series, series, { width, height: HEIGHT, ...PAD });
  const rows = siteRows(series);
  const first = series[0];
  const last = series[series.length - 1];
  const label = field ? t(field.labelKey) : '';

  let summary = '';
  if (first && last) {
    const d = toDisplayMeasure(last.weightLb, unitSystem) - toDisplayMeasure(first.weightLb, unitSystem);
    const n = formatNumber(Math.abs(d), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const change = Math.abs(d) < 0.05 ? t('body.deltaSame') : t(d < 0 ? 'body.deltaDown' : 'body.deltaUp', { n, unit });
    summary = t('body.measureTrendA11y', { field: label, value: num(last.weightLb), unit, change, date: day(first.dateKey, true) });
  }

  const header = (
    <View style={styles.head}>
      <Text style={styles.title} accessibilityRole="header">
        {label}
      </Text>
      {last ? (
        <Text style={styles.value} maxFontSizeMultiplier={1.4}>
          {num(last.weightLb)} <Text style={styles.unit}>{unit}</Text>
        </Text>
      ) : null}
      <View
        style={styles.chart}
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        testID="measure-site-chart"
      >
        {geometry ? (
          <Svg width={width} height={HEIGHT}>
            <Line x1={PAD.padL} x2={width - PAD.padR} y1={geometry.midY} y2={geometry.midY} stroke={colors.line} strokeWidth={1} />
            <Path d={dotsPath(geometry.xs, geometry.ys, 3)} fill={colors.muted} opacity={0.6} />
            {geometry.trendPath ? (
              <Path d={geometry.trendPath} stroke={colors.tealSolid} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            ) : null}
          </Svg>
        ) : null}
        {geometry ? (
          <>
            <Text style={[styles.axis, styles.axisTop]} maxFontSizeMultiplier={1.3}>{num(geometry.maxLb)}</Text>
            <Text style={[styles.axis, styles.axisMid, { top: geometry.midY - 8 }]} maxFontSizeMultiplier={1.3}>
              {num(geometry.midLb)}
            </Text>
            <Text style={[styles.axis, styles.axisBottom]} maxFontSizeMultiplier={1.3}>{num(geometry.minLb)}</Text>
          </>
        ) : null}
      </View>
      {first && last ? (
        <View style={styles.xRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.axis} maxFontSizeMultiplier={1.3}>{day(first.dateKey, true)}</Text>
          <Text style={styles.axis} maxFontSizeMultiplier={1.3}>{day(last.dateKey, true)}</Text>
        </View>
      ) : null}
      <Text style={styles.section} accessibilityRole="header">
        {t('body.measureSiteReadings')}
      </Text>
    </View>
  );

  return (
    <BottomSheet visible={site != null} onClose={onClose} native detents={[0.6, 1]}>
      <View style={NATIVE_SHEETS ? styles.fill : { height: Math.round(windowH * 0.72) }} testID="measure-site-sheet">
        <FlatList
          data={rows}
          keyExtractor={(r) => r.dateKey}
          ListHeaderComponent={header}
          renderItem={({ item }) => {
            const delta =
              item.delta == null
                ? null
                : Math.abs(toDisplayMeasure(item.delta, unitSystem)) < 0.05
                  ? '±0'
                  : `${item.delta < 0 ? '−' : '+'}${num(Math.abs(item.delta))}`;
            return (
              <View style={styles.row} accessible testID={`measure-site-row-${item.dateKey}`}>
                <Text style={styles.rowDate}>{day(item.dateKey, true)}</Text>
                <View style={styles.rowRight}>
                  {delta ? <Text style={styles.rowDelta}>{delta}</Text> : null}
                  <Text style={styles.rowValue}>
                    {num(item.value)} {unit}
                  </Text>
                </View>
              </View>
            );
          }}
          initialNumToRender={16}
          contentContainerStyle={styles.content}
        />
      </View>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    fill: { flex: 1 },
    head: { gap: space.xs, marginBottom: space.sm },
    title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
    value: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    unit: { fontSize: font.body, color: colors.muted },
    chart: { height: HEIGHT, marginTop: space.sm },
    axis: { fontSize: font.tiny, color: colors.muted },
    axisTop: { position: 'absolute', left: 0, width: GUTTER - 6, textAlign: 'right', top: 2 },
    axisMid: { position: 'absolute', left: 0, width: GUTTER - 6, textAlign: 'right' },
    axisBottom: { position: 'absolute', left: 0, width: GUTTER - 6, textAlign: 'right', bottom: 2 },
    xRow: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: PAD.padL, paddingRight: PAD.padR },
    section: { fontSize: font.small, fontWeight: '700', color: colors.muted, marginTop: space.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
      minHeight: 44,
    },
    rowDate: { fontSize: font.body, color: colors.muted },
    rowRight: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    rowDelta: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    rowValue: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    content: { paddingBottom: space.xl },
  });
