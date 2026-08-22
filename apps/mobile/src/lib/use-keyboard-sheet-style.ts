import { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '@/theme';

/**
 * The animated style that lifts a bottom sheet in lock-step with the keyboard.
 * Apply it to a `Reanimated.View` that wraps the sheet (the sheet stays anchored
 * at the screen bottom; this translates the whole thing up as the keyboard
 * rises). Frame-perfect via react-native-keyboard-controller — the one approach
 * that was smooth (see feedback_mobile_modal_keyboard).
 *
 * `height` is already negative while the keyboard is open, so it feeds straight
 * into translateY. The reported height reaches the physical screen bottom, so
 * lifting by the full amount overshoots the keyboard's visible top by the bottom
 * safe-area (home indicator); we nudge back down by that inset (minus a hair so
 * a primary button never clips), ramped by `progress` so the resting position is
 * untouched. On devices with no home indicator the inset is 0 → no nudge.
 */
export function useKeyboardSheetStyle() {
  const { height } = useReanimatedKeyboardAnimation();
  // `height` already reaches the keyboard's visible top, so the sheet's bottom
  // edge lands exactly on it. There used to be a downward "nudge" of
  // `insets.bottom - space.sm` here, on the theory that lifting by the full
  // amount overshoots by the home indicator. MEASURED ON DEVICE 2026-08-22:
  // it does not. The nudge simply parked the sheet that far BELOW the keyboard
  // — which is the gap reported on iOS — and on the LG G6, whose 48dp nav-bar
  // inset makes the nudge 40dp, it drove the Save button behind the keyboard
  // the moment the compensating padding was removed. Sheet bottom == keyboard
  // top; clearance for the primary button is the sheet's own padding, which is
  // one job in one place.
  return useAnimatedStyle(() => ({ transform: [{ translateY: height.value }] }));
}

/**
 * The sheet's own bottom padding, animated so it collapses as the keyboard
 * rises.
 *
 * A bottom sheet renders inside a `Modal`, which fills the physical screen and
 * ignores safe-area insets, so the resting padding has to carry
 * `insets.bottom` itself or the last row sits under the software navigation
 * bar (48dp on the LG VS988 — that clipped Save and made it miss taps).
 *
 * **But that inset is dead space the moment the keyboard opens**, because the
 * keyboard is drawn over the home indicator / nav bar it was reserving room
 * for. Adding it anyway leaves a visible band of empty sheet between the
 * primary button and the keyboard — reported on iOS as the sheet looking
 * "detached" from the keyboard, which is exactly what it is. So it ramps out
 * on `progress`, in lock-step with the lift above, and the resting position is
 * untouched.
 *
 * @param base padding that always applies, keyboard or not
 */
export function useKeyboardSheetPadding(base: number) {
  const insets = useSafeAreaInsets();
  const { progress } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({
    paddingBottom: base + interpolate(progress.value, [0, 1], [insets.bottom, 0]),
  }));
}
