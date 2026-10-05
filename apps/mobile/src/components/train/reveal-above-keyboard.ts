import { createContext, useCallback, useContext, useEffect, useRef, type RefObject } from 'react';
import { Keyboard, Platform, type ScrollView, type View } from 'react-native';
import { space } from '@/theme';

/**
 * Keeps something that appears UNDER a focused field — a set row's ± steppers
 * — above the iOS keyboard.
 *
 * The workout ScrollView's `automaticallyAdjustKeyboardInsets` scrolls the
 * focused TextInput above the keyboard, and only that: the steppers that open
 * beneath it stayed cut off at the keyboard's edge. RN's own
 * `scrollResponderScrollNativeHandleToKeyboard` would do this, but it assumes
 * the ScrollView starts at the top of the screen, and the workout's sits under
 * a header — it over-scrolls by the header's height. So: measure the node in
 * window coordinates, compare with the keyboard's top, scroll by the overlap.
 */
export type RevealAboveKeyboard = (node: View | null) => void;

export const RevealAboveKeyboardContext = createContext<RevealAboveKeyboard | null>(null);

/** For the screen that owns the ScrollView: its `onScroll` and the reveal. */
export function useRevealAboveKeyboard(scrollRef: RefObject<ScrollView | null>) {
  const offsetY = useRef(0);
  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
  }, []);
  const reveal = useCallback<RevealAboveKeyboard>(
    (node) => {
      const kb = Keyboard.metrics();
      if (!node || !kb) return;
      node.measureInWindow((_x, y, _w, h) => {
        const overlap = y + h + space.sm - kb.screenY;
        if (overlap > 0) scrollRef.current?.scrollTo({ y: offsetY.current + overlap, animated: true });
      });
    },
    [scrollRef],
  );
  return { onScroll, reveal };
}

/**
 * For the row: while `active`, reveal `ref`'s node once the keyboard is up —
 * on `keyboardDidShow` for a fresh keyboard, and straight away when focus moves
 * between fields with the keyboard already up (no show event then). iOS only:
 * Android resizes the window for the keyboard instead.
 */
export function useKeepAboveKeyboard(active: boolean, ref: RefObject<View | null>) {
  const reveal = useContext(RevealAboveKeyboardContext);
  useEffect(() => {
    if (!active || !reveal || Platform.OS !== 'ios') return;
    const run = () => reveal(ref.current);
    const sub = Keyboard.addListener('keyboardDidShow', run);
    const t = setTimeout(run, 50);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [active, reveal, ref]);
}
