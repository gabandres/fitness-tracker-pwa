import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Keyboard,
  Platform,
  TextInput,
  type MeasureInWindowOnSuccessCallback,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View,
  type ViewInstance,
} from 'react-native';
import { space } from '@/theme';

/** A ScrollView, plain or Reanimated (`useAnimatedRef`). Its ref is the host
 *  instance, which measures like any view; RN's class type omits that. */
type Scrollable = { scrollTo(o: { y: number; animated?: boolean }): void };
type Measurable = { measureInWindow(cb: MeasureInWindowOnSuccessCallback): void };
/** A Fabric host instance's DOM-style ancestry check (RN's `ReadOnlyNode`),
 *  where the runtime has it. */
type MaybeNode = { contains?: (other: unknown) => boolean };

/**
 * Is `input` inside `scroller`'s content? Only ever WIDENS the old rule: a
 * field still reaching below the top edge counts as inside, as it always did.
 * One wholly above it is inside when ancestry says so (where the host
 * instance offers it), else when its top is at or below the content's top
 * (the zero-height marker first in the content). That fallback would misread
 * a field ABOVE the ScrollView once scrolled past it — the template editor,
 * the one host, has none (its header holds buttons only).
 */
export function inputInside(
  scroller: unknown,
  input: unknown,
  m: { inputTop: number; inputBottom: number; viewTop: number; contentTop: number },
): boolean {
  if (m.inputBottom > m.viewTop) return true;
  const contains = (scroller as MaybeNode | null)?.contains;
  return typeof contains === 'function' ? contains.call(scroller, input) === true : m.inputTop >= m.contentTop;
}

/** One measurement pass, all in the same (window) coordinates. */
export type RevealMeasure = {
  /** The ScrollView's current content offset. */
  offset: number;
  /** The ScrollView's visible frame: its top and bottom edges. */
  viewTop: number;
  viewBottom: number;
  /** The keyboard's top edge. */
  keyboardTop: number;
  /** The focused input's top and bottom edges. */
  inputTop: number;
  inputBottom: number;
  /** Room to leave between the input and either edge. */
  margin: number;
  /** Whether the input is IN this ScrollView's content, when the caller
   *  knows (ancestry, or its position against the content's top). Unknown →
   *  geometry alone: an input wholly above the top edge is taken as outside. */
  inside?: boolean;
};

/**
 * The content offset that shows the input whole between the ScrollView's top
 * edge and the lower of its bottom edge and the keyboard's top — or `null` to
 * leave it where it is.
 *
 * It never scrolls an input ABOVE the top edge: the editor's Cancel / Save
 * header sits right over that edge, and an over-scroll put row 1 under it,
 * where the next tap hit the header (regression 18, iOS 26, 2026-10-12). When
 * the visible band is shorter than the input, the input's TOP wins.
 *
 * An input outside this ScrollView is left alone. Without `inside`, "wholly
 * above the top edge" is read as outside — which also left a field the
 * system had scrolled ENTIRELY under the header there (the reg-18 bug, one
 * row higher; train-ux E-N9). With `inside: true` such a field is brought
 * back below the edge like a partly clipped one.
 */
export function revealTarget(m: RevealMeasure): number | null {
  if (m.inside === false) return null;
  if (m.inside === undefined && m.inputBottom <= m.viewTop) return null;
  const visibleBottom = Math.min(m.keyboardTop, m.viewBottom);
  // How far the input may move up before its top meets the top edge (negative
  // when it is already clipped there).
  const room = m.inputTop - (m.viewTop + m.margin);
  const below = m.inputBottom + m.margin - visibleBottom;
  const delta = room < 0 ? room : Math.min(Math.max(below, 0), room);
  if (delta === 0) return null;
  return Math.max(0, m.offset + delta);
}

/**
 * Once the keyboard is up, scroll the focused input into the ScrollView's
 * visible band — both platforms.
 *
 * Under `<KeyboardProvider>` Android does not resize the window for the IME
 * (UX_AUDIT S22). A sheet grows its own bottom padding by the keyboard's
 * height instead (`useKeyboardSheetPadding`), which shrinks the ScrollView in
 * it — but RN scrolls a field into view on FOCUS, before the keyboard has
 * arrived, so a field near the bottom (the template editor's last set) ends up
 * under the keyboard with nothing to bring it back.
 *
 * iOS needs it too (train-ux review T3, 2026-10-11): the editor's "Edit
 * rests" focused a field the number pad then covered.
 *
 * The iOS path measures everything in ONE pass — the ScrollView, a zero-height
 * marker at the top of its content (`contentTopRef`), the input — so the
 * content offset is read off the same layout as the input (`viewTop -
 * markerTop`), not off the throttled `onScroll` stream. `revealTarget` then
 * never moves an input past the top edge, and brings back one already there:
 * on iOS 26 a set field in the template editor's native sheet is scrolled
 * ~220pt by the system as it takes focus — with this hook and
 * `automaticallyAdjustKeyboardInsets` both off — to under the sheet's header,
 * and ~30pt more as the keyboard leaves (regression 18, measured 2026-10-12).
 * So iOS also re-checks the last field on `keyboardDidHide`. Two frames: the
 * sheet's keyboard padding grows on `keyboardDidShow` too (the Done band).
 * The host ScrollView should NOT carry `automaticallyAdjustKeyboardInsets`:
 * the sheet already pads for the keyboard, and with it on, row 1 rose 282pt
 * instead of ~220 — a second native scroll on top of the system's.
 *
 * Android is HEAD's path, byte for byte in behaviour: offset from `onScroll`,
 * scroll by the overlap with the lower of the keyboard's top and the
 * ScrollView's bottom, inputs above the ScrollView's top ignored.
 *
 * Returns the `onScroll` to hand the ScrollView (with a `scrollEventThrottle`)
 * and the ref for a `collapsable={false}` zero-height View placed FIRST in its
 * content.
 */
export function useRevealFocusedInput(scrollRef: RefObject<Scrollable | null>) {
  const offsetY = useRef(0);
  const contentTopRef = useRef<ViewInstance>(null);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
  }, []);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    /** iOS: the input the last reveal was for, re-checked once the keyboard
     *  is gone (below). */
    let last: Measurable | null = null;
    /** iOS: one pass — ScrollView, content marker, input — then `revealTarget`. */
    const revealIos = (input: Measurable, kbTop: number) => {
      const scroller = scrollRef.current;
      const marker = contentTopRef.current;
      if (!scroller || !marker) return;
      (scroller as unknown as Measurable).measureInWindow((_sx, sy, _sw, sh) => {
        marker.measureInWindow((_mx, my) => {
          input.measureInWindow((_x, y, _w, h) => {
            const target = revealTarget({
              offset: sy - my,
              viewTop: sy,
              viewBottom: sy + sh,
              keyboardTop: kbTop,
              inputTop: y,
              inputBottom: y + h,
              margin: space.md,
              inside: inputInside(scroller, input, { inputTop: y, inputBottom: y + h, viewTop: sy, contentTop: my }),
            });
            if (target != null) scroller.scrollTo({ y: target, animated: true });
          });
        });
      });
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const kbTop = e.endCoordinates.screenY;
      const measureAndScroll = () => {
        const input = TextInput.State.currentlyFocusedInput();
        const scroller = scrollRef.current;
        if (!input || !scroller) return;
        if (ios) {
          last = input;
          revealIos(input, kbTop);
          return;
        }
        (scroller as unknown as Measurable).measureInWindow((_sx, sy, _sw, sh) => {
          input.measureInWindow((_x, y, _w, h) => {
            if (y < sy) return;
            const overlap = y + h + space.md - Math.min(kbTop, sy + sh);
            if (overlap > 0) scroller.scrollTo({ y: offsetY.current + overlap, animated: true });
          });
        });
      };
      // A frame for the sheet's padding to land: it animates with the
      // keyboard, and the ScrollView's last layout trails it by one. iOS
      // takes a second one for the Done-band padding (above).
      requestAnimationFrame(() => (ios ? requestAnimationFrame(measureAndScroll) : measureAndScroll()));
    });
    // iOS: the keyboard leaving moved the content too (measured on iOS 26 —
    // the row just edited rose ~30pt, under the header, as the sheet's
    // padding went). Put that field back below the top edge; nothing else.
    const hide = ios
      ? Keyboard.addListener('keyboardDidHide', () => {
        const input = last;
        last = null;
        if (input) requestAnimationFrame(() => requestAnimationFrame(() => revealIos(input, Infinity)));
      })
      : null;
    return () => {
      show.remove();
      hide?.remove();
    };
  }, [scrollRef]);
  return { onScroll, contentTopRef };
}
