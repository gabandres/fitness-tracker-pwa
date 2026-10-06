import Ionicons from '@expo/vector-icons/Ionicons';
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
 *  Unlike the What's New screen this is not one-time-per-version state: it
 *  reflects a live condition. The OTA half needs no dismiss (tapping resolves
 *  it by construction); the store half is dismissible because leaving for the
 *  store is the only action available and it may not be one the user can take. */
/** Whether either update mechanism has something to announce. Exported for
 *  `useTodayNudge`, which ranks the Nudges without rendering them. */
export function useUpdateVisible(): boolean {
  const ota = useOtaUpdate();
  const store = useStoreUpdate();
  return ota.pending || store.available;
}

/**
 * How far the banner's text grows with Dynamic Type / font scale. Uncapped, at
 * the largest accessibility size the two lines wrapped to a dozen and the
 * banner filled Today's whole first screen (S21-8) — a prompt that hides the
 * thing it is prompting about. 1.6× is still well past the default size, and
 * the full sentence is in the accessibility label for a screen reader.
 *
 * With every line held to ONE (`numberOfLines`), that bounds the card at AX5
 * to two ~22pt lines plus padding — about a tenth of the first screen
 * (`fontscale-s21-ui.test.tsx` pins the cap, the line counts and the
 * target). The icons are fixed-size glyphs and do not grow.
 */
export const BANNER_MAX_SCALE = 1.6;

export function UpdateBanner({ suppressed = false }: { suppressed?: boolean }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const ota = useOtaUpdate();
  const store = useStoreUpdate();

  if (suppressed) return null;

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
        // The whole sentence, since the visible lines may be truncated.
        accessibilityLabel={`${t('update.ota.title')}. ${t('update.ota.body')}`}
        accessibilityState={{ disabled: ota.applying, busy: ota.applying }}
        testID="ota-update"
      >
        <View style={styles.left}>
          <Ionicons name="arrow-down-circle" size={20} color={colors.accent} />
          <View style={styles.textCol}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={BANNER_MAX_SCALE}>
              {t('update.ota.title')}
            </Text>
            <Text style={styles.body} numberOfLines={1} maxFontSizeMultiplier={BANNER_MAX_SCALE}>
              {t('update.ota.body')}
            </Text>
          </View>
        </View>
        {ota.applying ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={styles.action} numberOfLines={1} maxFontSizeMultiplier={BANNER_MAX_SCALE}>
            {t('update.ota.action')}
          </Text>
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
        accessibilityLabel={`${t('update.store.title')}. ${t('update.store.body')}`}
      >
        <Ionicons name="cloud-download-outline" size={20} color={colors.accent} />
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={BANNER_MAX_SCALE}>
            {t('update.store.title')}
          </Text>
          <Text style={styles.body} numberOfLines={1} maxFontSizeMultiplier={BANNER_MAX_SCALE}>
            {t('update.store.body')}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        // 44×44 on its own, not by `hitSlop` — a slop overlapping the card's
        // other button is ambiguous about which one a tap meant.
        // (`settings-s21.test.tsx` pins the literal; moving it to `TARGET`
        // — 48dp on Android — means updating that pin with it.)
        style={styles.dismiss}
        onPress={() => {
          haptics.tap();
          store.dismiss();
        }}
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
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
});
