import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

/**
 * An SF Symbol on iOS, the Ionicons glyph everywhere else.
 *
 * `expo-symbols` has been a dependency since the scaffold (so it is linked in
 * every shipped binary and this is OTA-safe), but nothing used it: Trends drew
 * Ionicons' approximation of `questionmark.circle` next to system chrome that
 * draws the real one. Android keeps Ionicons on purpose — Material symbols are
 * a different drawing and the app's Android chrome is Ionicons throughout.
 *
 * Decorative by default: every call site sits inside a control that carries
 * its own label.
 */
export function Glyph({
  ios,
  android,
  size,
  color,
}: {
  ios: SFSymbol;
  android: keyof typeof Ionicons.glyphMap;
  size: number;
  color: string;
}) {
  if (Platform.OS !== 'ios') {
    // Hidden on Android too: an Ionicons glyph is a Text, and TalkBack read its
    // private-use character into the control's label (2026-10-06).
    return (
      <Ionicons name={android} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    );
  }
  // No `fallback` prop: every name passed here exists in SF Symbols 1 (iOS 13),
  // so it could never render — and a React element held as a native prop
  // makes the rendered tree circular, which breaks any test that serialises it.
  return (
    <SymbolView name={ios} size={size} tintColor={color} accessibilityElementsHidden importantForAccessibility="no" />
  );
}
