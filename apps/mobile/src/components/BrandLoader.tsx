import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, font, space } from '@/theme';

const SIZE = 76;
const STROKE = 6;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Branded loading / splash indicator: the coral "macro ring" draws around a
 * faint track and spins, with the wordmark below. Built on react-native-svg +
 * the built-in RN Animated API (native-driver rotate). (Reanimated DOES work
 * in this setup — babel-preset-expo auto-wires the worklets plugin; see
 * lib/motion.tsx — this predates that finding and works fine as-is.)
 * Renders identically on web export, so it stays Playwright-verifiable.
 */
export function BrandLoader() {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.wrap} testID="brand-loader">
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.line} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={colors.ring}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            // A ~30% arc of coral; the rotating parent sweeps it around the ring.
            strokeDasharray={`${C * 0.3} ${C}`}
          />
        </Svg>
      </Animated.View>
      <Text style={styles.word}>
        Macro<Text style={styles.wordAccent}> Log</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.lg },
  word: { fontSize: font.h2, fontWeight: '800', color: colors.ink, letterSpacing: 0.2 },
  wordAccent: { color: colors.accent },
});
