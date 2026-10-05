import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space, type } from '@/theme';

/**
 * The card a Body history row lifts into above its iOS context menu (re-score
 * 3, Platform) — the same move Today's diary rows, Train's templates and the
 * Trends charts make. A weigh-in shows its day, its weight and its change; a
 * tape row shows its day and every site it carries, one per line.
 *
 * UIKit asks for the preview's size BEFORE it renders (`previewSize`), so the
 * height is computed from what will be drawn (`rowPreviewHeight`) and the text
 * is capped at `PREVIEW_MAX_SCALE` — the same rule as `EntryPreview` on Today:
 * a box sized up front must not be outgrown by its own text.
 */

export const ROW_PREVIEW_WIDTH = 300;
const PREVIEW_MAX_SCALE = 1.3;

/** Padding, the caption, the optional big value and one line per `lines`
 *  entry, grown with the text scale up to the cap. Pure — tested. */
export function rowPreviewHeight(hasValue: boolean, lines: number, fontScale = 1): number {
  const scale = Math.min(Math.max(fontScale, 1), PREVIEW_MAX_SCALE);
  return Math.round((2 * space.xl + 20 + (hasValue ? 52 : 0) + lines * 24) * scale);
}

export function RowPreview({
  caption,
  value,
  unit,
  lines,
}: {
  /** The day, small, on top. */
  caption: string;
  /** The headline number, when the row has one (a weigh-in). */
  value?: string;
  unit?: string;
  lines: readonly string[];
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.preview}>
      <Text style={styles.caption} maxFontSizeMultiplier={PREVIEW_MAX_SCALE} numberOfLines={1}>
        {caption}
      </Text>
      {value ? (
        <Text style={styles.value} maxFontSizeMultiplier={PREVIEW_MAX_SCALE} numberOfLines={1}>
          {value}
          {unit ? <Text style={styles.unit}> {unit}</Text> : null}
        </Text>
      ) : null}
      {lines.map((line) => (
        <Text key={line} style={styles.line} maxFontSizeMultiplier={PREVIEW_MAX_SCALE} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    preview: { flex: 1, backgroundColor: colors.paper, padding: space.xl, gap: 2 },
    caption: { fontSize: font.small, color: colors.muted, fontWeight: '600', lineHeight: 20 },
    value: { fontFamily: type.display, fontSize: 40, color: colors.ink, lineHeight: 52 },
    unit: { fontFamily: type.heading, fontSize: font.h3, color: colors.muted },
    line: { fontSize: font.body, color: colors.ink, lineHeight: 22 },
  });
