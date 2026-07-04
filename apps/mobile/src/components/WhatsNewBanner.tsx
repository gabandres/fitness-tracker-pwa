import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { WHATS_NEW_VERSION, getWhatsNewSeen, markWhatsNewSeen } from '@/lib/whatsNew';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** One-time "what's new" card on Today. Shows until dismissed, then the seen
 *  version is stored (AsyncStorage) so it stays hidden until WHATS_NEW_VERSION
 *  is bumped. Renders nothing while loading or once dismissed. */
export function WhatsNewBanner() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let alive = true;
    getWhatsNewSeen().then((seen) => {
      if (alive) setShow(seen !== WHATS_NEW_VERSION);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  return (
    <View style={styles.card} testID="whats-new">
      <View style={styles.left}>
        <View style={styles.dot} />
        <View style={styles.textCol}>
          <Text style={styles.title}>{t('whatsNew.title')}</Text>
          <Text style={styles.body}>{t('whatsNew.body')}</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => {
          haptics.tap();
          setShow(false);
          void markWhatsNewSeen();
        }}
        hitSlop={10}
        testID="whats-new-dismiss"
      >
        <Ionicons name="close" size={20} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  left: { flexDirection: 'row', gap: space.md, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 5 },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: font.small, color: colors.ink, fontWeight: '800' },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
});
