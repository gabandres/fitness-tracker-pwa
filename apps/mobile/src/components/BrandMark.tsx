import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors, motion } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Mirrors the app icon's dual macro rings (public/icon-source.svg) with the
// live UI palette: coral calorie ring outside, protein green inside.
const OUTER_FILL = 0.76;
const INNER_FILL = 0.62;

/** One ring that sweeps from empty to `fill` on mount (jumps under reduce motion). */
function SweepRing({
  size,
  r,
  stroke,
  color,
  fill,
  delay,
}: {
  size: number;
  r: number;
  stroke: number;
  color: string;
  fill: number;
  delay: number;
}) {
  const c = 2 * Math.PI * r;
  const reduce = useReducedMotion();
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = reduce
      ? fill
      : withDelay(delay, withTiming(fill, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }));
  }, [fill, delay, reduce, sweep]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - sweep.value) }));
  return (
    <>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.line} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        animatedProps={animatedProps}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </>
  );
}

/**
 * The animated brand mark — the icon's dual macro rings sweeping to their
 * resting fills. The hero for sign-in / onboarding surfaces.
 */
export function BrandMark({ size = 96 }: { size?: number }) {
  const outerStroke = Math.round(size * 0.1);
  const innerStroke = Math.round(size * 0.08);
  const outerR = (size - outerStroke) / 2;
  const innerR = outerR - outerStroke - Math.round(size * 0.04);
  return (
    <View style={{ width: size, height: size }} testID="brand-mark">
      <Svg width={size} height={size}>
        <SweepRing size={size} r={outerR} stroke={outerStroke} color={colors.ring} fill={OUTER_FILL} delay={100} />
        <SweepRing size={size} r={innerR} stroke={innerStroke} color={colors.protein} fill={INNER_FILL} delay={280} />
      </Svg>
    </View>
  );
}
