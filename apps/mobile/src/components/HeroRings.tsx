import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 236;
const OUTER_STROKE = 15;
const INNER_STROKE = 12;
const OUTER_R = (SIZE - OUTER_STROKE) / 2;
const INNER_R = OUTER_R - OUTER_STROKE - 7;

interface RingProps {
  r: number;
  stroke: number;
  trackColor: string;
  color: string;
  /** 0..1 (clamped). */
  progress: number;
  delay: number;
}

/** One hero ring: sweeps to `progress` on mount and eases to each new value.
 *  Jumps under reduce motion. */
function Ring({ r, stroke, trackColor, color, progress, delay }: RingProps) {
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const reduce = useReducedMotion();
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = reduce
      ? p
      : withDelay(delay, withTiming(p, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }));
  }, [p, delay, reduce, fill]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - fill.value) }));
  return (
    <>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
      <AnimatedCircle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        animatedProps={animatedProps}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </>
  );
}

interface Props {
  calConsumed: number;
  calTarget: number;
  protConsumed: number;
  protTarget: number;
  carbs: number;
  fat: number;
}

/**
 * The Today hero (ADR-0014): the app icon come to life. One concentric
 * dual-ring element — calories outer, protein inner — on the shared dark
 * hero panel, remaining-kcal count-up in the center. The choreography is the
 * icon's sweep: outer first, inner ~180ms behind. Carbs/fat have no targets
 * in the domain, so they render as value chips, never progress.
 */
export function HeroRings({ calConsumed, calTarget, protConsumed, protTarget, carbs, fat }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const calRemaining = calTarget - calConsumed;
  const over = calRemaining < 0;

  // Celebration: hitting the protein target flares the inner ring once —
  // a glow halo swells and fades, with a success haptic. Fires only on the
  // crossing (null-first ref so a day that ALREADY met the target doesn't
  // flare on mount). Reduce motion keeps the haptic, skips the glow.
  const flare = useSharedValue(0);
  const prevProt = useRef<number | null>(null);
  useEffect(() => {
    const p = protTarget ? protConsumed / protTarget : 0;
    if (prevProt.current !== null && prevProt.current < 1 && p >= 1) {
      haptics.success();
      if (!reduce) {
        flare.value = withSequence(
          withTiming(1, { duration: motion.dur.base, easing: Easing.out(Easing.cubic) }),
          withTiming(0, { duration: motion.dur.slow * 2, easing: Easing.out(Easing.cubic) }),
        );
      }
    }
    prevProt.current = p;
  }, [protConsumed, protTarget, reduce, flare]);
  const flareProps = useAnimatedProps(() => ({ opacity: flare.value * 0.35 }));

  return (
    <View style={styles.panel} testID="hero-rings">
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Ring
            r={OUTER_R}
            stroke={OUTER_STROKE}
            trackColor={colors.heroTrack}
            color={over ? colors.danger : colors.ring}
            progress={calTarget ? calConsumed / calTarget : 0}
            delay={100}
          />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={INNER_R}
            stroke={colors.protein}
            strokeWidth={INNER_STROKE + 10}
            fill="none"
            animatedProps={flareProps}
          />
          <Ring
            r={INNER_R}
            stroke={INNER_STROKE}
            trackColor={colors.heroTrack}
            color={colors.protein}
            progress={protTarget ? protConsumed / protTarget : 0}
            delay={280}
          />
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <CountUpText value={Math.abs(calRemaining)} style={styles.centerValue} testID="hero-kcal" />
          <Text style={styles.centerCaption}>
            {t('today.kcal')} {over ? t('today.over') : t('today.left')}
          </Text>
        </View>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: over ? colors.danger : colors.ring }]} />
          <Text style={styles.legendText}>
            {calConsumed.toLocaleString()} / {calTarget.toLocaleString()} {t('today.kcal')}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.protein }]} />
          <Text style={styles.legendText}>
            {protConsumed}g / {protTarget}g {t('today.protein').toLowerCase()}
          </Text>
        </View>
      </View>

      <View style={styles.macroRow}>
        <Text style={styles.macroChip}>
          <Text style={{ color: colors.carbs }}>●</Text> {t('today.carbs')} {carbs}g
        </Text>
        <Text style={styles.macroChip}>
          <Text style={{ color: colors.fat }}>●</Text> {t('today.fat')} {fat}g
        </Text>
      </View>
    </View>
  );
}

function createStyles({ colors, shadow }: Theme) {
  return StyleSheet.create({
    panel: {
      backgroundColor: colors.heroPanel,
      borderRadius: radius.xl,
      paddingVertical: space.xl,
      paddingHorizontal: space.lg,
      alignItems: 'center',
      gap: space.lg,
      ...shadow.e2,
    },
    ringWrap: { width: SIZE, height: SIZE },
    center: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerValue: { fontFamily: type.display, fontSize: font.hero, color: colors.heroText },
    centerCaption: { fontSize: font.small, color: colors.heroMuted, marginTop: 2 },
    legendRow: { flexDirection: 'row', gap: space.xl, alignItems: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    dot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: font.small, color: colors.heroText, fontFamily: type.heading },
    macroRow: { flexDirection: 'row', gap: space.lg },
    macroChip: { fontSize: font.tiny, color: colors.heroMuted },
  });
}
