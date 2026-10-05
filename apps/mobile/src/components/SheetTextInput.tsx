import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { TextInput } from 'react-native';

type Props = ComponentProps<typeof TextInput>;

/**
 * `TextInput` for anything rendered inside a `BottomSheet native` — a drop-in
 * with the same props and ref.
 *
 * ## Why a sheet needs its own input
 *
 * A native sheet's content is rendered by the root `sheet` route from what its
 * owner PUBLISHED (`lib/sheet-portal.ts`), and the owner publishes in a layout
 * effect — one commit after its state changed. A controlled `TextInput` cannot
 * survive that lag. On each keystroke RN's TextInput updates its OWN state
 * (`lastNativeText`, `mostRecentEventCount`) in the keystroke's commit, while
 * its `value` prop is still the previous publish; its layout effect sees the
 * two disagree and sends the OLD text back to native with a CURRENT event
 * count, which native accepts. The keystroke is reverted, then restored a
 * commit later — and a key typed inside that window is lost or lands out of
 * order. Measured 2026-10-04 (Maestro 16, iOS 26): "QA Term Check" typed into
 * Add exercise was saved as "QA Term Chkc", and erase-then-retype garbled the
 * field four times out of four, while the Coach screen's input — an ordinary
 * screen, same typing — was clean four of four.
 *
 * So the value shown lives HERE, in the sheet route's tree, where it updates in
 * the same commit as the keystroke. The owner's `value` still wins whenever it
 * says something different: a reset or a sanitised value is adopted when the
 * prop changes, and a change the owner REJECTS (it returns without setting
 * state, so no new prop ever arrives) is reverted once the publish chain has
 * run — which is what a plain controlled input does too. Uncontrolled use
 * (`value` omitted) is passed straight through.
 */
export const SheetTextInput = forwardRef<TextInput, Props>(function SheetTextInput(
  { value, onChangeText, ...rest },
  ref,
) {
  const [text, setText] = useState(value);
  // Latest of each, for the deferred rejection check below.
  const propRef = useRef(value);
  propRef.current = value;
  const textRef = useRef(text);
  textRef.current = text;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The owner said something new (a reset, a prefill, a sanitised value).
  useLayoutEffect(() => {
    if (value !== undefined) setText(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = useCallback(
    (next: string) => {
      setText(next);
      onChangeText?.(next);
      // The owner's re-render, its publish and the route's re-render all flush
      // synchronously inside this event, so by the next macrotask the prop has
      // arrived if the owner accepted the text. If it still differs, the owner
      // rejected or rewrote it without a state change — show what it holds.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const held = propRef.current;
        if (held !== undefined && held !== textRef.current) setText(held);
      }, 0);
    },
    [onChangeText],
  );

  if (value === undefined) return <TextInput ref={ref} onChangeText={onChangeText} {...rest} />;
  return <TextInput ref={ref} value={text} onChangeText={onChange} {...rest} />;
});
