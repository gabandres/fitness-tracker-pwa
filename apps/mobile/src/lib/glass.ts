import { Platform } from 'react-native';
import { FAB_BAND } from '@/theme';

/**
 * Whether this phone draws iOS 26 Liquid Glass. `expo-glass-effect` is in
 * every binary since the scaffold (and in 1.2.5's), so this is a runtime
 * question — the OS version — not a build one. Guarded: a module that throws
 * on an older runtime must cost the tab bar its glass, never the app.
 */
function liquidGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    // Required lazily so jest and Android never load the native module.
    const { isLiquidGlassAvailable } = require('expo-glass-effect') as typeof import('expo-glass-effect');
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

/** The tab bar floats as a Liquid Glass capsule over the content (owner-
 *  approved 2026-10-05). Elsewhere it is the opaque bar under the content. */
export const GLASS_TAB_BAR = liquidGlass();

/**
 * How far a tab's scroll content must stop short of the screen's bottom edge.
 *
 * `FAB_BAND` clears the raised + over an opaque bar that sat BELOW the content.
 * A floating glass bar sits OVER it, so the content now runs to the screen's
 * edge and must also clear the capsule and the home indicator (64 + ~34 pt).
 * One constant, used by every tab, for the same reason `FAB_BAND` is one.
 */
export const TAB_SCROLL_BAND = FAB_BAND + (GLASS_TAB_BAR ? 100 : 0);
