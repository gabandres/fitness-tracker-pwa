import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTheme } from '@/lib/theme-context';

interface Props {
  /** Main series, oldest → newest, ONE ENTRY PER DAY. A non-number is a day
   *  without a reading: it keeps its x position and the line is bridged
   *  across it with a faint dashed segment.
   *
   *  This used to drop non-numbers before laying the series out, so a
   *  fortnight with five weigh-ins drew five evenly spaced points — the time
   *  axis squeezed and a three-day gap looked like one day. A caller that
   *  passes only readings (Body's `weightSeries`) draws exactly as before. */
  values: readonly (number | null | undefined)[];
  /** Optional forecast continuing past the solid line, drawn dashed. */
  projection?: readonly (number | null | undefined)[];
  width?: number;
  height?: number;
  color?: string;
  /** The chart's text alternative — the caller knows what the series IS
   *  ("Weight, last 30 days, 82 to 80 kg, trending down"); this component
   *  only knows it has numbers. Without it the SVG is silent to VoiceOver
   *  (S18-5). */
  accessibilityLabel?: string;
  testID?: string;
}

type Pt = { x: number; y: number };

/** Below this many readings the line is straight segments with a dot on
 *  every reading: smoothing two sessions drew a convex arc between them —
 *  a shape the data does not have — with no mark where it started
 *  (train-ux H-N13). From four up the smoothing reads as a trend. */
const SMOOTH_FROM = 4;
const PAD = 4;
/** The width before the container has been measured (and the old default). */
const FALLBACK_WIDTH = 280;
/** One empty projection, so the memo below is not invalidated every render. */
const NO_PROJECTION: readonly number[] = [];

export interface SparklineGeometry {
  mainD: string;
  gapD: string;
  projD: string;
  /** The points that get a dot: every reading under {@link SMOOTH_FROM},
   *  otherwise the latest one. */
  dots: Pt[];
  hasData: boolean;
}

/** The sparkline's paths for a series at a size. Pure. */
export function sparklineGeometry(
  values: readonly (number | null | undefined)[],
  projection: readonly (number | null | undefined)[],
  width: number,
  height: number,
): SparklineGeometry {
  const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
  const raw = values ?? [];
  const vs = raw.filter(isNum);
  const ps = (projection ?? []).filter(isNum);
  if (vs.length < 2) return { mainD: '', gapD: '', projD: '', dots: [], hasData: false };

  const all = ps.length ? vs.concat(ps) : vs;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  // Positions are by DAY index over the raw series, gaps included.
  const total = raw.length + ps.length;
  const stepX = (width - PAD * 2) / (total - 1);
  const toPoint = (v: number, i: number) => ({
    x: PAD + i * stepX,
    y: height - PAD - ((v - min) / span) * (height - PAD * 2),
  });

  // Contiguous runs of readings draw solid; the hop between two runs is a
  // separate faint dashed segment — "no reading here", never invented data.
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  raw.forEach((v, i) => {
    if (isNum(v)) run.push(toPoint(v, i));
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const main = runs.flat();
  const proj = ps.map((v, k) => toPoint(v, raw.length + k));
  const bridges = runs
    .slice(1)
    .map((r, k) => {
      const a = runs[k][runs[k].length - 1];
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${r[0].x.toFixed(2)} ${r[0].y.toFixed(2)}`;
    })
    .join(' ');

  const straight = main.length < SMOOTH_FROM;
  const path = (pts: Pt[]) => {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (straight) {
        d += ` L ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
        continue;
      }
      const cx = (prev.x + curr.x) / 2;
      d += ` Q ${cx.toFixed(2)} ${prev.y.toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    }
    return d;
  };

  return {
    mainD: runs.map(path).filter(Boolean).join(' '),
    gapD: bridges,
    // Anchor the dashed segment at the last solid point so they join.
    projD: proj.length ? path([main[main.length - 1], ...proj]) : '',
    dots: straight ? main : [main[main.length - 1]],
    hasData: true,
  };
}

/** Hand-rolled sparkline (RN-svg port of the PWA ui-sparkline): a quadratic-
 *  smoothed line through the values with a dot at the latest point and an
 *  optional dashed projection on the same y-scale — straight segments with a
 *  dot per reading under {@link SMOOTH_FROM} readings. <2 points → a muted
 *  dashed baseline, so the caller keeps a stable footprint regardless of data.
 *
 *  With no `width` it fills its container (measured on layout): the fixed
 *  280 pt default ended the e1RM line at ~80% of the exercise sheet. */
function SparklineImpl({ values, projection = NO_PROJECTION, width, height = 56, color, accessibilityLabel, testID }: Props) {
  const { colors } = useTheme();
  const stroke = color ?? colors.ink;
  const [measured, setMeasured] = useState<number | null>(null);
  const w = width ?? measured ?? FALLBACK_WIDTH;

  const { mainD, gapD, projD, dots, hasData } = useMemo(
    () => sparklineGeometry(values, projection, w, height),
    [values, projection, w, height],
  );

  return (
    <View
      accessible={accessibilityLabel != null}
      accessibilityRole={accessibilityLabel != null ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      onLayout={width == null ? (e) => setMeasured(Math.round(e.nativeEvent.layout.width)) : undefined}
      testID={testID}
    >
      <Svg width={w} height={height}>
        {hasData ? (
          <>
            {gapD ? <Path d={gapD} fill="none" stroke={colors.lineStrong} strokeWidth={1.25} strokeDasharray="2 3" /> : null}
            <Path d={mainD} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            {projD ? (
              <Path d={projD} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" opacity={0.5} />
            ) : null}
            {dots.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={stroke} />
            ))}
          </>
        ) : (
          <Line x1={2} x2={w - 2} y1={height / 2} y2={height / 2} stroke={colors.line} strokeWidth={1} strokeDasharray="3 3" />
        )}
      </Svg>
    </View>
  );
}

/** Memoized: the Body screen re-renders when its sheets open — no need to
 *  recompute the SVG unless the series/size actually change. */
export const Sparkline = memo(SparklineImpl);
