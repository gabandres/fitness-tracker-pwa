import { memo, useCallback, useMemo } from 'react';
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
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { formatDate, formatNumber } from '@/lib/date-format';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';
import { TrendChart, type TrendChartProps } from './TrendChart';

/**
 * The two lines Trends was missing (review 2026-10-04: "Trends draws no line
 * over time"): the maintenance estimate's history with intake and the target
 * against it, and the weight trend through the scale readings.
 *
 * All three take per-day arrays aligned to one key list and a range in days,
 * and slice the tail — the data layer computes once, the chips only choose how
 * much of it to show. (The third is protein, review S20: Cronometer and
 * MacroFactor both draw it and Trends drew no macro over time at all.)
 *
 * Every prop handed to `TrendChart` is memoised here: it is `memo`'d, and an
 * inline `formatY` or `openDay={{…}}` made that memo re-render on every Trends
 * render (review S20, bug 10).
 */

/** The range chips. "All" is the account's own history inside the chart cap
 *  — 90 days free (`CHART_HISTORY_DAYS_FREE`), a year behind `isPro`
 *  (`TDEE_SERIES_PRO_MAX_DAYS`), which v1 forces true. 6M/1Y only appear when
 *  the cap reaches them. */
export const TREND_RANGES = ['1m', '3m', '6m', '1y', 'all'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** Nominal days per fixed chip — Body's 1M/3M/6M/1Y lengths, but 3M is the
 *  90-day free cap exactly, so a free account's 3M is its whole allowance. */
const RANGE_NOMINAL: Record<Exclude<TrendRange, 'all'>, number> = { '1m': 30, '3m': 90, '6m': 182, '1y': 365 };

export function rangeDays(range: TrendRange, historyDays: number, cap: number): number {
  // At least a week, so a brand-new account's "All" is still a chart.
  if (range === 'all') return Math.max(7, Math.min(cap, historyDays || 7));
  return Math.min(RANGE_NOMINAL[range], cap);
}

/** The chips a cap can honestly offer: a 6M chip under a 90-day cap would be a
 *  second 3M. "1M", "3M" and "All" always show. */
export function rangesFor(cap: number): TrendRange[] {
  return TREND_RANGES.filter((r) => r === 'all' || r === '1m' || r === '3m' || RANGE_NOMINAL[r] <= cap);
}

const RANGE_LABEL: Record<TrendRange, { label: I18nKey; a11y: I18nKey }> = {
  '1m': { label: 'trends.range1m', a11y: 'trends.range1mA11y' },
  '3m': { label: 'trends.range3m', a11y: 'trends.range3mA11y' },
  '6m': { label: 'trends.range6m', a11y: 'trends.range6mA11y' },
  '1y': { label: 'trends.range1y', a11y: 'trends.range1yA11y' },
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

/** "milestone: A week of logging" for each milestone on a day. */
function milestoneWords(names: readonly string[] | undefined, t: TFn): string[] {
  return names?.map((n) => t('trends.chart.milestone', { name: t(`milestones.${n}` as I18nKey) })) ?? [];
}

/** The caption that names the window a chart without its own chips shows —
 *  the weight and protein cards follow the maintenance card's chips, and said
 *  nothing about it (review S20). */
function windowCaption(days: number, t: TFn): string {
  return t('trends.chart.lastDays', { n: days });
}

/** The three cards' shared "open this day" wiring, stable across renders. */
function useOpenDay(onOpenDay: (dateKey: string) => void, t: TFn, locale: Locale, onUsed?: () => void): NonNullable<TrendChartProps['openDay']> {
  return useMemo(
    () => ({
      label: (key: string) => t('trends.chart.openDay', { date: longDate(key, locale) }),
      actionLabel: t('trends.chart.openDayAction'),
      closeLabel: t('a11y.close'),
      onOpen: (key: string) => {
        onUsed?.();
        onOpenDay(key);
      },
    }),
    [onOpenDay, t, locale, onUsed],
  );
}

export function RangeChips({
  range,
  onChange,
  cap,
  t,
}: {
  range: TrendRange;
  onChange: (r: TrendRange) => void;
  /** The chart cap, in days — which chips exist, and what "All" reaches. */
  cap: number;
  t: TFn;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chips} accessibilityRole="tablist" testID="trend-range">
      {rangesFor(cap).map((r) => {
        const on = r === range;
        return (
          <PressScale
            key={r}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(RANGE_LABEL[r].a11y, { n: cap })}
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

function LegendItem({ color, label, dashed, dotted, dot }: { color: string; label: string; dashed?: boolean; dotted?: boolean; dot?: boolean }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.legendItem}>
      {dot ? (
        <View style={[styles.legendDot, { backgroundColor: color }]} />
      ) : (
        <View style={[styles.legendLine, { borderColor: color, borderStyle: dotted ? 'dotted' : dashed ? 'dashed' : 'solid' }]} />
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
  /** The chart cap in days (which range chips exist). */
  cap: number;
  onOpenDay: (dateKey: string) => void;
  t: TFn;
  locale: Locale;
}

function ExpenditureCardImpl({ keys, intake, series, days, target, milestones, range, onRange, cap, onOpenDay, t, locale }: ExpenditureCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // "Touch and hold a day" — nothing said a day could be opened at all
  // (review S20). Shown under this, the first chart, until a day has been
  // opened from any chart once; device-local, like the stub dismissals.
  const [hintSeen, markHintSeen] = useDismissedStub('trends.hint.openDay.seen');
  const openDay = useOpenDay(onOpenDay, t, locale, hintSeen ? undefined : markHintSeen);
  const formatY = useCallback((v: number) => formatNumber(Math.round(v / 10) * 10, locale), [locale]);

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
    const labels: string[] = [];
    const bubbles: string[] = [];
    k.forEach((key, i) => {
      const date = longDate(key, locale);
      const p = aligned[i];
      const kcalText = p?.kcal != null ? formatNumber(p.kcal, locale) : '';
      const est =
        p?.kcal == null
          ? t('trends.chart.expNone', { date })
          : t(p.source === 'formula' ? 'trends.chart.expFormula' : 'trends.chart.expMeasured', { date, kcal: kcalText });
      const ate = eat[i] != null ? t('trends.chart.ate', { kcal: formatNumber(eat[i] as number, locale) }) : t('trends.chart.notLogged');
      const ms = milestoneWords(names[i], t);
      labels.push([est, ate, ...ms].join(' · '));
      // The bubble's short form: date and numbers, the milestone named — a
      // diamond on the baseline is otherwise anonymous.
      const shortEst =
        p?.kcal == null
          ? t('trends.chart.bubbleNone')
          : t(p.source === 'formula' ? 'trends.chart.bubbleFormula' : 'trends.chart.bubbleMaint', { kcal: kcalText });
      bubbles.push([shortDate(key, locale), shortEst, ate, ...ms].join(' · '));
    });
    const measured = aligned.filter((p): p is TdeeSeriesPoint => p?.source === 'measured' && p.kcal != null);
    const hasFormula = isFormula.some(Boolean);
    // Said by state (review S20, bug 7): it always promised a dashed target
    // line — even with no target drawn — never mentioned the dashed formula
    // stretch, and told a seed-only account it had a "formula estimate".
    const head =
      measured.length >= 2
        ? t('trends.chart.expSummary', {
            days: k.length,
            from: formatNumber(measured[0].kcal as number, locale),
            to: formatNumber(measured[measured.length - 1].kcal as number, locale),
          })
        : hasFormula
          ? t('trends.chart.expSummaryFormula', { days: k.length })
          : t('trends.chart.expSummarySeed', { days: k.length });
    const summary = [
      head,
      eat.some((v) => v != null) ? t('trends.chart.expSummaryDots') : null,
      measured.length >= 2 && hasFormula ? t('trends.chart.expSummaryFormulaPart') : null,
      target > 0 ? t('trends.chart.expSummaryTarget', { kcal: formatNumber(target, locale) }) : null,
    ]
      .filter(Boolean)
      .join(' ');
    const xLabels: [string, string] = [shortDate(k[0], locale), shortDate(k[k.length - 1], locale)];
    return { k, kcal, isFormula, eat, labels, bubbles, summary, marks, hasFormula, xLabels };
  }, [keys, intake, series, days, milestones, target, t, locale]);

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
  // Today's dot is left off the plot: a half-logged day (lunch at 380 kcal)
  // stretched the axis down to it and flattened the estimate into a ruler line.
  // Its value still reads in the per-day stepper.
  const dots = useMemo(
    () => [{ key: 'intake', values: [...view.eat.slice(0, -1), null], color: colors.lineStrong, radius: 2.25 }],
    [view, colors.lineStrong],
  );
  // The audio graph's words (iOS VoiceOver, `AccessibleChart`): the legend's
  // own series names, so what is heard matches what is drawn.
  const audioGraph = useMemo(
    () => ({
      title: t('trends.expenditureTitle'),
      xTitle: t('entry.date'),
      yTitle: 'kcal',
      unit: 'kcal',
      decimals: 0,
      xLabel: (key: string) => longDate(key, locale),
      seriesNames: { tdee: t('trends.legendMaintenance'), intake: t('trends.legendIntake') },
    }),
    [t, locale],
  );

  const reference = useMemo(
    () =>
      target > 0
        ? { value: target, label: t('trends.chart.targetLabel', { kcal: formatNumber(target, locale) }), color: colors.muted }
        : undefined,
    [target, t, locale, colors.muted],
  );

  return (
    <View style={styles.card} testID="expenditure-card">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('trends.expenditureTitle')}</Text>
        <RangeChips range={range} onChange={onRange} cap={cap} t={t} />
      </View>
      {series == null ? (
        <View style={styles.placeholder} testID="expenditure-pending" />
      ) : (
        <TrendChart
          dateKeys={view.k}
          lines={lines}
          dots={dots}
          reference={reference}
          markers={view.marks}
          summary={view.summary}
          pointLabels={view.labels}
          bubbleLabels={view.bubbles}
          formatY={formatY}
          xLabels={view.xLabels}
          openDay={openDay}
          audioGraph={audioGraph}
          testID="expenditure-chart"
        />
      )}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LegendItem color={colors.accent} label={t('trends.legendMaintenance')} />
        {view.hasFormula ? <LegendItem color={colors.accent} label={t('trends.legendFormula')} dashed /> : null}
        <LegendItem color={colors.lineStrong} label={t('trends.legendIntake')} dot />
        {target > 0 ? <LegendItem color={colors.muted} label={t('trends.legendTarget')} dotted /> : null}
      </View>
      {/* Sighted-only: VoiceOver and TalkBack users have "Open this day in
          History" as an action on the chart itself. */}
      {series != null && !hintSeen ? (
        <Text style={styles.hint} accessibilityElementsHidden importantForAccessibility="no" testID="trends-open-day-hint">
          {t('trends.chart.openDayHint')}
        </Text>
      ) : null}
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
  const openDay = useOpenDay(onOpenDay, t, locale);
  const formatY = useCallback((v: number) => formatNumber(v, locale, { maximumFractionDigits: 1 }), [locale]);

  const view = useMemo(() => {
    const k = keys.slice(-days);
    const s = series.slice(-days);
    const show = (lb: number) => formatNumber(toDisplayWeight(lb, unitSystem), locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const scale = s.map((p) => (p.scale == null ? null : toDisplayWeight(p.scale, unitSystem)));
    const trend = s.map((p) => (p.trend == null ? null : toDisplayWeight(p.trend, unitSystem)));
    const { marks, names } = milestoneMarks(milestones, k);
    const labels: string[] = [];
    const bubbles: string[] = [];
    k.forEach((key, i) => {
      const date = longDate(key, locale);
      const p = s[i];
      const head =
        p.scale != null && p.trend != null
          ? t('trends.chart.weighed', { date, w: show(p.scale), trend: show(p.trend), u: unit })
          : p.trend != null
            ? t('trends.chart.noWeighIn', { date, trend: show(p.trend), u: unit })
            : t('trends.chart.noWeighInsYet', { date });
      const ms = milestoneWords(names[i], t);
      labels.push([head, ...ms].join(' · '));
      const short =
        p.scale != null && p.trend != null
          ? t('trends.chart.bubbleWeighed', { w: show(p.scale), trend: show(p.trend), u: unit })
          : p.trend != null
            ? t('trends.chart.bubbleTrend', { trend: show(p.trend), u: unit })
            : t('trends.chart.bubbleNoWeighIns');
      bubbles.push([shortDate(key, locale), short, ...ms].join(' · '));
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
    const xLabels: [string, string] = [shortDate(k[0], locale), shortDate(k[k.length - 1], locale)];
    return { k, scale, trend, labels, bubbles, summary, marks, weighIns, xLabels };
  }, [keys, series, days, unitSystem, milestones, t, locale, unit]);

  const lines = useMemo(() => [{ key: 'trend', values: view.trend, color: colors.teal, width: 2.5 }], [view, colors.teal]);
  const dots = useMemo(() => [{ key: 'scale', values: view.scale, color: colors.lineStrong, radius: 2.75 }], [view, colors.lineStrong]);
  // Same as the expenditure card's: legend names, display unit, one decimal —
  // the precision the per-day sentences already read weights at.
  const audioGraph = useMemo(
    () => ({
      title: t('trends.weightChartTitle'),
      xTitle: t('entry.date'),
      yTitle: unit,
      unit,
      decimals: 1,
      xLabel: (key: string) => longDate(key, locale),
      seriesNames: { trend: t('trends.legendTrend'), scale: t('trends.legendScale') },
    }),
    [t, locale, unit],
  );

  return (
    <View style={styles.card} testID="weight-trend-card">
      <View style={styles.head}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header">{t('trends.weightChartTitle')}</Text>
          <Text style={styles.caption} testID="weight-trend-window">{windowCaption(view.k.length, t)}</Text>
        </View>
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
          bubbleLabels={view.bubbles}
          formatY={formatY}
          xLabels={view.xLabels}
          openDay={openDay}
          audioGraph={audioGraph}
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

// ─── Protein ─────────────────────────────────────────────────────────────────

/** The protein line's smoothing: a trailing average over this many days. A
 *  single day's protein swings with one meal; a week is the unit the target
 *  is actually kept over. */
export const PROTEIN_AVG_DAYS = 7;

/**
 * Trailing mean over the last `window` days with a value, per day — null
 * until the first value. Gaps are skipped, not counted as zero: a day with no
 * food logged says nothing about protein.
 */
export function trailingMean(values: readonly (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  });
}

export interface ProteinTrendCardProps {
  keys: readonly string[];
  /** Protein (g) per day, null on a day with no food logged. */
  protein: readonly (number | null)[];
  days: number;
  target: number;
  milestones: Record<string, Date>;
  onOpenDay: (dateKey: string) => void;
  t: TFn;
  locale: Locale;
}

function ProteinTrendCardImpl({ keys, protein, days, target, milestones, onOpenDay, t, locale }: ProteinTrendCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const openDay = useOpenDay(onOpenDay, t, locale);
  const formatY = useCallback((v: number) => formatNumber(Math.round(v), locale), [locale]);

  const view = useMemo(() => {
    const k = keys.slice(-days);
    // Today is left out of the dots and the average, for the reason the
    // maintenance chart leaves today's intake dot out: a lunchtime total is
    // not a day's protein.
    const g = [...protein.slice(-days).slice(0, -1), null];
    const avg = trailingMean(g, PROTEIN_AVG_DAYS).map((v, i) => (i === g.length - 1 ? null : v));
    const { marks, names } = milestoneMarks(milestones, k);
    const labels: string[] = [];
    const bubbles: string[] = [];
    k.forEach((key, i) => {
      const date = longDate(key, locale);
      const v = g[i];
      const a = avg[i];
      const avgText = a != null ? t('trends.chart.proteinAvg', { g: formatNumber(Math.round(a), locale) }) : null;
      const ms = milestoneWords(names[i], t);
      const head =
        v != null
          ? t('trends.chart.proteinPoint', { date, g: formatNumber(v, locale) })
          : i === k.length - 1
            ? t('trends.chart.proteinToday', { date })
            : t('trends.chart.proteinNone', { date });
      labels.push([head, avgText, ...ms].filter(Boolean).join(' · '));
      bubbles.push(
        [shortDate(key, locale), v != null ? t('trends.chart.bubbleProtein', { g: formatNumber(v, locale) }) : t('trends.chart.notLogged'), avgText, ...ms]
          .filter(Boolean)
          .join(' · '),
      );
    });
    const logged = g.filter((v): v is number => v != null);
    const mean = logged.length ? Math.round(logged.reduce((s, v) => s + v, 0) / logged.length) : 0;
    const hit = target > 0 ? logged.filter((v) => v >= target).length : 0;
    const summary = [
      logged.length
        ? t('trends.chart.proteinSummary', { days: k.length, avg: formatNumber(mean, locale) })
        : t('trends.chart.proteinEmpty', { days: k.length }),
      target > 0 && logged.length
        ? t('trends.chart.proteinSummaryTarget', {
            g: formatNumber(target, locale),
            hit: formatNumber(hit, locale),
            days: formatNumber(logged.length, locale),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' ');
    const xLabels: [string, string] = [shortDate(k[0], locale), shortDate(k[k.length - 1], locale)];
    return { k, g, avg, labels, bubbles, summary, marks, logged: logged.length, xLabels };
  }, [keys, protein, days, target, milestones, t, locale]);

  // `good`, not the macro `protein` green: that one is tuned for fills and
  // measures under 3:1 as a thin line on light paper (UX_AUDIT S18-2).
  const lines = useMemo(() => [{ key: 'avg', values: view.avg, color: colors.good, width: 2.5 }], [view, colors.good]);
  const dots = useMemo(() => [{ key: 'protein', values: view.g, color: colors.lineStrong, radius: 2.5 }], [view, colors.lineStrong]);
  const reference = useMemo(
    () =>
      target > 0
        ? { value: target, label: t('trends.chart.proteinTargetLabel', { g: formatNumber(target, locale) }), color: colors.muted }
        : undefined,
    [target, t, locale, colors.muted],
  );
  const audioGraph = useMemo(
    () => ({
      title: t('trends.proteinChartTitle'),
      xTitle: t('entry.date'),
      yTitle: 'g',
      unit: 'g',
      decimals: 0,
      xLabel: (key: string) => longDate(key, locale),
      seriesNames: { avg: t('trends.legendProteinAvg'), protein: t('trends.legendProtein') },
    }),
    [t, locale],
  );

  return (
    <View style={styles.card} testID="protein-trend-card">
      <View style={styles.titleBlock}>
        <Text style={styles.title} accessibilityRole="header">{t('trends.proteinChartTitle')}</Text>
        <Text style={styles.caption} testID="protein-trend-window">{windowCaption(view.k.length, t)}</Text>
      </View>
      {view.logged === 0 ? (
        <Text style={styles.empty}>{t('trends.chart.proteinEmpty', { days: view.k.length })}</Text>
      ) : (
        <TrendChart
          dateKeys={view.k}
          lines={lines}
          dots={dots}
          reference={reference}
          markers={view.marks}
          summary={view.summary}
          pointLabels={view.labels}
          bubbleLabels={view.bubbles}
          formatY={formatY}
          xLabels={view.xLabels}
          openDay={openDay}
          audioGraph={audioGraph}
          testID="protein-trend-chart"
        />
      )}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LegendItem color={colors.good} label={t('trends.legendProteinAvg')} />
        <LegendItem color={colors.lineStrong} label={t('trends.legendProtein')} dot />
        {target > 0 ? <LegendItem color={colors.muted} label={t('trends.legendTarget')} dotted /> : null}
      </View>
    </View>
  );
}

export const ProteinTrendCard = memo(ProteinTrendCardImpl);

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm, marginTop: space.md },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm },
    title: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
    titleBlock: { flexShrink: 1, gap: 2 },
    caption: { fontSize: font.tiny, color: colors.muted },
    hint: { fontSize: font.tiny, color: colors.muted },
    // Same reserved height as the drawn chart (bubble + plot + x labels), so
    // the card does not jump when the deferred series lands.
    // The bubble is two lines (40) plus its 4dp margin since review S20.
    placeholder: { height: 132 + 44 + 18, borderRadius: radius.sm, backgroundColor: colors.inputBg, opacity: 0.6 },
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
