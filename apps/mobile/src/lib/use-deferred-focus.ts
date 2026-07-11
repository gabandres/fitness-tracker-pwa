import { useEffect, useRef } from 'react';
import type { TextInput } from 'react-native';

/**
 * A TextInput ref that focuses shortly AFTER a sheet opens, instead of
 * `autoFocus`. autoFocus fires the keyboard on the same frames the sheet is
 * springing up AND the keyboard-height paddingBottom is re-laying-out — three
 * animations colliding, which reads as lag/jank on open. Deferring the focus
 * past the spring settle lets the sheet land first, then the keyboard slides up
 * cleanly (the native-feeling sequence).
 *
 * Usage: `const ref = useDeferredFocus(visible); <TextInput ref={ref} … />`
 * (drop `autoFocus`).
 */
export function useDeferredFocus(visible: boolean, delayMs = 300) {
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => ref.current?.focus(), delayMs);
    return () => clearTimeout(timer);
  }, [visible, delayMs]);
  return ref;
}
