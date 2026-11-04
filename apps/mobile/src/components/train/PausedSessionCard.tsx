import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { remainingSteps, resumeDeadline, type DayBoundary } from '@macrolog/core';
import type { WorkoutSession } from '@/lib/workout';
import { useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { formatTime } from '@/lib/date-format';
import { Touchable } from '@/components/Touchable';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * A paused workout (core `session-pause.ts`): "Resume Travel D — 6 exercises
 * left", on Today and on Train's Start. One tap continues the SAME record.
 * "Exercises left" counts the steps of the template's order not started yet,
 * superset rounds included — a lift with two clusters left in a tri-set is two.
 */
export function PausedSessionCard({
  session,
  boundary,
  onResume,
}: {
  session: WorkoutSession;
  boundary: DayBoundary;
  onResume: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const left = useMemo(() => remainingSteps(session).length, [session]);
  const until = useMemo(() => resumeDeadline(session, boundary), [session, boundary]);
  const name = session.templateName || t('train.workout');
  const leftText = plural(t, locale, 'train.pause.left', left);
  return (
    <Touchable
      onPress={onResume}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={t('train.pause.resumeA11y', { name, left: leftText })}
      testID={`paused-session-${session.id}`}
    >
      <Ionicons name="play-circle" size={28} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>
          {t('train.pause.resume', { name })} — {leftText}
        </Text>
        <Text style={styles.sub}>{t('train.pause.until', { time: formatTime(until, locale) })}</Text>
      </View>
    </Touchable>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, flexDirection: 'row', alignItems: 'center' },
    title: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    sub: { fontSize: font.small, color: colors.muted, marginTop: 2 },
  });
