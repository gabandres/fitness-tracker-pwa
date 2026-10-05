import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRestCountdown } from '@/hooks/useRestTimer';
import { useT } from '@/i18n';
import { useActiveWorkout } from '@/lib/active-workout-signal';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { clock } from './train-summary';

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
 * on every tab but Train (which shows the session itself).
 *
 * While a rest is running the pill shows the REST instead of the elapsed time
 * ("Workout · Rest 1:12") — the number a lifter who stepped over to Today is
 * actually waiting on, and what Hevy's mini-bar carries (Train re-score).
 */
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
    <TouchableOpacity
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
      <Ionicons name="chevron-forward" size={16} style={styles.chevron} />
    </TouchableOpacity>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      minHeight: 44,
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
