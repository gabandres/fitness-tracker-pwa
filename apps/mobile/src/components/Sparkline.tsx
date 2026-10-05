import { memo, useMemo } from 'react';
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
}

/** Hand-rolled sparkline (RN-svg port of the PWA ui-sparkline): a quadratic-
 *  smoothed line through the values with a dot at the latest point and an
 *  optional dashed projection on the same y-scale. <2 points → a muted dashed
 *  baseline, so the caller keeps a stable footprint regardless of data. */
function SparklineImpl({ values, projection = [], width = 280, height = 56, color, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const stroke = color ?? colors.ink;
  const PAD = 4;

  const { mainD, gapD, projD, last, hasData } = useMemo(() => {
    const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
    const raw = values ?? [];
    const vs = raw.filter(isNum);
    const ps = (projection ?? []).filter(isNum);
    if (vs.length < 2) return { mainD: '', gapD: '', projD: '', last: { x: 0, y: 0 }, hasData: false };

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
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
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

    const smooth = (pts: { x: number; y: number }[]) => {
      if (pts.length < 2) return '';
      let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cx = (prev.x + curr.x) / 2;
        d += ` Q ${cx.toFixed(2)} ${prev.y.toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
      }
      return d;
    };

    return {
      mainD: runs.map(smooth).filter(Boolean).join(' '),
      gapD: bridges,
      // Anchor the dashed segment at the last solid point so they join.
      projD: proj.length ? smooth([main[main.length - 1], ...proj]) : '',
      last: main[main.length - 1],
      hasData: true,
    };
  }, [values, projection, width, height]);

  return (
    <View
      accessible={accessibilityLabel != null}
      accessibilityRole={accessibilityLabel != null ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={width} height={height}>
        {hasData ? (
          <>
            {gapD ? <Path d={gapD} fill="none" stroke={colors.lineStrong} strokeWidth={1.25} strokeDasharray="2 3" /> : null}
            <Path d={mainD} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
            {projD ? (
              <Path d={projD} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" opacity={0.5} />
            ) : null}
            <Circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
          </>
        ) : (
          <Line x1={2} x2={width - 2} y1={height / 2} y2={height / 2} stroke={colors.line} strokeWidth={1} strokeDasharray="3 3" />
        )}
      </Svg>
    </View>
  );
}

/** Memoized: the Body screen re-renders when its sheets open — no need to
 *  recompute the SVG unless the series/size actually change. */
export const Sparkline = memo(SparklineImpl);
