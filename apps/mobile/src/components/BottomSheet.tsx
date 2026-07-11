import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, Modal, PanResponder, Pressable, StyleSheet, View,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useKeyboardSheetStyle } from '@/lib/use-keyboard-sheet-style';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

const OFFSCREEN = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
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
export function BottomSheet({ visible, onClose, children }: Props) {
  const styles = useThemedStyles(createStyles);
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  // Frame-perfect keyboard lift (shared across every sheet) — see the hook.
  const keyboardStyle = useKeyboardSheetStyle();

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
  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      {
        transform: [
          { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }), drag) },
        ],
      },
    ],
    [anim, drag, styles.sheet],
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={backdropStyle}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={[styles.wrap, { pointerEvents: 'box-none' }]}>
        {/* Outer Reanimated layer lifts the sheet with the keyboard (frame-
            perfect); inner RN-Animated layer owns the open/close spring + drag. */}
        <Reanimated.View style={keyboardStyle}>
          <Animated.View style={sheetStyle}>
            <View style={styles.grabZone} {...pan.panHandlers}>
              <View style={styles.handle} />
            </View>
            {children}
          </Animated.View>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

const createStyles = ({ scheme, colors, shadow }: Theme) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    maxHeight: '94%',
    ...shadow.e3,
  },
  // Generous touch target around the visual handle for the drag gesture.
  grabZone: { alignSelf: 'stretch', alignItems: 'center', paddingBottom: space.sm, marginTop: -space.sm, paddingTop: space.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
});
