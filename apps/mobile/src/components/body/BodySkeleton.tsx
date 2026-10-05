import { StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

/**
 * The shape of Body before its numbers arrive (Body review, Pf4).
 *
 * A cold open with nothing on disk used to show a lone spinner in the middle
 * of the screen, and then the whole layout snapped in around where it had
 * been. These blocks stand where the hero, the button and the first rows will
 * be, so the data lands INTO the layout instead of replacing it. Static on
 * purpose — no shimmer: a pulse is motion a reduce-motion user would have to
 * be exempted from, and the wait it decorates is usually under a second.
 *
 * Only reachable on a true cold start: `useCachedState` paints the last
 * session from disk otherwise.
 */
export function BodySkeleton() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('body.loading')}
      testID="body-skeleton"
    >
      <View style={styles.hero}>
        <View style={[styles.bar, styles.barHero]} />
        <View style={[styles.bar, styles.barCaption]} />
        <View style={styles.chart} />
      </View>
      <View style={styles.button} />
      <View style={styles.row} />
      <View style={styles.row} />
      <View style={styles.row} />
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    wrap: { padding: space.xl, gap: space.md },
    hero: {
      backgroundColor: colors.heroPanel,
      borderRadius: radius.xl,
      paddingVertical: space.xl,
      paddingHorizontal: space.lg,
      alignItems: 'center',
      gap: space.sm,
    },
    bar: { backgroundColor: colors.heroTrack, borderRadius: radius.sm },
    barHero: { width: 160, height: 56 },
    barCaption: { width: 120, height: 14 },
    chart: { alignSelf: 'stretch', height: 140, backgroundColor: colors.heroTrack, borderRadius: radius.md, opacity: 0.5 },
    button: { height: 56, borderRadius: radius.md, backgroundColor: colors.inputBg, marginTop: space.md },
    row: { height: 52, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  });
