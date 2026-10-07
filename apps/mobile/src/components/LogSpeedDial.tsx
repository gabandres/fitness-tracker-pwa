import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, type PressableStateCallbackType, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { CONTEXT_MENUS, ContextMenu } from '@/components/ContextMenu';
import { useT } from '@/i18n';
import { FEATURES } from '@/lib/features';
import * as haptics from '@/lib/haptics';
import { rippleClip } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const CAM_RISE = -150;
const MAN_RISE = -78;
/** How long the native menu's actions wait before presenting anything:
 *  `onSelected` fires while UIKit is still dismissing the menu, and a sheet
 *  presented into that transition can be dropped (Today re-score, bug 7 —
 *  the same wait as a diary row's menu, `MENU_DISMISS_MS` in MealEntries). */
const MENU_DISMISS_MS = 300;

/** The Material ink on the coral +: drawn in the
 *  foreground so it shows over the fill, clipped to the circle by RN. Dark,
 *  not the app's neutral grey — grey at 22% barely moves on coral. */
const FAB_RIPPLE = Platform.OS === 'android' ? { color: 'rgba(0, 0, 0, 0.18)', foreground: true } : undefined;

/**
 * The +'s pressed look (Impeccable audit, S20: "the + has no pressed state").
 * A press-in scale on the platform's own press timing, with a dimmed fill as
 * the half that survives Reduce Motion — no movement then, still a visible
 * change. Applied to the button's OWN style, so the raise and the shadow
 * press down with it. Exported for test.
 */
export function fabPressedStyle(pressed: boolean, reduce: boolean) {
  if (!pressed) return null;
  return reduce ? { opacity: 0.8 } : { opacity: 0.9, transform: [{ scale: 0.93 }] };
}

/**
 * The raised center action. A **tap** on the + is the primary action and opens
 * the food search on Today directly; a **long-press** fans open the dial —
 * 📷 Scan meal and 🔍 Search foods — on a spring, staggered, over a dimming
 * backdrop, while the + rotates into an ×. Honors reduce-motion (instant
 * toggle). When `FEATURES.photoScan` is off it degrades to a plain + that opens
 * the search directly, with no dial at all.
 *
 * ## Tap is the sheet, long-press is the dial (UX_AUDIT S18-18)
 *
 * Until 2026-09-28 a tap opened the dial and the sheet was a second tap away —
 * the most frequent action in the app behind a menu whose other entry (Scan)
 * has its own tab-bar-adjacent route. "Tap + to log your first meal"
 * (`today.emptyHint`) is now literally true. The scan's other door is the
 * food sheet's "More ways" list (`open-scan` in EntrySheet) — added 2026-10-04,
 * when the owner could not find the camera: a long-press is invisible, and
 * this comment's claim that Scan had "its own tab-bar-adjacent route" was
 * never true. Screen-reader users get the same
 * two paths: the hint says long-press for more, and a `longpress`
 * accessibility action opens the dial without a timed gesture. While the dial
 * is open the + is its close button, as before.
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
 *
 * ## On iOS the long-press is the system menu (Today re-score, Platform)
 *
 * Where native context menus exist (`CONTEXT_MENUS`), the long-press opens
 * the same `UIContextMenu` the diary rows use — Scan meal · Search foods —
 * instead of this custom fan, so the one long-press in the bar behaves like
 * every other long-press in iOS. The dial stays for Android, which has no
 * system equivalent. A screen reader gets Scan as a named action there.
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

  function close() {
    if (!openRef.current) return;
    setDial(false);
  }

  function openSheet() {
    router.navigate({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
  }

  /** Tap: the primary action — or, while the dial is open, its close button. */
  function primary() {
    haptics.tap();
    if (openRef.current) {
      setDial(false);
      return;
    }
    openSheet();
  }

  /** Long-press (or the `longpress` accessibility action): fan the dial open. */
  function more() {
    if (openRef.current) return;
    haptics.tap();
    setDial(true);
  }

  function choose(action: 'scan' | 'manual') {
    haptics.tap();
    setDial(false);
    if (action === 'scan') router.navigate('/scan');
    else openSheet();
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

  // iOS: the system context menu on long-press, no fan (see the header).
  if (FEATURES.photoScan && CONTEXT_MENUS) {
    return (
      <View style={styles.slot}>
        {/* The lift lives on a plain View OUTSIDE the menu: a negative margin
            inside the native wrapper would put the top of the button outside
            its bounds, where UIKit does not deliver touches. */}
        <View style={styles.lift}>
          <ContextMenu
            actions={[
              {
                key: 'scan',
                title: t('log.scan'),
                icon: 'camera',
                // Waits like "Search foods" below (Today re-score 3, B1): /scan
                // is a full-screen modal, and presenting it while UIKit is
                // still dismissing the menu is the same transition a sheet
                // can be dropped into.
                onPress: () => {
                  setTimeout(() => router.navigate('/scan'), MENU_DISMISS_MS);
                },
              },
              {
                key: 'manual',
                title: t('log.manual'),
                icon: 'magnifyingglass',
                onPress: () => {
                  setTimeout(openSheet, MENU_DISMISS_MS);
                },
              },
            ]}
          >
            <Pressable
              style={({ pressed }: PressableStateCallbackType) => [styles.fabShape, rippleClip(styles.fabShape), fabPressedStyle(pressed, reduce)]}
              android_ripple={FAB_RIPPLE}
              accessibilityRole="button"
              accessibilityLabel={t('log.openA11y')}
              accessibilityHint={t('log.fabHint')}
              accessibilityActions={[{ name: 'scan', label: t('log.scan') }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'scan') {
                  haptics.tap();
                  router.navigate('/scan');
                }
              }}
              testID="log-button"
              onPress={() => {
                haptics.tap();
                openSheet();
              }}
            >
              <Ionicons name="add" size={32} color={colors.heroPanel} />
            </Pressable>
          </ContextMenu>
        </View>
      </View>
    );
  }

  // Flag off → plain + straight to the search sheet, no dial.
  if (!FEATURES.photoScan) {
    return (
      <View style={styles.slot}>
        <Pressable
          style={({ pressed }: PressableStateCallbackType) => [styles.fab, rippleClip(styles.fab), fabPressedStyle(pressed, reduce)]}
          android_ripple={FAB_RIPPLE}
          accessibilityRole="button"
          accessibilityLabel={t('log.manual')}
          testID="log-button"
          onPress={() => {
            haptics.tap();
            openSheet();
          }}
        >
          <Ionicons name="add" size={32} color={colors.heroPanel} />
        </Pressable>
      </View>
    );
  }

  const pe = open ? 'auto' : 'none';
  return (
    <View style={[styles.slot, { pointerEvents: 'box-none' }]}>
      {/* Full-screen dimmer — big negative insets so it covers the screen from
          inside the tab bar; taps anywhere close the dial. */}
      {/* While open it is a real control — the only big "dismiss" target —
          so it is named; while closed it is out of the tree entirely. */}
      <AnimatedPressable
        style={[styles.backdrop, backdropStyle, { pointerEvents: pe }]}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.close')}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        testID="log-backdrop"
      />

      {/* Opacity 0 hides a satellite from the EYE only — VoiceOver and
          TalkBack still swiped onto "Scan meal" and "Search foods" with the
          dial shut, buttons that were invisible and untappable. So the closed
          dial takes them out of the accessibility tree as well. */}
      <Animated.View
        style={[styles.satellite, camSatStyle, { pointerEvents: pe }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
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

      <Animated.View
        style={[styles.satellite, manSatStyle, { pointerEvents: pe }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        {/* The pill is INSIDE the Pressable so tapping the words works too — it
            was a dead target for as long as it was a sibling `View`. */}
        <Pressable style={styles.satHit} onPress={() => choose('manual')} accessibilityRole="button" accessibilityLabel={t('log.manual')} testID="log-manual">
          <Animated.View style={[styles.labelPill, manLabelStyle]}>
            <Text style={styles.labelText}>{t('log.manual')}</Text>
          </Animated.View>
          <View style={styles.satBtn}>
            {/* A magnifier, not a pencil: the label says "Search foods" and the
                sheet it opens IS the search (UX_AUDIT S18-17). */}
            <Ionicons name="search-outline" size={22} color={colors.ink} />
          </View>
        </Pressable>
      </Animated.View>

      <Pressable
        style={({ pressed }: PressableStateCallbackType) => [styles.fab, rippleClip(styles.fab), fabPressedStyle(pressed, reduce)]}
        android_ripple={FAB_RIPPLE}
        accessibilityRole="button"
        accessibilityLabel={t('log.openA11y')}
        // No hint while open: the button is the dial's close then, and the
        // expanded state already says so.
        accessibilityHint={open ? undefined : t('log.fabHint')}
        accessibilityState={{ expanded: open }}
        accessibilityActions={[{ name: 'longpress', label: t('log.moreA11y') }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'longpress') more();
        }}
        testID="log-button"
        onPress={primary}
        onLongPress={more}
        delayLongPress={350}
      >
        {/* Dark glyph, not white: white on the coral is 2.85:1, under the 3:1
            WCAG floor for a graphical control. `heroPanel` is the one dark
            token shared by both themes, and it measures 6.46:1 on `ring`. */}
        <Animated.View style={plusStyle}>
          <Ionicons name="add" size={32} color={colors.heroPanel} />
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
    // The iOS context-menu variant: the same button, its raise on a wrapper.
    lift: { marginTop: -(space.xl + 2), zIndex: 3 },
    fabShape: {
      width: 58,
      height: 58,
      borderRadius: radius.pill,
      backgroundColor: colors.ring,
      alignItems: 'center',
      justifyContent: 'center',
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
