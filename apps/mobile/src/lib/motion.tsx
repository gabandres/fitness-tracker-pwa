import { type ComponentProps, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
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
import { useLocale } from '@/i18n';
import { numberSeparators } from '@/lib/date-format';
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

/**
 * Entrance for the lines of a hero moment (the welcome intro). Same shape as
 * {@link enterUp} on the `motion.hero` tokens: slower, ~100 ms apart, eased —
 * never sprung. The one element with weight on that screen is the mark, and it
 * springs on its own; four things with weight read as a toy.
 */
export function heroEnter(index = 0) {
  return FadeInUp.duration(motion.hero.dur)
    .delay(motion.hero.lead + index * motion.hero.stagger)
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

/**
 * Format with grouping and fixed decimals ("12345.67", 1 → "12,345.7").
 * Worklet — runs on the UI thread.
 *
 * The separators are PARAMETERS, not literals. A worklet runs in its own JS
 * runtime and has no `Intl`, so it cannot ask what a locale groups with; it
 * used to assume a comma, which was correct for `en` and `es-PR` and wrong
 * the moment pt-BR shipped — Brazil writes 1.974, and the big number on Today
 * is rendered through here. `numberSeparators()` resolves them on the JS
 * thread and the two characters are captured as plain strings.
 */
function formatNumber(n: number, decimals: number, group: string, decimal: string): string {
  'worklet';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  let out = '';
  for (let i = 0; i < int.length; i++) {
    out += int[i];
    const fromEnd = int.length - 1 - i;
    if (fromEnd > 0 && fromEnd % 3 === 0) out += group;
  }
  return (n < 0 ? '−' : '') + out + (frac ? decimal + frac : '');
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
 * The widest string this animation will render, given where it starts and where
 * it lands. Exported for test — it is the whole input to {@link CountUpText}'s
 * sizing, and the layout defect it fixes cannot be caught any other way here.
 *
 * Longest by CHARACTER COUNT, not by measured pixels, which is an approximation
 * and a deliberate one: a proportional face makes "1" narrower than "8", so the
 * ghost can be a few points wider than strictly needed. Wider is the safe
 * direction — the text is centred inside it — while narrower is the bug.
 */
export function widestCountUpText(
  from: number,
  to: number,
  decimals: number,
  group: string,
  decimal: string,
  suffix: string,
): string {
  const a = formatNumber(from, decimals, group, decimal) + suffix;
  const b = formatNumber(to, decimals, group, decimal) + suffix;
  return b.length >= a.length ? b : a;
}

/**
 * Number that counts to `value` when it changes (jumps under reduce motion).
 * Rendered through a read-only TextInput — the standard Reanimated trick for
 * updating text from the UI thread without re-rendering React.
 *
 * ## Why there is a hidden `<Text>` behind it
 *
 * That trick has a cost that is easy to miss: **Yoga measures this box on the
 * JS pass, from React-visible props, while `animatedProps` writes `text` on the
 * UI thread.** Layout never re-runs, so the width is frozen at whatever string
 * React last rendered — and every wider string the animation passes through is
 * CLIPPED at that width.
 *
 * Reported 2026-08-28 from the Today hero, which is the worst place for it: the
 * ring read **"1,14"** with the last glyph gone. The box had been measured for a
 * three-digit remaining and the number animated up through four digits on its
 * way to a new value. Nothing about it looks like clipping — it looks like a
 * formatter dropping a digit, which sent the first diagnosis at `formatNumber`.
 *
 * **No test in this repo could have caught it, and that is structural:**
 * `AGENTS.md` records that RNTL never runs a Yoga layout pass, which is the same
 * reason the F-series layout defects and OTA 74's unflexed row reached devices
 * with green suites. Hence {@link widestCountUpText} is extracted as a pure
 * function and tested directly.
 *
 * So a hidden `<Text>` carrying the widest string the animation will show does
 * the measuring, and the TextInput is laid over it. The ghost is the only thing
 * Yoga sees; it cannot be clipped, because it is what defines the width.
 *
 * The alternative — a fixed `minWidth` — was rejected: the right value depends
 * on the font, the locale's separators and the magnitude, and a wrong one is
 * invisible until a user crosses a digit boundary, which is exactly how this
 * defect survived.
 */
export function CountUpText({ value, decimals = 0, suffix = '', style, testID }: CountUpProps) {
  const reduce = useReducedMotion();
  // Resolved on the JS thread; the worklet below only ever sees two strings.
  const { group, decimal } = numberSeparators(useLocale());
  const sv = useSharedValue(value);
  // Read during render, so it still holds the PREVIOUS value — the effect below
  // advances it only after the ghost has been sized for the span being animated.
  const from = useRef(value);
  const widest = useMemo(
    () => widestCountUpText(from.current, value, decimals, group, decimal, suffix),
    [value, decimals, group, decimal, suffix],
  );
  useEffect(() => {
    sv.value = reduce
      ? value
      : withTiming(value, { duration: motion.dur.slow, easing: Easing.out(Easing.cubic) });
    from.current = value;
  }, [value, reduce, sv]);
  const animatedProps = useAnimatedProps(() => {
    const text = formatNumber(sv.value, decimals, group, decimal) + suffix;
    return { text, defaultValue: text };
  });
  return (
    <View style={styles.countUpWrap}>
      {/* Sizes the box and is never seen. `accessible={false}` keeps it out of
          the a11y tree, which would otherwise read every number twice. */}
      <Text
        style={[style, styles.countUpGhost]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        numberOfLines={1}
      >
        {widest}
      </Text>
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        style={[styles.countUp, style, styles.countUpOverlay]}
        animatedProps={animatedProps}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Kill TextInput's platform padding so it lays out like a <Text>.
  countUp: { padding: 0, paddingVertical: 0, textAlign: 'center' },
  countUpWrap: { position: 'relative' },
  // `opacity` rather than `display: none` — a hidden box measures nothing.
  countUpGhost: { opacity: 0 },
  // Spelled out rather than `absoluteFill`, which is a registered style ID and
  // cannot be merged with the caller's `style` in the same array reliably.
  // `textAlignVertical` is the Android half of centring; iOS single-line
  // TextInputs centre themselves.
  countUpOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    textAlignVertical: 'center',
  },
});
