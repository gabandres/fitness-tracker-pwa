import { renderHook } from '@testing-library/react-native';
import { Keyboard, type ScrollView, type View } from 'react-native';
import { useRevealAboveKeyboard } from '@/components/train/reveal-above-keyboard';

/**
 * The workout's set steppers open under the focused field, and the iOS
 * keyboard covered them (Impeccable audit, 2026-10-05). The reveal scrolls by
 * exactly the overlap with the keyboard's top, plus `space.sm` — and not at
 * all when nothing is covered.
 */

async function setup(keyboardTop: number | null) {
  jest.spyOn(Keyboard, 'metrics').mockReturnValue(
    keyboardTop == null ? undefined : { screenX: 0, screenY: keyboardTop, width: 390, height: 844 - keyboardTop },
  );
  const scrollTo = jest.fn();
  const scrollRef = { current: { scrollTo } as unknown as ScrollView };
  const { result } = await renderHook(() => useRevealAboveKeyboard(scrollRef));
  // The list is already scrolled 120 down.
  result.current.onScroll({ nativeEvent: { contentOffset: { y: 120 } } });
  const node = (y: number, h: number) =>
    ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, y, 390, h) }) as unknown as View;
  return { reveal: result.current.reveal, scrollTo, node };
}

afterEach(() => jest.restoreAllMocks());

it('scrolls a covered node up by its overlap with the keyboard', async () => {
  const { reveal, scrollTo, node } = await setup(500);
  reveal(node(480, 48)); // bottom 528 + 8 margin = 36 past the keyboard's top
  expect(scrollTo).toHaveBeenCalledWith({ y: 120 + 36, animated: true });
});

it('leaves a node the keyboard does not reach alone', async () => {
  const { reveal, scrollTo, node } = await setup(500);
  reveal(node(300, 48));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('does nothing with no keyboard up', async () => {
  const { reveal, scrollTo, node } = await setup(null);
  reveal(node(800, 48));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('the workout list pads for the iOS keyboard and hosts the reveal', () => {
  const { readFileSync } = jest.requireActual<typeof import('fs')>('fs');
  const { join } = jest.requireActual<typeof import('path')>('path');
  const src = readFileSync(join(__dirname, '..', 'components/train/ActiveSession.tsx'), 'utf8');
  expect(src).toMatch(/automaticallyAdjustKeyboardInsets/);
  expect(src).toMatch(/<RevealAboveKeyboardContext\.Provider value=\{keyboardReveal\.reveal\}>/);
  const row = readFileSync(join(__dirname, '..', 'components/train/SetRow.tsx'), 'utf8');
  expect(row).toMatch(/useKeepAboveKeyboard\(focused != null, stepRowRef\)/);
});
