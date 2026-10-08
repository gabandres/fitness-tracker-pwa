import { type ReactNode, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, type DimensionValue, Dimensions, Modal, PanResponder, type PanResponderInstance, Platform, Pressable,
  StyleSheet, type StyleProp, View, type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import {
  clearSheetActive,
  clearSheetPortal,
  dismissSheet,
  getSheetPortal,
  isPresented,
  markSheetActive,
  setSheetPortal,
} from '@/lib/sheet-portal';
import Reanimated, { useReducedMotion } from 'react-native-reanimated';
import { ToastSheetHost } from '@/components/Toast';
import { useT } from '@/i18n';
import { useKeyboardSheetPadding } from '@/lib/use-keyboard-sheet-style';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';

const OFFSCREEN = Dimensions.get('window').height;

/**
 * The confirm host, nested in an open sheet. `ConfirmHost` is
 * required lazily: `ConfirmSheet` renders a `BottomSheet`, so a top-level
 * import would be a require cycle.
 */
function SheetOverlays() {
  const { ConfirmHost } = require('@/components/ConfirmSheet') as typeof import('@/components/ConfirmSheet');
  // Absent when a test mocks the module down to `confirm`. (The toast host is
  // mounted inside the panel instead — see the render.)
  return ConfirmHost ? <ConfirmHost /> : null;
}

/** Which dismissal the user made without aiming at a button. */
export type SheetCloseVia = 'backdrop' | 'drag' | 'back';

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
  /**
   * Called INSTEAD of `onClose` for the three dismissals that are easy to
   * make by accident — a backdrop tap, a drag on the handle, Android back —
   * so a sheet holding typed input can step back or ask first. Return
   * `false` to stay open (a drag then settles back into place); anything
   * else means the caller closed. Omit it and those gestures close outright,
   * as they always have.
   */
  onRequestClose?: (via: SheetCloseVia) => boolean | void;
  /** Host toasts and confirms inside this sheet's Modal while it is open
   *  (default true). The confirm's own sheet passes false — it IS the overlay. */
  overlays?: boolean;
  /**
   * Present as a NATIVE sheet where the platform has one worth using (iOS:
   * `UISheetPresentationController` through the root `sheet` route — real
   * detents, system grabber and swipe, Liquid Glass on iOS 26). Elsewhere it
   * is this component, unchanged. UX_AUDIT S20; `lib/sheet-portal.ts`.
   */
  native?: boolean;
  /**
   * The content would be lost by an accidental dismissal (typed input). A
   * native sheet then refuses the swipe-down and asks `onRequestClose`
   * instead; the JS sheet always asks, so it ignores this.
   */
  guarded?: boolean;
  /** Native detents: fractions of the screen, or `'fit'` to the content. */
  detents?: number[] | 'fit';
  /** Android back steps INSIDE the sheet right now (a sub-screen to leave
   *  before closing): the native sheet then routes back to `onRequestClose`
   *  instead of dismissing. iOS has no back key; ignored there. */
  backSteps?: boolean;
}

/** Whether `native` sheets are presented natively on this platform: iOS
 *  through `UISheetPresentationController`, Android through react-native-
 *  screens' formSheet — a Material `BottomSheetBehavior` sheet with its drag,
 *  scrim and predictive back (S20; owner-approved for Android 2026-10-05). */
export const NATIVE_SHEETS = Platform.OS === 'ios' || Platform.OS === 'android';

export function BottomSheet(props: Props) {
  return props.native && NATIVE_SHEETS ? <NativeBottomSheet {...props} /> : <JsBottomSheet {...props} />;
}

/**
 * `BottomSheet native` on iOS: publishes its children to the portal and drives
 * the root `sheet` route from `visible`. Renders nothing in place.
 */
function NativeBottomSheet({
  visible,
  onClose,
  children,
  onRequestClose,
  overlays = true,
  guarded = false,
  detents = [0.6, 1],
  backdropTestID,
  backSteps = false,
}: Props) {
  const id = `sheet-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const request = (via: SheetCloseVia): boolean => {
    if (onRequestClose) return onRequestClose(via) !== false;
    onClose();
    return true;
  };
  // The route holds `requestClose` across renders, so it calls through a ref.
  // Written in a layout effect — never during render, which made the React
  // Compiler skip this component — and declared before the publish below, so
  // the route has the current handler by the time it can call it.
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  });

  // Republished every render so the route always shows current children —
  // but only while there is a route to show them: a closed sheet published on
  // every render of its screen (each Today snapshot), for nothing (round 3).
  // Kept while the route is still up, so the content does not vanish during
  // the dismiss animation.
  useLayoutEffect(() => {
    if (!visible && !isPresented(id)) return;
    setSheetPortal(id, {
      node: children,
      requestClose: (via) => requestRef.current(via),
      guarded,
      backSteps,
      overlays,
      visible,
      testID: backdropTestID ? `${backdropTestID}-native` : undefined,
    });
  });
  // The owner unmounting takes its sheet with it — left up, the route would
  // keep showing the last children with nobody to answer its buttons.
  useEffect(
    () => () => {
      dismissSheet(id);
      clearSheetPortal(id);
    },
    [id],
  );

  // `detents` is read when the route is pushed but is not a trigger: a new
  // array (the default is one per render) must not re-run the open/close below.
  const pushRoute = useEffectEvent(() => {
    router.push({
      pathname: '/sheet',
      params: { id, detents: detents === 'fit' ? 'fit' : detents.join(',') },
    });
  });

  useEffect(() => {
    if (visible && !isPresented(id)) {
      // Before the push: the screen underneath blurs when the route lands, and
      // must already know it is a sheet over it (`useFocusEffectThroughSheets`).
      markSheetActive(id);
      pushRoute();
    } else if (!visible) {
      dismissSheet(id);
      if (!isPresented(id)) {
        // Closed before its route ever mounted: nothing will unregister it,
        // and the route — if it still lands — must read `visible: false` and
        // leave (the publish above skips a closed sheet).
        clearSheetActive(id);
        const last = getSheetPortal(id);
        if (last?.visible) setSheetPortal(id, { ...last, visible: false });
      }
    }
  }, [visible, id]);

  return null;
}

/**
 * Drag-to-dismiss on the handle strip: follow the finger down, release past
 * the threshold (or a flick) asks `release` to close; otherwise — or when it
 * returns false — spring back into place. The responder is created once, so
 * `release` is the first render's and must read anything that changes through
 * a ref. A hook of its own so the React Compiler can see `release` is only
 * called from the gesture: built inline, the same `useState` initializer reads
 * to the compiler as a ref passed to a render-time call, and it skipped
 * `JsBottomSheet` for it.
 */
function useHandleDrag(drag: Animated.Value, release: () => boolean): PanResponderInstance {
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if ((g.dy > 120 || g.vy > 0.8) && release()) return;
        Animated.spring(drag, { toValue: 0, stiffness: 300, damping: 26, useNativeDriver: true }).start();
      },
    }),
  );
  return pan;
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
function JsBottomSheet({
  visible,
  onClose,
  children,
  contentStyle,
  maxHeight = '94%',
  backdropTestID,
  onRequestClose,
  overlays = true,
}: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  // Reduce Motion: the sheet appears and disappears in place, no spring.
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [anim] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));

  // The sheet GROWS for the keyboard rather than moving: `wrap` is flex-end,
  // so extra bottom padding keeps the background pinned to the screen edge
  // and pushes the content up. Moving it instead leaves whatever the keyboard
  // frame does not paint — on iOS 26, the transparent band holding the
  // system's floating "Done" pill — showing the page behind. See the hook.
  const sheetPadding = useKeyboardSheetPadding(space.xxl);

  // Open/close runs on `visible` alone. `mounted` and `reduceMotion` are read,
  // not triggers — an effect event keeps a Reduce Motion flip or the exit
  // animation's own `setMounted(false)` from re-running it.
  const onVisible = useEffectEvent((show: boolean) => {
    if (show) {
      setMounted(true);
      drag.setValue(0);
      if (reduceMotion) {
        anim.setValue(1);
        return;
      }
      Animated.spring(anim, {
        toValue: 1,
        stiffness: 250,
        damping: 28,
        mass: 1,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      if (reduceMotion) {
        anim.setValue(0);
        setMounted(false);
        return;
      }
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  });
  useEffect(() => {
    // `setMounted` is the Modal half of an animation this effect drives on an
    // external system (RN Animated); the rule below has nothing to say about
    // that. Suppressing THIS rule does not make the compiler skip — only
    // `exhaustive-deps` and `rules-of-hooks` suppressions do.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    onVisible(visible);
  }, [visible]);

  const request = (via: SheetCloseVia): boolean => {
    if (onRequestClose) return onRequestClose(via) !== false;
    onClose();
    return true;
  };
  // The drag responder is created once and the props are not, so it calls
  // through a ref — written in a layout effect, not during render (a
  // render-time write made the React Compiler skip this component).
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  });
  const pan = useHandleDrag(drag, () => requestRef.current('drag'));

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
    <Modal visible={mounted} transparent animationType="none" onRequestClose={() => request('back')}>
      {/* The backdrop is a real control — it closes the sheet — so it says so
          (S18-5). Without a role and a label VoiceOver reads it as an unnamed
          button the size of the screen. */}
      <Animated.View style={backdropStyle}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => request('backdrop')}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          testID={backdropTestID}
        />
      </Animated.View>
      <View style={[styles.wrap, { pointerEvents: 'box-none' }]}>
        {/* Outer Reanimated layer lifts the sheet with the keyboard (frame-
            perfect); inner RN-Animated layer owns the open/close spring + drag.
            `accessibilityViewIsModal` keeps VoiceOver INSIDE the panel — the
            screen underneath is still in the tree and would otherwise be
            swipeable-to. */}
        <Animated.View style={sheetStyle} accessibilityViewIsModal>
          <Reanimated.View style={[styles.sheet, contentStyle, sheetPadding]}>
            {/* The handle is a drag affordance with no screen-reader meaning:
                the backdrop and the OS back gesture already close the sheet. */}
            <View
              style={styles.grabZone}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              {...pan.panHandlers}
            >
              <View style={styles.handle} />
            </View>
            {children}
          </Reanimated.View>
          {/* The toast lives INSIDE the modal panel: `accessibilityViewIsModal`
              hides every sibling from VoiceOver, so a toast drawn beside the
              panel was announced but its Undo could not be reached. */}
          {visible && overlays ? <ToastSheetHost /> : null}
        </Animated.View>
      </View>
      {/* Confirms raised while this sheet is open are presented from here:
          iOS will not present a second Modal from a controller already
          presenting this one, which is where the tab-layout host lives. Only
          while visible; toasts get the same treatment inside the panel. */}
      {visible && overlays ? <SheetOverlays /> : null}
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
