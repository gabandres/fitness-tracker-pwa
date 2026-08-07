import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import { useOtaUpdate, useStoreUpdate } from '@/lib/app-update';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** "Your app is out of date" card on Today, covering BOTH update mechanisms.
 *
 *  The OTA case wins when both are true: a downloaded bundle can be applied in
 *  one tap and costs the user nothing, whereas the store case sends them out of
 *  the app. Only one banner ever renders — two stacked "update" prompts read as
 *  a broken app.
 *
 *  Unlike {@link WhatsNewBanner} this is not one-time-per-version state: it
 *  reflects a live condition. The OTA half needs no dismiss (tapping resolves
 *  it by construction); the store half is dismissible because leaving for the
 *  store is the only action available and it may not be one the user can take. */
export function UpdateBanner() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const ota = useOtaUpdate();
  const store = useStoreUpdate();

  if (ota.pending) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          haptics.tap();
          void ota.apply();
        }}
        disabled={ota.applying}
        accessibilityRole="button"
        accessibilityLabel={t('update.ota.title')}
        testID="ota-update"
      >
        <View style={styles.left}>
          <Ionicons name="arrow-down-circle" size={20} color={colors.accent} />
          <View style={styles.textCol}>
            <Text style={styles.title}>{t('update.ota.title')}</Text>
            <Text style={styles.body}>{t('update.ota.body')}</Text>
          </View>
        </View>
        {ota.applying ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={styles.action}>{t('update.ota.action')}</Text>
        )}
      </TouchableOpacity>
    );
  }

  if (!store.available) return null;

  return (
    <View style={styles.card} testID="store-update">
      <TouchableOpacity
        style={styles.left}
        onPress={() => {
          haptics.tap();
          store.open();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('update.store.title')}
      >
        <Ionicons name="cloud-download-outline" size={20} color={colors.accent} />
        <View style={styles.textCol}>
          <Text style={styles.title}>{t('update.store.title')}</Text>
          <Text style={styles.body}>{t('update.store.body')}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          haptics.tap();
          store.dismiss();
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.dismiss')}
        testID="store-update-dismiss"
      >
        <Ionicons name="close" size={20} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: font.small, color: colors.ink, fontWeight: '800' },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
  action: { fontSize: font.small, color: colors.accent, fontWeight: '800' },
});
