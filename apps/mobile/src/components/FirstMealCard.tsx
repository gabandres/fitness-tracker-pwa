import { StyleSheet, Text, View } from 'react-native';
import { Touchable } from '@/components/Touchable';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * "Log your first meal" (2026-11-19). Production: only a third of signups ever
 * logged a food, and the median first log came 34 minutes in — Today did not
 * point at the one thing a new account has to do. This card does, directly
 * under the hero, for an account that has never logged (`showFirstMealCard` in
 * `lib/today-gate.ts`), and goes by itself once an entry exists.
 *
 * Its button is FILLED on purpose: for this state it is the screen's primary
 * action, and it opens the same add sheet the + button does.
 */
export function FirstMealCard({ onLog }: { onLog: () => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.card} testID="first-meal-card">
      <Text style={styles.title} accessibilityRole="header">
        {t('firstMeal.title')}
      </Text>
      <Text style={styles.body}>{t('firstMeal.body')}</Text>
      <Touchable
        style={styles.cta}
        onPress={() => {
          haptics.tap();
          onLog();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('firstMeal.cta')}
        testID="first-meal-log"
      >
        <Text style={styles.ctaText}>{t('firstMeal.cta')}</Text>
      </Touchable>
    </View>
  );
}

// The Today card shape (`RecalibrationCard`, `TargetChangeNotice`), so it reads
// as the same system.
const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.xs,
    },
    title: { fontSize: font.body, color: colors.ink, fontWeight: '800' },
    body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    cta: {
      alignSelf: 'flex-start',
      marginTop: space.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      minHeight: TARGET,
      justifyContent: 'center',
    },
    ctaText: { fontSize: font.small, fontWeight: '800', color: colors.onFill },
  });
