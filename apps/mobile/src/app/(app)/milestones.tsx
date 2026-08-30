import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sortMilestones } from '@macrolog/core';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { useMilestoneRecord } from '@/hooks/useMilestones';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date-format';
import { enterUp } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * The milestone archive — everything this account has on record.
 *
 * ## It renders ONLY what was earned, and that is the design, not a shortcut
 *
 * The obvious version of this screen lists all eleven milestones and greys out
 * the ones you have not reached. That version is a progress meter in the shape
 * of a list, and it is the exact mechanism the 2026-08-29 review banned when it
 * permitted this feature at all: `UX_AUDIT.md` §S12 rejects shame-based
 * gamification, and milestones were allowed through as a NARROWING of that — a
 * record of what happened is fine, a ladder to climb is not.
 *
 * It also fixes the worst screen this feature could otherwise ship. A new
 * install opening a list of eleven locked rows reads as *"you have achieved
 * nothing"* — the single most off-brand thing a product positioned on **calm**
 * could show someone on day one. The empty state says one plain sentence
 * instead.
 *
 * `sortMilestones` is what enforces this: it filters `MILESTONE_ORDER` down to
 * what is on file and cannot return an unearned key.
 *
 * ## "Recorded", not "Achieved on"
 *
 * A streak length is not an event — nothing writes when it ticks over — so
 * derived milestones are evaluated when the app next opens Today, and the date
 * is when Ignia noticed rather than when the act happened. The copy says
 * `Recorded {date}` and claims no more than that. See `useMilestones.ts`.
 */
/**
 * Month + day + year, no weekday and no time.
 *
 * The precision is the point: a derived milestone's timestamp is when the app
 * evaluated, so showing `2:14 PM` would dress an approximation up as an
 * observation. A date is as much as this record can honestly claim.
 */
const MILESTONE_DATE: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

export default function MilestonesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const { earned, ready } = useMilestoneRecord(user?.uid);
  const rows = sortMilestones(Object.keys(earned));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="milestones-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('milestones.title')}</Text>
        {/* Balances the back chevron so the title is optically centred. */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subtitle}>{t('milestones.settingsSub')}</Text>

        {/* `ready` gates the empty state, not the list. Showing "nothing here
            yet" for the half-second before the listener answers would tell a
            user with fifty milestones that they have none. */}
        {rows.length === 0 ? (
          ready ? (
            <Text style={styles.empty} testID="milestones-empty">
              {t('milestones.empty')}
            </Text>
          ) : null
        ) : (
          rows.map((key, i) => (
            <Animated.View
              key={key}
              entering={enterUp(i)}
              style={styles.row}
              testID={`milestone-${key}`}
            >
              <View style={styles.rule} />
              <View style={styles.rowCol}>
                <Text style={styles.rowTitle}>{t(`milestones.${key}` as I18nKey)}</Text>
                <Text style={styles.rowMeta}>
                  {t('milestones.recorded', {
                    date: formatDate(earned[key], locale, MILESTONE_DATE),
                  })}
                </Text>
              </View>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    title: {
      flex: 1,
      textAlign: 'center',
      fontSize: font.h2,
      fontWeight: '800',
      color: colors.ink,
    },
    headerSpacer: { width: 26 },
    body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
    subtitle: { fontSize: font.body, color: colors.muted, marginBottom: space.sm },
    empty: { fontSize: font.body, color: colors.muted, lineHeight: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingRight: space.lg,
      overflow: 'hidden',
    },
    rule: {
      width: 3,
      alignSelf: 'stretch',
      backgroundColor: colors.accent,
      borderTopRightRadius: radius.sm,
      borderBottomRightRadius: radius.sm,
    },
    rowCol: { flex: 1, gap: 2, paddingLeft: space.sm },
    // Manrope — never paired with `fontWeight` (ADR-0014).
    rowTitle: { fontSize: font.body, fontFamily: type.heading, color: colors.ink },
    rowMeta: { fontSize: font.small, color: colors.muted },
  });
