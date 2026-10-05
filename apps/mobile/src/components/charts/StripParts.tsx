import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme-context';

/**
 * The two marks every fourteen-column habit strip draws, stated once.
 *
 * Both were drawn three times, once per card, and both failed non-text
 * contrast (WCAG 1.4.11, 3:1) in the review of 2026-10-04 — which is the
 * argument for one copy: the fix lands on all three strips or none.
 */

/**
 * "No reading this day" — a short DASHED line at the baseline in `lineStrong`.
 *
 * It was a 1px solid hairline in `line`, which measured 1.12:1 against the
 * card: present in the code and absent on the screen, so a gap read as a
 * missing column rather than as a stated absence. Dashed, so it can never be
 * mistaken for a very short bar. Three plain Views rather than an SVG line:
 * fourteen of these can sit in a strip, and a View costs nothing to draw.
 */
export function GapMarker() {
  const { colors } = useTheme();
  return (
    <View style={styles.gap} pointerEvents="none">
      <View style={[styles.dash, { backgroundColor: colors.lineStrong }]} />
      <View style={[styles.dash, { backgroundColor: colors.lineStrong }]} />
      <View style={[styles.dash, { backgroundColor: colors.lineStrong }]} />
    </View>
  );
}

/**
 * The user's own median, drawn ON TOP of the bars with a paper halo under it.
 *
 * `ink` at 55% opacity measured 1.22:1 over the fasting bars and 1.27:1 over
 * water — the line vanished exactly where it crossed a bar, which is the only
 * place it carries information ("do the tops hug the line?"). A 3px stripe of
 * the card colour under a full-strength 1px ink line separates it from any
 * bar colour in either theme.
 */
export function MedianLine({ bottomPct }: { bottomPct: number }) {
  const { colors } = useTheme();
  return (
    <View pointerEvents="none" style={[styles.median, { bottom: `${bottomPct}%` }]}>
      <View style={[styles.halo, { backgroundColor: colors.card }]} />
      <View style={[styles.ink, { backgroundColor: colors.ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { width: '100%', height: 2, flexDirection: 'row', justifyContent: 'space-between' },
  dash: { width: '24%', height: 2, borderRadius: 1 },
  // Centred on its fraction: the 3px halo straddles the 1px line.
  median: { position: 'absolute', left: 0, right: 0, height: 3, marginBottom: -1, justifyContent: 'center' },
  halo: { ...StyleSheet.absoluteFill, opacity: 0.9 },
  ink: { height: 1 },
});
