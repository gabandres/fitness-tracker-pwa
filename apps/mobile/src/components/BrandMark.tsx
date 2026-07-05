import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';
import { motion } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Macronaut mark: the coral macro-calorie ring doubles as an astronaut helmet
// rim; inside sits a dark visor with a light sheen-glint and a green (protein)
// star reflected in it — macro + astronaut in one symbol. The ring sweeps on
// mount, keeping the app's living-ring identity.
const RING_FILL = 0.78;

/** A 4-point sparkle (star) path centered at (cx, cy), outer radius r. */
function sparklePath(cx: number, cy: number, r: number): string {
  const i = r * 0.4; // inner radius
  const d = i * 0.7071; // inner vertices on the diagonals
  return [
    `M ${cx} ${cy - r}`,
    `L ${cx + d} ${cy - d}`,
    `L ${cx + r} ${cy}`,
    `L ${cx + d} ${cy + d}`,
    `L ${cx} ${cy + r}`,
    `L ${cx - d} ${cy + d}`,
    `L ${cx - r} ${cy}`,
    `L ${cx - d} ${cy - d}`,
    'Z',
  ].join(' ');
}

/**
 * The animated Macronaut brand mark — helmet-rim ring sweeping to its resting
 * fill, over a visor with a glint and a protein-green star. Hero for sign-in /
 * onboarding / the loading splash.
 */
export function BrandMark({ size = 96 }: { size?: number }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const center = size / 2;

  const rimStroke = Math.round(size * 0.1);
  const rimR = (size - rimStroke) / 2;
  const visorR = rimR - rimStroke * 0.5 - size * 0.03;

  const circumference = 2 * Math.PI * rimR;
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = reduce
      ? RING_FILL
      : withDelay(120, withTiming(RING_FILL, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }));
  }, [reduce, sweep]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - sweep.value) }));

  // Star sits lower-right in the visor, like a reflected point of light.
  const starCx = center + visorR * 0.32;
  const starCy = center + visorR * 0.3;

  return (
    <View style={{ width: size, height: size }} testID="brand-mark">
      <Svg width={size} height={size}>
        {/* Dark visor */}
        <Circle cx={center} cy={center} r={visorR} fill={colors.ink} />
        {/* Sheen glint — a soft diagonal highlight across the upper visor */}
        <Ellipse
          cx={center - visorR * 0.28}
          cy={center - visorR * 0.32}
          rx={visorR * 0.62}
          ry={visorR * 0.24}
          fill={colors.onInk}
          opacity={0.16}
          transform={`rotate(-38 ${center - visorR * 0.28} ${center - visorR * 0.32})`}
        />
        {/* Protein-green star reflected in the visor */}
        <Path d={sparklePath(starCx, starCy, visorR * 0.2)} fill={colors.protein} />
        <Path d={sparklePath(center - visorR * 0.34, center - visorR * 0.02, visorR * 0.08)} fill={colors.onInk} opacity={0.7} />

        {/* Helmet-rim / macro ring: track + animated coral sweep */}
        <Circle cx={center} cy={center} r={rimR} stroke={colors.line} strokeWidth={rimStroke} fill="none" />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={rimR}
          stroke={colors.ring}
          strokeWidth={rimStroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={ringProps}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
    </View>
  );
}
