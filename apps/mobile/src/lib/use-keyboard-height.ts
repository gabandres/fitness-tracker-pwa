import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * The current on-screen keyboard height (0 when hidden). Anchor a bottom sheet
 * at the screen bottom and set its `paddingBottom` to this value: the sheet
 * fills behind the keyboard while only its content lifts above it — smooth and
 * cutout-free. This is the pattern the meal EntrySheet proved; a
 * `KeyboardAvoidingView behavior="padding"` wrapper stutters and leaves a grey
 * gap between the sheet and the keyboard (and under-lifts inside a Modal).
 *
 * iOS uses the `will` events (they fire with the keyboard's own animation
 * curve, so content tracks it); Android only emits `did`.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
