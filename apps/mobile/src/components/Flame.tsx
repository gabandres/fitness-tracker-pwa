import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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

// The Ignia mark — the "Ember on Ink" glyph chosen in the 2026-08-31 icon
// redesign: one kinetic, wind-swept flame built from three flat layers
// (deep red → coral → amber), no rings, no chrome. The same three paths are
// the app icon's Icon Composer depth groups, so the fire reads identically on
// the home screen, the splash and every loading state. The layer colors are
// BRAND constants, deliberately not theme tokens — a logo keeps its colors in
// both themes (same reasoning as ShareCard pinning palettes.light).

// Kinetic flame silhouette in a 0..100 viewBox: tip swept right, a side tongue
// on the left, bulbous base.
const FLAME_OUTER =
  'M58 6 C 60 18 54 26 48 34 C 43 41 41 48 44 54 C 38 50 35 44 36 37 C 28 46 24 56 26 66 C 28 78 38 88 50 90 C 62 88 72 80 74 68 C 76 56 70 44 64 32 C 61 24 59 15 58 6 Z';
// Mid layer — the coral body, echoing the outer sweep.
const FLAME_MID =
  'M56 26 C 58 36 54 42 49 49 C 44 55 42 61 45 67 C 41 63 39 57 40 51 C 34 58 32 66 35 74 C 38 82 45 86 51 87 C 60 85 67 78 68 68 C 69 57 63 44 56 26 Z';
// Amber hot-core, seated in the lower half of the flame.
const FLAME_CORE =
  'M54 48 C 58 56 60 63 57 70 C 55 77 50 81 46 82 C 41 80 38 74 39 67 C 40 59 46 53 54 48 Z';

// Brand ember layers — fixed across themes.
const EMBER_DEEP = '#6e121a';
const EMBER_MID = '#c0472f';
const EMBER_CORE = '#f2b24a';
const EMBER_HEART = '#fdf6ec';

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
      { translateY: (1 - (0.97 + breathe.value * 0.06)) * (size * 0.45) },
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

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="flame">
      {/* Heat halo — a soft coral bloom behind the ember. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && haloStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Circle cx={50} cy={54} r={40} fill={colors.ring} opacity={live ? 1 : 0.12} />
        </Svg>
      </Animated.View>

      {/* The three ember layers. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && flameStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={FLAME_OUTER} fill={EMBER_DEEP} />
          <Path d={FLAME_MID} fill={EMBER_MID} />
          <Path d={FLAME_CORE} fill={EMBER_CORE} />
          {/* White-hot heart at the base — the point the eye reads as "lit". */}
          <Circle cx={48} cy={70} r={5} fill={EMBER_HEART} opacity={0.8} />
        </Svg>
      </Animated.View>

      {/* Rising spark, launched off the swept tip. */}
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, live && sparkStyle]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Circle cx={57} cy={13} r={2.6} fill={colors.carbs} />
        </Svg>
      </Animated.View>
    </View>
  );
}
