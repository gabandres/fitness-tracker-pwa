import { memo, useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import {
  type Frame,
  domainOf,
  dotsPath,
  fencesOf,
  niceTicks,
  indexAtX,
  labelWidth,
  lastIndexWithValue,
  linePaths,
  placeRefLabel,
  xAt,
  xTickIndices,
  yAt,
  ysOf,
} from './chart-geometry';
import { AccessibleChart } from './AccessibleChart';
import { audioGraphDescriptor } from './audio-graph';
import { useAdjustableDays } from './useAdjustableDays';

/**
 * A per-day line chart for Trends: lines, dots, a labelled reference line and
 * milestone ticks, with a finger scrub and a screen-reader stepper.
 *
 * ## Three ways in, one set of strings
 *
 * - **Sight**: the drawn series, a reference line whose VALUE is printed beside
 *   it (a dashed line with no number is a guess the reader has to make), Y
 *   ticks in their own gutter and three to five dates under the axis.
 * - **Touch**: drag across the plot — or touch and hold, then drag, the way
 *   Health and MacroFactor scrub — and a cursor, a dot and a value bubble
 *   follow the finger, with a selection haptic each time it crosses into a new
 *   day. TAP a day to open it in History, the way the budget strip already
 *   worked (re-score 3, U2: holding still used to raise the system context
 *   menu instead of starting the scrub, and the scrub only began on an 8 dp
 *   sideways drag; a hold cannot mean both).
 * - **Screen reader**: one adjustable element — the label is `summary`, the
 *   value is the day under the cursor, and increment/decrement step it
 *   (`useAdjustableDays`). "Open this day in History" is a custom action.
 *
 * The bubble and the screen reader read the SAME day — `pointLabels[i]`, or
 * its short form `bubbleLabels[i]` when the caller passes one (the full
 * sentence needs ~380dp and the bubble has a phone's width), so what a sighted
 * user scrubs to and what VoiceOver announces cannot disagree. That
 * array — one description per day plus a summary — is also exactly the input
 * an `AXChartDescriptor` (the audio graph) needs: with `audioGraph` set, the
 * adjustable element is an `AccessibleChart` and VoiceOver's rotor adds "Audio
 * Graph" and "Chart Details" on iOS (`audio-graph.ts`). The stepper is
 * unchanged — same element, same label, same actions.
 *
 * ## Nothing drawn over the data
 *
 * The Y ticks sit in a left gutter sized to their widest label, and the
 * reference label takes whichever side of its line covers the fewest points
 * (`placeRefLabel`) — both used to be opaque boxes on top of the plot, over
 * the newest over-target days and, for a maintenance-goal user, over the
 * endpoint dot the chart exists to show (re-score 3, B1). The scrub bubble
 * floats over the card's header while a finger is down instead of reserving a
 * 44 dp blank band above every chart (V2).
 *
 * ## No React render while dragging
 *
 * The scrub lives in Reanimated shared values on the UI thread: the gesture
 * writes an index, the cursor/dot/bubble read it in worklets, and the bubble's
 * text is an animated `TextInput` prop. The only JS hop is the haptic tick, once
 * per day crossed. Paths are memoised on the series and the measured width, the
 * gestures on the frame, and the component is `memo`'d — which only holds if
 * the caller's props are stable too (`TrendsCharts` memoises every one), so a
 * parent re-render with the same data redraws nothing.
 *
 * Reduce Motion: nothing here animates on its own. The cursor follows the
 * finger directly (direct manipulation is not decorative motion) and the
 * bubble does not spring.
 */

export interface ChartLine {
  key: string;
  values: readonly (number | null)[];
  color: string;
  width?: number;
  /** Draw the segment ENDING at day i dashed — a formula prior, not data. */
  dashedAt?: (i: number) => boolean;
  /** Join the two sides of a gap with a faint dashed bridge. */
  bridgeGaps?: boolean;
}

export interface ChartDots {
  key: string;
  values: readonly (number | null)[];
  color: string;
  radius?: number;
  /**
   * Let this series stretch the y axis only as far as its outlier fences
   * (`fencesOf`). A dot past them is pinned to the plot edge and drawn HOLLOW
   * — "off the chart, this way" — and its real value still reads in the bubble
   * and to a screen reader. For intake dots under a maintenance line, where
   * one half-logged day used to squash the line flat.
   */
  clipOutliers?: boolean;
}

export interface TrendChartProps {
  dateKeys: readonly string[];
  lines: readonly ChartLine[];
  dots?: readonly ChartDots[];
  /** A horizontal reference (the daily target), labelled beside its line. */
  reference?: { value: number; label: string; color?: string };
  /** Milestone ticks along the baseline. */
  markers?: readonly { index: number }[];
  /** A labelled vertical mark on a day (the day the estimate turned measured). */
  annotations?: readonly { index: number; label: string }[];
  /** Index into `lines` the cursor dot rides (default 0). */
  cursorLine?: number;
  height?: number;
  /** Chart-level text alternative ("Maintenance, last 30 days, 2,380 to 2,450 kcal"). */
  summary: string;
  /** One sentence per day — the screen-reader value (and the bubble text
   *  unless `bubbleLabels` is given). */
  pointLabels: readonly string[];
  /** A SHORT form per day for the scrub bubble — date and numbers, no prose.
   *  Wraps to two lines at most. */
  bubbleLabels?: readonly string[];
  /** Y tick formatter for the top/middle/bottom gridline labels. */
  formatY: (v: number) => string;
  /** The date under the axis for a day key (already localised, short). Three
   *  to five evenly spaced days are labelled, always the first and last. */
  xTickLabel?: (dateKey: string) => string;
  /** "Open this day in History" — a tap on the plot and a custom a11y action. */
  openDay?: {
    actionLabel: string;
    onOpen: (dateKey: string) => void;
  };
  /**
   * Names for the audio graph (iOS VoiceOver). Series come from `lines` then
   * `dots`, named by their `key` through `seriesNames`. Omit and the chart
   * keeps its stepper with no audio graph — the behaviour before it existed.
   */
  audioGraph?: {
    title: string;
    xTitle: string;
    yTitle: string;
    unit?: string;
    decimals?: number;
    /** The date as VoiceOver should read it, per `dateKeys` entry. */
    xLabel: (dateKey: string) => string;
    seriesNames: Readonly<Record<string, string>>;
  };
  testID?: string;
}

/** Plot padding before the tick gutter is added on the left. */
const PAD: Omit<Frame, 'width' | 'height'> = { padL: 6, padR: 6, padT: 10, padB: 10 };
/** Axis text scales with Dynamic Type, but only this far — it names a fixed-
 *  size plot. */
const AXIS_MAX_SCALE = 1.3;
/** Hold still this long and the scrub starts without a sideways drag. Short
 *  enough to read as "press and drag", long enough that a scroll starting on
 *  the chart moves first and fails it. */
const HOLD_TO_SCRUB_MS = 180;
/** Roughly one date label per this many dp of plot. */
const X_TICK_SPACING = 72;
const X_TICK_BOX = 64;

/** A selection tick per day crossed. Local, not `lib/haptics`: that module's
 *  three calls are impacts and notifications, and a scrub wants the lightest
 *  feedback the OS has. No-op on web, like the rest. */
function tick(): void {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => {});
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function TrendChartImpl({
  dateKeys,
  lines,
  dots = [],
  reference,
  markers = [],
  annotations = [],
  cursorLine = 0,
  height = 132,
  summary,
  pointLabels,
  bubbleLabels,
  formatY,
  xTickLabel,
  openDay,
  audioGraph,
  testID,
}: TrendChartProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const n = dateKeys.length;
  // The size axis text actually renders at — what the gutter and the label
  // boxes are sized from.
  const axisFont = font.tiny * Math.min(fontScale || 1, AXIS_MAX_SCALE);

  // Fitted to the data, then snapped to nice gridlines (sim review 2026-10-06:
  // the maintenance axis ran 200 → 2,850 off one half-logged day, and the
  // protein axis printed 16 / 86 / 155). A dot series that opts in stretches
  // the axis only to its outlier fences; everything never goes below zero.
  const scale = useMemo(() => {
    const dotSeries = dots.map((d) => {
      if (!d.clipOutliers) return d.values;
      const fence = fencesOf(d.values);
      return fence ? d.values.map((v) => (v == null || v < fence.min || v > fence.max ? null : v)) : d.values;
    });
    const all = [...lines.map((l) => l.values), ...dotSeries, reference ? [reference.value] : []];
    const raw = domainOf(all, { minSpan: 2, padFrac: 0 });
    if (!raw) return null;
    const nonNegative = all.every((s) => s.every((v) => v == null || v >= 0));
    return niceTicks(raw, { floor: nonNegative ? 0 : undefined });
  }, [lines, dots, reference]);
  const domain = useMemo(() => (scale ? { min: scale.min, max: scale.max } : null), [scale]);
  // One label per gridline, top first.
  const ticks = useMemo(
    () => (scale ? scale.ticks.map((v) => ({ v, label: formatY(v) })).reverse() : null),
    [scale, formatY],
  );
  // The left gutter: the widest tick label plus a gap — the ticks live there
  // and the data starts after it.
  const gutter = ticks ? Math.max(...ticks.map((tk) => labelWidth(tk.label, axisFont))) + 4 : PAD.padL;

  const frame: Frame = useMemo(() => ({ width, height, ...PAD, padL: gutter }), [width, height, gutter]);

  const geometry = useMemo(() => {
    if (!domain || width <= 0) return null;
    const inside = (v: number) => v >= domain.min && v <= domain.max;
    const clamp = (v: number) => Math.max(domain.min, Math.min(domain.max, v));
    const dotPoints = dots.map((d) => ({
      dots: d,
      pts: d.values
        .map((v, i) => (v == null || (d.clipOutliers && !inside(v)) ? null : { x: xAt(i, n, frame), y: yAt(v, domain, frame) }))
        .filter((p): p is { x: number; y: number } => p != null),
      // Pinned to the edge they fell off, drawn hollow.
      off: d.clipOutliers
        ? d.values
            .map((v, i) => (v == null || inside(v) ? null : { x: xAt(i, n, frame), y: yAt(clamp(v), domain, frame) }))
            .filter((p): p is { x: number; y: number } => p != null)
        : [],
    }));
    const xs = dateKeys.map((_, i) => xAt(i, n, frame));
    const lineYs = lines.map((l) => ysOf(l.values, domain, frame));
    const cursorYs = (lineYs[cursorLine] ?? []).map((y) => (y == null ? -1 : y));
    const lastIdx = lastIndexWithValue(lines[cursorLine]?.values ?? []);
    const refY = reference ? yAt(reference.value, domain, frame) : null;
    let refBox = null;
    if (reference && refY != null) {
      const points = [
        ...dotPoints.flatMap((d) => d.pts),
        ...lineYs.flatMap((ys) => ys.map((y, i) => (y == null ? null : { x: xs[i], y })).filter((p): p is { x: number; y: number } => p != null)),
      ];
      const heavy = lastIdx >= 0 && cursorYs[lastIdx] >= 0 ? [{ x: xs[lastIdx], y: cursorYs[lastIdx] }] : [];
      refBox = placeRefLabel({
        refY,
        labelW: labelWidth(reference.label, axisFont) + 6,
        labelH: Math.ceil(axisFont * 1.35),
        width,
        height,
        minLeft: frame.padL,
        points,
        heavy,
      });
    }
    return {
      paths: lines.map((l) => ({
        line: l,
        ...linePaths(l.values, domain, frame, { dashedAt: l.dashedAt, bridgeGaps: l.bridgeGaps }),
      })),
      dotPaths: dotPoints.map(({ dots: d, pts, off }) => ({ dots: d, d: dotsPath(pts, d.radius ?? 2.5), off: dotsPath(off, (d.radius ?? 2.5) + 0.5) })),
      refY,
      refBox,
      xs,
      cursorYs,
      lastIdx,
    };
  }, [domain, lines, dots, reference, width, height, frame, dateKeys, n, cursorLine, axisFont]);

  const xTicks = useMemo(() => {
    if (!xTickLabel || !geometry || n === 0) return [];
    const plotW = Math.max(0, width - frame.padL - frame.padR);
    const count = Math.max(2, Math.min(5, Math.floor(plotW / X_TICK_SPACING)));
    return xTickIndices(n, count).map((i) => {
      const x = geometry.xs[i];
      const left = Math.max(0, Math.min(width - X_TICK_BOX, x - X_TICK_BOX / 2));
      // A box pushed against an edge aligns its text to that edge, so the
      // first and last dates sit under the first and last days.
      const align: 'left' | 'right' | 'center' = left <= 0 ? 'left' : left >= width - X_TICK_BOX ? 'right' : 'center';
      return { i, left, align, label: xTickLabel(dateKeys[i]) };
    });
  }, [xTickLabel, geometry, n, width, frame, dateKeys]);

  const descriptor = useMemo(
    () =>
      audioGraph
        ? audioGraphDescriptor({
            title: audioGraph.title,
            summary,
            xTitle: audioGraph.xTitle,
            xLabels: dateKeys.map(audioGraph.xLabel),
            yTitle: audioGraph.yTitle,
            unit: audioGraph.unit,
            decimals: audioGraph.decimals,
            series: [
              ...lines.map((l) => ({ name: audioGraph.seriesNames[l.key] ?? l.key, values: l.values })),
              ...dots.map((d) => ({ name: audioGraph.seriesNames[d.key] ?? d.key, values: d.values, continuous: false })),
            ],
            pointLabels,
          })
        : null,
    [audioGraph, summary, dateKeys, lines, dots, pointLabels],
  );

  const stepper = useAdjustableDays(n, summary, (i) => pointLabels[i] ?? '', {
    actions: openDay
      ? [{ name: 'openDay', label: openDay.actionLabel, run: (i) => openDay.onOpen(dateKeys[i]) }]
      : [],
  });

  // ── Scrub: UI-thread state only ──
  const idx = useSharedValue(-1);
  const xs = geometry?.xs ?? [];
  const ys = geometry?.cursorYs ?? [];
  const labels = bubbleLabels ?? pointLabels;
  const f = frame;
  const canOpen = openDay != null;
  const openIndex = useCallback(
    (i: number) => {
      const key = dateKeys[i];
      if (key && openDay) openDay.onOpen(key);
    },
    [dateKeys, openDay],
  );

  // Memoised: rebuilding the gestures on every render re-attached them to the
  // detector each time the parent drew. `idx.get()` / `idx.set()` in here, not
  // `idx.value`: an assignment to `.value` inside a hook's callback reads to
  // React Compiler as mutating a frozen value, and it skipped the whole chart
  // (Reanimated's documented accessors for compiled code; same effect).
  const gesture = useMemo(() => {
    // A sideways drag scrubs at once. Showing the cursor at touch-down instead
    // flashed the bubble on every vertical scroll that began on the chart.
    const drag = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-14, 14])
      .onStart((e) => {
        idx.set(indexAtX(e.x, n, f));
      })
      .onUpdate((e) => {
        const next = indexAtX(e.x, n, f);
        if (next !== idx.get()) {
          idx.set(next);
          scheduleOnRN(tick);
        }
      })
      .onFinalize(() => {
        idx.set(-1);
      });

    // Touch and hold, then drag: the scrub starts where the finger rests,
    // with a tick to say so. Moving first (a scroll) fails it.
    const hold = Gesture.Pan()
      .activateAfterLongPress(HOLD_TO_SCRUB_MS)
      .failOffsetY([-14, 14])
      .onStart((e) => {
        idx.set(indexAtX(e.x, n, f));
        scheduleOnRN(tick);
      })
      .onUpdate((e) => {
        const next = indexAtX(e.x, n, f);
        if (next !== idx.get()) {
          idx.set(next);
          scheduleOnRN(tick);
        }
      })
      .onFinalize(() => {
        idx.set(-1);
      });

    // A tap opens the day under the finger in History.
    const tap = Gesture.Tap()
      .enabled(canOpen)
      .maxDuration(HOLD_TO_SCRUB_MS + 60)
      .maxDistance(10)
      .onEnd((e, success) => {
        if (success) scheduleOnRN(openIndex, indexAtX(e.x, n, f));
      });

    return Gesture.Race(drag, hold, tap);
  }, [idx, n, f, canOpen, openIndex]);

  const cursorStyle = useAnimatedStyle(() => {
    const i = idx.value;
    return { opacity: i < 0 ? 0 : 1, transform: [{ translateX: i < 0 ? 0 : (xs[i] ?? 0) }] };
  });
  const dotStyle = useAnimatedStyle(() => {
    const i = idx.value;
    const y = i < 0 ? -1 : (ys[i] ?? -1);
    return {
      opacity: y < 0 ? 0 : 1,
      transform: [{ translateX: i < 0 ? 0 : (xs[i] ?? 0) - 4 }, { translateY: y < 0 ? 0 : y - 4 }],
    };
  });
  const bubbleStyle = useAnimatedStyle(() => ({ opacity: idx.value < 0 ? 0 : 1 }));
  const bubbleProps = useAnimatedProps(() => {
    const i = idx.value;
    return { text: i < 0 ? '' : (labels[i] ?? '') } as unknown as TextInputProps;
  });

  const tickStyle = { width: gutter - 4 };
  const plotLeft = frame.padL - 2;

  const plot = (
    <GestureDetector gesture={gesture}>
      <AccessibleChart
        {...stepper.a11y}
        descriptor={descriptor}
        style={{ height }}
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        testID={testID ? `${testID}-plot` : undefined}
      >
        {geometry ? (
          <Svg width={width} height={height}>
            {/* A gridline per nice tick — named by the labels in the gutter.
                Two labels left the middle of a 2,000-wide kcal axis to
                guesswork; three fixed ones printed whatever the padded data
                extent happened to be. */}
            {domain && ticks
              ? ticks.map((tk) => {
                  const y = yAt(tk.v, domain, frame);
                  return <Line key={`g-${tk.v}`} x1={plotLeft} x2={width} y1={y} y2={y} stroke={colors.line} strokeWidth={1} />;
                })
              : null}
            {geometry.refY != null ? (
              <Line
                x1={plotLeft}
                x2={width}
                y1={geometry.refY}
                y2={geometry.refY}
                stroke={reference?.color ?? colors.lineStrong}
                // DOTTED, not dashed: a dashed accent segment already means
                // "formula estimate" on this chart, and two dash styles on one
                // plot asked the reader to tell 4/4 from 5/4.
                strokeWidth={1.75}
                strokeDasharray="0.1 4"
                strokeLinecap="round"
              />
            ) : null}
            {annotations.map((a) => (
              <Line
                key={`a-${a.index}`}
                x1={geometry.xs[a.index] ?? 0}
                x2={geometry.xs[a.index] ?? 0}
                y1={PAD.padT}
                y2={height - PAD.padB}
                stroke={colors.lineStrong}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            ))}
            {/* One path per dot series, not a Circle per day. */}
            {geometry.dotPaths.map(({ dots: d, d: path, off }) => (
              <GDots key={d.key} path={path} off={off} color={d.color} />
            ))}
            {geometry.paths.map(({ line, solid, dashed, bridges }) => (
              <GLine key={line.key} solid={solid} dashed={dashed} bridges={bridges} color={line.color} width={line.width ?? 2.25} faint={colors.lineStrong} />
            ))}
            {/* Today's point, so the line visibly ENDS on the hero figure. */}
            {geometry.lastIdx >= 0 && geometry.cursorYs[geometry.lastIdx] >= 0 ? (
              <Path
                d={dotsPath([{ x: geometry.xs[geometry.lastIdx], y: geometry.cursorYs[geometry.lastIdx] }], 4)}
                fill={lines[cursorLine]?.color}
                stroke={colors.card}
                strokeWidth={2}
              />
            ) : null}
            {markers.map((m) => (
              <Rect
                key={`m-${m.index}`}
                x={(geometry.xs[m.index] ?? 0) - 3}
                y={height - PAD.padB - 3}
                width={6}
                height={6}
                rotation={45}
                originX={geometry.xs[m.index] ?? 0}
                originY={height - PAD.padB}
                fill={colors.accent}
              />
            ))}
          </Svg>
        ) : null}
        {geometry && ticks && domain ? (
          <>
            {ticks.map((tk, i) => (
              <Text
                key={`t-${tk.v}`}
                style={[styles.tick, tickStyle, { top: yAt(tk.v, domain, frame) - axisFont * 0.65 }]}
                maxFontSizeMultiplier={AXIS_MAX_SCALE}
                numberOfLines={1}
                importantForAccessibility="no"
                accessibilityElementsHidden
                testID={testID ? (i === Math.floor(ticks.length / 2) ? `${testID}-tick-mid` : `${testID}-tick-${i}`) : undefined}
              >
                {tk.label}
              </Text>
            ))}
            {reference && geometry.refBox ? (
              <Text
                style={[
                  styles.refLabel,
                  { left: geometry.refBox.left, top: geometry.refBox.top, width: geometry.refBox.width, color: reference.color ?? colors.muted },
                ]}
                maxFontSizeMultiplier={AXIS_MAX_SCALE}
                numberOfLines={1}
                importantForAccessibility="no"
                accessibilityElementsHidden
                testID={testID ? `${testID}-ref-label` : undefined}
              >
                {reference.label}
              </Text>
            ) : null}
            {annotations.map((a) => {
              const x = geometry.xs[a.index] ?? 0;
              // Beside the mark, on whichever side has the room.
              const right = x > width / 2;
              return (
                <Text
                  key={`al-${a.index}`}
                  style={[styles.annotation, right ? { right: width - x + 3 } : { left: x + 3 }, { top: PAD.padT }]}
                  maxFontSizeMultiplier={AXIS_MAX_SCALE}
                  numberOfLines={1}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                  testID={testID ? `${testID}-annotation` : undefined}
                >
                  {a.label}
                </Text>
              );
            })}
          </>
        ) : null}
        <Animated.View style={[styles.cursor, { height }, cursorStyle]} pointerEvents="none" />
        <Animated.View style={[styles.cursorDot, { borderColor: lines[cursorLine]?.color ?? colors.ink }, dotStyle]} pointerEvents="none" />
      </AccessibleChart>
    </GestureDetector>
  );

  return (
    <View testID={testID}>
      {plot}

      {xTickLabel ? (
        <View style={styles.xRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {/* Holds the row's height before the plot has a width, so the card
              does not grow when the dates land. */}
          <Text style={[styles.xLabel, styles.xSizer]} maxFontSizeMultiplier={AXIS_MAX_SCALE}> </Text>
          {xTicks.map((tk) => (
            <Text
              key={tk.i}
              style={[styles.xLabel, styles.xTick, { left: tk.left, textAlign: tk.align }]}
              maxFontSizeMultiplier={AXIS_MAX_SCALE}
              numberOfLines={1}
            >
              {tk.label}
            </Text>
          ))}
        </View>
      ) : null}

      {/* The bubble floats over the card's header while a finger is down —
          above the plot, so the finger never covers it, and reserving no
          blank band when nobody is scrubbing. */}
      <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <AnimatedTextInput
          editable={false}
          multiline
          scrollEnabled={false}
          underlineColorAndroid="transparent"
          style={styles.bubbleText}
          defaultValue=""
          animatedProps={bubbleProps}
          maxFontSizeMultiplier={AXIS_MAX_SCALE}
        />
      </Animated.View>
    </View>
  );
}

function GDots({ path, off, color }: { path: string; off: string; color: string }) {
  return (
    <>
      {path ? <Path d={path} fill={color} /> : null}
      {off ? <Path d={off} fill="none" stroke={color} strokeWidth={1.5} testID="trend-chart-offscale" /> : null}
    </>
  );
}

function GLine({ solid, dashed, bridges, color, width, faint }: { solid: string; dashed: string; bridges: string; color: string; width: number; faint: string }) {
  return (
    <>
      {bridges ? <Path d={bridges} fill="none" stroke={faint} strokeWidth={1.25} strokeDasharray="2 4" /> : null}
      {dashed ? <Path d={dashed} fill="none" stroke={color} strokeWidth={width} strokeDasharray="4 4" strokeLinecap="round" opacity={0.75} /> : null}
      {solid ? <Path d={solid} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </>
  );
}

export const TrendChart = memo(TrendChartImpl);

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    // In the gutter, right-aligned against the plot — no background, nothing
    // under them to hide.
    tick: { position: 'absolute', left: 0, fontSize: font.tiny, color: colors.faint, textAlign: 'right' },
    // A card-coloured halo instead of an opaque box: legible across the dotted
    // line it names, and a dot it happens to touch still shows through.
    refLabel: {
      position: 'absolute',
      fontSize: font.tiny,
      fontWeight: '700',
      textAlign: 'right',
      textShadowColor: colors.card,
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 0 },
    },
    annotation: {
      position: 'absolute',
      fontSize: font.tiny,
      fontWeight: '700',
      color: colors.muted,
      textShadowColor: colors.card,
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 0 },
    },
    cursor: { position: 'absolute', top: 0, left: 0, width: 1.5, marginLeft: -0.75, backgroundColor: colors.ink },
    cursorDot: { position: 'absolute', top: 0, left: 0, width: 8, height: 8, borderRadius: 4, borderWidth: 2, backgroundColor: colors.card },
    // Two lines tall, always — a bubble that grew with its text would jump
    // mid-scrub. Anchored to the chart's top edge and drawn upward over the
    // header.
    bubble: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: '100%',
      height: 40,
      marginBottom: space.xs,
      zIndex: 2,
      borderRadius: radius.sm,
      backgroundColor: colors.ink,
      justifyContent: 'center',
      ...shadow.e1,
    },
    bubbleText: {
      color: colors.onInk,
      fontSize: font.tiny,
      lineHeight: 15,
      fontWeight: '700',
      textAlign: 'center',
      textAlignVertical: 'center',
      paddingVertical: 0,
      paddingTop: 0,
      paddingHorizontal: space.sm,
    },
    xRow: { marginTop: 2 },
    xSizer: { opacity: 0 },
    xTick: { position: 'absolute', top: 0, width: X_TICK_BOX },
    xLabel: { fontSize: font.tiny, color: colors.faint },
  });
