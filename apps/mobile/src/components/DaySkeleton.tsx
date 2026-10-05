import { StyleSheet, View } from 'react-native';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

/**
 * The placeholder shapes a diary day loads into, shared by Today's cold start
 * and the History day (Today re-score 3, Visual 14). Each is the card or row it
 * stands in for, in the colours it will have — so the first real frame changes
 * content, not layout (review V5). The History day used to load on a bare
 * spinner, and stepping into a month not yet fetched flashed the whole screen
 * to it.
 *
 * Every piece is hidden from the reader: the caller owns the one "loading"
 * announcement (Today's hero skeleton, the History day's wrapper).
 */

/** DailyMetrics' three rows: a dot and two lines each. */
export function SkeletonMetricsCard() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.card} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.metric, i > 0 && styles.divider]}>
          <View style={styles.dot} />
          <View style={styles.lines}>
            <View style={[styles.bar, { width: 56 }]} />
            <View style={[styles.bar, styles.barStrong, { width: 96 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The History day's totals card: four figures over four labels. */
export function SkeletonTotals() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.totals} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.total}>
          <View style={[styles.bar, styles.barStrong, { width: 44 }]} />
          <View style={[styles.bar, { width: 36 }]} />
        </View>
      ))}
    </View>
  );
}

/** `count` diary rows: a label and a sub-line, the kcal on the right. */
export function SkeletonRows({ count = 2 }: { count?: number }) {
  const styles = useThemedStyles(createStyles);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.lines}>
            <View style={[styles.bar, styles.barStrong, { width: '55%' }]} />
            <View style={[styles.bar, { width: '35%' }]} />
          </View>
          <View style={[styles.bar, styles.barStrong, { width: 48 }]} />
        </View>
      ))}
    </>
  );
}

function createStyles({ colors }: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    metric: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
    divider: { borderTopWidth: 1, borderTopColor: colors.line },
    dot: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.line },
    lines: { flex: 1, gap: space.xs },
    bar: { height: 10, borderRadius: 5, backgroundColor: colors.line },
    barStrong: { height: 14, borderRadius: 7 },
    // The History day's `totals` card, padding for padding.
    totals: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.lg,
    },
    total: { flex: 1, alignItems: 'center', gap: space.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
  });
}
