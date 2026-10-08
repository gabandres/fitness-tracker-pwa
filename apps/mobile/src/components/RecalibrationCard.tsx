import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { RecalibrationTrend } from '@macrolog/core';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import type { useRecalibration } from '@/hooks/useRecalibration';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

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
/**
 * Takes the screen's `useRecalibration()` rather than calling it: Today needs
 * the same digest for `useTodayNudge`, and each call opens its own three
 * listeners (`useCoreSnapshot`) over the 400-row log window — so the card and
 * the nudge used to cost six for one answer.
 */
export function RecalibrationCard({
  recalibration,
  suppressed = false,
}: {
  recalibration: ReturnType<typeof useRecalibration>;
  suppressed?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { digest, acknowledge, previous } = recalibration;

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

  // Old → new (review 2026-10-06: the card stated a new target and nothing it
  // moved from). A drift names the maintenance last acknowledged and, when the
  // ack carried it, the target then; a first showing names the profile
  // estimate the measured number replaces. Every figure is one the digest or
  // the stored ack already holds — nothing is recomputed.
  const kcal = (n: number) => formatNumber(Math.round(n), locale);
  const fromTo: string[] = [];
  if (!firstDisclosure && previous) {
    fromTo.push(t('recalibration.maintFromTo', { from: kcal(previous.tdee), to: kcal(digest.trueTdee) }));
    if (previous.target != null && Math.round(previous.target) !== Math.round(digest.calorieTarget)) {
      fromTo.push(t('recalibration.targetFromTo', { from: kcal(previous.target), to: kcal(digest.calorieTarget) }));
    }
  } else if (firstDisclosure && digest.deltaVsFormula != null && Math.abs(digest.deltaVsFormula) >= 1) {
    fromTo.push(t('recalibration.estimateFromTo', { from: kcal(digest.trueTdee - digest.deltaVsFormula), to: kcal(digest.trueTdee) }));
  }

  // What is NEW, and nothing the hero already says (S21). The card sits right
  // under the hero, which prints today's target and maintenance; the body used
  // to restate both ("…your real burn at about 2,380 kcal/day. Your daily
  // target is 1,880 kcal.") on top of the old → new lines, so the same two
  // numbers appeared three times on one screen. Now: the change (old → new),
  // then one line of why (`TREND_KEY`). When there is no "from" to show — no
  // stored ack, or a profile estimate that matched — a number-free line says
  // where the reading comes from, so the card never reduces to a title.
  return (
    <View style={styles.card} testID="recalibration-card">
      <Text style={styles.title} accessibilityRole="header">
        {t(firstDisclosure ? 'recalibration.firstTitle' : 'recalibration.cardTitle')}
      </Text>
      {fromTo.length > 0 ? (
        fromTo.map((line) => (
          <Text key={line} style={styles.fromTo} testID="recalibration-from-to">
            {line}
          </Text>
        ))
      ) : (
        <Text style={styles.body} testID="recalibration-basis">
          {t('recalibration.basis')}
        </Text>
      )}
      <Text style={styles.trend} testID="recalibration-why">
        {t(TREND_KEY[digest.trend])}
      </Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={() => {
          haptics.tap();
          acknowledge();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('recalibration.cardCta')}
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
  body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  // The figures, in ink and tabular so "2,450 → 2,380" lines up.
  fromTo: { fontSize: font.small, color: colors.ink, fontWeight: '600', lineHeight: 20, fontVariant: ['tabular-nums'] },
  // The why. `muted`, not `faint`: it is the card's one sentence now, not a
  // footnote under a paragraph.
  trend: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  // A real 44 pt / 48 dp button (it was ~33) — `TARGET`. The accent fill
  // stays — a brand call — with `onFill` text, AA in both themes.
  cta: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: TARGET,
    justifyContent: 'center',
  },
  ctaText: { fontSize: font.small, fontWeight: '800', color: colors.onFill },
});
