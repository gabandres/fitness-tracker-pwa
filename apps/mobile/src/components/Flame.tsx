import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme-context';

// The Ignia mark — a burning ember. A coral "living ring" (carried over from
// the calorie-ring identity) becomes the heat rim; inside it a flame flickers
// over a white-hot core, with a soft halo that breathes like radiated heat.
// One glyph, reused by the static brand mark and the animated splash/loader so
// the fire reads identically on the splash screen and every loading state.

// Flame silhouette in a 0..100 viewBox: pointed tip up, bulbous base.
const FLAME =
  'M50 15 C 62 31 64 45 60 58 C 57 70 52 78 50 87 C 48 78 43 70 40 58 C 36 45 38 31 50 15 Z';
// Inner white-hot core — smaller, seated in the lower half of the flame.
const CORE =
  'M50 41 C 56 49 57 57 54 64 C 52 70 51 74 50 79 C 49 74 48 70 46 64 C 43 57 44 49 50 41 Z';

/**
 * The animated ember glyph. `flicker` drives the living fire (flame breathe +
 * halo pulse + a drifting spark); when false — or under reduce-motion — it
 * renders a still, fully-lit ember. Pure SVG + reanimated transforms on
 * wrapping views, so it exports to web and stays Playwright-verifiable.
 */
export function Flame({ size = 96, flicker = true }: { size?: number; flicker?: boolean }) {
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const live = flicker && !reduce;

  // Flame breathe: a quick, uneven scale/opacity loop reads as a flicker.
  const breathe = useSharedValue(0);
  // Heat halo: a slower swell that fades as it grows — radiated warmth.
  const halo = useSharedValue(0);
  // Spark: a bright point rising off the tip.
  const spark = useSharedValue(0);

  useEffect(() => {
    if (!live) return;
    breathe.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
        withTiming(0.35, { duration: 260, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.8, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 280, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    halo.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    spark.value = withRepeat(withDelay(300, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) })), -1);
  }, [live, breathe, halo, spark]);

  // Flame: scale from the base (bottom-anchored) so the tip dances, not the root.
  const flameStyle = useAnimatedStyle(() => ({
    opacity: 0.86 + breathe.value * 0.14,
    transform: [
      { translateY: (1 - (0.97 + breathe.value * 0.06)) * (size * 0.44) },
      { scaleY: 0.97 + breathe.value * 0.09 },
      { scaleX: 1 - breathe.value * 0.03 },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.28 - halo.value * 0.2,
    transform: [{ scale: 0.9 + halo.value * 0.35 }],
  }));
  const sparkStyle = useAnimatedStyle(() => ({
    opacity: spark.value < 0.15 ? 0 : (1 - spark.value) * 0.9,
    transform: [{ translateY: -spark.value * size * 0.34 }, { translateX: (spark.value - 0.5) * size * 0.1 }],
  }));

  const gid = `flame-${size}`;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="flame">
      {/* Heat halo — a soft coral bloom behind the ember. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && haloStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Circle cx={50} cy={52} r={40} fill={colors.ring} opacity={live ? 1 : 0.12} />
        </Svg>
      </Animated.View>

      {/* Ember rim — the living ring, now the heat ring. */}
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Circle cx={50} cy={52} r={45} stroke={colors.line} strokeWidth={4} fill="none" opacity={0.5} />
        <Circle cx={50} cy={52} r={45} stroke={colors.ring} strokeWidth={4} fill="none" strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 45 * 0.72} ${2 * Math.PI * 45}`} transform="rotate(-90 50 52)" />
      </Svg>

      {/* Flame + core. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && flameStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={gid} cx="50%" cy="72%" r="62%">
              <Stop offset="0" stopColor={colors.carbs} />
              <Stop offset="0.5" stopColor={colors.ring} />
              <Stop offset="1" stopColor={colors.accent} />
            </RadialGradient>
          </Defs>
          <Path d={FLAME} fill={`url(#${gid})`} />
          {/* Amber hot-core + a white-hot heart at the base → layered-fire read. */}
          <Path d={CORE} fill={colors.carbs} opacity={0.92} />
          <Circle cx={50} cy={66} r={6} fill={colors.white} opacity={0.8} />
        </Svg>
      </Animated.View>

      {/* Rising spark. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && sparkStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Circle cx={50} cy={22} r={2.6} fill={colors.carbs} />
        </Svg>
      </Animated.View>
    </View>
  );
}
