import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { medicationDayOf, medicationStatus, newLedgerId } from '@macrolog/core';
import { Touchable } from '@/components/Touchable';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useMedicationLog } from '@/lib/medication';
import { medicationDayLabel } from '@/lib/medication-text';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/** The clock, for handlers (see `app/medication.tsx`). */
const stamp = (): number => Date.now();

/**
 * Today's medication card (2026-11-20): shown only when there is something to
 * say about today — a dose day, a dose logged today, or a past dose day with
 * no entry. Absent on every other day, and for anyone with no medication set
 * up, which is nearly everyone.
 *
 * "Log dose" records the usual dose now, in one tap; the site and a note are
 * added on the Medication screen. The wording is the screen's: a day with no
 * entry is "no dose logged for Tuesday", and nothing here says what to do.
 */
export function MedicationTodayCard({ uid }: { uid: string | undefined }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const store = useMedicationLog(uid, t);
  // The clock is read on focus, never in a render.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const today = medicationDayOf(now);

  const rows = store.log.medications
    .map((med) => ({ med, status: medicationStatus(med, store.log, today) }))
    .filter((r) => r.status.state !== 'upcoming');
  if (rows.length === 0) return null;

  async function logNow(medicationId: string, dose: string | undefined) {
    haptics.tap();
    const ok = await store.logDose({ id: newLedgerId(Math.random), medicationId, takenAt: stamp(), ...(dose ? { dose } : {}) });
    if (ok) {
      haptics.success();
      setNow(stamp());
    }
  }

  return (
    <View style={styles.card} testID="medication-today">
      {rows.map(({ med, status }) => (
        <View key={med.id} style={styles.row} testID={`medication-today-${med.id}`}>
          <Ionicons name="medical-outline" size={18} color={colors.accent} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
          <View style={styles.text}>
            <Text style={styles.title}>
              {med.name}
              {med.dose ? <Text style={styles.dose}>{`  ${med.dose}`}</Text> : null}
            </Text>
            <Text style={styles.line} testID={`medication-today-state-${med.id}`}>
              {status.state === 'due'
                ? t('medication.stateDue')
                : status.state === 'taken'
                  ? t('medication.stateTaken')
                  : t('medication.stateOpen', { day: medicationDayLabel(status.openDay ?? today, locale) })}
            </Text>
          </View>
          {status.state !== 'taken' ? (
            <Touchable
              style={styles.button}
              onPress={() => void logNow(med.id, med.dose)}
              accessibilityRole="button"
              accessibilityLabel={`${t('medication.todayLog')}, ${med.name}`}
              testID={`medication-today-log-${med.id}`}
            >
              <Text style={styles.buttonText}>{t('medication.todayLog')}</Text>
            </Touchable>
          ) : null}
        </View>
      ))}
      <TouchableOpacity
        style={styles.link}
        // `as Href`: `typedRoutes` regenerates from a running dev server, so a
        // route added without one is invisible to tsc until then.
        onPress={() => router.push('/medication' as Href)}
        accessibilityRole="button"
        testID="medication-today-open"
      >
        <Text style={styles.linkText}>{t('medication.todayOpen')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
    row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
    text: { flex: 1, gap: 2 },
    title: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
    dose: { fontSize: font.small, color: colors.muted, fontWeight: '400' },
    line: { fontSize: font.small, color: colors.muted },
    button: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      minHeight: TARGET,
      paddingHorizontal: space.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { color: colors.onInk, fontWeight: '700', fontSize: font.small },
    link: { minHeight: TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
    linkText: { fontSize: font.small, color: colors.ink, fontWeight: '600', textDecorationLine: 'underline' },
  });
