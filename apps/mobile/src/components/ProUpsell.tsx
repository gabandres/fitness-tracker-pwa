import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Inline "this is a Pro feature" card. Shown in place of a gated surface for
 * free users; tapping routes to Settings where the Pro bundle + unlock live.
 * Coral-tinted so it reads as a soft nudge, not an error.
 */
export function ProUpsell({ feature }: { feature: string }) {
  const t = useT();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        haptics.tap();
        router.push('/settings');
      }}
      testID="pro-upsell"
    >
      <View style={styles.badge}>
        <Ionicons name="lock-closed" size={13} color={colors.white} />
        <Text style={styles.badgeText}>{t('pro.badge')}</Text>
      </View>
      <Text style={styles.title}>{feature}</Text>
      <Text style={styles.sub}>{t('pro.upsellSub')}</Text>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{t('pro.learnMore')}</Text>
        <Ionicons name="chevron-forward" size={15} color={colors.accent} />
      </View>
    </TouchableOpacity>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
    alignItems: 'flex-start',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: { color: colors.white, fontSize: font.tiny, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: font.body, fontWeight: '700', color: colors.ink, marginTop: space.xs },
  sub: { fontSize: font.small, color: colors.muted },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs },
  ctaText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
});
