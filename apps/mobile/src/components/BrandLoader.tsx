import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Flame } from '@/components/Flame';
import { useTheme } from '@/lib/theme-context';
import { font, space, type } from '@/theme';

const SIZE = 104;
// Ember spawn points around the flame base (x offset from center, start delay).
const EMBERS = [
  { x: -18, delay: 0, drift: -10, dur: 1600 },
  { x: 14, delay: 260, drift: 8, dur: 1900 },
  { x: -6, delay: 520, drift: -4, dur: 1500 },
  { x: 22, delay: 780, drift: 12, dur: 2000 },
  { x: -22, delay: 1040, drift: -14, dur: 1750 },
  { x: 4, delay: 1300, drift: 6, dur: 1650 },
];

/** A single spark that rises off the fire, drifting and fading as it cools. */
function Ember({ x, delay, drift, dur, color }: { x: number; delay: number; drift: number; dur: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: dur, easing: Easing.out(Easing.cubic) }), -1));
  }, [t, delay, dur]);
  const style = useAnimatedStyle(() => ({
    // Fade in fast, then cool to nothing over the rise.
    opacity: t.value < 0.1 ? t.value * 8 : (1 - t.value) * 0.85,
    transform: [
      { translateX: x + drift * t.value },
      { translateY: -t.value * (SIZE * 0.85) },
      { scale: 1 - t.value * 0.6 },
    ],
  }));
  return <Animated.View style={[styles.ember, { backgroundColor: color }, style]} />;
}

/**
 * Branded loading / splash: the {@link Flame} ember burns while sparks rise off
 * it and the "Ignia" wordmark settles below. Rendered by the root layout for
 * BOTH the boot splash and every in-app loading state, so the fire is the same
 * moment everywhere (not a static system splash). Exports to web → Playwright.
 */
export function BrandLoader() {
  const { colors } = useTheme();
  const reduce = useReducedMotion();

  // Wordmark rises + fades in under the flame.
  const enter = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) enter.value = withDelay(160, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }));
  }, [enter, reduce]);
  const wordStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  return (
    <View style={styles.wrap} testID="brand-loader">
      <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
        {!reduce &&
          EMBERS.map((e, i) => (
            <Ember key={i} x={e.x} delay={e.delay} drift={e.drift} dur={e.dur} color={i % 2 ? colors.carbs : colors.ring} />
          ))}
        <Flame size={SIZE} flicker />
      </View>
      <Animated.Text style={[styles.word, { color: colors.ink }, wordStyle]}>Ignia</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.lg },
  ember: { position: 'absolute', bottom: SIZE * 0.34, width: 5, height: 5, borderRadius: 3 },
  word: { fontFamily: type.display, fontSize: font.h1, letterSpacing: 1.5 },
});
