import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { altitudeNote, stepsVsUsual, type TravelPeriod } from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/**
 * Today while a trip is on (travel mode, 2026-10-26, core `travel.ts`).
 *
 * Eyeballed food makes calories the softer number and protein the one worth
 * hitting, so the card leads with protein — big, against its target — and
 * shows calories after it as an approximation ("≈"). Then steps against the
 * user's usual count (Apple Watch keeps importing them), the altitude note for
 * the first days at a high stop, and the "Eyeballed meal" entry.
 *
 * Above the rings, not in the nudge slot: it states the day's terms rather
 * than asking for an action, and it must not wait behind an update banner.
 */
export function TravelCard({
  period,
  todayKey,
  protein,
  proteinTarget,
  kcal,
  kcalTarget,
  steps,
  onEyeballMeal,
}: {
  period: TravelPeriod;
  todayKey: string;
  protein: number;
  proteinTarget: number;
  kcal: number;
  kcalTarget: number;
  steps: number | null | undefined;
  onEyeballMeal: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const n = (v: number) => formatNumber(Math.round(v), locale);
  const left = Math.max(0, Math.round(proteinTarget - protein));
  const pct = proteinTarget > 0 ? Math.min(1, protein / proteinTarget) : 0;
  const walk = stepsVsUsual(steps, period);
  const altitude = altitudeNote(todayKey, period);

  return (
    <View style={styles.card} testID="travel-card">
      <Text style={styles.eyebrow} accessibilityRole="header" testID="travel-banner">
        {t('travel.banner', { label: period.label ?? t('travel.defaultLabel') })}
      </Text>

      <View style={styles.proteinRow} accessible accessibilityLabel={t('travel.proteinA11y', { eaten: n(protein), target: n(proteinTarget), left: n(left) })}>
        <Text style={styles.proteinBig} testID="travel-protein">
          {n(protein)}
          <Text style={styles.proteinOf}>{` / ${n(proteinTarget)} g`}</Text>
        </Text>
        <Text style={styles.proteinLabel}>{left > 0 ? t('travel.proteinLeft', { left: n(left) }) : t('travel.proteinHit')}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>

      <Text style={styles.kcal} testID="travel-kcal">
        {t('travel.kcalApprox', { eaten: n(kcal), target: n(kcalTarget) })}
      </Text>
      <Text style={styles.line} testID="travel-steps">
        {walk.steps != null
          ? t('travel.steps', { steps: n(walk.steps), usual: n(walk.usual) })
          : t('travel.stepsNone', { usual: n(walk.usual) })}
      </Text>

      {altitude ? (
        <View style={styles.altitude} testID="travel-altitude" accessibilityRole="alert">
          <Ionicons name="trending-up-outline" size={16} color={colors.warn} />
          <Text style={styles.altitudeText}>
            {t('travel.altitude', { place: altitude.place, meters: n(altitude.meters), day: altitude.day })}
          </Text>
        </View>
      ) : null}

      <PressScale
        style={styles.button}
        onPress={() => {
          haptics.tap();
          onEyeballMeal();
        }}
        accessibilityRole="button"
        testID="travel-eyeball"
      >
        <Ionicons name="eye-outline" size={18} color={colors.onInk} />
        <Text style={styles.buttonText}>{t('travel.eyeballButton')}</Text>
      </PressScale>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
    eyebrow: {
      fontSize: font.tiny,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.accent,
      fontWeight: '700',
    },
    proteinRow: { marginTop: space.xs },
    // Manrope — no `fontWeight` (ADR-0014).
    proteinBig: { fontSize: font.h1, fontFamily: type.display, color: colors.ink },
    proteinOf: { fontSize: font.h3, color: colors.muted },
    proteinLabel: { fontSize: font.small, color: colors.muted },
    track: { height: 6, borderRadius: 3, backgroundColor: colors.inputBg, overflow: 'hidden', marginVertical: space.xs },
    fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
    kcal: { fontSize: font.body, color: colors.ink },
    line: { fontSize: font.small, color: colors.muted },
    altitude: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', marginTop: space.xs },
    altitudeText: { flex: 1, fontSize: font.small, color: colors.ink },
    button: {
      flexDirection: 'row',
      gap: space.xs,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      minHeight: TARGET,
      marginTop: space.sm,
    },
    buttonText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
  });
