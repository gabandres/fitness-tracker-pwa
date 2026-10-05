import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { type Locale, useLocale, useT } from '@/i18n';
import { formatDate, formatTime } from '@/lib/date-format';
import { useHealthStatus } from '@/lib/health-status';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';
import { BodyIcon } from './BodyIcon';

/**
 * When an import last ran, as a line says it: the time alone today ("9:41"),
 * the day and time before that ("Oct 3 9:41"). One formatter for Body's
 * footer and the Connected apps cards — Connected apps printed the date even
 * for a sync a minute ago while the footer printed only the time, so the two
 * screens described the same run two ways (re-score 3, Copy).
 *
 * Here, not in `health-status.ts`: that module is AsyncStorage and nothing
 * else on purpose (its header), and a formatter pulls in the i18n registry.
 */
export function syncWhen(at: Date, locale: Locale, now: Date = new Date()): string {
  return at.toDateString() === now.toDateString()
    ? formatTime(at, locale)
    : `${formatDate(at, locale, { month: 'short', day: 'numeric' })} ${formatTime(at, locale)}`;
}

/**
 * "Weight syncs from Apple Health · 9:41" (Body review, U11).
 *
 * A scale reading that lands from Health and one typed by hand are the same
 * document (`dailyWeights` has no `source`, #110), so nothing on Body said
 * where half the rows came from, whether the import was on, or when it last
 * ran — and "my scale stopped syncing" had no place to be noticed. One quiet
 * line under the history answers all three, and is the door to Connected apps
 * where the details and the permission fix live.
 *
 * Off: says what connecting would do, rather than nothing — the same line is
 * how someone with a smart scale finds out the import exists.
 */
export function HealthFooter() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const status = useHealthStatus();
  if (!status || Platform.OS === 'web') return null;

  const store = t(Platform.OS === 'ios' ? 'health.storeIos' : 'health.storeAndroid');
  const when = status.lastSync ? syncWhen(new Date(status.lastSync.atMs), locale) : null;
  const line = !status.connected
    ? t('body.healthFooterOff', { store })
    : when
      ? t('body.healthFooter', { store, time: when })
      : t('body.healthFooterNever', { store });

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push('/connected-apps')}
      accessibilityRole="link"
      accessibilityHint={t('body.healthFooterA11y')}
      testID="body-health-footer"
    >
      <BodyIcon sf="heart.text.square" ion="heart-outline" size={16} color={colors.muted} />
      <Text style={styles.text}>{line}</Text>
      <BodyIcon sf="chevron.right" ion="chevron-forward" size={14} color={colors.muted} />
    </TouchableOpacity>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, marginTop: space.sm },
    text: { flex: 1, fontSize: font.small, color: colors.muted },
  });
