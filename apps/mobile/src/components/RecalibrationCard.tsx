import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RecalibrationTrend } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useRecalibration } from '@/hooks/useRecalibration';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** Trend bucket → i18n reason key (kept as a typed map so the dynamic lookup
 *  stays inside the I18nKey union). */
const TREND_KEY: Record<RecalibrationTrend, I18nKey> = {
  'metabolism-slowed': 'recalibration.trend.metabolism-slowed',
  'metabolism-faster': 'recalibration.trend.metabolism-faster',
  steady: 'recalibration.trend.steady',
};

/**
 * Adaptive-TDEE recalibration digest card (v1.1 retention loop) — mobile twin
 * of the web Today recalibration card. Surfaces the measured-mode TDEE shift
 * the app already applies silently; acknowledging latches it off until the
 * reading drifts meaningfully again. Renders nothing when there's nothing
 * fresh to show.
 */
export function RecalibrationCard() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { digest, acknowledge } = useRecalibration();

  if (!digest.shouldSurface) return null;

  return (
    <View style={styles.card} testID="recalibration-card">
      <Text style={styles.title}>{t('recalibration.cardTitle')}</Text>
      <Text style={styles.body}>
        {t('recalibration.cardBody', { tdee: digest.trueTdee, target: digest.calorieTarget })}
      </Text>
      <Text style={styles.trend}>{t(TREND_KEY[digest.trend])}</Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={() => {
          haptics.tap();
          acknowledge();
        }}
        testID="recalibration-ack"
      >
        <Text style={styles.ctaText}>{t('recalibration.cardCta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.xs,
  },
  title: { fontSize: font.body, color: colors.ink, fontWeight: '800' },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
  trend: { fontSize: font.small, color: colors.faint, lineHeight: 18 },
  cta: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  ctaText: { fontSize: font.small, fontWeight: '800', color: colors.white },
});
