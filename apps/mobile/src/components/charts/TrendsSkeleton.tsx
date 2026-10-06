import { StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

/**
 * The shape Trends loads into (sim review 2026-10-06: the first load was a
 * lone spinner, then the whole page snapped in around it). The same rule as
 * `BodySkeleton` and `DaySkeleton`: each block stands where the hero, the
 * maintenance chart and the weekly panel will be, in the colours they will
 * have, so the data lands INTO the layout. Static — no shimmer, which is
 * motion a reduce-motion user would have to be exempted from.
 *
 * One element to a screen reader, announced as loading.
 */
export function TrendsSkeleton() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('a11y.loadingTrends')}
      testID="trends-skeleton"
    >
      <View style={styles.hero}>
        <View style={[styles.heroBar, styles.badge]} />
        <View style={[styles.heroBar, styles.heroValue]} />
        <View style={[styles.heroBar, styles.heroLine]} />
        <View style={[styles.heroBar, styles.chip]} />
      </View>
      <View style={styles.card}>
        <View style={[styles.bar, styles.barStrong, { width: '45%' }]} />
        <View style={[styles.bar, { width: '30%' }]} />
        <View style={styles.chart} />
      </View>
      <View style={styles.card}>
        <View style={[styles.bar, styles.barStrong, { width: '35%' }]} />
        <View style={styles.chartShort} />
      </View>
    </View>
  );
}

const createStyles = ({ colors, scheme }: Theme) =>
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
    heroBar: { backgroundColor: colors.heroTrack, borderRadius: radius.sm },
    badge: { width: 72, height: 18, borderRadius: radius.pill },
    heroValue: { width: 168, height: 52 },
    heroLine: { width: 200, height: 14 },
    chip: { width: 150, height: 28, borderRadius: radius.pill, marginTop: space.xs },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? `${colors.lineStrong}80` : colors.line,
      padding: space.lg,
      gap: space.sm,
    },
    bar: { height: 12, borderRadius: radius.sm, backgroundColor: colors.line },
    barStrong: { height: 16 },
    chart: { height: 150, borderRadius: radius.sm, backgroundColor: colors.inputBg, opacity: 0.6 },
    chartShort: { height: 96, borderRadius: radius.sm, backgroundColor: colors.inputBg, opacity: 0.6 },
  });
