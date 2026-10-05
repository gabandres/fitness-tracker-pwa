import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  type TdeeSeriesPoint,
  type UnitSystem,
  type WeightSeriesPoint,
  bodyWeightUnit,
  parseYmd,
  sortMilestones,
  toDisplayWeight,
} from '@macrolog/core';
import { type I18nKey, type Locale, type TFn } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';
import { TrendChart } from './TrendChart';

/**
 * The two lines Trends was missing (review 2026-10-04: "Trends draws no line
 * over time"): the maintenance estimate's history with intake and the target
 * against it, and the weight trend through the scale readings.
 *
 * Both take per-day arrays aligned to one key list and a range in days, and
 * slice the tail — the data layer computes once, the chips only choose how much
 * of it to show.
 */

/** The range chips. "All" is the account's own history, inside the free
 *  90-day chart cap (`CHART_HISTORY_DAYS_FREE`) — never more. */
export const TREND_RANGES = ['1m', '3m', 'all'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export function rangeDays(range: TrendRange, historyDays: number, cap: number): number {
  if (range === '1m') return Math.min(30, cap);
  if (range === '3m') return cap;
  // At least a week, so a brand-new account's "All" is still a chart.
  return Math.max(7, Math.min(cap, historyDays || 7));
}

const RANGE_LABEL: Record<TrendRange, { label: I18nKey; a11y: I18nKey }> = {
  '1m': { label: 'trends.range1m', a11y: 'trends.range1mA11y' },
  '3m': { label: 'trends.range3m', a11y: 'trends.range3mA11y' },
  all: { label: 'trends.rangeAll', a11y: 'trends.rangeAllA11y' },
};

function shortDate(key: string, locale: Locale): string {
  return formatDate(parseYmd(key), locale, { month: 'short', day: 'numeric' });
}

function longDate(key: string, locale: Locale): string {
  return formatDate(parseYmd(key), locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Milestone ticks inside a window: the archive's `earnedAt` dates, by day. */
function milestoneMarks(milestones: Record<string, Date>, keys: readonly string[]) {
  const at = new Map<string, string[]>();
  for (const name of sortMilestones(Object.keys(milestones))) {
    const d = milestones[name];
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    at.set(k, [...(at.get(k) ?? []), name]);
  }
  const marks: { index: number }[] = [];
  const names: (string[] | undefined)[] = keys.map((k, i) => {
    const hit = at.get(k);
    if (hit) marks.push({ index: i });
    return hit;
  });
  return { marks, names };
}

export function RangeChips({
  range,
  onChange,
  t,
}: {
  range: TrendRange;
  onChange: (r: TrendRange) => void;
  t: TFn;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chips} accessibilityRole="tablist" testID="trend-range">
      {TREND_RANGES.map((r) => {
        const on = r === range;
        return (
          <PressScale
            key={r}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(RANGE_LABEL[r].a11y)}
            testID={`trend-range-${r}`}
            onPress={() => {
              if (on) return;
              haptics.tap();
              onChange(r);
            }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]} maxFontSizeMultiplier={1.3}>
              {t(RANGE_LABEL[r].label)}
            </Text>
          </PressScale>
        );
      })}
    </View>
  );
}

function LegendItem({ color, label, dashed, dot }: { color: string; label: string; dashed?: boolean; dot?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.legendItem}>
      {dot ? (
        <View style={[styles.legendDot, { backgroundColor: color }]} />
      ) : (
        <View style={[styles.legendLine, { borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      )}
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// ─── Expenditure ─────────────────────────────────────────────────────────────

export interface ExpenditureCardProps {
  /** Aligned per-day arrays; the card shows the last `days` of each. */
  keys: readonly string[];
  intake: readonly (number | null)[];
  /** `tdeeSeries` output for (at least) the last `days` days; null while it
   *  is still being computed. */
  series: TdeeSeriesPoint[] | null;
  days: number;
  target: number;
  milestones: Record<string, Date>;
  range: TrendRange;
  onRange: (r: TrendRange) => void;
  onOpenDay: (dateKey: string) => void;
  t: TFn;
  locale: Locale;
}

function ExpenditureCardImpl({ keys, intake, series, days, target, milestones, range, onRange, onOpenDay, t, locale }: ExpenditureCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  const view = useMemo(() => {
    const k = keys.slice(-days);
    const pts = series ? series.slice(-days) : null;
    // Align the series to the window by key — a range change can leave the
    // previous (shorter or longer) series in place for a frame.
    const byKey = new Map((pts ?? []).map((p) => [p.dateKey as string, p]));
    const aligned = k.map((key) => byKey.get(key) ?? null);
    const kcal = aligned.map((p) => p?.kcal ?? null);
    const isFormula = aligned.map((p) => p?.source === 'formula');
    const eat = intake.slice(-days);
    const { marks, names } = milestoneMarks(milestones, k);
    const labels = k.map((key, i) => {
      const date = longDate(key, locale);
      const p = aligned[i];
      const est =
        p?.kcal == null
          ? t('trends.chart.expNone', { date })
          : t(p.source === 'formula' ? 'trends.chart.expFormula' : 'trends.chart.expMeasured', {
              date,
              kcal: formatNumber(p.kcal, locale),
            });
      const ate = eat[i] != null ? t('trends.chart.ate', { kcal: formatNumber(eat[i] as number, locale) }) : t('trends.chart.notLogged');
      const ms = names[i]?.map((n) => t('trends.chart.milestone', { name: t(`milestones.${n}` as I18nKey) })) ?? [];
      return [est, ate, ...ms].join(' · ');
    });
    const measured = aligned.filter((p): p is TdeeSeriesPoint => p?.source === 'measured' && p.kcal != null);
    const summary =
      measured.length >= 2
        ? t('trends.chart.expSummary', {
            days: k.length,
            from: formatNumber(measured[0].kcal as number, locale),
            to: formatNumber(measured[measured.length - 1].kcal as number, locale),
          })
        : t('trends.chart.expSummaryFormula', { days: k.length });
    return { k, kcal, isFormula, eat, labels, summary, marks, hasFormula: isFormula.some(Boolean) };
  }, [keys, intake, series, days, milestones, t, locale]);

  const lines = useMemo(
    () => [
      {
        key: 'tdee',
        values: view.kcal,
        color: colors.accent,
        width: 2.5,
        dashedAt: (i: number) => view.isFormula[i],
      },
    ],
    [view, colors.accent],
  );
  const dots = useMemo(() => [{ key: 'intake', values: view.eat, color: colors.lineStrong, radius: 2.25 }], [view, colors.lineStrong]);

  return (
    <View style={styles.card} testID="expenditure-card">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('trends.expenditureTitle')}</Text>
        <RangeChips range={range} onChange={onRange} t={t} />
      </View>
      {series == null ? (
        <View style={styles.placeholder} testID="expenditure-pending" />
      ) : (
        <TrendChart
          dateKeys={view.k}
          lines={lines}
          dots={dots}
          reference={target > 0 ? { value: target, label: t('trends.chart.targetLabel', { kcal: formatNumber(target, locale) }), color: colors.muted } : undefined}
          markers={view.marks}
          summary={view.summary}
          pointLabels={view.labels}
          formatY={(v) => formatNumber(Math.round(v / 10) * 10, locale)}
          xLabels={[shortDate(view.k[0], locale), shortDate(view.k[view.k.length - 1], locale)]}
          openDay={{
            label: (key) => t('trends.chart.openDay', { date: longDate(key, locale) }),
            actionLabel: t('trends.chart.openDayAction'),
            closeLabel: t('a11y.close'),
            onOpen: onOpenDay,
          }}
          testID="expenditure-chart"
        />
      )}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LegendItem color={colors.accent} label={t('trends.legendMaintenance')} />
        {view.hasFormula ? <LegendItem color={colors.accent} label={t('trends.legendFormula')} dashed /> : null}
        <LegendItem color={colors.lineStrong} label={t('trends.legendIntake')} dot />
        {target > 0 ? <LegendItem color={colors.muted} label={t('trends.legendTarget')} dashed /> : null}
      </View>
    </View>
  );
}

export const ExpenditureCard = memo(ExpenditureCardImpl);

// ─── Weight ──────────────────────────────────────────────────────────────────

export interface WeightTrendCardProps {
  keys: readonly string[];
  series: readonly WeightSeriesPoint[];
  days: number;
  unitSystem: UnitSystem;
  milestones: Record<string, Date>;
  onOpenBody: () => void;
  onOpenDay: (dateKey: string) => void;
  t: TFn;
  locale: Locale;
}

function WeightTrendCardImpl({ keys, series, days, unitSystem, milestones, onOpenBody, onOpenDay, t, locale }: WeightTrendCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unit = bodyWeightUnit(unitSystem);

  const view = useMemo(() => {
    const k = keys.slice(-days);
    const s = series.slice(-days);
    const show = (lb: number) => formatNumber(toDisplayWeight(lb, unitSystem), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const scale = s.map((p) => (p.scale == null ? null : toDisplayWeight(p.scale, unitSystem)));
    const trend = s.map((p) => (p.trend == null ? null : toDisplayWeight(p.trend, unitSystem)));
    const { marks, names } = milestoneMarks(milestones, k);
    const labels = k.map((key, i) => {
      const date = longDate(key, locale);
      const p = s[i];
      const head =
        p.scale != null && p.trend != null
          ? t('trends.chart.weighed', { date, w: show(p.scale), trend: show(p.trend), u: unit })
          : p.trend != null
            ? t('trends.chart.noWeighIn', { date, trend: show(p.trend), u: unit })
            : t('trends.chart.noWeighInsYet', { date });
      const ms = names[i]?.map((n) => t('trends.chart.milestone', { name: t(`milestones.${n}` as I18nKey) })) ?? [];
      return [head, ...ms].join(' · ');
    });
    const weighIns = s.filter((p) => p.scale != null).length;
    const trended = trend.filter((v): v is number => v != null);
    const first = trended[0];
    const last = trended[trended.length - 1];
    const delta = first != null && last != null ? last - first : 0;
    const trendKey: I18nKey =
      Math.abs(delta) < (unitSystem === 'metric' ? 0.2 : 0.5) ? 'a11y.trend.flat' : delta < 0 ? 'a11y.trend.down' : 'a11y.trend.up';
    const summary =
      first != null && last != null
        ? t('a11y.chart.weight', {
            days: k.length,
            from: formatNumber(first, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            to: formatNumber(last, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            unit,
            trend: t(trendKey),
          })
        : t('trends.chart.weightEmpty', { days: k.length });
    return { k, scale, trend, labels, summary, marks, weighIns };
  }, [keys, series, days, unitSystem, milestones, t, locale, unit]);

  const lines = useMemo(() => [{ key: 'trend', values: view.trend, color: colors.teal, width: 2.5 }], [view, colors.teal]);
  const dots = useMemo(() => [{ key: 'scale', values: view.scale, color: colors.lineStrong, radius: 2.75 }], [view, colors.lineStrong]);

  return (
    <View style={styles.card} testID="weight-trend-card">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('trends.weightChartTitle')}</Text>
        <PressScale
          style={styles.link}
          accessibilityRole="link"
          accessibilityLabel={t('trends.openBody')}
          onPress={() => {
            haptics.tap();
            onOpenBody();
          }}
          testID="weight-trend-open-body"
        >
          <Text style={styles.linkText} maxFontSizeMultiplier={1.3}>{t('trends.openBodyShort')}</Text>
        </PressScale>
      </View>
      {view.weighIns === 0 ? (
        <Text style={styles.empty}>{t('trends.chart.weightEmpty', { days: view.k.length })}</Text>
      ) : (
        <TrendChart
          dateKeys={view.k}
          lines={lines}
          dots={dots}
          markers={view.marks}
          summary={view.summary}
          pointLabels={view.labels}
          formatY={(v) => formatNumber(v, locale, { maximumFractionDigits: 1 })}
          xLabels={[shortDate(view.k[0], locale), shortDate(view.k[view.k.length - 1], locale)]}
          openDay={{
            label: (key) => t('trends.chart.openDay', { date: longDate(key, locale) }),
            actionLabel: t('trends.chart.openDayAction'),
            closeLabel: t('a11y.close'),
            onOpen: onOpenDay,
          }}
          testID="weight-trend-chart"
        />
      )}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LegendItem color={colors.teal} label={t('trends.legendTrend')} />
        <LegendItem color={colors.lineStrong} label={t('trends.legendScale')} dot />
      </View>
    </View>
  );
}

export const WeightTrendCard = memo(WeightTrendCardImpl);

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm, marginTop: space.md },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
    title: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
    // Same reserved height as the drawn chart (bubble + plot + x labels), so
    // the card does not jump when the deferred series lands.
    placeholder: { height: 132 + 30 + 18, borderRadius: radius.sm, backgroundColor: colors.inputBg, opacity: 0.6 },
    empty: { fontSize: font.small, color: colors.muted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
    chip: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
    chipOn: { backgroundColor: colors.inputBg, borderColor: colors.lineStrong },
    chipText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    chipTextOn: { color: colors.ink, fontWeight: '700' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendLine: { width: 16, height: 0, borderTopWidth: 2 },
    legendDot: { width: 6, height: 6, borderRadius: 3 },
    legendText: { fontSize: font.tiny, color: colors.muted },
    link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs },
    linkText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  });
