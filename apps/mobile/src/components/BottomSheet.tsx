import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View,
} from 'react-native';
import { colors, radius, space } from '@/theme';

const OFFSCREEN = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet with a **fade-in-place** dim backdrop and a slide-up panel.
 *
 * RN `<Modal animationType="slide">` slides the WHOLE modal — backdrop
 * included — up from the bottom, so the dim reads as a grey rectangle climbing
 * the screen instead of covering it (the "weird backdrop" the meal EntrySheet
 * was rebuilt to avoid). This drives one `Animated.Value`: the backdrop's
 * opacity fades and the sheet's translateY slides, independently, so the dim
 * stays full-screen and still. Mounted through the exit animation so it
 * doesn't pop.
 */
export function BottomSheet({ visible, onClose, children }: Props) {
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useMemo(() => [styles.backdrop, { opacity: anim }], [anim]);
  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [OFFSCREEN, 0] }) }] },
    ],
    [anim],
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={backdropStyle}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
        pointerEvents="box-none"
      >
        <Animated.View style={sheetStyle}>
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    maxHeight: '94%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
});
