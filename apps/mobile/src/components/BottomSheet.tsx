import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, type DimensionValue, Dimensions, Modal, PanResponder, Pressable,
  StyleSheet, type StyleProp, View, type ViewStyle,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useKeyboardSheetPadding } from '@/lib/use-keyboard-sheet-style';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

const OFFSCREEN = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * Extra style for the painted panel — the per-sheet metrics that differ and
   * legitimately should: a `gap` between direct children, a wider `paddingTop`.
   * Applied AFTER the base style and BEFORE the keyboard padding, so a call
   * site can retune its spacing but cannot accidentally override the one thing
   * that must not vary (see `useKeyboardSheetPadding` for why `paddingBottom`
   * is not negotiable).
   */
  contentStyle?: StyleProp<ViewStyle>;
  /** Ceiling on the panel's height. Defaults to 94% of the screen; the Train
   *  sheets ask for 80%, which is a deliberate difference — a picker that
   *  covers the whole screen stops reading as a sheet. */
  maxHeight?: DimensionValue;
  /** testID for the dim backdrop, for tests that dismiss by tapping it. */
  backdropTestID?: string;
}

/**
 * Bottom sheet with a **fade-in-place** dim backdrop and a spring slide-up
 * panel, dismissible by dragging the grab handle down.
 *
 * RN `<Modal animationType="slide">` slides the WHOLE modal — backdrop
 * included — so the dim reads as a grey rectangle climbing the screen instead
 * of covering it (the "weird backdrop" the meal EntrySheet was rebuilt to
 * avoid). `anim` (0..1) drives the backdrop's opacity and the sheet's base
 * translateY independently; `drag` adds the finger's live offset on top.
 * Mounted through the exit animation so it doesn't pop. Built on the RN
 * Animated API (native driver) — proven smooth in these modals; see
 * lib/motion.tsx for the Reanimated primitives used elsewhere.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  contentStyle,
  maxHeight = '94%',
  backdropTestID,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  // The sheet GROWS for the keyboard rather than moving: `wrap` is flex-end,
  // so extra bottom padding keeps the background pinned to the screen edge
  // and pushes the content up. Moving it instead leaves whatever the keyboard
  // frame does not paint — on iOS 26, the transparent band holding the
  // system's floating "Done" pill — showing the page behind. See the hook.
  const sheetPadding = useKeyboardSheetPadding(space.xxl);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        stiffness: 250,
        damping: 28,
        mass: 1,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag-to-dismiss on the handle strip: follow the finger down, release past
  // the threshold (or a flick) closes; otherwise spring back into place.
  // (onClose through a ref — the responder is created once, the prop isn't.)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) onCloseRef.current();
        else Animated.spring(drag, { toValue: 0, stiffness: 300, damping: 26, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const backdropStyle = useMemo(() => [styles.backdrop, { opacity: anim }], [anim, styles.backdrop]);
  // Transform only. The painted surface (background, radius, padding) is the
  // inner Reanimated view, because RN-Animated and Reanimated styles cannot be
  // composed on one node and the padding is what has to animate.
  const sheetStyle = useMemo(
    () => [
      styles.sheetMotion,
      { maxHeight },
      {
        transform: [
          { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }), drag) },
        ],
      },
    ],
    [anim, drag, maxHeight, styles.sheetMotion],
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={backdropStyle}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID={backdropTestID} />
      </Animated.View>
      <View style={[styles.wrap, { pointerEvents: 'box-none' }]}>
        {/* Outer Reanimated layer lifts the sheet with the keyboard (frame-
            perfect); inner RN-Animated layer owns the open/close spring + drag. */}
        <Animated.View style={sheetStyle}>
          <Reanimated.View style={[styles.sheet, contentStyle, sheetPadding]}>
            <View style={styles.grabZone} {...pan.panHandlers}>
              <View style={styles.handle} />
            </View>
            {children}
          </Reanimated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = ({ scheme, colors, shadow }: Theme) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  // maxHeight arrives from the `maxHeight` prop; this holds nothing else.
  sheetMotion: {},
  sheet: {
    // **`flexShrink: 1` is load-bearing and was the bug.** The ceiling lives on
    // the OUTER motion layer (RN-Animated and Reanimated styles cannot compose
    // on one node), so without this the painted panel keeps its full content
    // height and simply overflows the clamp: a tall sheet's pinned action row
    // ends up below the fold with nothing able to scroll to it. Every sheet
    // this component replaced carried its `maxHeight` on the painted view
    // itself, so each one bounded its own flex children for free; the two-layer
    // split quietly removed that. Caught on the device with the meal sheet's
    // Add button behind the keyboard — `flexShrink` lets the panel take the
    // clamped height, which is what makes it DEFINITE for the `flexShrink: 1`
    // ScrollView inside it. A percentage cannot do this job: the panel's parent
    // is auto-height, so a percentage maxHeight there resolves against nothing.
    flexShrink: 1,
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    // Overridden by useKeyboardSheetPadding; this is the resting value.
    paddingBottom: space.xxl,
    ...shadow.e3,
  },
  // Generous touch target around the visual handle for the drag gesture.
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingBottom: space.sm, marginTop: -space.sm, paddingTop: space.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
});
