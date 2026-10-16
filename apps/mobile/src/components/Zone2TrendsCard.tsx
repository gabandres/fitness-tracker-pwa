import { StyleSheet, Text, View } from 'react-native';
import type { Zone2Trends } from '@/hooks/useTrends';
import { useT, useLocale } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * Zone 2 on Trends (Program v2.1, 2026-10-15): "Zone 2 in band (HR 120–130):
 * n of last 6", and each of those sessions' average HR. The numbers come from
 * `useTrends` (`zone2`), which reads Train's on-disk sessions once per focus.
 * Draws only when there is a session to count.
 */
export function Zone2TrendsCard({ summary }: { summary: Zone2Trends | null | undefined }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  if (!summary || summary.sessions.length === 0) return null;
  const { band, sessions, inBand } = summary;
  return (
    <View testID="zone2-trends">
      <Text style={styles.section} accessibilityRole="header">{t('trends.zone2.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.headline} testID="zone2-in-band">
          {t('trends.zone2.inBand', { min: band.min, max: band.max, n: inBand, of: sessions.length })}
        </Text>
        {sessions.map((s) => (
          <View key={s.date.getTime()} style={styles.row} testID={`zone2-session-${s.date.getTime()}`}>
            <Text style={styles.date}>{formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            <Text style={[styles.hr, !s.inBand && styles.out]}>
              {t('trends.zone2.avgHr', { hr: s.avgHr })}
              {s.inBand ? '' : ` · ${t('cardio.outsideZone2Short')}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    section: {
      fontSize: font.small,
      color: colors.muted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: space.lg,
      marginBottom: space.xs,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.lg,
      gap: space.xs,
    },
    headline: { fontFamily: type.heading, fontSize: font.body, color: colors.ink, marginBottom: space.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
    date: { fontSize: font.small, color: colors.muted },
    hr: { fontSize: font.small, color: colors.ink },
    out: { color: colors.warn },
  });
