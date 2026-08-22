import { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '@/theme';

/**
 * Bottom-sheet keyboard handling.
 *
 * ## The rule, learned the expensive way
 *
 * **A bottom sheet's BACKGROUND runs to the bottom of the screen. Only its
 * CONTENT moves.** That is how a native `UISheetPresentationController`
 * behaves, and it is the reason the sheets here kept looking wrong on iOS:
 * they translated the whole sheet up by the keyboard height, so whatever the
 * keyboard frame did not cover showed the page behind it.
 *
 * On iOS 26 that is guaranteed to be visible. A `number-pad` has no return
 * key, so the system floats its own "Done" pill in a band above the keypad —
 * and that band is inside the keyboard frame every API reports, and it is
 * transparent. A lifted sheet sits correctly on top of the whole frame and
 * leaves the band showing the page: read as "the sheet is detached from the
 * keyboard". No amount of arithmetic closes it, because nothing measurable
 * separates the band from the keypad. Four attempts proved that — three at the
 * offset and one with the keyboard library's own `KeyboardAvoidingView`, which
 * placed it in exactly the same spot for exactly the same correct reason.
 *
 * Grow the padding instead of moving the sheet and the band is simply sheet,
 * rounded at the top, continuous down to the screen edge — which is what
 * Android already looked like, because its keypad fills the whole frame.
 *
 * Android is unaffected by the change in kind: the same expression collapses
 * to the same result there, since its frame has no transparent band.
 */

/**
 * Animated `paddingBottom` for a bottom sheet whose background reaches the
 * screen edge.
 *
 * At rest it is `rest + insets.bottom` — a sheet lives inside a `Modal`, which
 * fills the physical screen and ignores safe-area insets, so without that the
 * last row sits under the software navigation bar (48dp on the LG VS988, which
 * clipped Save and made it miss taps).
 *
 * With the keyboard open it is `open + keyboardHeight`. The inset term drops
 * out because the keyboard is drawn over the very bar it was reserving room
 * for, and `open` is deliberately tighter than `rest`: the keyboard frame
 * already contributes its own dead band on iOS, so a generous gap on top of it
 * reads as sloppy rather than airy.
 *
 * @param rest padding below the last row when no keyboard is showing
 * @param open padding between the last row and the top of the keyboard frame
 */
export function useKeyboardSheetPadding(rest: number, open: number = space.sm) {
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => {
    // `height` is 0 closed and negative while the keyboard is open.
    const keyboard = -height.value;
    return keyboard > 0
      ? { paddingBottom: open + keyboard }
      : { paddingBottom: rest + insets.bottom };
  });
}

/**
 * @deprecated Translates a whole sheet by the keyboard height. Correct on
 * Android and wrong on iOS for the reason in the module comment — it drags the
 * sheet's background up with its content and exposes the page beneath.
 * `DailyMetrics` has moved to {@link useKeyboardSheetPadding}; the Train sheets
 * and `BottomSheet` still use this and should follow.
 */
export function useKeyboardSheetStyle() {
  const insets = useSafeAreaInsets();
  const { height, progress } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => {
    const nudge = Math.max(insets.bottom - space.sm, 0);
    const offset = interpolate(progress.value, [0, 1], [0, nudge]);
    return { transform: [{ translateY: height.value + offset }] };
  });
}
