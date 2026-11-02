import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseYmd, travelWeek, type DayBoundary, type TravelPlanEntry, type TravelWeekRow } from '@macrolog/core';
import type { WorkoutSession } from '@/lib/workout';
import { useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * "This week" on Today during a trip with a plan (core `travel-plan.ts`): the
 * week's planned sessions and the next one. It informs and asks nothing, so a
 * skipped session reads as that and carries no penalty.
 */
export function TravelPlanCard({
  plan,
  todayKey,
  sessions,
  boundary,
}: {
  plan: readonly TravelPlanEntry[];
  todayKey: string;
  sessions: readonly WorkoutSession[];
  boundary: DayBoundary;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const week = useMemo(() => travelWeek(plan, todayKey, sessions, boundary), [plan, todayKey, sessions, boundary]);
  const day = (key: string) => formatDate(parseYmd(key), locale, { weekday: 'short', month: 'numeric', day: 'numeric' });
  const when = (e: TravelPlanEntry) => (e.from === e.to ? day(e.from) : `${day(e.from)} – ${day(e.to)}`);
  const status = (r: TravelWeekRow) => {
    if (r.status === 'done') return t('travel.plan.done');
    if (r.status === 'skipped') return t('travel.plan.skipped');
    if (r.status === 'due') return t('travel.plan.due');
    return null;
  };

  return (
    <View style={styles.card} testID="travel-plan">
      <Text style={styles.eyebrow} accessibilityRole="header">{t('travel.plan.title')}</Text>
      {week.next ? (
        <Text style={styles.next} testID="travel-plan-next">
          {t('travel.plan.next', { label: week.next.label, date: when(week.next) })}
        </Text>
      ) : null}
      {week.rows.map((r) => (
        <View key={`${r.from}-${r.label}`} style={styles.row} accessible testID={`travel-plan-${r.from}-${r.status}`}>
          <Text style={styles.when}>{when(r)}</Text>
          <Text style={[styles.what, r.status === 'done' || r.status === 'skipped' ? styles.past : null]}>
            {r.status === 'rest' ? t('travel.plan.rest') : r.label}
            {r.note ? ` · ${r.note}` : ''}
            {status(r) ? ` · ${status(r)}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
    eyebrow: { fontSize: font.small, color: colors.muted },
    next: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    row: { flexDirection: 'row', gap: space.sm },
    when: { fontSize: font.small, color: colors.muted, minWidth: 96 },
    what: { fontSize: font.small, color: colors.ink, flex: 1 },
    past: { color: colors.muted },
  });
