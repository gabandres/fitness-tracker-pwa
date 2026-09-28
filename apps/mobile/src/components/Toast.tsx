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
 * action — the WCAG "enough time" floor for a timed control). The action fires
 * once and dismisses. Enter/exit through Reanimated with `ReduceMotion.System`,
 * so a reduce-motion user gets a plain appear/disappear — same rule as every
 * primitive in `lib/motion.tsx`. Announced through `accessibilityLiveRegion`
 * and `accessibilityRole="alert"`, so a screen-reader user hears the receipt
 * without it stealing focus.
 *
 * Sits above the FAB band, not on it: the speed-dial owns the bottom-right
 * corner on every tab, and a toast under a floating button is a toast with
 * its action covered.
 */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  /** The one button. Omit for a plain receipt (which gets Dismiss). */
  action?: ToastAction;
  /** Auto-dismiss after this long. Default 4000; 5000 when `action` is set. */
  durationMs?: number;
  testID?: string;
}

interface ToastApi {
  show: (message: string, opts?: ToastOptions) => void;
  hide: () => void;
}

interface ActiveToast extends ToastOptions {
  message: string;
  key: number;
}

const ToastContext = createContext<ToastApi | null>(null);

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
      const ms = opts.durationMs ?? (opts.action ? 5000 : 4000);
      timer.current = setTimeout(() => {
        // Only the toast that armed this timer may clear it — a newer one has
        // its own.
        setCurrent((c) => (c?.key === key ? null : c));
        timer.current = null;
      }, ms);
    },
    [],
  );

  useEffect(() => {
    notify = show;
    return () => {
      notify = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show, hide]);

  const api = useMemo<ToastApi>(() => ({ show, hide }), [show, hide]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={current} onHide={hide} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastHost({ toast, onHide }: { toast: ActiveToast | null; onHide: () => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View style={[styles.layer, { bottom: insets.bottom + FAB_BAND }]} pointerEvents="box-none">
      <Animated.View
        key={toast.key}
        entering={FadeInDown.duration(motion.dur.base).reduceMotion(ReduceMotion.System)}
        exiting={FadeOutDown.duration(motion.dur.fast).reduceMotion(ReduceMotion.System)}
        style={styles.toast}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={toast.testID ?? 'toast'}
      >
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.action ? (
          <TouchableOpacity
            onPress={() => {
              haptics.tap();
              onHide();
              toast.action?.onPress();
            }}
            hitSlop={10}
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
    },
  });
