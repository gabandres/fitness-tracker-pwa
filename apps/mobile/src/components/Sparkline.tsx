import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useTheme } from '@/lib/theme-context';

interface Props {
  /** Main series, oldest → newest. Non-numbers are dropped (a missed day
   *  won't punch a hole). */
  values: readonly (number | null | undefined)[];
  /** Optional forecast continuing past the solid line, drawn dashed. */
  projection?: readonly (number | null | undefined)[];
  width?: number;
  height?: number;
  color?: string;
}

/** Hand-rolled sparkline (RN-svg port of the PWA ui-sparkline): a quadratic-
 *  smoothed line through the values with a dot at the latest point and an
 *  optional dashed projection on the same y-scale. <2 points → a muted dashed
 *  baseline, so the caller keeps a stable footprint regardless of data. */
function SparklineImpl({ values, projection = [], width = 280, height = 56, color }: Props) {
  const { colors } = useTheme();
  const stroke = color ?? colors.ink;
  const PAD = 4;

  const { mainD, projD, last, hasData } = useMemo(() => {
    const vs = (values ?? []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    const ps = (projection ?? []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    if (vs.length < 2) return { mainD: '', projD: '', last: { x: 0, y: 0 }, hasData: false };

    const all = ps.length ? vs.concat(ps) : vs;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const total = vs.length + ps.length;
    const stepX = (width - PAD * 2) / (total - 1);
    const toPoint = (v: number, i: number) => ({
      x: PAD + i * stepX,
      y: height - PAD - ((v - min) / span) * (height - PAD * 2),
    });

    const main = vs.map((v, i) => toPoint(v, i));
    const proj = ps.map((v, k) => toPoint(v, vs.length + k));

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
      mainD: smooth(main),
      // Anchor the dashed segment at the last solid point so they join.
      projD: proj.length ? smooth([main[main.length - 1], ...proj]) : '',
      last: main[main.length - 1],
      hasData: true,
    };
  }, [values, projection, width, height]);

  return (
    <View>
      <Svg width={width} height={height}>
        {hasData ? (
          <>
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
