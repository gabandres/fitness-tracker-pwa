import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import type { useHealthReconnect } from '@/hooks/useHealthReconnect';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Reconnect Apple Health so Watch workouts bring their heart rate (owner,
 * 2026-10-20). A Today Nudge (`useTodayNudge`), shaped like `UpdateBanner`:
 * one action that opens the iOS permission sheet, and "Later", which snoozes
 * it three days. Takes the screen's `useHealthReconnect()` so the nudge and
 * the card read one answer.
 */
export function HealthReconnectCard({
  reconnect,
  suppressed = false,
}: {
  reconnect: ReturnType<typeof useHealthReconnect>;
  suppressed?: boolean;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  if (!reconnect.visible || suppressed) return null;
  return (
    <View style={styles.card} testID="health-reconnect">
      <View style={styles.left}>
        <Ionicons name="watch-outline" size={20} color={colors.accent} />
        <View style={styles.textCol}>
          <Text style={styles.title} accessibilityRole="header">{t('healthReconnect.title')}</Text>
          <Text style={styles.body}>{t('healthReconnect.body')}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={reconnect.busy}
              onPress={() => { haptics.tap(); void reconnect.reconnect(); }}
              testID="health-reconnect-go"
              style={styles.hit}
            >
              {reconnect.busy ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.action}>{t('healthReconnect.cta')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => { haptics.tap(); void reconnect.later(); }}
              testID="health-reconnect-later"
              style={styles.hit}
            >
              <Text style={styles.later}>{t('healthReconnect.later')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  left: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: font.small, color: colors.ink, fontWeight: '800' },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  hit: { minHeight: 44, justifyContent: 'center' },
  action: { fontSize: font.small, color: colors.accent, fontWeight: '800' },
  later: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
});
