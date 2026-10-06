import { StyleSheet, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { TARGET } from './train-styles';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * The one-time "get a buzz when rest is over" priming sheet (UX_AUDIT
 * S18-10). Same idiom as `ConfirmSheet` — dim backdrop, grab handle, ink
 * fill — so the explanation reads as the app speaking, not the OS. The OS
 * dialog itself follows Allow; the caller owns that call and the stored
 * "shown" flag (`rest-notify-priming.ts`), so this component is pure UI.
 *
 * Both buttons are 44 pt and carry a role; Not now is a real answer, not a
 * dismiss — the caller records it the same as Allow.
 */
export function RestNotifySheet({
  visible,
  onAllow,
  onNotNow,
}: {
  visible: boolean;
  onAllow: () => void;
  onNotNow: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <BottomSheet visible={visible} onClose={onNotNow} backdropTestID="rest-notify-backdrop">
      <View style={styles.wrap}>
        <Text style={styles.title} accessibilityRole="header">{t('train.restNotify.title')}</Text>
        <Text style={styles.body}>{t('train.restNotify.body')}</Text>
        <View style={styles.row}>
          <Touchable
            style={styles.quiet}
            onPress={onNotNow}
            accessibilityRole="button"
            testID="rest-notify-not-now"
          >
            <Text style={styles.quietText}>{t('train.restNotify.notNow')}</Text>
          </Touchable>
          <Touchable
            style={styles.go}
            onPress={() => {
              haptics.tap();
              onAllow();
            }}
            accessibilityRole="button"
            testID="rest-notify-allow"
          >
            <Text style={styles.goText}>{t('train.restNotify.allow')}</Text>
          </Touchable>
        </View>
      </View>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { gap: space.sm, paddingTop: space.xs },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  quiet: {
    flex: 1,
    minHeight: TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  quietText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  go: {
    flex: 1,
    minHeight: TARGET,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  goText: { fontSize: font.body, fontWeight: '700', color: colors.onInk },
});
