import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CountUpText } from '@/lib/motion';
import { colors, font, motion } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** 0..1 (clamped). */
  progress: number;
  size?: number;
  stroke?: number;
  color: string;
  /** Big number in the center — animates a count-up when it changes. */
  value: number;
  /** Unit appended after the value (e.g. "g"). */
  valueSuffix?: string;
  /** Small caption under the value. */
  label: string;
  /** Optional secondary caption (e.g. "/ 140g"). */
  sub?: string;
  testID?: string;
}

export function MacroRing({
  progress,
  size = 132,
  stroke = 12,
  color,
  value,
  valueSuffix,
  label,
  sub,
  testID,
}: Props) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  // Fill sweeps from empty on mount and eases to each new value — same
  // duration/easing as the center count-up so ring and number move together.
  const reduce = useReducedMotion();
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = reduce
      ? p
      : withTiming(p, { duration: motion.dur.slow, easing: Easing.out(Easing.cubic) });
  }, [p, reduce, fill]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - fill.value) }));

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Svg width={size} height={size}>
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
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <CountUpText
          value={value}
          suffix={valueSuffix}
          style={styles.value}
          testID={testID ? `${testID}-value` : undefined}
        />
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  sub: { fontSize: font.tiny, color: colors.faint, marginTop: 1 },
  label: { fontSize: font.small, color: colors.muted, marginTop: 2 },
});
