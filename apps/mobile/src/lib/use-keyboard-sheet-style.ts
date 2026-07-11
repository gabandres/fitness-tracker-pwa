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
  const insets = useSafeAreaInsets();
  const { height, progress } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => {
    const nudge = Math.max(insets.bottom - space.sm, 0);
    const offset = interpolate(progress.value, [0, 1], [0, nudge]);
    return { transform: [{ translateY: height.value + offset }] };
  });
}
