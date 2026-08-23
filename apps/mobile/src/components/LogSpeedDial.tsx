import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
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
 *
 * ## It is rendered by the TAB LAYOUT, which is why dismissal is explicit
 *
 * The dial outlives every screen beneath it, so nothing about a navigation
 * closes it on its own. Until 2026-08-21 the only thing that did was tapping a
 * satellite BUTTON or the backdrop — and a user (UX_AUDIT, Abdiel Medina) hit
 * the gap on the photo-scan result: the pills and the 55% scrim sat on top of
 * the result, covering "Add today". Reproduced on an LG VS988, two distinct
 * defects:
 *
 * 1. **The label pill swallowed its own tap.** It was a plain `View`, so it
 *    became the touch target and no ancestor was a responder — a tap on the
 *    words "Scan meal" did nothing at all, while the same tap 90px right on the
 *    circle worked. Fixed by making the whole satellite (pill + circle) ONE
 *    `Pressable`; the pill renders outside that Pressable's 52px box, which is
 *    fine — RN dispatches to out-of-bounds descendants and the responder then
 *    bubbles up. (uiautomator still reports those clipped bounds as an empty
 *    rect, which is why Maestro cannot tap `log-scan` on this device. That is a
 *    harness-visibility problem, not a touch one — see `06-scan-intro.yaml`.)
 * 2. **Hardware back navigated out from under it.** Back on the scan screen
 *    with the dial open returned to Today with the dial still fanned open over
 *    it. Now back dismisses the dial, and any route change closes it.
 */
export function LogSpeedDial() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Mirror of `open` for the callbacks below, which run from effects and from
  // the back handler and would otherwise read a stale render's value.
  const openRef = useRef(false);
  const pathname = usePathname();

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

  function setDial(next: boolean) {
    openRef.current = next;
    setOpen(next);
    animate(next);
  }

  function toggle() {
    haptics.tap();
    setDial(!openRef.current);
  }

  function close() {
    if (!openRef.current) return;
    setDial(false);
  }

  function choose(action: 'scan' | 'manual') {
    haptics.tap();
    setDial(false);
    if (action === 'scan') router.navigate('/scan');
    else router.navigate({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
  }

  // Every route change closes the dial. `choose()` already does for the two
  // taps it owns; this covers everything else that can move the app while the
  // dial is open — a deep link, hardware back, a tab press that beats the
  // backdrop — none of which the dial can otherwise hear.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(close, [pathname]);

  // Android: back dismisses the dial instead of navigating out from under it.
  // No-op on iOS, where BackHandler never fires.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    <View style={[styles.slot, { pointerEvents: 'box-none' }]}>
      {/* Full-screen dimmer — big negative insets so it covers the screen from
          inside the tab bar; taps anywhere close the dial. */}
      <AnimatedPressable
        style={[styles.backdrop, backdropStyle, { pointerEvents: pe }]}
        onPress={close}
        accessibilityElementsHidden={!open}
        testID="log-backdrop"
      />

      <Animated.View style={[styles.satellite, camSatStyle, { pointerEvents: pe }]}>
        {/* The pill is INSIDE the Pressable so tapping the words works too — it
            was a dead target for as long as it was a sibling `View`. */}
        <Pressable style={styles.satHit} onPress={() => choose('scan')} accessibilityRole="button" accessibilityLabel={t('log.scan')} testID="log-scan">
          <Animated.View style={[styles.labelPill, camLabelStyle]}>
            <Text style={styles.labelText}>{t('log.scan')}</Text>
          </Animated.View>
          <View style={styles.satBtn}>
            <Ionicons name="camera" size={22} color={colors.ink} />
          </View>
        </Pressable>
      </Animated.View>

      <Animated.View style={[styles.satellite, manSatStyle, { pointerEvents: pe }]}>
        {/* The pill is INSIDE the Pressable so tapping the words works too — it
            was a dead target for as long as it was a sibling `View`. */}
        <Pressable style={styles.satHit} onPress={() => choose('manual')} accessibilityRole="button" accessibilityLabel={t('log.manual')} testID="log-manual">
          <Animated.View style={[styles.labelPill, manLabelStyle]}>
            <Text style={styles.labelText}>{t('log.manual')}</Text>
          </Animated.View>
          <View style={styles.satBtn}>
            <Ionicons name="create-outline" size={22} color={colors.ink} />
          </View>
        </Pressable>
      </Animated.View>

      <Pressable
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel={t('log.openA11y')}
        accessibilityHint={t('log.openHint')}
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
    // Sized by the circle alone, so the circle stays centered over the FAB; the
    // pill hangs off to the left of this box and is still part of its tap.
    satHit: { flexDirection: 'row', alignItems: 'center' },
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
