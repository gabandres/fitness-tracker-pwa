import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BodyFatInput, BodyFatShown } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';
import { BodyIcon } from './BodyIcon';

/** "waist and hip" / "cintura y cadera" — the missing tape inputs, named.
 *  The old copy said "waist + neck" to everyone, which a woman can satisfy in
 *  full and still get no estimate: the Navy formula also needs hip. */
export function fieldList(missing: readonly BodyFatInput[], t: TFn): string {
  const names = missing.map((k) => t(`measure.${k}` as I18nKey).toLowerCase());
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${t('common.listAnd')} ${names[names.length - 1]}`;
}

/**
 * Body fat, read as a value with a source (Body review, V3).
 *
 * It was a label on the left, three lines of fine print under it, and the
 * percentage pushed to the right edge — the number you came for in the place
 * the eye reaches last, and the method's accuracy note always open beside it.
 * Now the value leads, a chip says where it came from ("U.S. Navy estimate",
 * "Measured · DXA · Oct 3"), and the method explanation moved behind an ⓘ into
 * its own sheet: worth one tap, not worth permanent space.
 *
 * The value is capped at 1.4× font scale (A11) — a display numeral that
 * outgrows its card clips, and a clipped "18.2%" reads "18.".
 *
 * A missing sex/height is a dead end without a way to it (Body re-score), so
 * that gap carries a button to Refine targets — the one screen that edits
 * both without re-running the whole onboarding wizard.
 */
export function BodyFatCard({
  shown,
  navyPct,
  gap,
  missing,
}: {
  shown: BodyFatShown | null;
  /** The tape estimate, kept in view beside a measured value. */
  navyPct: number | null;
  gap: 'profile' | 'measurement' | null;
  missing: readonly BodyFatInput[];
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(false);

  const source =
    shown?.source === 'measured'
      ? t(shown.method === 'dxa' ? 'body.measuredDxa' : 'body.measuredOther', {
          date: formatDate(shown.date, locale, { month: 'short', day: 'numeric' }),
        })
      : shown
        ? t('body.navyEstimate')
        : gap === 'profile'
          ? t('body.bfNeedProfile')
          : t('body.bfNeedFields', { fields: fieldList(missing, t) });

  return (
    <View style={styles.card} testID="bodyfat-card">
      <View style={styles.head}>
        <Text style={styles.label} accessibilityRole="header">{t('body.bodyFat')}</Text>
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            setInfoOpen(true);
          }}
          style={styles.info}
          accessibilityRole="button"
          accessibilityLabel={t('body.bfInfoA11y')}
          testID="bodyfat-info"
        >
          <BodyIcon sf="info.circle" ion="information-circle-outline" size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value} maxFontSizeMultiplier={1.4} testID="bodyfat-value">
          {shown ? `${formatNumber(shown.pct, locale)}%` : '—'}
        </Text>
        <View style={[styles.chip, shown ? styles.chipOn : styles.chipOff]}>
          <Text style={[styles.chipText, shown ? styles.chipTextOn : styles.chipTextOff]} testID="bodyfat-source">
            {source}
          </Text>
        </View>
      </View>
      {/* A measured value keeps the tape estimate in view, so the two methods
          can be compared rather than one silently replacing the other. */}
      {shown?.source === 'measured' && navyPct != null ? (
        <Text style={styles.hint}>{t('body.navyAlso', { pct: formatNumber(navyPct, locale) })}</Text>
      ) : null}
      {!shown && gap === 'profile' ? (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            router.push('/refine-targets');
          }}
          style={styles.fixBtn}
          accessibilityRole="button"
          testID="bodyfat-set-profile"
        >
          <Text style={styles.fixBtnText}>{t('body.bfSetProfile')}</Text>
        </TouchableOpacity>
      ) : null}

      <BottomSheet visible={infoOpen} onClose={() => setInfoOpen(false)} native detents="fit">
        <View style={styles.sheet} testID="bodyfat-info-sheet">
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('body.bfInfoTitle')}</Text>
          <Text style={styles.sheetLine}>{t('body.navyAccuracy')}</Text>
          <Text style={styles.sheetLine}>{t('body.measureIntro')}</Text>
          <Text style={styles.sheetLine}>{t('measure.bodyFatHint')}</Text>
          <TouchableOpacity
            style={styles.sheetBtn}
            onPress={() => setInfoOpen(false)}
            accessibilityRole="button"
            testID="bodyfat-info-done"
          >
            <Text style={styles.sheetBtnText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
}

const createStyles = ({ colors, scheme }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      // Framed in dark like the history rows (re-score 3, Visual).
      borderColor: scheme === 'dark' ? `${colors.lineStrong}80` : colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      marginTop: space.md,
      gap: space.xs,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    info: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
    // `flexWrap` + `flexShrink` on the chip so a long es-PR source line wraps
    // under the value instead of pushing it off the card — the 2026-08-18
    // "15.1%" → "15." clip, from the other direction.
    valueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
    value: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
    chip: { flexShrink: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
    chipOn: { backgroundColor: colors.tealSoft },
    chipOff: { backgroundColor: colors.inputBg },
    chipText: { fontSize: font.small, fontWeight: '700' },
    chipTextOn: { color: colors.tealSolid },
    chipTextOff: { color: colors.muted },
    hint: { fontSize: font.small, color: colors.muted },
    // The same bordered 44 pt button as Body's "Add" (V3 / A7).
    fixBtn: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: space.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      marginTop: space.xs,
    },
    fixBtnText: { fontSize: font.small, color: colors.ink, fontWeight: '700' },
    sheet: { gap: space.md, paddingTop: space.xs },
    sheetTitle: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
    sheetLine: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.5 },
    sheetBtn: { backgroundColor: colors.ink, borderRadius: radius.md, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
    sheetBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
  });
