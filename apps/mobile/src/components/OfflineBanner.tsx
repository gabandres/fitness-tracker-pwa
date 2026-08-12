import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '@/i18n';
import { useIsOffline } from '@/lib/connectivity';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * "You are offline, and your meals are safe."
 *
 * The PWA has had this since it got Firestore persistence (`app.ts`); the Expo
 * app has been silent about it, which is the worse of the two failures. A web
 * user at least keeps seeing their data. Before the read cache landed, a phone
 * with no signal showed an empty day and no explanation — indistinguishable
 * from a bug, or from the account being wiped.
 *
 * **Not a Nudge** (`CONTEXT.md`): it asks for nothing, it is not dismissible,
 * and it is not competing with the update or what's-new banners for the
 * one-at-a-time slot. It is a state readout, so it sits above them and reports
 * a fact for exactly as long as the fact holds.
 *
 * Deliberately reassuring rather than alarming. Saying "offline" alone invites
 * the user to stop logging until they have signal, which is the opposite of
 * what the queue now makes true.
 */
export function OfflineBanner() {
  const offline = useIsOffline();
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  if (!offline) return null;

  return (
    <View
      style={styles.banner}
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
      <Text style={styles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    text: { flex: 1, fontSize: font.small, color: colors.muted },
  });
}
