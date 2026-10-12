import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { useRestCountdown } from '@/hooks/useRestTimer';
import { useT } from '@/i18n';
import { useActiveWorkout } from '@/lib/active-workout-signal';
import { GLASS_BAR_HEIGHT, glassBarGap } from '@/lib/glass';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { clock } from './train-summary';
import { TARGET } from './train-styles';

/**
 * "Workout · 12:34 · Resume" — the open workout, from any tab (Train review
 * item 11).
 *
 * The tab bar's dot says a workout is open; it does not say for how long, and
 * it is a 6pt target in the Train icon's corner. Hevy and Strong keep a bar
 * like this above their tab bars, because the raised Log button pulls you to
 * Today mid-session (a shake, a coffee) and the way back should be one tap.
 *
 * Reads the same signal as the dot (`active-workout-signal.ts`, ADR-0016 — no
 * listener, no documents). Renders nothing when no workout is open, so the
 * caller can mount it unconditionally; the tab layout does, above the tab bar
 * on every tab but Train (which shows the session itself), and insets those
 * tabs' content by {@link pillSceneInset} so it covers nothing.
 *
 * While a rest is running the pill shows the REST instead of the elapsed time
 * ("Workout · Rest 1:12") — the number a lifter who stepped over to Today is
 * actually waiting on, and what Hevy's mini-bar carries (Train re-score).
 */
/** The gap under the pill that clears the raised Log button, which stands
 *  ~26 pt proud of the tab bar. The tab layout's pill slot pads by this. */
export const PILL_TAB_CLEARANCE = 30;

/**
 * How far a tab's content must stop short of the screen's bottom edge while
 * the pill shows — so the pill never sits over a control (Train re-score
 * L-N11 / H-N3 / J-N7: on Body it covered "Log weight" at rest and took the
 * tap meant for it; on Today, the fasting card's button).
 *
 * Under the OPAQUE bar this is 0: the bar and the pill above it are laid out
 * in flow below the content, which already ends at the pill's top. Under the
 * iOS 26 glass capsule the bar floats OVER the content, and the pill with it,
 * so the content is inset by the whole stack — pill, clearance, capsule and
 * its gap. `measured` is that stack as last laid out; until it is, the sum of
 * its parts at default text size.
 *
 * Scroll padding alone could not do this: the overlap is at rest, before any
 * scroll, wherever a short screen happens to put its last button.
 */
export function pillSceneInset(glass: boolean, measured: number | null, insetBottom: number): number {
  if (!glass) return 0;
  return measured ?? TARGET + space.xs + PILL_TAB_CLEARANCE + GLASS_BAR_HEIGHT + glassBarGap(insetBottom);
}

export function ActiveWorkoutPill({ onResume }: { onResume: () => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const workout = useActiveWorkout();
  const rest = useRestCountdown(workout.active ? workout.restEndsAt : null);
  const resting = rest.remaining > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!workout.active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [workout.active]);

  if (!workout.active) return null;
  const name = workout.name || t('train.activePill');
  // Clamped: `now` can trail a just-started workout by up to one tick.
  const time = workout.startedAt != null ? clock(Math.max(0, now - workout.startedAt) / 1000) : null;

  return (
    <Touchable
      style={styles.pill}
      onPress={() => {
        haptics.tap();
        onResume();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        resting
          ? t('train.activePillRestA11y', { name, time: rest.label })
          : t('train.activePillA11y', { name, time: time ?? '' })
      }
      testID="active-workout-pill"
    >
      <View style={styles.dot} />
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      {resting ? (
        <Text style={styles.time} testID="active-workout-pill-rest">{t('train.activePillRest', { time: rest.label })}</Text>
      ) : time ? (
        <Text style={styles.time}>{time}</Text>
      ) : null}
      <View style={styles.fill} />
      <Text style={styles.resume}>{t('train.activeResume')}</Text>
      <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={16} style={styles.chevron} />
    </Touchable>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: TARGET,
      marginHorizontal: space.md,
      marginBottom: space.xs,
      paddingHorizontal: space.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.ink,
      ...shadow.e2,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ring },
    name: { flexShrink: 1, fontSize: font.small, fontWeight: '700', color: colors.onInk },
    time: { fontSize: font.small, color: colors.onInk, opacity: 0.85, fontVariant: ['tabular-nums'] },
    fill: { flex: 1 },
    resume: { fontSize: font.small, fontWeight: '800', color: colors.onInk },
    chevron: { color: colors.onInk },
  });
