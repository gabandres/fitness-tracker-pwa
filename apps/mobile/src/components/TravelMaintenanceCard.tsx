import { StyleSheet, Text, View } from 'react-native';
import { MAINTENANCE_FRACTION, type MaintenanceCheck, type TravelPeriod } from '@macrolog/core';
import { VOLUME_MUSCLE_KEY } from '@/components/train/volume-muscle-name';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Travel mode's "maintenance check" on Trends (2026-10-26, core
 * `travel-volume.ts`): each muscle's hard sets in the last 7 days of the trip
 * against a third of its weekly normal before it — about what keeps muscle
 * for a few weeks. Short muscles first. Draws only during a trip, and only
 * when there was a pre-trip normal to compare with.
 */
export function TravelMaintenanceCard({ data }: { data: { period: TravelPeriod; check: MaintenanceCheck } | null | undefined }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  if (!data || data.check.rows.length === 0) return null;
  const { check } = data;
  const n = (v: number) => formatNumber(Math.round(v * 10) / 10, locale);
  return (
    <View testID="travel-maintenance-check">
      <Text style={styles.section} accessibilityRole="header">{t('trends.travelCheck.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.headline} testID="travel-check-headline">
          {t('trends.travelCheck.headline', { ok: check.okCount, of: check.rows.length })}
        </Text>
        <Text style={styles.sub}>
          {t('trends.travelCheck.sub', {
            since: formatDate(check.windowFrom, locale, { month: 'short', day: 'numeric' }),
            fraction: Math.round(MAINTENANCE_FRACTION * 100),
          })}
        </Text>
        {check.rows.map((r) => (
          <View key={r.muscle} style={styles.row} testID={`travel-check-${r.muscle}`}>
            <Text style={styles.muscle}>{t(VOLUME_MUSCLE_KEY[r.muscle])}</Text>
            <Text style={[styles.value, !r.ok && styles.short]}>
              {t('trends.travelCheck.row', { sets: n(r.thisWeek), needed: n(r.needed), normal: n(r.normalWeekly) })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    section: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: space.sm },
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
    headline: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    sub: { fontSize: font.small, color: colors.muted, marginBottom: space.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
    muscle: { fontSize: font.small, color: colors.ink },
    value: { fontSize: font.small, color: colors.ink },
    short: { color: colors.warn },
  });
