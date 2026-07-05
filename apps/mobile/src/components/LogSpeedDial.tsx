import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '@/i18n';
import { FEATURES } from '@/lib/features';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const CAM_RISE = -150;
const MAN_RISE = -78;

/**
 * The raised center action. Tapping the **+** fans open two labelled actions —
 * 📷 Scan meal and ✎ Manual entry — on a spring, staggered, over a dimming
 * backdrop, while the + rotates into an ×. Honors reduce-motion (instant
 * toggle). When `FEATURES.photoScan` is off it degrades to a plain + that opens
 * the manual sheet directly.
 */
export function LogSpeedDial() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  // One driver for the +/backdrop; per-satellite values give the stagger.
  const p = useSharedValue(0);
  const cam = useSharedValue(0);
  const man = useSharedValue(0);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: p.value * 0.55 }));
  const plusStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${interpolate(p.value, [0, 1], [0, 45])}deg` }] }));
  const camSatStyle = useAnimatedStyle(() => ({
    opacity: cam.value,
    transform: [{ translateY: interpolate(cam.value, [0, 1], [0, CAM_RISE]) }, { scale: interpolate(cam.value, [0, 1], [0.4, 1]) }],
  }));
  const manSatStyle = useAnimatedStyle(() => ({
    opacity: man.value,
    transform: [{ translateY: interpolate(man.value, [0, 1], [0, MAN_RISE]) }, { scale: interpolate(man.value, [0, 1], [0.4, 1]) }],
  }));
  const camLabelStyle = useAnimatedStyle(() => ({ opacity: cam.value, transform: [{ translateX: interpolate(cam.value, [0, 1], [12, 0]) }] }));
  const manLabelStyle = useAnimatedStyle(() => ({ opacity: man.value, transform: [{ translateX: interpolate(man.value, [0, 1], [12, 0]) }] }));

  function animate(next: boolean) {
    const to = next ? 1 : 0;
    if (reduce) {
      p.value = to;
      cam.value = to;
      man.value = to;
      return;
    }
    p.value = withTiming(to, { duration: motion.dur.fast });
    const spring = motion.spring.gentle;
    // Opening: camera leads, manual follows. Closing: reverse (retract top-down).
    cam.value = withDelay(next ? 0 : 70, withSpring(to, spring));
    man.value = withDelay(next ? 70 : 0, withSpring(to, spring));
  }

  function toggle() {
    haptics.tap();
    const next = !open;
    setOpen(next);
    animate(next);
  }

  function close() {
    if (!open) return;
    setOpen(false);
    animate(false);
  }

  function choose(action: 'scan' | 'manual') {
    haptics.tap();
    setOpen(false);
    animate(false);
    if (action === 'scan') router.navigate('/scan');
    else router.navigate({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
  }

  // Flag off → plain + straight to the manual sheet, no dial.
  if (!FEATURES.photoScan) {
    return (
      <View style={styles.slot}>
        <Pressable
          style={styles.fab}
          accessibilityRole="button"
          accessibilityLabel={t('log.manual')}
          testID="log-button"
          onPress={() => {
            haptics.tap();
            router.navigate({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
          }}
        >
          <Ionicons name="add" size={32} color={colors.white} />
        </Pressable>
      </View>
    );
  }

  const pe = open ? 'auto' : 'none';
  return (
    <View style={styles.slot} pointerEvents="box-none">
      {/* Full-screen dimmer — big negative insets so it covers the screen from
          inside the tab bar; taps anywhere close the dial. */}
      <AnimatedPressable
        style={[styles.backdrop, backdropStyle]}
        pointerEvents={pe}
        onPress={close}
        accessibilityElementsHidden={!open}
        testID="log-backdrop"
      />

      <Animated.View style={[styles.satellite, camSatStyle]} pointerEvents={pe}>
        <Animated.View style={[styles.labelPill, camLabelStyle]}>
          <Text style={styles.labelText}>{t('log.scan')}</Text>
        </Animated.View>
        <Pressable style={styles.satBtn} onPress={() => choose('scan')} accessibilityRole="button" accessibilityLabel={t('log.scan')} testID="log-scan">
          <Ionicons name="camera" size={22} color={colors.ink} />
        </Pressable>
      </Animated.View>

      <Animated.View style={[styles.satellite, manSatStyle]} pointerEvents={pe}>
        <Animated.View style={[styles.labelPill, manLabelStyle]}>
          <Text style={styles.labelText}>{t('log.manual')}</Text>
        </Animated.View>
        <Pressable style={styles.satBtn} onPress={() => choose('manual')} accessibilityRole="button" accessibilityLabel={t('log.manual')} testID="log-manual">
          <Ionicons name="create-outline" size={22} color={colors.ink} />
        </Pressable>
      </Animated.View>

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel={t('log.scan')}
        accessibilityState={{ expanded: open }}
        testID="log-button"
        onPress={toggle}
      >
        <Animated.View style={plusStyle}>
          <Ionicons name="add" size={32} color={colors.white} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

function createStyles({ colors, shadow }: Theme) {
  return StyleSheet.create({
    slot: { flex: 1, alignItems: 'center', zIndex: 30 },
    fab: {
      width: 58,
      height: 58,
      borderRadius: radius.pill,
      backgroundColor: colors.ring,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -(space.xl + 2),
      zIndex: 3,
      ...shadow.e3,
    },
    backdrop: { position: 'absolute', top: -2000, bottom: -200, left: -2000, right: -2000, backgroundColor: '#000', zIndex: 1 },
    // Centered over the FAB; the animated translateY lifts it into place.
    satellite: { position: 'absolute', bottom: 6, flexDirection: 'row', alignItems: 'center', zIndex: 2 },
    satBtn: {
      width: 52,
      height: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.e2,
    },
    labelPill: { position: 'absolute', right: 60, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
    labelText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
  });
}
