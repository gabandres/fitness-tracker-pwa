import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RecalibrationTrend } from '@macrolog/core';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
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
/** Whether the digest has a fresh shift worth surfacing. Exported for
 *  `useTodayNudge`. */
export function useRecalibrationVisible(): boolean {
  return useRecalibration().digest.shouldSurface;
}

export function RecalibrationCard({ suppressed = false }: { suppressed?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { digest, acknowledge } = useRecalibration();

  if (!digest.shouldSurface || suppressed) return null;

  // A first disclosure is not a recalibration, and until 2026-09-04 it could
  // not tell them apart because the two always coincided: the card was gated on
  // `reliable`, and crossing into `reliable` was the same moment `dailyTargets`
  // switched the day's target to the estimator. So "Your target just
  // recalibrated" described a real event, every time it fired.
  //
  // `c93a740c` decoupled them. The target now follows the estimator from the
  // moment measured mode opens, and this card lost its `reliable` gate in the
  // same commit so that a move is never unexplained — which means it can now
  // reach an account whose target did not move at all. Seen the hour it
  // shipped, on the owner's own phone: the card announced a recalibration and
  // "set" a target that had read 1,944 before and after.
  //
  // `deltaSinceAck` is the honest discriminator and needs no new state: it is
  // null exactly when nothing has been acknowledged yet, i.e. this is the first
  // time the app has shown this number rather than a drift away from one the
  // user already saw. First show states what the number IS; the drift path
  // keeps the event wording, because there the event happened.
  const firstDisclosure = digest.deltaSinceAck == null;

  return (
    <View style={styles.card} testID="recalibration-card">
      <Text style={styles.title}>
        {t(firstDisclosure ? 'recalibration.firstTitle' : 'recalibration.cardTitle')}
      </Text>
      <Text style={styles.body}>
        {t(firstDisclosure ? 'recalibration.firstBody' : 'recalibration.cardBody', {
          tdee: formatNumber(digest.trueTdee, locale),
          target: formatNumber(digest.calorieTarget, locale),
        })}
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
