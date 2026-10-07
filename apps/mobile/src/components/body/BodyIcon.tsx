import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';

/**
 * One icon, drawn in each platform's own vocabulary (Body review, P9).
 *
 * iOS gets the SF Symbol — the glyph set every system screen uses, so the
 * chevron, the trash can and the info circle match the rest of the phone in
 * weight and optical size, and they follow Dynamic Type's symbol scale.
 * Everywhere else gets the Ionicons glyph the app has always drawn.
 *
 * `expo-symbols` has been a dependency since the app was scaffolded
 * (2026-06-29), so every installed binary links it and this ships by OTA. A
 * symbol name the OS does not know renders the `fallback`, never a blank.
 *
 * Always decorative: the control around it carries the label (the
 * `a11y-labels` scan reads the control, not the glyph).
 */
export function BodyIcon({
  sf,
  ion,
  size,
  color,
}: {
  sf: Extract<ComponentProps<typeof SymbolView>['name'], string>;
  ion: ComponentProps<typeof Ionicons>['name'];
  size: number;
  color: string;
}) {
  // Hidden on Android too: an Ionicons glyph is a Text, and TalkBack read its
  // private-use character into the control's label (2026-10-06).
  const fallback = (
    <Ionicons name={ion} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
  );
  if (Platform.OS !== 'ios') return fallback;
  return (
    <SymbolView
      name={sf}
      size={size}
      tintColor={color}
      fallback={fallback}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
