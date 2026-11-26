import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  checkInReading,
  checkInSites,
  type CheckInSite,
  type DayBoundary,
  type HomePlanCheckIn,
  type HomePlanEstimatedMeal,
  type Measurement,
} from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * Today's home-plan card (core `home-plan.ts`, 2026-11-18): a check-in that is
 * due ("tape + photo — the numbers are on Body") and a day when a meal may be
 * logged as an estimate, with the button that logs one. Renders nothing when
 * neither applies.
 */
export function HomePlanTodayCard({
  checkIn,
  estimatedMeal,
  onEstimatedMeal,
}: {
  checkIn: HomePlanCheckIn | null;
  estimatedMeal: HomePlanEstimatedMeal | null;
  onEstimatedMeal: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  if (!checkIn && !estimatedMeal) return null;
  return (
    <View style={styles.card} testID="home-plan-today">
      {checkIn ? (
        <View style={styles.row} testID="home-plan-checkin">
          <Ionicons name="resize-outline" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">{checkIn.title}</Text>
            <Text style={styles.line}>{checkIn.note ?? t('homePlan.checkInToday')}</Text>
          </View>
        </View>
      ) : null}
      {estimatedMeal ? (
        <>
          <Text style={styles.line} testID="home-plan-estimated">
            {estimatedMeal.note ?? t('homePlan.estimatedMeal', { slot: estimatedMeal.slot })}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => {
              haptics.tap();
              onEstimatedMeal();
            }}
            accessibilityRole="button"
            testID="home-plan-estimated-log"
          >
            <Ionicons name="eye-outline" size={18} color={colors.onInk} />
            <Text style={styles.buttonText}>{t('homePlan.estimatedLog', { slot: estimatedMeal.slot })}</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

const SITE_LABEL: Record<CheckInSite, 'homePlan.waist' | 'homePlan.neck' | 'homePlan.chest'> = {
  waist: 'homePlan.waist',
  neck: 'homePlan.neck',
  chest: 'homePlan.chest',
};

/**
 * Body's check-in card: the 7-day weight average and the newest tape against
 * the plan's baseline (core `checkInReading`). Imperial throughout — the plan's
 * baseline is in lb and inches, as the app stores them.
 */
export function HomeCheckInCard({
  checkIn,
  todayKey,
  weights,
  measurements,
  boundary,
}: {
  checkIn: HomePlanCheckIn;
  todayKey: string;
  weights: Readonly<Record<string, number>>;
  measurements: readonly Measurement[];
  boundary: DayBoundary;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const r = checkInReading(checkIn, todayKey, weights, measurements, boundary);
  const b = checkIn.baseline;
  const n = (v: number, d = 1) => formatNumber(v, locale, { maximumFractionDigits: d });
  const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${n(Math.abs(v), d)}`;
  return (
    <View style={styles.card} testID="home-checkin-card">
      <Text style={styles.title} accessibilityRole="header">{checkIn.title}</Text>
      <Text style={styles.line} testID="home-checkin-weight">
        {r.avgWeightLb != null
          ? t('homePlan.weightLine', {
            avg: n(r.avgWeightLb), n: r.weighIns,
            vs: b.weightLb != null && r.weightDelta != null ? t('homePlan.vsBaseline', { delta: `${signed(r.weightDelta)} lb`, base: `${n(b.weightLb)} lb`, date: b.date }) : '',
          })
          : t('homePlan.noWeights')}
      </Text>
      {checkInSites(checkIn).map((key) => {
        const site = t(SITE_LABEL[key]);
        const now = r[`${key}In`];
        const delta = r[`${key}Delta`];
        const base = b[`${key}In`];
        return (
          <Text key={key} style={styles.line} testID={`home-checkin-${key}`}>
            {base != null
              ? now != null && delta != null
                ? t('homePlan.tapeLine', { site, now: n(now, 2), delta: signed(delta, 2), base: n(base, 2) })
                : t('homePlan.tapeMissing', { site, base: n(base, 2) })
              : now != null
                ? t('homePlan.tapeFirst', { site, now: n(now, 2) })
                : t('homePlan.tapeNotYet', { site })}
          </Text>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
    row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
    title: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
    line: { fontSize: font.small, color: colors.muted },
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
