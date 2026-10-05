import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  FadeOutDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { announce, primeScreenReaderState, recommendedTimeoutMs } from '@/lib/a11y';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { FAB_BAND, font, motion, radius, space } from '@/theme';

/**
 * A bottom toast with one optional action (UX_AUDIT S18-6 / S18-12).
 *
 * Two jobs, one surface: a **receipt** ("Saved offline — syncs when you
 * reconnect", `offline.queued`) and an **undo** ("Entry deleted · Undo") for
 * the destructive taps that are cheap to reverse. Anything that needs a
 * decision before the fact is `ConfirmSheet`; anything that is an error the
 * user must act on is an inline error slot, not a toast.
 *
 * ## API
 *
 * ```tsx
 * <ToastProvider>{app}</ToastProvider>                 // once, in the root layout
 * const toast = useToast();
 * toast.show(t('offline.queued'));
 * toast.show(t('entry.deleted'), {
 *   durationMs: 5000,
 *   action: { label: t('common.undo'), onPress: () => readd() },
 * });
 * toast.hide();
 * ```
 *
 * `showToast(message, opts)` is the same call for code with no hook access (a
 * write helper, a ledger op). It is a no-op until a provider mounts — a
 * receipt nobody can see is not worth throwing over.
 *
 * ## Behaviour
 *
 * One toast at a time; a new `show` replaces the old (the newest fact wins).
 * Auto-dismisses after `durationMs` (default 4 s; 5 s when there is an
 * action — the WCAG "enough time" floor for a timed control; at least 10 s for
 * an actionable toast while a screen reader is on, and never shorter than
 * Android's "time to take action" setting — `lib/a11y.ts`). The action fires
 * once and dismisses. Enter/exit through Reanimated with `ReduceMotion.System`,
 * so a reduce-motion user gets a plain appear/disappear — same rule as every
 * primitive in `lib/motion.tsx`. Announced once through
 * `announceForAccessibility` on both platforms (no live region: the toast can
 * move from a sheet's host to the root host, and a live region re-reads on
 * every remount), so a screen-reader user hears the receipt without it
 * stealing focus. Inside a sheet it draws at the top of the panel — the bottom
 * there is the keyboard and the sheet's action row — and drops "Edit".
 *
 * The announcement waits {@link ANNOUNCE_AFTER_SHEET_MS} when a sheet is open
 * or has just closed: the receipt is usually raised in the same tick the add
 * sheet is dismissed, and VoiceOver drops an announcement that lands while it
 * is moving focus back to the screen underneath.
 *
 * The bottom toast swipes away (sideways or down) — the Material snackbar
 * gesture and the one iOS users try on any banner. From 1.35× text the
 * actions take their own row under the message, so neither is squeezed into
 * a sliver (UX_AUDIT Today review A7).
 */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  /** The main button. Omit for a plain receipt (which gets Dismiss). */
  action?: ToastAction;
  /** An optional second button, drawn before `action` — the add receipt's
   *  "Edit" beside its "Undo". Ignored without `action`. */
  secondaryAction?: ToastAction;
  /** Auto-dismiss after this long. Default 4000; 5000 when `action` is set. */
  durationMs?: number;
  testID?: string;
}

interface ToastApi {
  show: (message: string, opts?: ToastOptions) => void;
  hide: () => void;
  /** Run the live toast's action (and dismiss it). False when there is no
   *  toast or it has no action — the Magic Tap handler's answer. */
  act: () => boolean;
}

/** How long an announcement waits around a sheet dismissal — see Behaviour. */
export const ANNOUNCE_AFTER_SHEET_MS = 400;
/** Text scale from which the toast stacks its actions under the message. */
const STACK_AT_FONT_SCALE = 1.35;
/** A swipe past either distance dismisses; shorter springs back. */
const SWIPE_DISMISS_X = 80;
const SWIPE_DISMISS_Y = 36;

/** What the in-modal host needs: the live toast and the portal stack. */
interface ToastStateApi {
  current: ActiveToast | null;
  hide: () => void;
  /** Ids of mounted `ToastSheetHost`s, newest last — only the newest draws. */
  portals: readonly number[];
  register: (id: number) => () => void;
}

interface ActiveToast extends ToastOptions {
  message: string;
  key: number;
}

/** Two actions side by side: full vertical slop, but horizontal slop under
 *  half the gap between them, so their targets cannot overlap. */
const ACTION_SLOP = { top: 12, bottom: 12, left: 5, right: 5 } as const;

const ToastContext = createContext<ToastApi | null>(null);
const ToastStateContext = createContext<ToastStateApi | null>(null);
let portalSeq = 0;
/** Module-scope, so `useState(nextPortalId)` mints one id per host without the
 *  React Compiler seeing a global mutated during render. */
const nextPortalId = () => ++portalSeq;

let notify: ((message: string, opts?: ToastOptions) => void) | null = null;

/** Imperative form for non-component code. No provider mounted → nothing shown. */
export function showToast(message: string, opts?: ToastOptions): void {
  notify?.(message, opts);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ActiveToast | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read by `act` and `show` from event handlers only — never during render.
  const currentRef = useRef<ActiveToast | null>(null);
  const portalCount = useRef(0);
  const lastSheetCloseAt = useRef(0);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCurrent(null);
  }, []);

  const show = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      const key = ++seq.current;
      setCurrent({ ...opts, message, key });
      // Spoken on iOS too: the live region below is Android-only, and
      // `role="alert"` is silent under VoiceOver. The action label rides along
      // so a screen-reader user knows there is something to reach for.
      const actions = [opts.action && opts.secondaryAction?.label, opts.action?.label]
        .filter(Boolean)
        .join(', ');
      // Spoken once, here, on both platforms — not through a live region:
      // the toast can move from a sheet's host to the root host as the sheet
      // closes, and a live region re-announces on every remount.
      const spoken = actions ? `${message}. ${actions}` : message;
      const nearSheet =
        portalCount.current > 0 || Date.now() - lastSheetCloseAt.current < ANNOUNCE_AFTER_SHEET_MS;
      if (nearSheet) {
        setTimeout(() => {
          // Superseded while it waited: the newer toast speaks for itself.
          if (seq.current === key) announce(spoken);
        }, ANNOUNCE_AFTER_SHEET_MS);
      } else {
        announce(spoken);
      }
      const base = opts.durationMs ?? (opts.action ? 5000 : 4000);
      void recommendedTimeoutMs(base, !!opts.action).then((ms) => {
        // A newer toast already replaced this one while the timeout resolved.
        if (seq.current !== key) return;
        timer.current = setTimeout(() => {
          // Only the toast that armed this timer may clear it — a newer one has
          // its own.
          setCurrent((c) => (c?.key === key ? null : c));
          timer.current = null;
        }, ms);
      });
    },
    [],
  );

  const act = useCallback(() => {
    const action = currentRef.current?.action;
    if (!action) return false;
    hide();
    action.onPress();
    return true;
  }, [hide]);

  useEffect(() => {
    primeScreenReaderState();
    notify = show;
    return () => {
      notify = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show, hide]);

  const api = useMemo<ToastApi>(() => ({ show, hide, act }), [show, hide, act]);

  const [portals, setPortals] = useState<number[]>([]);
  const register = useCallback((id: number) => {
    portalCount.current += 1;
    setPortals((p) => [...p, id]);
    return () => {
      portalCount.current -= 1;
      lastSheetCloseAt.current = Date.now();
      setPortals((p) => p.filter((x) => x !== id));
    };
  }, []);
  const state = useMemo<ToastStateApi>(
    () => ({ current, hide, portals, register }),
    [current, hide, portals, register],
  );

  return (
    <ToastContext.Provider value={api}>
      <ToastStateContext.Provider value={state}>
        {children}
        {/* While a sheet is open its own host draws the toast: a native Modal
            sits above everything in this tree, so a receipt raised from inside
            a sheet ("Saved to My Foods") was spoken but never seen. */}
        {portals.length === 0 ? <ToastHost toast={current} onHide={hide} /> : null}
      </ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

/**
 * The toast, drawn inside a modal. `BottomSheet` mounts one in its `Modal`, so
 * a toast shown while a sheet is up lands above the sheet rather than behind
 * it. Stacked sheets (a confirm over the food sheet) each register; only the
 * newest draws. Outside a `ToastProvider` it renders nothing.
 */
export function ToastSheetHost() {
  const ctx = useContext(ToastStateContext);
  const [id] = useState(nextPortalId);
  const register = ctx?.register;
  useEffect(() => register?.(id), [register, id]);
  if (!ctx || ctx.portals[ctx.portals.length - 1] !== id) return null;
  return <ToastHost toast={ctx.current} onHide={ctx.hide} placement="sheet" />;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastHost({
  toast,
  onHide,
  placement = 'bottom',
}: {
  toast: ActiveToast | null;
  onHide: () => void;
  /** `sheet`: drawn at the top of an open sheet's panel — the bottom there is
   *  the keyboard and the sheet's own action row, and a toast over either is
   *  covered or covering. */
  placement?: 'bottom' | 'sheet';
}) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const inSheet = placement === 'sheet';
  // In a sheet the wrapper sits beside the panel (elevation 6 on Android); a
  // higher elevation keeps it drawn above the panel if Fabric keeps the node.
  const at = inSheet ? { top: space.sm, elevation: 8 } : { bottom: insets.bottom + FAB_BAND };
  return (
    // Keyed by the toast, so a replacement starts from rest rather than
    // inheriting a half-finished swipe.
    <ToastCard key={toast.key} toast={toast} onHide={onHide} inSheet={inSheet} at={at} />
  );
}

function ToastCard({
  toast,
  onHide,
  inSheet,
  at,
}: {
  toast: ActiveToast;
  onHide: () => void;
  inSheet: boolean;
  at: object;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_AT_FONT_SCALE;
  // No "Edit" inside a sheet: it would open an editor over the one already
  // open. The receipt is usually raised while the add sheet is closing, and
  // the root host draws the full toast, Edit included, once it has.
  const secondary = inSheet ? undefined : toast.secondaryAction;

  // Swipe to dismiss. Only the bottom toast: inside a sheet's Modal the
  // gesture would compete with the sheet's own drag-to-dismiss.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const swipe = Gesture.Pan()
    .enabled(!inSheet)
    .minDistance(8)
    .onUpdate((e) => {
      tx.set(e.translationX);
      // Down only: the toast sits above the tab bar and has nowhere to go up.
      ty.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      const gone =
        Math.abs(e.translationX) > SWIPE_DISMISS_X ||
        e.translationY > SWIPE_DISMISS_Y ||
        Math.abs(e.velocityX) > 800 ||
        e.velocityY > 600;
      if (gone) {
        scheduleOnRN(onHide);
        return;
      }
      tx.set(withTiming(0, { duration: motion.dur.fast }));
      ty.set(withTiming(0, { duration: motion.dur.fast }));
    });
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
    opacity: 1 - Math.min(0.6, Math.abs(tx.value) / 300),
  }));

  const buttons = (
    <>
      {toast.action && secondary ? (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            onHide();
            secondary.onPress();
          }}
          hitSlop={ACTION_SLOP}
          accessibilityRole="button"
          testID="toast-secondary-action"
        >
          <Text style={styles.action}>{secondary.label}</Text>
        </TouchableOpacity>
      ) : null}
      {toast.action ? (
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            onHide();
            toast.action?.onPress();
          }}
          hitSlop={secondary ? ACTION_SLOP : 10}
          accessibilityRole="button"
          testID="toast-action"
        >
          <Text style={styles.action}>{toast.action.label}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onHide}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          testID="toast-dismiss"
        >
          <Text style={styles.action}>{t('common.dismiss')}</Text>
        </TouchableOpacity>
      )}
    </>
  );

  return (
    <View style={[styles.layer, at]} pointerEvents="box-none">
      <GestureDetector gesture={swipe}>
        <Animated.View
          entering={FadeInDown.duration(motion.dur.base).reduceMotion(ReduceMotion.System)}
          exiting={FadeOutDown.duration(motion.dur.fast).reduceMotion(ReduceMotion.System)}
          style={[styles.toast, stacked && styles.toastStacked, dragStyle]}
          accessibilityRole="alert"
          testID={toast.testID ?? 'toast'}
        >
          {/* Uncapped lines when stacked: the message has the full width then,
              and two lines at 2× text cut most receipts mid-word. */}
          <Text style={[styles.message, stacked && styles.messageStacked]} numberOfLines={stacked ? undefined : 2}>
            {toast.message}
          </Text>
          {stacked ? <View style={styles.actionsRow}>{buttons}</View> : buttons}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    layer: {
      position: 'absolute',
      left: space.lg,
      right: space.lg,
      alignItems: 'center',
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      maxWidth: 480,
      alignSelf: 'stretch',
      minHeight: 48,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      backgroundColor: colors.ink,
      ...shadow.e3,
    },
    // Message over a right-aligned row of actions — see STACK_AT_FONT_SCALE.
    toastStacked: { flexDirection: 'column', alignItems: 'stretch', gap: space.sm },
    actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.lg },
    message: { flex: 1, fontSize: font.small, color: colors.onInk, fontWeight: '600' },
    messageStacked: { flex: 0 },
    // `onInk`, not `accent`: accent is tuned for the CANVAS and lands near 2:1
    // on an ink fill in both themes. Weight + underline carry "this is the
    // button" instead of hue.
    action: {
      fontSize: font.small,
      fontWeight: '800',
      color: colors.onInk,
      textDecorationLine: 'underline',
      paddingVertical: space.xs,
      // A 44pt target even for a short word ("Edit", "Undo") — the text box
      // alone measured ~40pt wide, under the floor.
      minWidth: 44,
      textAlign: 'center',
    },
  });
