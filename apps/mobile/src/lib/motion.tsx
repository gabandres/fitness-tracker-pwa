import { type ComponentProps, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, TextInput, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  LinearTransition,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as haptics from '@/lib/haptics';
import { motion } from '@/theme';

/**
 * Motion primitives — the ONLY place components should get animation behavior
 * from. Everything here derives its timing from the `motion` tokens in
 * `theme.ts` and honors the OS reduce-motion setting, so a component that uses
 * these is accessible and on-system by construction.
 *
 * Reanimated works in this Expo SDK 54 setup with zero config: babel-preset-expo
 * auto-loads `react-native-worklets/plugin` when `react-native-worklets` is
 * installed (it is). If animations ever silently no-op, clear the Metro cache
 * (`expo start -c`) before suspecting the code.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Staggered fade+rise entrance for the Nth card/row of a screen or list. */
export function enterUp(index = 0) {
  return FadeInUp.duration(motion.dur.base)
    .delay(index * motion.stagger)
    .easing(Easing.out(Easing.cubic))
    .reduceMotion(ReduceMotion.System);
}

/** Spring layout transition for rows that move when siblings are added/removed. */
export const springLayout = LinearTransition.springify()
  .damping(motion.spring.gentle.damping)
  .stiffness(motion.spring.gentle.stiffness)
  .reduceMotion(ReduceMotion.System);

/** Non-bouncy layout transition — for size changes that should settle cleanly
 *  (e.g. an accordion expanding) where a spring's overshoot reads as "jumpy". */
export const smoothLayout = LinearTransition.duration(motion.dur.base)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);

type PressScaleProps = Omit<ComponentProps<typeof Pressable>, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. Default 0.96; use ~0.9 for small pills/chips. */
  scaleTo?: number;
  /** Fire haptics.tap() on press (skip when the handler already does). */
  haptic?: boolean;
};

/** Pressable that springs down while pressed — the app's standard tactile CTA. */
export function PressScale({ style, scaleTo = 0.96, haptic = false, onPress, onPressIn, onPressOut, ...rest }: PressScaleProps) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        if (!reduce) scale.value = withSpring(scaleTo, motion.spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.spring.press);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics.tap();
        onPress?.(e);
      }}
    />
  );
}

/**
 * Celebration pulse: returns an animated style and a `trigger()` that bounces
 * the element once (scale up, spring back). No-op under reduce motion — pair
 * the trigger with a haptic so the reward still lands.
 */
export function usePulse(scaleTo = 1.25) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const trigger = useCallback(() => {
    if (reduce) return;
    scale.value = withSequence(withSpring(scaleTo, motion.spring.press), withSpring(1, motion.spring.gentle));
  }, [reduce, scaleTo, scale]);
  return [style, trigger] as const;
}

/** Format with comma grouping and fixed decimals ("12345.67", 1 → "12,345.7").
 *  Worklet — runs on the UI thread. */
function formatNumber(n: number, decimals: number): string {
  'worklet';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  let out = '';
  for (let i = 0; i < int.length; i++) {
    out += int[i];
    const fromEnd = int.length - 1 - i;
    if (fromEnd > 0 && fromEnd % 3 === 0) out += ',';
  }
  return (n < 0 ? '−' : '') + out + (frac ? '.' + frac : '');
}

type CountUpProps = {
  value: number;
  /** Fraction digits to render (default 0 — integers). */
  decimals?: number;
  /** Unit appended after the number (e.g. "g"). */
  suffix?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * Number that counts to `value` when it changes (jumps under reduce motion).
 * Rendered through a read-only TextInput — the standard Reanimated trick for
 * updating text from the UI thread without re-rendering React.
 */
export function CountUpText({ value, decimals = 0, suffix = '', style, testID }: CountUpProps) {
  const reduce = useReducedMotion();
  const sv = useSharedValue(value);
  useEffect(() => {
    sv.value = reduce
      ? value
      : withTiming(value, { duration: motion.dur.slow, easing: Easing.out(Easing.cubic) });
  }, [value, reduce, sv]);
  const animatedProps = useAnimatedProps(() => {
    const text = formatNumber(sv.value, decimals) + suffix;
    return { text, defaultValue: text };
  });
  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      style={[styles.countUp, style]}
      animatedProps={animatedProps}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  // Kill TextInput's platform padding so it lays out like a <Text>.
  countUp: { padding: 0, paddingVertical: 0, textAlign: 'center' },
});
