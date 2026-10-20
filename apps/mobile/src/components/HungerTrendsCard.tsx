import { StyleSheet, Text, View } from 'react-native';
import { type HungerWeek, hungerRaiseTarget } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * Evening hunger on Trends (2026-10-20): the 7-day average of the 0–10 rating
 * typed on Today, and the rule the owner reads it against — "avg ≥7 →
 * consider raising target to ~<target + 100>". The rule is a sentence, never
 * an action: nothing here (or anywhere) changes a target from this number.
 * Draws only once a day in the window is rated.
 */
export function HungerTrendsCard({ week, targetKcal }: { week: HungerWeek | null | undefined; targetKcal: number | null | undefined }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  if (!week || week.average == null) return null;
  const raiseTo = hungerRaiseTarget(targetKcal);
  return (
    <View testID="hunger-trends">
      <Text style={styles.section} accessibilityRole="header">{t('trends.hunger.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.headline} testID="hunger-avg">
          {t('trends.hunger.avg', { avg: formatNumber(week.average, locale, { maximumFractionDigits: 1 }) })}
        </Text>
        <Text style={styles.meta} testID="hunger-rated">
          {t('trends.hunger.rated', { n: week.ratedDays, of: week.windowDays })}
        </Text>
        <Text style={[styles.rule, week.raise && styles.ruleMet]} testID="hunger-rule">
          {raiseTo != null
            ? t('trends.hunger.rule', { kcal: formatNumber(raiseTo, locale) })
            : t('trends.hunger.ruleNoTarget')}
        </Text>
        <Text style={styles.meta}>{t('trends.hunger.displayOnly')}</Text>
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
    headline: { fontFamily: type.heading, fontSize: font.body, color: colors.ink },
    meta: { fontSize: font.small, color: colors.muted },
    rule: { fontSize: font.small, color: colors.ink, marginTop: space.xs },
    ruleMet: { color: colors.warn, fontWeight: '700' },
  });
