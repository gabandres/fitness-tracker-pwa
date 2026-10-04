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
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated';
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
 * <ToastProvider>{app}</ToastProvider>                 // once, in the tab layout
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
}

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

let notify: ((message: string, opts?: ToastOptions) => void) | null = null;

/** Imperative form for non-component code. No provider mounted → nothing shown. */
export function showToast(message: string, opts?: ToastOptions): void {
  notify?.(message, opts);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ActiveToast | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      announce(actions ? `${message}. ${actions}` : message);
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

  useEffect(() => {
    primeScreenReaderState();
    notify = show;
    return () => {
      notify = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show, hide]);

  const api = useMemo<ToastApi>(() => ({ show, hide }), [show, hide]);

  const [portals, setPortals] = useState<number[]>([]);
  const register = useCallback((id: number) => {
    setPortals((p) => [...p, id]);
    return () => setPortals((p) => p.filter((x) => x !== id));
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
  const id = useRef(++portalSeq).current;
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
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const inSheet = placement === 'sheet';
  // In a sheet the wrapper sits beside the panel (elevation 6 on Android); a
  // higher elevation keeps it drawn above the panel if Fabric keeps the node.
  const at = inSheet ? { top: space.sm, elevation: 8 } : { bottom: insets.bottom + FAB_BAND };
  // No "Edit" inside a sheet: it would open an editor over the one already
  // open. The receipt is usually raised while the add sheet is closing, and
  // the root host draws the full toast, Edit included, once it has.
  const secondary = inSheet ? undefined : toast.secondaryAction;
  return (
    <View style={[styles.layer, at]} pointerEvents="box-none">
      <Animated.View
        key={toast.key}
        entering={FadeInDown.duration(motion.dur.base).reduceMotion(ReduceMotion.System)}
        exiting={FadeOutDown.duration(motion.dur.fast).reduceMotion(ReduceMotion.System)}
        style={styles.toast}
        accessibilityRole="alert"
        testID={toast.testID ?? 'toast'}
      >
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
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
      </Animated.View>
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
    message: { flex: 1, fontSize: font.small, color: colors.onInk, fontWeight: '600' },
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
