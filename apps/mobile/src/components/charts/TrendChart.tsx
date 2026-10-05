import { memo, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import {
  type Frame,
  domainOf,
  indexAtX,
  lastIndexWithValue,
  linePaths,
  xAt,
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
 * - **Sight**: the drawn series, a reference line whose VALUE is printed at its
 *   right end (a dashed line with no number is a guess the reader has to make),
 *   and first/last date under the axis.
 * - **Touch**: drag across the plot and a cursor, a dot and a value bubble
 *   follow the finger, with a selection haptic each time it crosses into a new
 *   day. Long-press a day to open it in History.
 * - **Screen reader**: one adjustable element — the label is `summary`, the
 *   value is the day under the cursor, and increment/decrement step it
 *   (`useAdjustableDays`). "Open this day in History" is a custom action.
 *
 * The bubble and the screen reader read the SAME `pointLabel(i)`, so what a
 * sighted user scrubs to and what VoiceOver announces cannot disagree. That
 * array — one description per day plus a summary — is also exactly the input
 * an `AXChartDescriptor` (the audio graph) needs: with `audioGraph` set, the
 * adjustable element is an `AccessibleChart` and VoiceOver's rotor adds "Audio
 * Graph" and "Chart Details" on iOS (`audio-graph.ts`). The stepper is
 * unchanged — same element, same label, same actions.
 *
 * ## No React render while dragging
 *
 * The scrub lives in Reanimated shared values on the UI thread: the gesture
 * writes an index, the cursor/dot/bubble read it in worklets, and the bubble's
 * text is an animated `TextInput` prop. The only JS hop is the haptic tick, once
 * per day crossed. Paths are memoised on the series and the measured width, and
 * the component is `memo`'d, so a parent re-render with the same data redraws
 * nothing.
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
}

export interface TrendChartProps {
  dateKeys: readonly string[];
  lines: readonly ChartLine[];
  dots?: readonly ChartDots[];
  /** A horizontal reference (the daily target), labelled at its right end. */
  reference?: { value: number; label: string; color?: string };
  /** Milestone ticks along the baseline. */
  markers?: readonly { index: number }[];
  /** Index into `lines` the cursor dot rides (default 0). */
  cursorLine?: number;
  height?: number;
  /** Chart-level text alternative ("Maintenance, last 30 days, 2,380 to 2,450 kcal"). */
  summary: string;
  /** One sentence per day — the bubble text and the screen-reader value. */
  pointLabels: readonly string[];
  /** Y tick formatter for the top/bottom gridline labels. */
  formatY: (v: number) => string;
  /** First / last x label (already localised). */
  xLabels?: readonly [string, string];
  /** "Open this day in History" — long-press and a custom a11y action. */
  openDay?: {
    label: (dateKey: string) => string;
    actionLabel: string;
    closeLabel: string;
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

const PAD: Omit<Frame, 'width' | 'height'> = { padL: 6, padR: 6, padT: 10, padB: 10 };

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
  cursorLine = 0,
  height = 132,
  summary,
  pointLabels,
  formatY,
  xLabels,
  openDay,
  audioGraph,
  testID,
}: TrendChartProps) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const n = dateKeys.length;

  const frame: Frame = useMemo(() => ({ width, height, ...PAD }), [width, height]);

  const geometry = useMemo(() => {
    const domain = domainOf(
      [...lines.map((l) => l.values), ...dots.map((d) => d.values), reference ? [reference.value] : []],
      { minSpan: 2 },
    );
    if (!domain || width <= 0) return null;
    return {
      domain,
      paths: lines.map((l) => ({
        line: l,
        ...linePaths(l.values, domain, frame, { dashedAt: l.dashedAt, bridgeGaps: l.bridgeGaps }),
      })),
      dotPoints: dots.map((d) => ({
        dots: d,
        pts: d.values
          .map((v, i) => (v == null ? null : { i, x: xAt(i, n, frame), y: yAt(v, domain, frame) }))
          .filter((p): p is { i: number; x: number; y: number } => p != null),
      })),
      refY: reference ? yAt(reference.value, domain, frame) : null,
      xs: dateKeys.map((_, i) => xAt(i, n, frame)),
      cursorYs: ysOf(lines[cursorLine]?.values ?? [], domain, frame).map((y) => (y == null ? -1 : y)),
      lastIdx: lastIndexWithValue(lines[cursorLine]?.values ?? []),
    };
  }, [lines, dots, reference, width, frame, dateKeys, n, cursorLine]);

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
  const labels = pointLabels;
  const f = frame;

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      idx.value = indexAtX(e.x, n, f);
    })
    .onUpdate((e) => {
      const next = indexAtX(e.x, n, f);
      if (next !== idx.value) {
        idx.value = next;
        scheduleOnRN(tick);
      }
    })
    .onFinalize(() => {
      idx.value = -1;
    });

  const longPress = Gesture.LongPress()
    .minDuration(450)
    .enabled(openDay != null)
    .onStart((e) => {
      scheduleOnRN(setMenuIndex, indexAtX(e.x, n, f));
      scheduleOnRN(tick);
    });

  const gesture = Gesture.Race(pan, longPress);

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
  const bubbleStyle = useAnimatedStyle(() => {
    const i = idx.value;
    // Keep the bubble on the plot: centred on the cursor, clamped to the edges.
    const w = f.width;
    const bw = Math.min(220, w);
    const x = i < 0 ? 0 : Math.max(0, Math.min(w - bw, (xs[i] ?? 0) - bw / 2));
    return { opacity: i < 0 ? 0 : 1, width: bw, transform: [{ translateX: x }] };
  });
  const bubbleProps = useAnimatedProps(() => {
    const i = idx.value;
    return { text: i < 0 ? '' : (labels[i] ?? '') } as unknown as TextInputProps;
  });

  const lastLabel =
    reference && geometry?.refY != null ? (
      <Text
        style={[styles.refLabel, { top: Math.max(0, geometry.refY - 16), color: reference.color ?? colors.muted }]}
        maxFontSizeMultiplier={1.3}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {reference.label}
      </Text>
    ) : null;

  return (
    <View testID={testID}>
      {/* The bubble sits ABOVE the plot so the finger never covers it. */}
      <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <AnimatedTextInput
          editable={false}
          underlineColorAndroid="transparent"
          style={styles.bubbleText}
          defaultValue=""
          animatedProps={bubbleProps}
          maxFontSizeMultiplier={1.3}
        />
      </Animated.View>

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
              {/* Top and bottom gridlines — named by the tick labels below. */}
              <Line x1={0} x2={width} y1={PAD.padT} y2={PAD.padT} stroke={colors.line} strokeWidth={1} />
              <Line x1={0} x2={width} y1={height - PAD.padB} y2={height - PAD.padB} stroke={colors.line} strokeWidth={1} />
              {geometry.refY != null ? (
                <Line
                  x1={0}
                  x2={width}
                  y1={geometry.refY}
                  y2={geometry.refY}
                  stroke={reference?.color ?? colors.lineStrong}
                  strokeWidth={1.25}
                  strokeDasharray="5 4"
                />
              ) : null}
              {geometry.dotPoints.map(({ dots: d, pts }) =>
                pts.map((p) => (
                  <Circle key={`${d.key}-${p.i}`} cx={p.x} cy={p.y} r={d.radius ?? 2.5} fill={d.color} />
                )),
              )}
              {geometry.paths.map(({ line, solid, dashed, bridges }) => (
                <GLine key={line.key} solid={solid} dashed={dashed} bridges={bridges} color={line.color} width={line.width ?? 2.25} faint={colors.lineStrong} />
              ))}
              {/* Today's point, so the line visibly ENDS on the hero figure. */}
              {geometry.lastIdx >= 0 && geometry.cursorYs[geometry.lastIdx] >= 0 ? (
                <Circle
                  cx={geometry.xs[geometry.lastIdx]}
                  cy={geometry.cursorYs[geometry.lastIdx]}
                  r={4}
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
          {geometry ? (
            <>
              <Text style={[styles.tick, styles.tickTop]} maxFontSizeMultiplier={1.3} importantForAccessibility="no" accessibilityElementsHidden>
                {formatY(geometry.domain.max)}
              </Text>
              <Text style={[styles.tick, styles.tickBottom]} maxFontSizeMultiplier={1.3} importantForAccessibility="no" accessibilityElementsHidden>
                {formatY(geometry.domain.min)}
              </Text>
              {lastLabel}
            </>
          ) : null}
          <Animated.View style={[styles.cursor, { height }, cursorStyle]} pointerEvents="none" />
          <Animated.View style={[styles.cursorDot, { borderColor: lines[cursorLine]?.color ?? colors.ink }, dotStyle]} pointerEvents="none" />
        </AccessibleChart>
      </GestureDetector>

      {xLabels ? (
        <View style={styles.xRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.xLabel} maxFontSizeMultiplier={1.3}>{xLabels[0]}</Text>
          <Text style={styles.xLabel} maxFontSizeMultiplier={1.3}>{xLabels[1]}</Text>
        </View>
      ) : null}

      {/* The long-press menu. A JS pill rather than a native context menu: it
          works the same on both platforms and needs no new native code. */}
      {openDay && menuIndex != null && dateKeys[menuIndex] ? (
        <View style={styles.menu}>
          <Pressable
            style={styles.menuBtn}
            accessibilityRole="button"
            onPress={() => {
              const key = dateKeys[menuIndex];
              setMenuIndex(null);
              openDay.onOpen(key);
            }}
            testID={testID ? `${testID}-open-day` : undefined}
          >
            <Text style={styles.menuText}>{openDay.label(dateKeys[menuIndex])}</Text>
          </Pressable>
          <Pressable
            style={styles.menuClose}
            accessibilityRole="button"
            accessibilityLabel={openDay.closeLabel}
            onPress={() => setMenuIndex(null)}
            hitSlop={8}
          >
            <Text style={styles.menuCloseText}>×</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
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
    tick: { position: 'absolute', left: 2, fontSize: font.tiny, color: colors.faint, backgroundColor: colors.card, paddingHorizontal: 2 },
    tickTop: { top: 0 },
    tickBottom: { bottom: 0 },
    refLabel: { position: 'absolute', right: 2, fontSize: font.tiny, fontWeight: '700', backgroundColor: colors.card, paddingHorizontal: 3 },
    cursor: { position: 'absolute', top: 0, left: 0, width: 1.5, marginLeft: -0.75, backgroundColor: colors.ink },
    cursorDot: { position: 'absolute', top: 0, left: 0, width: 8, height: 8, borderRadius: 4, borderWidth: 2, backgroundColor: colors.card },
    bubble: {
      height: 26,
      marginBottom: space.xs,
      borderRadius: radius.sm,
      backgroundColor: colors.ink,
      justifyContent: 'center',
      ...shadow.e1,
    },
    bubbleText: { color: colors.onInk, fontSize: font.tiny, fontWeight: '700', textAlign: 'center', paddingVertical: 0, paddingHorizontal: space.sm },
    xRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    xLabel: { fontSize: font.tiny, color: colors.faint },
    menu: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.xs, marginTop: space.sm },
    menuBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.ink },
    menuText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
    menuClose: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
    menuCloseText: { color: colors.muted, fontSize: font.h3 },
  });
