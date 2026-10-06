import { Platform, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * The one segmented control Trends and Body use (sim review 2026-10-06).
 *
 * Four controls on two screens had four looks — 1M/3M as pills, Protein/Carbs/
 * Fat as the same pills in another row, the weekly panel as a boxed strip, and
 * Body's range as bordered chips on the hero — and two semantics: tabs on
 * Trends, radios on Body. One switch between views of the same card is one
 * control, so it is drawn once, here:
 *
 * - **A well with segments in it**; the selected one is raised (a filled face
 *   plus a `lineStrong` edge — in dark mode `card` and `inputBg` are the SAME
 *   colour, so the fill alone measured 1.00:1 and the border is the cue).
 * - **Tablist / tab with `selected`** to a screen reader, everywhere — "tab,
 *   2 of 3, selected" — because every one of these swaps what the card below
 *   shows, which is what a tab is.
 * - **A real 44 pt (iOS) / 48 dp (Android) segment**, not a 32 pt face with
 *   slop: the review measured Body's at 32.
 * - **`tone="hero"`** for the dark hero panel (dark in both themes, ADR-0014):
 *   the well is `heroTrack`, the selected face `heroText` with `heroPanel`
 *   text.
 *
 * A segment may carry an identity `dot` (the habit hues) — colour as identity,
 * never as state: it keeps its hue whether or not the segment is selected.
 */

/** The platform touch floor: Apple HIG 44 pt, Material 48 dp. */
export const TOUCH_TARGET = Platform.OS === 'android' ? 48 : 44;

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Spoken instead of `label` ("3 months" for "3M"). */
  a11yLabel?: string;
  /** Identity colour drawn as a small disc before the label. */
  dot?: string;
  testID?: string;
}

export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
  tone = 'card',
  accessibilityLabel,
  maxFontSizeMultiplier,
  stretch = false,
  testID,
}: {
  segments: readonly Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  tone?: 'card' | 'hero';
  /** Names the group ("Chart range"). */
  accessibilityLabel?: string;
  /** Range labels are glyph-like ("1M") and cap; word labels can scale. */
  maxFontSizeMultiplier?: number;
  /** Fill the row, segments sharing it equally, instead of sizing to content. */
  stretch?: boolean;
  testID?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const hero = tone === 'hero';
  return (
    <View
      style={[styles.well, hero && styles.wellHero, stretch && styles.wellStretch]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {segments.map((s) => {
        const on = s.key === value;
        return (
          <PressScale
            key={s.key}
            style={[styles.segment, stretch && styles.segmentStretch, on && (hero ? styles.segmentOnHero : styles.segmentOn)]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={s.a11yLabel}
            testID={s.testID}
            onPress={() => {
              if (on) return;
              haptics.tap();
              onChange(s.key);
            }}
          >
            {s.dot ? <View style={[styles.dot, { backgroundColor: s.dot }]} /> : null}
            <Text
              style={[styles.text, hero && styles.textHero, on && (hero ? styles.textOnHero : styles.textOn)]}
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          </PressScale>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    // Sized to content and wrapping at large text sizes rather than running
    // off the screen.
    well: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignSelf: 'flex-start',
      gap: 2,
      padding: 2,
      borderRadius: radius.md,
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.line,
    },
    // heroTrack on heroPanel is 1.29:1 — the edge is what shows the well.
    wellHero: { backgroundColor: colors.heroTrack, borderColor: colors.heroTrack, alignSelf: 'center' },
    wellStretch: { alignSelf: 'stretch', flexWrap: 'nowrap' },
    // The transparent border keeps an unselected segment the same size as the
    // selected one, which carries a real one.
    segment: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: TOUCH_TARGET,
      minWidth: TOUCH_TARGET,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    segmentStretch: { flex: 1, paddingHorizontal: space.xs },
    segmentOn: { backgroundColor: colors.card, borderColor: colors.lineStrong },
    segmentOnHero: { backgroundColor: colors.heroText, borderColor: colors.heroText },
    dot: { width: 7, height: 7, borderRadius: radius.pill },
    text: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    textHero: { color: colors.heroMuted, fontWeight: '700' },
    textOn: { color: colors.ink, fontWeight: '700' },
    textOnHero: { color: colors.heroPanel },
  });
