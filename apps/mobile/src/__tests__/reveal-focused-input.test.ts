import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, Platform, TextInput } from 'react-native';
import { inputInside, revealTarget, useRevealFocusedInput } from '@/lib/use-reveal-focused-input';

/**
 * Regression 18 (iOS 26, 2026-10-12): focusing row 1 of the template editor's
 * set table scrolled it UNDER the sheet's Cancel / Save header, and the next
 * tap hit the header. The reveal now reads the offset off the same layout as
 * the input and never moves an input past the ScrollView's top edge.
 */

const base = { offset: 200, viewTop: 130, viewBottom: 500, keyboardTop: 520, margin: 12 };

describe('revealTarget', () => {
  it('scrolls a field under the keyboard up by its overlap', () => {
    // bottom 520 + 12 margin − visible bottom 500 = 32
    expect(revealTarget({ ...base, inputTop: 476, inputBottom: 520 })).toBe(232);
  });

  it('leaves a field already in the visible band alone', () => {
    expect(revealTarget({ ...base, inputTop: 300, inputBottom: 344 })).toBeNull();
  });

  it('never scrolls a field above the top edge — the top wins when the band is short', () => {
    // A field 40 below the top edge but needing 100 to clear the keyboard:
    // it moves only 28 (to top + margin), never under the header.
    expect(revealTarget({ ...base, keyboardTop: 300, inputTop: 170, inputBottom: 388 })).toBe(228);
  });

  it('brings a field clipped by the top edge back down below it', () => {
    expect(revealTarget({ ...base, inputTop: 110, inputBottom: 154 })).toBe(168);
  });

  it('ignores a field wholly above the ScrollView (the sheet’s own fields)', () => {
    expect(revealTarget({ ...base, inputTop: 60, inputBottom: 104 })).toBeNull();
  });

  it('brings back a field WHOLLY under the top edge when it is known to be inside (E-N9)', () => {
    // Row 1 pushed entirely under the header (bottom 104 < top 130): 200 − (142 − 60).
    expect(revealTarget({ ...base, inputTop: 60, inputBottom: 104, inside: true })).toBe(118);
    expect(revealTarget({ ...base, inputTop: 60, inputBottom: 104, inside: false })).toBeNull();
  });

  it('never targets a negative offset', () => {
    expect(revealTarget({ ...base, offset: 10, inputTop: 100, inputBottom: 144 })).toBe(0);
  });
});

describe('inputInside (E-N9)', () => {
  const m = { inputTop: 60, inputBottom: 104, viewTop: 130, contentTop: -70 };
  it('keeps the old rule: a field still reaching below the top edge is inside', () => {
    expect(inputInside({ contains: () => false }, {}, { ...m, inputTop: 110, inputBottom: 154 })).toBe(true);
  });
  it('a field wholly above the edge: ancestry decides where the host has it', () => {
    const input = {};
    expect(inputInside({ contains: (x: unknown) => x === input }, input, m)).toBe(true);
    expect(inputInside({ contains: () => false }, input, m)).toBe(false);
  });
  it('…else its top against the content top', () => {
    expect(inputInside({}, {}, m)).toBe(true);
    expect(inputInside({}, {}, { ...m, contentTop: 80 })).toBe(false);
  });
});

describe('useRevealFocusedInput', () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
    jest.restoreAllMocks();
  });

  const box = (y: number, h: number) => ({
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, y, 390, h),
  });

  async function run(platform: 'ios' | 'android', inputY: number, jsOffset: number) {
    Platform.OS = platform;
    const on = new Map<string, (e?: { endCoordinates: { screenY: number } }) => void>();
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((evt: string, cb: never) => {
      on.set(evt, cb);
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const input = { y: inputY };
    jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue({
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, input.y, 390, 44),
    } as never);
    const scrollTo = jest.fn();
    // The ScrollView: top 130, 370 tall (it ends at 500, above the keyboard).
    const scrollRef = { current: { scrollTo, ...box(130, 370) } };
    const { result } = await renderHook(() => useRevealFocusedInput(scrollRef));
    // The layout's real offset is 300 (the content top sits at 130 − 300);
    // the throttled onScroll stream may say otherwise.
    (result.current.contentTopRef as { current: unknown }).current = box(-170, 0);
    result.current.onScroll({ nativeEvent: { contentOffset: { y: jsOffset } } } as never);
    await act(async () => on.get('keyboardDidShow')?.({ endCoordinates: { screenY: 520 } }));
    return { scrollTo, input, hide: () => act(async () => on.get('keyboardDidHide')?.()), hasHide: on.has('keyboardDidHide') };
  }

  it('iOS: a row well above the keyboard is not scrolled, whatever onScroll last said', async () => {
    const { scrollTo } = await run('ios', 200, 0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('iOS: a covered row scrolls from the LAYOUT offset, not a stale onScroll one', async () => {
    // bottom 504 + 12 − 500 = 16 → 300 + 16, though onScroll last said 0.
    const { scrollTo } = await run('ios', 460, 0);
    expect(scrollTo).toHaveBeenCalledWith({ y: 316, animated: true });
  });

  it('iOS: when the keyboard leaves, the field just edited is put back below the top edge if it rose under it', async () => {
    const { scrollTo, input, hide } = await run('ios', 200, 0);
    // The content moved as the keyboard went: the field's top is now 20pt
    // above the ScrollView's top (130) — under the sheet's header.
    input.y = 110;
    await hide();
    // 300 − (142 − 110) = 268: top edge + margin.
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 268, animated: true });
  });

  it('iOS: a row the system scrolled ENTIRELY under the header is brought back (E-N9)', async () => {
    // Input 70–114 against a ScrollView top of 130; content top −170 → inside.
    const { scrollTo } = await run('ios', 70, 0);
    // 300 + (70 − 142) = 228.
    expect(scrollTo).toHaveBeenCalledWith({ y: 228, animated: true });
  });

  it('Android: a row wholly above the top edge is still left alone (HEAD)', async () => {
    const { scrollTo } = await run('android', 70, 40);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('Android: unchanged — scrolls by the overlap from the onScroll offset', async () => {
    const { scrollTo, hasHide } = await run('android', 460, 40);
    expect(scrollTo).toHaveBeenCalledWith({ y: 40 + 16, animated: true });
    expect(hasHide).toBe(false);
  });
});
