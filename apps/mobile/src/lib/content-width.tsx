import { type ReactNode } from 'react';
import { type ModalProps, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme-context';
import { CONTENT_MAX_WIDTH } from '@/theme';

/**
 * Keeps a screen's content clear of the screen's LEFT and RIGHT safe-area
 * insets, so no screen has to.
 *
 * On a phone in portrait both are 0 and this is a no-op. They are not 0 on an
 * iPhone Duo: closed, its cover display puts the status bar and camera in a
 * strip down the right side (84 pt, measured on the iOS 27.1 simulator), and
 * Apple's guidance is that opposite insets are never assumed equal. Every
 * screen here pads only top and bottom (`edges={['top']}` and friends), and
 * the floating tab bar, rest bar and toast pad by fixed margins, so each would
 * have needed its own left/right handling.
 *
 * Mounted per ROUTE (the root stack's `screenLayout`), not around the whole
 * navigator: the native header is the system's bar, and on the Duo the system
 * lays its buttons out down the status-bar strip — padding the navigator
 * narrowed the header too and pushed its back button to the wrong end.
 *
 * A native `SafeAreaView`, so it measures where IT sits rather than trusting
 * the window's insets — correct under a header, in a full-screen modal and in
 * a sheet alike. The nested `SafeAreaProvider` then measures the padded box,
 * so `useSafeAreaInsets()` below reports 0 left/right instead of insets
 * already applied, and `useSafeAreaFrame()` the width content actually has.
 * The padding is painted `paper`, so the canvas still runs to the glass.
 */
export function HorizontalSafeArea({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.fill, { backgroundColor: colors.paper }]}>
      <SafeAreaProvider style={styles.fill}>{children}</SafeAreaProvider>
    </SafeAreaView>
  );
}

/**
 * The extra side margin that centres a {@link CONTENT_MAX_WIDTH} column in the
 * space content has — 0 on any phone, positive on a wide window.
 *
 * For what cannot take `contentColumn` (an absolutely positioned bar is placed
 * by its `left`/`right`, and a `maxWidth` on it pins it to the left edge
 * rather than centring it): add this to the side insets instead.
 */
export function useColumnGutter(): number {
  const { width } = useSafeAreaFrame();
  return Math.max(0, Math.floor((width - CONTENT_MAX_WIDTH) / 2));
}

/**
 * Every orientation, for an RN `<Modal>`'s `supportedOrientations`. RN's
 * default is portrait alone, and a modal that disagrees with the window it is
 * presented over is the case an iPhone Duo creates: its inner display does not
 * honour the app's portrait lock. On every other iPhone iOS intersects this
 * with the app's own orientations (portrait, `app.json`), so it changes
 * nothing there.
 */
export const ALL_ORIENTATIONS: ModalProps['supportedOrientations'] = [
  'portrait',
  'portrait-upside-down',
  'landscape',
  'landscape-left',
  'landscape-right',
];

const styles = StyleSheet.create({ fill: { flex: 1 } });
