import { StyleSheet, Text, View } from 'react-native';
import { type MaintenanceView } from '@macrolog/core';
import { useT } from '@/i18n';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * One line under the rings: today's intake read against MEASURED burn, not
 * against the target.
 *
 * The rings already answer "how much have I got left today". They cannot
 * answer "am I actually in a deficit", because the target they count down from
 * can be clamped by a calorie floor sitting above the user's real maintenance —
 * in which case being perfectly on target is being exactly at maintenance, and
 * nothing on the screen says so.
 *
 * Deliberately a line and not a card. Trends owns the detail — the badge, the
 * completeness percentage, the history — and duplicating it here would make
 * Today the second place to maintain a TDEE explanation. This is the dashboard
 * pointer; that is the screen it points at.
 *
 * Renders nothing unless the estimate is genuinely measured (`maintenanceView`
 * returns null otherwise), so a formula or seed number never appears here
 * looking like an observation.
 */
export function MaintenanceLine({ view }: { view: MaintenanceView | null }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  if (!view) return null;

  const under = view.delta < 0;
  const magnitude = Math.abs(view.delta);

  return (
    <View style={styles.row} testID="maintenance-line">
      <Text style={styles.label} numberOfLines={1}>
        {t('today.maintenance')}
        <Text style={styles.value}> {view.maintenance.toLocaleString()}</Text>
      </Text>
      <Text style={[styles.delta, under ? styles.under : styles.over]} numberOfLines={1}>
        {under
          ? t('today.underMaintenance', { n: magnitude.toLocaleString() })
          : t('today.overMaintenance', { n: magnitude.toLocaleString() })}
      </Text>
      {/* An unreliable reading is shown, not withheld — it is still built from
          this user's own data. The caveat rides here so the number itself does
          not have to be hedged. */}
      {view.reliable ? null : <Text style={styles.caveat}>{t('today.maintenanceRough')}</Text>}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      gap: 2,
    },
    label: { fontSize: font.small, color: colors.muted },
    value: { color: colors.ink, fontWeight: '800' },
    delta: { fontSize: font.small, fontWeight: '700' },
    under: { color: colors.ink },
    over: { color: colors.muted },
    caveat: { fontSize: font.tiny, color: colors.faint },
  });
