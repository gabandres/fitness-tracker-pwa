import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ACCESSIBILITY_FONT_SCALE } from '@/lib/font-scale';
import { PressScale } from '@/lib/motion';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { NativeSegmentedControlView } from '../../../modules/native-segmented-control';

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
 *
 * **Native where it can be (2026-10-07).** On a binary that carries
 * `modules/native-segmented-control` it is the platform's own control — a
 * `UISegmentedControl` on iOS, Material 3 segmented buttons on Android — full
 * width, `TARGET` tall. The JS control above stays for three cases: a binary
 * without the module (an OTA reaching an older install, jest), a segment with
 * a `dot` (neither native control draws one beside a title), and accessibility
 * text sizes, where it wraps and the native controls truncate.
 */

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Spoken instead of `label` ("3 months" for "3M"). */
  a11yLabel?: string;
  /** Identity colour drawn as a small disc before the label. */
  dot?: string;
  testID?: string;
}

/** Whether this binary draws the platform's own segmented control. */
export const NATIVE_SEGMENTED_CONTROL = NativeSegmentedControlView != null;

export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
  tone = 'card',
  accessibilityLabel,
  maxFontSizeMultiplier,
  stretch = false,
  role = 'tab',
  disabled = false,
  haptic = true,
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
  /** What a screen reader calls it: `tab` swaps the card below (Trends,
   *  Body); `radio` sets a preference (Settings). */
  role?: 'tab' | 'radio';
  disabled?: boolean;
  /** Off when `onChange` plays its own (Settings' pickers do). */
  haptic?: boolean;
  testID?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const hero = tone === 'hero';
  const NativeView = NativeSegmentedControlView;
  if (NativeView && fontScale < ACCESSIBILITY_FONT_SCALE && !segments.some((s) => s.dot)) {
    const selectedIndex = Math.max(0, segments.findIndex((s) => s.key === value));
    return (
      <View style={styles.native} accessibilityLabel={accessibilityLabel} testID={testID}>
        <NativeView
          style={styles.nativeFill}
          segments={segments.map((s) => ({ label: s.label, a11yLabel: s.a11yLabel, testID: s.testID }))}
          selectedIndex={selectedIndex}
          enabled={!disabled}
          fontSize={font.small * Math.min(fontScale, maxFontSizeMultiplier ?? fontScale)}
          forceDark={hero}
          cornerRadius={radius.md}
          colors={
            hero
              ? { text: colors.heroMuted, selectedText: colors.heroPanel, selectedBackground: colors.heroText, border: colors.heroMuted }
              : { text: colors.muted, selectedText: colors.ink, selectedBackground: colors.tealSoft, border: colors.lineStrong }
          }
          onChange={(e) => {
            const next = segments[e.nativeEvent.index];
            if (!next || next.key === value) return;
            if (haptic) haptics.tap();
            onChange(next.key);
          }}
        />
      </View>
    );
  }
  return (
    <View
      style={[styles.well, hero && styles.wellHero, stretch && styles.wellStretch, disabled && styles.wellOff]}
      accessibilityRole={role === 'radio' ? 'radiogroup' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {segments.map((s) => {
        const on = s.key === value;
        return (
          <PressScale
            key={s.key}
            style={[styles.segment, stretch && styles.segmentStretch, on && (hero ? styles.segmentOnHero : styles.segmentOn)]}
            accessibilityRole={role}
            accessibilityState={disabled ? { selected: on, disabled } : { selected: on }}
            disabled={disabled || undefined}
            accessibilityLabel={s.a11yLabel}
            testID={s.testID}
            onPress={() => {
              if (on) return;
              if (haptic) haptics.tap();
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
    wellOff: { opacity: 0.5 },
    // The native control has no intrinsic width: it takes the whole line
    // (in a wrapping header row too — `alignSelf: 'stretch'` there means
    // height, and left it zero wide on Trends) and is a real target tall.
    native: { width: '100%', height: TARGET },
    nativeFill: { flex: 1 },
    // The transparent border keeps an unselected segment the same size as the
    // selected one, which carries a real one.
    segment: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: TARGET,
      minWidth: TARGET,
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
