import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  type TdeeSeriesPoint,
  type UnitSystem,
  type WeightSeriesPoint,
  bodyWeightUnit,
  sortMilestones,
  toDisplayWeight,
} from '@macrolog/core';
import { type I18nKey, type Locale, type TFn } from '@/i18n';
import { useDismissedStub } from '@/hooks/useDismissedStub';
import { usePersistedTab } from '@/hooks/usePersistedTab';
import { MenuButton, type MenuButtonAction } from '@/components/MenuButton';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';
import { chartDate, chartNumber as formatNumber, signedNumber } from './chart-format';
import { Glyph } from './Glyph';
import { TrendChart, type TrendChartProps } from './TrendChart';
import { SegmentedControl } from './SegmentedControl';

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

/**
 * Whether an account's history is shorter than the shortest fixed range — in
 * which case every fixed chip is mostly blank axis and the screen opens on
 * "All" instead (sim review 2026-10-06: a new account's 1M was 27 empty days).
 */
export function fitsAllRange(historyDays: number): boolean {
  return historyDays < RANGE_NOMINAL['1m'];
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

// Cached (`chart-format.ts`, re-score 3 bug B2): a year of days is ~3,300
// date strings across the three cards, re-written per replay chunk.
function shortDate(key: string, locale: Locale): string {
  return chartDate(key, locale, 'short');
}

function longDate(key: string, locale: Locale): string {
  return chartDate(key, locale, 'long');
}

/** The x-axis date formatter a card hands its chart, stable per locale. */
function useXTickLabel(locale: Locale): (key: string) => string {
  return useCallback((key: string) => shortDate(key, locale), [locale]);
}

/**
 * The index of the day still in progress inside a window — the user's own day
 * (`todayKey`, under their day boundary), which is NOT always the last key:
 * the chart keys are calendar days (the estimator's), so between midnight and
 * a 03:00 day start the live day is the second-to-last key and the last one is
 * an empty calendar day (re-score 3, B4). Without a `todayKey`, the last key.
 * -1 when the live day is not in the window at all.
 */
export function liveIndex(keys: readonly string[], todayKey: string | undefined): number {
  if (todayKey == null) return keys.length - 1;
  return keys.indexOf(todayKey);
}

/** Per-day values with the live day and anything after it blanked — a
 *  lunchtime total is not a day. */
function completeDaysOnly<T>(values: readonly (T | null)[], live: number): (T | null)[] {
  const cut = live >= 0 ? live : values.length;
  return values.map((v, i) => (i >= cut ? null : v));
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
function useOpenDay(onOpenDay: (dateKey: string) => void, t: TFn, onUsed?: () => void): NonNullable<TrendChartProps['openDay']> {
  return useMemo(
    () => ({
      actionLabel: t('trends.chart.openDayAction'),
      onOpen: (key: string) => {
        onUsed?.();
        onOpenDay(key);
      },
    }),
    [onOpenDay, t, onUsed],
  );
}

/**
 * The window caption on the cards without chips, as a pull-down: the weight
 * and protein cards follow the maintenance card's 1M/3M/All, and "Last 30
 * days" said so but offered no way to change it short of scrolling back up
 * (re-score 3, U4). A system menu on the caption itself keeps the card as
 * quiet as it was. Where the binary has no native menu (Expo Go, web) a tap
 * steps to the next range.
 */
function RangeMenu({
  range,
  onRange,
  cap,
  days,
  t,
  testID,
}: {
  range: TrendRange;
  onRange: (r: TrendRange) => void;
  cap: number;
  /** The days actually drawn — what the caption names. */
  days: number;
  t: TFn;
  testID: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const ranges = rangesFor(cap);
  const caption = windowCaption(days, t);
  const actions: MenuButtonAction[] = ranges.map((r) => ({
    key: r,
    title: t(RANGE_LABEL[r].a11y, { n: cap }),
    sfSymbol: r === range ? 'checkmark' : undefined,
    onPress: () => {
      if (r !== range) onRange(r);
    },
  }));
  return (
    <MenuButton
      actions={actions}
      title={t('trends.chart.rangeMenuTitle')}
      accessibilityLabel={t('trends.chart.rangeMenuA11y', { range: caption })}
      accessibilityHint={t('trends.chart.rangeMenuHint')}
      testID={`${testID}-menu`}
      onFallbackPress={() => {
        haptics.tap();
        onRange(ranges[(ranges.indexOf(range) + 1) % ranges.length]);
      }}
      style={styles.rangeMenu}
    >
      <View style={styles.rangeFace} pointerEvents="none">
        <Text style={styles.rangeFaceText} testID={testID} maxFontSizeMultiplier={1.6}>{caption}</Text>
        <Glyph ios="chevron.down" android="chevron-down" size={11} color={colors.teal} />
      </View>
    </MenuButton>
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
  const segments = useMemo(
    () =>
      rangesFor(cap).map((r) => ({
        key: r,
        label: t(RANGE_LABEL[r].label),
        a11yLabel: t(RANGE_LABEL[r].a11y, { n: cap }),
        testID: `trend-range-${r}`,
      })),
    [cap, t],
  );
  return (
    <SegmentedControl
      segments={segments}
      value={range}
      onChange={onChange}
      accessibilityLabel={t('trends.chart.rangeMenuTitle')}
      maxFontSizeMultiplier={1.3}
      testID="trend-range"
    />
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
  /** The user's day in progress (`useTrends().todayKey`); defaults to the
   *  last key. */
  todayKey?: string;
  t: TFn;
  locale: Locale;
}

function ExpenditureCardImpl({ keys, intake, series, days, target, milestones, range, onRange, cap, onOpenDay, todayKey, t, locale }: ExpenditureCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // "Tap a day" — nothing said a day could be opened at all (review S20).
  // Shown under this, the first chart, until a day has been opened from any
  // chart once; device-local, like the stub dismissals.
  const [hintSeen, markHintSeen] = useDismissedStub('trends.hint.openDay.seen');
  const openDay = useOpenDay(onOpenDay, t, hintSeen ? undefined : markHintSeen);
  const formatY = useCallback((v: number) => formatNumber(Math.round(v / 10) * 10, locale), [locale]);
  const xTickLabel = useXTickLabel(locale);

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
    const live = liveIndex(k, todayKey);
    // The day the dashed formula stretch turns solid — the estimate's first
    // day measured from the user's own data, marked where it happened.
    const flip = aligned.findIndex((p, i) => i > 0 && isFormula[i - 1] && p?.source === 'measured');
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
      // The live day's intake is a running total, and is said as one — the
      // audio graph and the dots leave it out (re-score 3, B6).
      const ate =
        eat[i] != null
          ? t(i === live ? 'trends.chart.ateSoFar' : 'trends.chart.ate', { kcal: formatNumber(eat[i] as number, locale) })
          : t('trends.chart.notLogged');
      const ms = milestoneWords(names[i], t);
      const flipWords = i === flip ? [t('trends.chart.measuredFrom')] : [];
      labels.push([est, ate, ...flipWords, ...ms].join(' · '));
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
    const dots = completeDaysOnly(eat, live);
    // Said by state (review S20, bug 7): it always promised a dashed target
    // line — even with no target drawn — never mentioned the dashed formula
    // stretch, and told a seed-only account it had a "formula estimate".
    const from = measured.length >= 2 ? (measured[0].kcal as number) : null;
    const to = measured.length >= 2 ? (measured[measured.length - 1].kcal as number) : null;
    const head =
      from != null && to != null
        ? t('trends.chart.expSummary', { days: k.length, from: formatNumber(from, locale), to: formatNumber(to, locale) })
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
    // What the range did, in sight — it used to exist only as screen-reader
    // text (re-score 3, U1). Without two measured days there is no change to
    // state, so the visible line is the same head sentence VoiceOver hears:
    // a seed-only account saw an empty box and no words at all (C2).
    const readout =
      from != null && to != null
        ? t('trends.chart.expChange', { from: formatNumber(from, locale), to: formatNumber(to, locale), delta: signedNumber(to - from, locale) })
        : head;
    // Nothing to draw: no estimate on any day and nothing eaten.
    const empty = kcal.every((v) => v == null) && dots.every((v) => v == null);
    const annotations = flip > 0 ? [{ index: flip, label: t('trends.chart.measuredMark') }] : [];
    return { k, kcal, isFormula, dots, labels, bubbles, summary, readout, readoutIsChange: from != null, empty, marks, hasFormula, annotations };
  }, [keys, intake, series, days, milestones, target, todayKey, t, locale]);

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
  // Its value still reads in the per-day stepper, as "so far".
  const dots = useMemo(
    () => [{ key: 'intake', values: view.dots, color: colors.lineStrong, radius: 2.25, clipOutliers: true }],
    [view, colors.lineStrong],
  );
  // The audio graph's words (iOS VoiceOver, `AccessibleChart`): the legend's
  // own series names, so what is heard matches what is drawn.
  const audioGraph = useMemo(
    () => ({
      title: t('trends.expenditureTitle'),
      xTitle: t('entry.date'),
      yTitle: t('trends.kcalUnit'),
      unit: t('trends.kcalUnit'),
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
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header">{t('trends.expenditureTitle')}</Text>
          {/* Sighted-only: the chart's own label says the same thing. */}
          {series != null ? (
            <Text
              style={view.readoutIsChange ? styles.readout : styles.caption}
              accessibilityElementsHidden
              importantForAccessibility="no"
              testID="expenditure-readout"
            >
              {view.readout}
            </Text>
          ) : null}
        </View>
        <RangeChips range={range} onChange={onRange} cap={cap} t={t} />
      </View>
      {series == null ? (
        <View style={styles.placeholder} testID="expenditure-pending" />
      ) : view.empty ? null : (
        <TrendChart
          dateKeys={view.k}
          lines={lines}
          dots={dots}
          reference={reference}
          markers={view.marks}
          annotations={view.annotations}
          summary={view.summary}
          pointLabels={view.labels}
          bubbleLabels={view.bubbles}
          formatY={formatY}
          xTickLabel={xTickLabel}
          openDay={openDay}
          audioGraph={audioGraph}
          testID="expenditure-chart"
        />
      )}
      {view.empty && series != null ? null : (
        <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <LegendItem color={colors.accent} label={t('trends.legendMaintenance')} />
          {view.hasFormula ? <LegendItem color={colors.accent} label={t('trends.legendFormula')} dashed /> : null}
          <LegendItem color={colors.lineStrong} label={t('trends.legendIntake')} dot />
          {target > 0 ? <LegendItem color={colors.muted} label={t('trends.legendTarget')} dotted /> : null}
        </View>
      )}
      {/* Sighted-only: VoiceOver and TalkBack users have "Open this day in
          History" as an action on the chart itself. */}
      {series != null && !view.empty && !hintSeen ? (
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
  /** The shared range. Without it the caption is static text. */
  range?: TrendRange;
  onRange?: (r: TrendRange) => void;
  cap?: number;
  t: TFn;
  locale: Locale;
}

function WeightTrendCardImpl({ keys, series, days, unitSystem, milestones, onOpenBody, onOpenDay, range, onRange, cap, t, locale }: WeightTrendCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unit = bodyWeightUnit(unitSystem);
  const openDay = useOpenDay(onOpenDay, t);
  const formatY = useCallback((v: number) => formatNumber(v, locale, { maximumFractionDigits: 1 }), [locale]);
  const xTickLabel = useXTickLabel(locale);

  const view = useMemo(() => {
    const k = keys.slice(-days);
    const s = series.slice(-days);
    const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    const show = (lb: number) => formatNumber(toDisplayWeight(lb, unitSystem), locale, oneDecimal);
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
    const flat = Math.abs(delta) < (unitSystem === 'metric' ? 0.2 : 0.5);
    const trendKey: I18nKey = flat ? 'a11y.trend.flat' : delta < 0 ? 'a11y.trend.down' : 'a11y.trend.up';
    const summary =
      first != null && last != null
        ? t('a11y.chart.weight', {
            days: k.length,
            from: formatNumber(first, locale, oneDecimal),
            to: formatNumber(last, locale, oneDecimal),
            unit,
            trend: t(trendKey),
          })
        : t('trends.chart.weightEmpty', { days: k.length });
    // The change over the window, in sight (re-score 3, U1) — on the same
    // steady threshold the summary uses.
    const readout =
      first != null && last != null
        ? flat
          ? t('trends.chart.weightSteady')
          : t('trends.chart.weightChange', { delta: signedNumber(delta, locale, oneDecimal), u: unit })
        : null;
    return { k, scale, trend, labels, bubbles, summary, readout, marks, weighIns };
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
      {/* The title and the link share one row, centred on each other — the
          link used to centre on the title AND the caption below it, and sat
          between the two lines (sim review 2026-10-06). */}
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.titleGrow]} accessibilityRole="header">{t('trends.weightChartTitle')}</Text>
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
      <View style={styles.captionRow}>
        {range && onRange && cap ? (
          <RangeMenu range={range} onRange={onRange} cap={cap} days={view.k.length} t={t} testID="weight-trend-window" />
        ) : (
          <Text style={styles.caption} testID="weight-trend-window">{windowCaption(view.k.length, t)}</Text>
        )}
        {view.readout && view.weighIns > 0 ? (
          <Text style={styles.readout} accessibilityElementsHidden importantForAccessibility="no" testID="weight-trend-readout">
            {view.readout}
          </Text>
        ) : null}
      </View>
      {view.weighIns === 0 ? (
        // A soft placeholder the size of the chart it stands in for, with the
        // sentence inside it — a legend over no chart described lines that
        // were not drawn.
        <View style={styles.emptyBox} testID="weight-trend-empty">
          <Text style={styles.emptyText}>{t('trends.chart.weightEmpty', { days: view.k.length })}</Text>
        </View>
      ) : (
        <>
          <TrendChart
            dateKeys={view.k}
            lines={lines}
            dots={dots}
            markers={view.marks}
            summary={view.summary}
            pointLabels={view.labels}
            bubbleLabels={view.bubbles}
            formatY={formatY}
            xTickLabel={xTickLabel}
            openDay={openDay}
            audioGraph={audioGraph}
            testID="weight-trend-chart"
          />
          <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <LegendItem color={colors.teal} label={t('trends.legendTrend')} />
            <LegendItem color={colors.lineStrong} label={t('trends.legendScale')} dot />
          </View>
        </>
      )}
    </View>
  );
}

export const WeightTrendCard = memo(WeightTrendCardImpl);

// ─── Macros (protein, carbs, fat) ────────────────────────────────────────────

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

/**
 * The macros the card can plot. Protein leads (it has a target and is the one
 * the app coaches); carbs and fat were never drawn over time at all while
 * Cronometer charts every nutrient (re-score 3, U3). Fibre is not here because
 * Ignia does not record it — a `DailyLog` has no fibre field, and adding one
 * is a rules change, not a chart.
 */
export const MACRO_TABS = ['protein', 'carbs', 'fat'] as const;
export type MacroTab = (typeof MACRO_TABS)[number];

const MACRO_LABEL: Record<MacroTab, I18nKey> = { protein: 'macro.protein', carbs: 'macro.carbs', fat: 'macro.fat' };
/** The lower-case noun the per-day sentences use ("42 g carbs"). Protein
 *  keeps its own, older strings. */
const MACRO_NAME: Record<Exclude<MacroTab, 'protein'>, I18nKey> = { carbs: 'trends.chart.carbsName', fat: 'trends.chart.fatName' };

export interface ProteinTrendCardProps {
  keys: readonly string[];
  /** Protein (g) per day, null on a day with no food logged. */
  protein: readonly (number | null)[];
  /** Carbs / fat (g) per day, null on a day without them. Omit and the card
   *  is protein-only, with no selector. */
  carbs?: readonly (number | null)[];
  fat?: readonly (number | null)[];
  days: number;
  target: number;
  milestones: Record<string, Date>;
  onOpenDay: (dateKey: string) => void;
  /** The user's day in progress (`useTrends().todayKey`). */
  todayKey?: string;
  range?: TrendRange;
  onRange?: (r: TrendRange) => void;
  cap?: number;
  t: TFn;
  locale: Locale;
}

function ProteinTrendCardImpl({ keys, protein, carbs, fat, days, target, milestones, onOpenDay, todayKey, range, onRange, cap, t, locale }: ProteinTrendCardProps) {
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  const openDay = useOpenDay(onOpenDay, t);
  const formatY = useCallback((v: number) => formatNumber(Math.round(v), locale), [locale]);
  const xTickLabel = useXTickLabel(locale);
  const selectable = carbs != null && fat != null;
  // Remembered per device, like the panel tabs on this screen.
  const [macroRaw, setMacro] = usePersistedTab('trends.macro', MACRO_TABS, 'protein');
  const macro: MacroTab = selectable ? (macroRaw as MacroTab) : 'protein';
  const isProtein = macro === 'protein';
  const goal = isProtein ? target : 0;
  const macroSegments = useMemo(
    () => MACRO_TABS.map((m) => ({ key: m, label: t(MACRO_LABEL[m]), testID: `macro-tab-${m}` })),
    [t],
  );

  const view = useMemo(() => {
    const source = macro === 'carbs' ? (carbs ?? []) : macro === 'fat' ? (fat ?? []) : protein;
    const k = keys.slice(-days);
    const live = liveIndex(k, todayKey);
    // Today is left out of the dots and the average, for the reason the
    // maintenance chart leaves today's intake dot out: a lunchtime total is
    // not a day's protein.
    const g = completeDaysOnly(source.slice(-days), live);
    const avg = trailingMean(g, PROTEIN_AVG_DAYS).map((v, i) => (live >= 0 && i >= live ? null : v));
    const name = isProtein ? '' : t(MACRO_NAME[macro as Exclude<MacroTab, 'protein'>]);
    const title = t(isProtein ? 'trends.proteinChartTitle' : MACRO_LABEL[macro]);
    const { marks, names } = milestoneMarks(milestones, k);
    const labels: string[] = [];
    const bubbles: string[] = [];
    k.forEach((key, i) => {
      const date = longDate(key, locale);
      const v = g[i];
      const a = avg[i];
      const avgText = a != null ? t('trends.chart.proteinAvg', { g: formatNumber(Math.round(a), locale) }) : null;
      const ms = milestoneWords(names[i], t);
      const grams = v != null ? formatNumber(v, locale) : '';
      const head =
        v != null
          ? isProtein
            ? t('trends.chart.proteinPoint', { date, g: grams })
            : t('trends.chart.macroPoint', { date, g: grams, name })
          : i === live
            ? t('trends.chart.proteinToday', { date })
            : t('trends.chart.proteinNone', { date });
      labels.push([head, avgText, ...ms].filter(Boolean).join(' · '));
      const short =
        v != null
          ? isProtein
            ? t('trends.chart.bubbleProtein', { g: grams })
            : t('trends.chart.bubbleMacro', { g: grams, name })
          : t('trends.chart.notLogged');
      bubbles.push([shortDate(key, locale), short, avgText, ...ms].filter(Boolean).join(' · '));
    });
    const logged = g.filter((v): v is number => v != null);
    const mean = logged.length ? Math.round(logged.reduce((s, v) => s + v, 0) / logged.length) : 0;
    const hit = goal > 0 ? logged.filter((v) => v >= goal).length : 0;
    const summary = [
      logged.length
        ? isProtein
          ? t('trends.chart.proteinSummary', { days: k.length, avg: formatNumber(mean, locale) })
          : t('trends.chart.macroSummary', { days: k.length, avg: formatNumber(mean, locale), title })
        : isProtein
          ? t('trends.chart.proteinEmpty', { days: k.length })
          : t('trends.chart.macroEmpty', { days: k.length, name }),
      goal > 0 && logged.length
        ? t('trends.chart.proteinSummaryTarget', {
            g: formatNumber(goal, locale),
            hit: formatNumber(hit, locale),
            days: formatNumber(logged.length, locale),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' ');
    // The average and days at target, in sight (re-score 3, U1) — the summary
    // computed both and only VoiceOver heard them.
    const readout = logged.length
      ? [
          t('trends.chart.macroAvgShort', { g: formatNumber(mean, locale) }),
          goal > 0 ? t('trends.chart.macroHitShort', { hit: formatNumber(hit, locale), days: formatNumber(logged.length, locale) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
    return { k, g, avg, labels, bubbles, summary, readout, marks, logged: logged.length, title };
  }, [keys, protein, carbs, fat, macro, isProtein, days, goal, milestones, todayKey, t, locale]);

  // `good`, not the macro `protein` green: that one is tuned for fills and
  // measures under 3:1 as a thin line on light paper (UX_AUDIT S18-2). Carbs
  // are an amber that clears 3:1 on the CARD the line is drawn on: the ember
  // `habitFasting` measured 2.85:1 on light `card` (sim review 2026-10-06), so
  // light mode takes `warn` (4.5:1, the same amber family, darker); dark keeps
  // the ember, bright on near-black.
  const lineColor =
    macro === 'carbs' ? (scheme === 'light' ? colors.warn : colors.habitFasting) : macro === 'fat' ? colors.fat : colors.good;
  const lines = useMemo(() => [{ key: 'avg', values: view.avg, color: lineColor, width: 2.5 }], [view, lineColor]);
  const dots = useMemo(() => [{ key: 'protein', values: view.g, color: colors.lineStrong, radius: 2.5 }], [view, colors.lineStrong]);
  const reference = useMemo(
    () =>
      goal > 0
        ? { value: goal, label: t('trends.chart.proteinTargetLabel', { g: formatNumber(goal, locale) }), color: colors.muted }
        : undefined,
    [goal, t, locale, colors.muted],
  );
  const dailyLegend = isProtein ? t('trends.legendProtein') : t('trends.legendDaily');
  const audioGraph = useMemo(
    () => ({
      title: view.title,
      xTitle: t('entry.date'),
      yTitle: t('unit.g'),
      unit: t('unit.g'),
      decimals: 0,
      xLabel: (key: string) => longDate(key, locale),
      seriesNames: { avg: t('trends.legendProteinAvg'), protein: dailyLegend },
    }),
    [t, locale, view.title, dailyLegend],
  );

  return (
    <View style={styles.card} testID="protein-trend-card">
      <View style={styles.titleBlock}>
        <Text style={styles.title} accessibilityRole="header">{view.title}</Text>
        <View style={styles.captionRow}>
          {range && onRange && cap ? (
            <RangeMenu range={range} onRange={onRange} cap={cap} days={view.k.length} t={t} testID="protein-trend-window" />
          ) : (
            <Text style={styles.caption} testID="protein-trend-window">{windowCaption(view.k.length, t)}</Text>
          )}
          {view.readout ? (
            <Text style={styles.readout} accessibilityElementsHidden importantForAccessibility="no" testID="protein-trend-readout">
              {view.readout}
            </Text>
          ) : null}
        </View>
      </View>
      {selectable ? (
        <SegmentedControl
          segments={macroSegments}
          value={macro}
          onChange={setMacro}
          maxFontSizeMultiplier={1.3}
          testID="macro-tabs"
        />
      ) : null}
      {view.logged === 0 ? (
        <Text style={styles.empty}>
          {isProtein
            ? t('trends.chart.proteinEmpty', { days: view.k.length })
            : t('trends.chart.macroEmpty', { days: view.k.length, name: t(MACRO_NAME[macro as Exclude<MacroTab, 'protein'>]) })}
        </Text>
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
          xTickLabel={xTickLabel}
          openDay={openDay}
          audioGraph={audioGraph}
          testID="protein-trend-chart"
        />
      )}
      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LegendItem color={lineColor} label={t('trends.legendProteinAvg')} />
        <LegendItem color={colors.lineStrong} label={dailyLegend} dot />
        {goal > 0 ? <LegendItem color={colors.muted} label={t('trends.legendTarget')} dotted /> : null}
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
    // `small`, not `tiny`: the theme keeps 12 pt for uppercase eyebrows, and
    // these are sentences (sim review 2026-10-06).
    caption: { fontSize: font.small, color: colors.muted },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    titleGrow: { flex: 1 },
    captionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: space.sm },
    // The change over the range — a figure, so it reads in ink, not muted.
    readout: { fontSize: font.small, color: colors.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
    hint: { fontSize: font.small, color: colors.muted },
    // Same reserved height as the drawn chart (plot + x labels), so the card
    // does not jump when the deferred series lands. The scrub bubble floats
    // over the header now and reserves nothing (re-score 3, V2).
    placeholder: { height: 132 + 18, borderRadius: radius.sm, backgroundColor: colors.inputBg, opacity: 0.6 },
    empty: { fontSize: font.small, color: colors.muted },
    emptyBox: { minHeight: 132, borderRadius: radius.sm, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: space.lg },
    emptyText: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
    // The caption-as-menu: 44 dp tall like every control here, its face the
    // caption plus a chevron in the link colour.
    rangeMenu: { minHeight: TARGET, justifyContent: 'center' },
    rangeFace: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rangeFaceText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendLine: { width: 16, height: 0, borderTopWidth: 2 },
    legendDot: { width: 6, height: 6, borderRadius: 3 },
    legendText: { fontSize: font.small, color: colors.muted },
    link: { minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.xs },
    linkText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  });
