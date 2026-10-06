import * as Haptics from 'expo-haptics';
import { memo, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  type AccessibilityActionEvent,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Line, Path } from 'react-native-svg';
import {
  type DatedWeight,
  type UnitSystem,
  type WeightRange,
  WEIGHT_RANGES,
  bodyWeightUnit,
  parseYmd,
  pointsInRange,
  toDisplayWeight,
} from '@macrolog/core';
import { type I18nKey, type Locale, type TFn, useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { isScreenReaderOn } from '@/lib/a11y';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { usePersistedTab } from '@/hooks/usePersistedTab';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import { audioGraphDescriptor } from '@/components/charts/audio-graph';
import { labelWidth } from '@/components/charts/chart-geometry';
import { SegmentedControl } from '@/components/charts/SegmentedControl';
import { type ChartFrame, dotsPath, nearestIndex, weightChartGeometry } from './weight-chart-geometry';

/**
 * The Body tab's long-range weight chart (Body review, U4 + V1).
 *
 * Replaces a fixed 300 pt, 14-day sparkline that overran a 360 dp screen, had
 * no axis, no dates and no goal, and could not show anything older than two
 * weeks — so "am I actually losing?" had to be answered from a list.
 *
 * - **Range chips** 1M / 3M / 6M / 1Y / All. "All" asks the hook for history
 *   older than its 400-day listener, once (`loadAllHistory`).
 * - **Dots are readings, the line is the trend** (`trendWeightSeries`, the
 *   Trends smoother), the dash is the 4-week projection, and a dashed rule
 *   marks the goal when it is near enough to draw without flattening the line.
 * - **Axis**: min, middle and max in a gutter on the left with a faint mid
 *   gridline, and first, middle and last date underneath (re-score: two
 *   numbers and two dates left a 140 pt plot unreadable). The numbers sit in
 *   their own `AXIS_GUTTER`, right-aligned, not over the plot — at `left: 0`
 *   with an 8 pt pad they drew across the oldest dots (re-score 3).
 * - **The caption** under the plot explains the dash, and is drawn only when
 *   the dash is (1M and 3M with a projection). It lived on Body and showed on
 *   every range, so 6M, 1Y and All described a line that was not there.
 * - **One path for the dots** (`dotsPath`), not a `<Circle>` per reading.
 * - **Scrub**: drag across the plot and a cursor follows the finger with a
 *   readout over the range chips (they are not needed mid-drag, and a bubble
 *   laid out in its own row left a dead band above the plot at rest) and a
 *   selection tick per reading crossed. The finger
 *   position, the index and the readout text live in shared values and
 *   animated props — dragging re-renders NO React component (the same
 *   UI-thread pattern `CountUpText` and the Trends charts use). A vertical
 *   drag fails the gesture so the screen still scrolls.
 * - **Accessible**: one adjustable element. Its label is the summary of the
 *   range (from, to, trend direction, low, high); swiping up/down steps the
 *   value through readings, newest first — Apple Health's own chart pattern.
 *   On iOS that element is an `AccessibleChart`, so VoiceOver's rotor also
 *   offers an audio graph of the readings and the trend (`audio-graph.ts`) —
 *   additive; the stepper is unchanged. The descriptor is built only while a
 *   screen reader is on: on "All" it is three arrays of ~1,400 entries, and
 *   nobody else can hear it.
 * - **Dots** are thinned past a year of readings: a dot within its own radius
 *   of the last one drawn is skipped (`dotsPath`'s `minGap`), which is
 *   invisible at that density and halves the path.
 * - **Reduce Motion**: the plot fades in only when motion is allowed; the
 *   cursor never animates, it is placed.
 */

const HEIGHT = 140;
/** The narrowest the left gutter gets; it widens to its widest label (below). */
const AXIS_GUTTER_MIN = 40;
/** Axis numerals scale with the OS text size, but only this far. */
const AXIS_MAX_SCALE = 1.3;
const PAD: Omit<ChartFrame, 'width' | 'height' | 'padL'> = { padR: 8, padT: 12, padB: 12 };
/** Touch and hold this long and the scrub starts without a sideways drag —
 *  the same hold `TrendChart` uses. */
const HOLD_TO_SCRUB_MS = 180;
/** The chosen range, remembered per device like the Trends range. A stored
 *  value no longer in `WEIGHT_RANGES` falls back to the automatic pick. */
const RANGE_KEY = 'body.range';
const RANGE_AUTO = 'auto';
/** Above this many readings the dots are thinned (see the header). */
const DOT_THIN_FROM = 365;
const FORECAST_DAYS = 28;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** The lightest feedback the OS has, once per reading crossed. Local rather
 *  than `lib/haptics` — that module's calls are impacts and notifications. */
function tick(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

/** Is a screen reader running? Tracked live, so turning VoiceOver on with
 *  the chart on screen builds its audio graph. */
function useScreenReaderOn(): boolean {
  const [on, setOn] = useState(isScreenReaderOn);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (alive) setOn(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

const RANGE_VALID: readonly string[] = [RANGE_AUTO, ...WEIGHT_RANGES];

const RANGE_LONG: Record<WeightRange, I18nKey> = {
  '1M': 'body.range1MLong',
  '3M': 'body.range3MLong',
  '6M': 'body.range6MLong',
  '1Y': 'body.range1YLong',
  All: 'body.rangeAllLong',
};
const RANGE_SHORT: Record<WeightRange, I18nKey> = {
  '1M': 'body.range1M',
  '3M': 'body.range3M',
  '6M': 'body.range6M',
  '1Y': 'body.range1Y',
  All: 'body.rangeAll',
};

/** One reading at one decimal in the display unit and locale. */
function weightNum(lb: number, unitSystem: UnitSystem, locale: Locale): string {
  return formatNumber(toDisplayWeight(lb, unitSystem), locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

/** The date a reading is named by; the long ranges carry the year. */
function rangeDate(key: string, range: WeightRange, locale: Locale): string {
  return formatDate(parseYmd(key), locale, { month: 'short', day: 'numeric', year: range === '1M' || range === '3M' ? undefined : 'numeric' });
}

/**
 * The per-reading sentences and the range summary, as one pure computation the
 * chart memoises on its data — rebuilt per render, they were ~1,400 strings on
 * "All" every time a sheet opened over Body (review 2026-10-06, Pf).
 */
function chartText(
  shown: readonly DatedWeight[],
  shownTrend: readonly DatedWeight[],
  range: WeightRange,
  unitSystem: UnitSystem,
  unit: string,
  t: TFn,
  locale: Locale,
): { labels: string[]; dates: string[]; summary: string } {
  const dates = shown.map((p) => rangeDate(p.dateKey, range, locale));
  const labels = shown.map((p, i) =>
    t('body.chartPoint', {
      date: dates[i],
      weight: weightNum(p.weightLb, unitSystem, locale),
      trend: weightNum(shownTrend[i]?.weightLb ?? p.weightLb, unitSystem, locale),
      unit,
    }),
  );
  let summary = t('body.chartEmptyRange');
  if (shown.length > 0) {
    const first = shownTrend[0]?.weightLb ?? shown[0].weightLb;
    const last = shownTrend[shownTrend.length - 1]?.weightLb ?? shown[shown.length - 1].weightLb;
    const d = last - first;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of shown) {
      if (p.weightLb < lo) lo = p.weightLb;
      if (p.weightLb > hi) hi = p.weightLb;
    }
    summary = t('a11y.chart.weightRange', {
      range: t(RANGE_LONG[range]),
      from: weightNum(first, unitSystem, locale),
      to: weightNum(last, unitSystem, locale),
      unit,
      trend: t(d < -0.1 ? 'a11y.trend.down' : d > 0.1 ? 'a11y.trend.up' : 'a11y.trend.flat'),
      min: weightNum(lo, unitSystem, locale),
      max: weightNum(hi, unitSystem, locale),
    });
  }
  return { labels, dates, summary };
}

interface Props {
  /** Every loaded reading, oldest first. */
  points: readonly DatedWeight[];
  /** The trend at every reading, oldest first — computed over ALL history, so
   *  a range's first point carries the trend it really had, not a fresh seed. */
  trend: readonly DatedWeight[];
  todayKey: string;
  goalLb: number | null;
  /** The 28-day fit's slope, for the dash. */
  slopeLbPerWeek: number | null;
  unitSystem: UnitSystem;
  hasOlderHistory: boolean;
  onNeedAll: () => void;
  testID?: string;
}

function WeightChartImpl({
  points,
  trend,
  todayKey,
  goalLb,
  slopeLbPerWeek,
  unitSystem,
  hasOlderHistory,
  onNeedAll,
  testID,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unit = bodyWeightUnit(unitSystem);
  // Until the user picks one, the range is the shortest that has something to
  // draw: a chart opening on "No weigh-ins in this range" when the last one is
  // six weeks old reads as lost data, not as a filter. A pick is REMEMBERED
  // (review 2026-10-06) — but a stored range from an earlier session that has
  // since gone empty falls back to the automatic one, for the same reason. A
  // pick made this session is honoured as made.
  const [picked, setPicked] = useState<WeightRange | null>(null);
  const [stored, setStored] = usePersistedTab(RANGE_KEY, RANGE_VALID, RANGE_AUTO);
  const autoRange = useMemo<WeightRange>(
    () => WEIGHT_RANGES.find((r) => pointsInRange(points, r, todayKey).length >= 2) ?? 'All',
    [points, todayKey],
  );
  const storedRange = useMemo<WeightRange | null>(() => {
    if (stored === RANGE_AUTO || !(WEIGHT_RANGES as readonly string[]).includes(stored)) return null;
    const r = stored as WeightRange;
    return pointsInRange(points, r, todayKey).length >= 2 ? r : null;
  }, [stored, points, todayKey]);
  const range = picked ?? storedRange ?? autoRange;
  // "All" means all: asked for whenever the range IS All, picked or not. When
  // the auto range landed on All (under two readings in a year) the fetch
  // never ran and "All time" quietly showed the 400-day window (re-score 3,
  // bug 5). `loadAllHistory` is idempotent, so a re-run costs nothing.
  useEffect(() => {
    if (range === 'All' && hasOlderHistory) onNeedAll();
  }, [range, hasOlderHistory, onNeedAll]);
  const screenReader = useScreenReaderOn();
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const axisFont = font.tiny * Math.min(fontScale || 1, AXIS_MAX_SCALE);
  const [a11yIndex, setA11yIndex] = useState<number | null>(null);

  const shown = useMemo(() => pointsInRange(points, range, todayKey), [points, range, todayKey]);
  const shownTrend = useMemo(() => {
    const keys = new Set(shown.map((p) => p.dateKey));
    return trend.filter((p) => keys.has(p.dateKey));
  }, [trend, shown]);

  // The dash only means something on the short ranges, where four weeks
  // ahead is a visible fraction of the axis. The caption follows it.
  const dashed = slopeLbPerWeek != null && (range === '1M' || range === '3M');
  // The left gutter, sized to the widest axis label at the size it actually
  // renders. A fixed 34 dp column wrapped "184.6" mid-number at large text
  // ("184.\n6", sim review 2026-10-06). Sized off the data extent plus a
  // goal, which bound every label the axis can print.
  const gutter = useMemo(() => {
    const vals = [...shown.map((p) => p.weightLb), ...shownTrend.map((p) => p.weightLb)];
    if (goalLb != null) vals.push(goalLb);
    if (vals.length === 0) return AXIS_GUTTER_MIN;
    const widest = Math.max(...[Math.min(...vals) - 1, Math.max(...vals) + 1].map((v) => labelWidth(weightNum(v, unitSystem, locale), axisFont)));
    return Math.max(AXIS_GUTTER_MIN, widest + 6);
  }, [shown, shownTrend, goalLb, unitSystem, locale, axisFont]);
  const frame: ChartFrame = useMemo(() => ({ width, height: HEIGHT, padL: gutter, ...PAD }), [width, gutter]);
  const geometry = useMemo(
    () =>
      weightChartGeometry(shown, shownTrend, frame, {
        goalLb,
        slopeLbPerWeek,
        forecastDays: dashed ? FORECAST_DAYS : 0,
      }),
    [shown, shownTrend, frame, goalLb, slopeLbPerWeek, dashed],
  );

  const num = (lb: number) => weightNum(lb, unitSystem, locale);
  const day = (key: string) => formatDate(parseYmd(key), locale, { month: 'short', day: 'numeric' });

  // One string per reading, built on the JS thread: the worklet below only
  // indexes into it (no Intl on the UI runtime — see `numberSeparators`).
  // Memoised on the data, through a pure function so the deps are complete
  // and the React Compiler keeps compiling this component.
  const { labels, dates, summary } = useMemo(
    () => chartText(shown, shownTrend, range, unitSystem, unit, t, locale),
    [shown, shownTrend, range, unitSystem, unit, t, locale],
  );

  // ── Audio graph (iOS VoiceOver) — readings as points, the trend as a line,
  // both in the display unit at the precision the labels read them. Built only
  // while a screen reader is on. ──
  const descriptor = useMemo(
    () =>
      shown.length === 0 || !screenReader
        ? null
        : audioGraphDescriptor({
            title: t('trends.weightChartTitle'),
            summary,
            xTitle: t('entry.date'),
            xLabels: dates,
            yTitle: unit,
            unit,
            decimals: 1,
            series: [
              { name: t('trends.legendTrend'), values: shown.map((p, i) => toDisplayWeight(shownTrend[i]?.weightLb ?? p.weightLb, unitSystem)) },
              { name: t('trends.legendScale'), values: shown.map((p) => toDisplayWeight(p.weightLb, unitSystem)), continuous: false },
            ],
            pointLabels: labels,
          }),
    [shown, shownTrend, screenReader, summary, dates, labels, unit, unitSystem, t],
  );

  // ── Adjustable stepping (screen readers) — clamped on read, newest first ──
  const n = shown.length;
  const index = n === 0 ? 0 : Math.min(n - 1, Math.max(0, a11yIndex ?? n - 1));
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') setA11yIndex(Math.min(n - 1, index + 1));
    else if (e.nativeEvent.actionName === 'decrement') setA11yIndex(Math.max(0, index - 1));
  };

  // ── Scrub: UI-thread state only ──
  const idx = useSharedValue(-1);
  const xs = geometry?.xs ?? [];
  const ys = geometry?.trendYs ?? [];
  const w = frame.width;

  // TrendChart's fix, mirrored (sim review 2026-10-06): the cursor and the
  // bubble used to appear at touch-DOWN (`onBegin`), so every vertical scroll
  // that started on the chart flashed them. Now a sideways drag scrubs at
  // once, or a short hold starts it where the finger rests; moving vertically
  // first fails both and the screen scrolls.
  const drag = Gesture.Pan()
    .enabled(n > 0)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart((e) => {
      idx.value = nearestIndex(xs, e.x);
    })
    .onUpdate((e) => {
      const next = nearestIndex(xs, e.x);
      if (next !== idx.value) {
        idx.value = next;
        scheduleOnRN(tick);
      }
    })
    .onFinalize(() => {
      idx.value = -1;
    });
  const hold = Gesture.Pan()
    .enabled(n > 0)
    .activateAfterLongPress(HOLD_TO_SCRUB_MS)
    .failOffsetY([-14, 14])
    .onStart((e) => {
      idx.value = nearestIndex(xs, e.x);
      scheduleOnRN(tick);
    })
    .onUpdate((e) => {
      const next = nearestIndex(xs, e.x);
      if (next !== idx.value) {
        idx.value = next;
        scheduleOnRN(tick);
      }
    })
    .onFinalize(() => {
      idx.value = -1;
    });
  const pan = Gesture.Race(drag, hold);

  const cursorStyle = useAnimatedStyle(() => {
    const i = idx.value;
    return { opacity: i < 0 ? 0 : 1, transform: [{ translateX: i < 0 ? 0 : (xs[i] ?? 0) }] };
  });
  const dotStyle = useAnimatedStyle(() => {
    const i = idx.value;
    const y = i < 0 ? -1 : (ys[i] ?? -1);
    return {
      opacity: y < 0 ? 0 : 1,
      transform: [{ translateX: i < 0 ? 0 : (xs[i] ?? 0) - 5 }, { translateY: y < 0 ? 0 : y - 5 }],
    };
  });
  const bubbleStyle = useAnimatedStyle(() => {
    const i = idx.value;
    const bw = Math.min(240, w);
    const x = i < 0 ? 0 : Math.max(0, Math.min(w - bw, (xs[i] ?? 0) - bw / 2));
    return { opacity: i < 0 ? 0 : 1, width: bw, transform: [{ translateX: x }] };
  });
  const bubbleProps = useAnimatedProps(() => {
    const i = idx.value;
    return { text: i < 0 ? '' : (labels[i] ?? '') } as unknown as TextInputProps;
  });

  function pick(r: WeightRange) {
    if (r === range) return;
    setPicked(r);
    setStored(r);
    setA11yIndex(null);
  }
  const segments = WEIGHT_RANGES.map((r) => ({ key: r, label: t(RANGE_SHORT[r]), a11yLabel: t(RANGE_LONG[r]), testID: `weight-range-${r}` }));

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.chipsBand}>
        {/* The shared segmented control (tablist, a real 44/48 pt segment) —
            these were 32 pt radios while Trends' were tabs (review
            2026-10-06). */}
        <SegmentedControl
          segments={segments}
          value={range}
          onChange={pick}
          tone="hero"
          accessibilityLabel={t('body.rangeGroupA11y')}
          maxFontSizeMultiplier={AXIS_MAX_SCALE}
          testID="weight-range"
        />

        {/* The readout sits ABOVE the plot so the finger never covers it — over
            the chips, which nobody needs mid-drag. */}
        <Animated.View
          style={[styles.bubble, bubbleStyle]}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <AnimatedTextInput
            editable={false}
            underlineColorAndroid="transparent"
            style={styles.bubbleText}
            defaultValue=""
            animatedProps={bubbleProps}
            maxFontSizeMultiplier={1.3}
          />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <AccessibleChart
          descriptor={descriptor}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={summary}
          accessibilityValue={n > 0 ? { text: labels[index] } : undefined}
          accessibilityHint={n > 1 ? t('body.chartScrubHint') : undefined}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
          style={{ height: HEIGHT }}
          onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
          testID={testID ? `${testID}-plot` : undefined}
        >
          {geometry ? (
            <Animated.View entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)} style={StyleSheet.absoluteFill}>
              <Svg width={width} height={HEIGHT}>
                {geometry.goalY != null ? (
                  <Line
                    x1={gutter}
                    x2={width - PAD.padR}
                    y1={geometry.goalY}
                    y2={geometry.goalY}
                    stroke={colors.heroMuted}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />
                ) : null}
                <Line
                  x1={gutter}
                  x2={width - PAD.padR}
                  y1={geometry.midY}
                  y2={geometry.midY}
                  stroke={colors.heroTrack}
                  strokeWidth={1}
                />
                <Path
                  d={dotsPath(geometry.xs, geometry.ys, shown.length > 120 ? 1.5 : 2.5, shown.length > DOT_THIN_FROM ? 1.5 : 0)}
                  fill={colors.heroText}
                  opacity={0.45}
                />
                {geometry.trendPath ? (
                  <Path d={geometry.trendPath} stroke={colors.ring} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                ) : null}
                {geometry.forecastPath ? (
                  <Path d={geometry.forecastPath} stroke={colors.ring} strokeWidth={2} strokeDasharray="4 5" fill="none" opacity={0.7} />
                ) : null}
              </Svg>
            </Animated.View>
          ) : n === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('body.chartEmptyRange')}</Text>
            </View>
          ) : null}

          {geometry ? (
            <>
              {/* One line each, in a gutter as wide as the widest label — never
                  wrapped mid-number. */}
              <Text style={[styles.axis, styles.axisY, { width: gutter - 6, top: -2 }]} numberOfLines={1} maxFontSizeMultiplier={AXIS_MAX_SCALE} importantForAccessibility="no" accessibilityElementsHidden>
                {num(geometry.maxLb)}
              </Text>
              <Text style={[styles.axis, styles.axisY, { width: gutter - 6, bottom: -4 }]} numberOfLines={1} maxFontSizeMultiplier={AXIS_MAX_SCALE} importantForAccessibility="no" accessibilityElementsHidden>
                {num(geometry.minLb)}
              </Text>
              <Text
                style={[styles.axis, styles.axisY, { width: gutter - 6, top: geometry.midY - axisFont * 0.7 }]}
                numberOfLines={1}
                maxFontSizeMultiplier={AXIS_MAX_SCALE}
                importantForAccessibility="no"
                accessibilityElementsHidden
              >
                {num(geometry.midLb)}
              </Text>
              {geometry.goalY != null && goalLb != null ? (
                <Text
                  style={[styles.axis, styles.goalLabel, { top: Math.max(0, geometry.goalY - 16) }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={AXIS_MAX_SCALE}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                >
                  {t('body.chartGoal', { n: num(goalLb), unit })}
                </Text>
              ) : null}
            </>
          ) : null}

          <Animated.View style={[styles.cursor, cursorStyle]} pointerEvents="none" />
          <Animated.View style={[styles.dot, dotStyle]} pointerEvents="none" />
        </AccessibleChart>
      </GestureDetector>

      {n > 0 ? (
        <View style={[styles.xRow, { paddingLeft: gutter }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.axis} numberOfLines={1} maxFontSizeMultiplier={AXIS_MAX_SCALE}>{dates[0]}</Text>
          {geometry?.midDateKey ? (
            <Text style={styles.axis} numberOfLines={1} maxFontSizeMultiplier={AXIS_MAX_SCALE}>{day(geometry.midDateKey)}</Text>
          ) : null}
          <Text style={styles.axis} numberOfLines={1} maxFontSizeMultiplier={AXIS_MAX_SCALE}>{day(shown[n - 1].dateKey)}</Text>
        </View>
      ) : null}

      {/* What the marks are, on EVERY range (review 2026-10-06: it showed
          only on 1M/3M, with the dash). The dash's half is said only when
          the dash is drawn — 6M/1Y/All have none. The line is the trend over
          every reading; the dash is fitted over 28 days (PROJECTION_WINDOW_DAYS
          in useBody — a 14-day fit is dominated by water weight). */}
      {n > 0 ? (
        <Text style={styles.caption} testID={testID ? `${testID}-caption` : undefined}>
          {t(dashed ? 'body.chartWindows' : 'body.chartLegend')}
        </Text>
      ) : null}
    </View>
  );
}

export const WeightChart = memo(WeightChartImpl);

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    wrap: { alignSelf: 'stretch', gap: space.xs, marginTop: space.xs },
    // As tall as the segmented control, so the scrub readout that floats
    // over it never changes the layout.
    chipsBand: { justifyContent: 'center' },
    bubble: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      borderRadius: radius.sm,
      backgroundColor: colors.heroTrack,
      justifyContent: 'center',
      paddingHorizontal: space.sm,
    },
    bubbleText: { color: colors.heroText, fontSize: font.small, padding: 0, textAlign: 'center' },
    axis: { fontSize: font.tiny, color: colors.heroMuted },
    // Right-aligned in the gutter, clear of the plot; width set per render.
    axisY: { position: 'absolute', left: 0, textAlign: 'right' },
    goalLabel: { position: 'absolute', right: PAD.padR },
    xRow: { flexDirection: 'row', justifyContent: 'space-between', paddingRight: PAD.padR },
    // A sentence, so `small` — 12 pt is the theme's eyebrow size.
    caption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs, paddingHorizontal: space.md },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.heroMuted, fontSize: font.small },
    cursor: {
      position: 'absolute',
      top: PAD.padT,
      bottom: PAD.padB,
      width: 1,
      left: 0,
      backgroundColor: colors.heroMuted,
    },
    dot: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.ring,
      borderWidth: 2,
      borderColor: colors.heroPanel,
    },
  });
