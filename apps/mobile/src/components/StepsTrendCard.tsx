import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  addDays,
  calendarDateKey,
  parseYmd,
  stepsAverage,
  usualSteps,
  USUAL_STEPS_WINDOW_DAYS,
  type TravelPeriod,
} from '@macrolog/core';
import { useActivityRange } from '@/hooks/useActivityRange';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Trends → Steps (2026-11-06): the 7-day average of COMPLETE days, beside the
 * usual count. Steps are activity only — the card says so, because the screen
 * around it is about maintenance and targets, which steps never move (core
 * `steps.ts`). Hidden until there is a week with any count.
 */
export function StepsTrendCard({
  uid,
  todayKey,
  periods,
  refreshKey,
}: {
  uid: string | undefined;
  todayKey: string | undefined;
  periods: readonly TravelPeriod[] | undefined;
  refreshKey?: unknown;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const [from, to] = useMemo((): [string | null, string | null] => {
    if (!todayKey) return [null, null];
    const today = parseYmd(todayKey);
    return [calendarDateKey(addDays(today, -USUAL_STEPS_WINDOW_DAYS)), calendarDateKey(addDays(today, -1))];
  }, [todayKey]);
  const days = useActivityRange(uid, from, to, refreshKey);
  const avg = useMemo(() => (days && todayKey ? stepsAverage(days, todayKey) : null), [days, todayKey]);
  const usual = useMemo(() => (days && todayKey ? usualSteps(days, todayKey, periods ?? []) : null), [days, todayKey, periods]);
  if (!avg) return null;
  return (
    <View style={styles.card} testID="trends-steps">
      <Text style={styles.title} accessibilityRole="header">{t('trends.steps.title')}</Text>
      <Text style={styles.big} testID="trends-steps-avg">{t('trends.steps.avg', { n: formatNumber(avg.mean, locale) })}</Text>
      <Text style={styles.line}>{t('trends.steps.window', { days: String(avg.days) })}</Text>
      {usual ? <Text style={styles.line}>{t('trends.steps.usual', { usual: formatNumber(usual, locale) })}</Text> : null}
      <Text style={styles.note}>{t('trends.steps.note')}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { marginTop: space.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: space.lg, gap: 2 },
    title: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    big: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginTop: space.xs },
    line: { fontSize: font.small, color: colors.muted },
    note: { fontSize: font.small, color: colors.muted, marginTop: space.xs, fontStyle: 'italic' },
  });
