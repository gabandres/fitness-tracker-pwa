import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  type MeasureInWindowOnSuccessCallback,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { space } from '@/theme';

/** A ScrollView, plain or Reanimated (`useAnimatedRef`). Its ref is the host
 *  instance, which measures like any view; RN's class type omits that. */
type Scrollable = { scrollTo(o: { y: number; animated?: boolean }): void };
type Measurable = { measureInWindow(cb: MeasureInWindowOnSuccessCallback): void };

/**
 * Android: once the keyboard is up, scroll the focused input above it.
 *
 * Under `<KeyboardProvider>` Android does not resize the window for the IME
 * (UX_AUDIT S22). A sheet grows its own bottom padding by the keyboard's
 * height instead (`useKeyboardSheetPadding`), which shrinks the ScrollView in
 * it — but RN scrolls a field into view on FOCUS, before the keyboard has
 * arrived, so a field near the bottom (the template editor's last set) ends up
 * under the keyboard with nothing to bring it back. iOS has
 * `automaticallyAdjustKeyboardInsets` and the native sheets for this.
 *
 * Measures in window coordinates, like `train/reveal-above-keyboard.ts`, and
 * scrolls by the overlap with the lower of the keyboard's top and the
 * ScrollView's own bottom edge. Ignores an input above the ScrollView's top
 * (the sheet's name field outside it). Returns the `onScroll` to hand the
 * ScrollView (with a `scrollEventThrottle`) — the scroll is relative to its
 * offset.
 */
export function useRevealFocusedInput(scrollRef: RefObject<Scrollable | null>) {
  const offsetY = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      const kbTop = e.endCoordinates.screenY;
      // A frame for the sheet's padding to land: it animates with the
      // keyboard, and the ScrollView's last layout trails it by one.
      requestAnimationFrame(() => {
        const input = TextInput.State.currentlyFocusedInput();
        const scroller = scrollRef.current;
        if (!input || !scroller) return;
        (scroller as unknown as Measurable).measureInWindow((_sx, sy, _sw, sh) => {
          input.measureInWindow((_x, y, _w, h) => {
            if (y < sy) return;
            const overlap = y + h + space.md - Math.min(kbTop, sy + sh);
            if (overlap > 0) scroller.scrollTo({ y: offsetY.current + overlap, animated: true });
          });
        });
      });
    });
    return () => sub.remove();
  }, [scrollRef]);
  return onScroll;
}
