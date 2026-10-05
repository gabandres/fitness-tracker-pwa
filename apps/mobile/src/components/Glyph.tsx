import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

/**
 * An icon that is the platform's own: an SF Symbol on iOS, Ionicons elsewhere
 * (V5). The add sheet's in-field barcode / camera doors and its "More ways"
 * menu drew Ionicons outlines beside system text, a half-step off in weight
 * and optical size from everything iOS draws around them; a symbol matches
 * the system font by construction.
 *
 * `expo-symbols` has been in the binary since the app was scaffolded, so this
 * needs no build. The Ionicons glyph is also the iOS fallback — `SymbolView`
 * renders it when the native view or the symbol name is unavailable.
 */
export function Glyph({
  sf,
  ion,
  size,
  color,
}: {
  sf: SFSymbol;
  ion: ComponentProps<typeof Ionicons>['name'];
  size: number;
  color: string;
}) {
  const fallback = <Ionicons name={ion} size={size} color={color} />;
  if (Platform.OS !== 'ios') return fallback;
  return <SymbolView name={sf} size={size} tintColor={color} weight="medium" fallback={fallback} />;
}
