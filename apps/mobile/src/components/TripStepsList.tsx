import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DEFAULT_USUAL_STEPS, parseYmd, tripStepDays, type TravelPeriod } from '@macrolog/core';
import { useActivityRange } from '@/hooks/useActivityRange';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/**
 * The travel summary's day list (2026-11-06): each day of the trip so far with
 * its step count, and the average against the trip's usual. A day without a
 * count shows "—" (no data, not zero); today is marked as still counting.
 * Recorded walks are already inside each day's total — nothing is added.
 */
export function TripStepsList({ uid, period, todayKey }: { uid: string; period: TravelPeriod; todayKey: string }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const to = period.end < todayKey ? period.end : todayKey;
  const activity = useActivityRange(uid, period.start <= todayKey ? period.start : null, to);
  const days = useMemo(() => (activity ? tripStepDays(period, activity, todayKey) : []), [activity, period, todayKey]);
  const complete = days.filter((d) => !d.today && d.steps != null);
  if (!days.some((d) => d.steps != null)) return null;
  const avg = complete.length ? Math.round(complete.reduce((s, d) => s + (d.steps ?? 0), 0) / complete.length) : null;
  return (
    <View style={styles.box} testID="travel-steps-list">
      <Text style={styles.title}>{t('settings.travel.stepsTitle')}</Text>
      {avg != null ? (
        <Text style={styles.avg}>
          {t('settings.travel.stepsAvg', { n: formatNumber(avg, locale), usual: formatNumber(period.usualSteps ?? DEFAULT_USUAL_STEPS, locale) })}
        </Text>
      ) : null}
      {days.map((d) => (
        <View key={d.dateKey} style={styles.row} accessible>
          <Text style={styles.day}>{formatDate(parseYmd(d.dateKey), locale, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
          <Text style={styles.value} testID={`travel-steps-${d.dateKey}`}>
            {d.steps == null
              ? '—'
              : d.today
                ? t('settings.travel.stepsSoFar', { n: formatNumber(d.steps, locale) })
                : formatNumber(d.steps, locale)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    box: { marginTop: space.sm, gap: 2 },
    title: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    avg: { fontSize: font.small, color: colors.muted, marginBottom: space.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
    day: { fontSize: font.small, color: colors.muted },
    value: { fontSize: font.small, color: colors.ink, fontVariant: ['tabular-nums'] },
  });
