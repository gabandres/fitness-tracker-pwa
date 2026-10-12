import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Branded replacement for `Alert.alert` confirm dialogs (UX_AUDIT S16-10).
 *
 * The native alert breaks the app's visual language mid-flow — system font,
 * platform-teal buttons, square corners — for exactly the taps that should
 * feel most considered (deletes, disconnects). This sheet keeps the app's
 * sheet idiom: dim backdrop, grab handle, ink/danger fills.
 *
 * ## API — imperative, like the Alert it replaces
 *
 * `confirm({ title, body, confirmText, destructive, onConfirm })` from
 * anywhere; `<ConfirmHost />` is mounted in the tab layout and, nested, inside
 * every open `BottomSheet` (see `hosts`); the newest renders the call. Module-level listener rather than context,
 * on the `setPersistedTab` precedent — the callers are spread across screens
 * and a context would thread through every one of them for no benefit.
 *
 * Deliberately NOT used for: the account-deletion double-confirm (a system
 * dialog for an irreversible, support-adjacent action is a trust signal, and
 * chaining two sheets invites a mis-tap), and plain error notices (no choice
 * to make).
 *
 * ## `native: true` — the system dialog, for a confirm asked OVER a native sheet
 *
 * A branded sheet drawn on top of a native formSheet is sheet-on-sheet (R30),
 * and iOS asks for an ACTION SHEET to confirm leaving unsaved changes (R31;
 * train-ux FINAL-SCORE F2). With `native: true` the newest host presents the
 * platform's own dialog instead: iOS `ActionSheetIOS` (title + message, the
 * main action first and red when `destructive`, the secondary under it,
 * Cancel last in its own group); Android `Alert.alert`, whose three slots are
 * neutral / negative / positive — the secondary, Cancel, the main action. The
 * Android back key and a tap outside cancel. Same callbacks, same fail-closed
 * rule: no host mounted, nothing runs. Use it from inside a `BottomSheet
 * native` (the Finish prompt, discard-changes over the template editor,
 * delete exercise); keep the branded sheet everywhere else. `confirmNative`
 * is the same call with the option set.
 */
export interface ConfirmOptions {
  title: string;
  body?: string;
  /** The affirmative button's label — always name the action, never "OK". */
  confirmText: string;
  /** The way out, when "Cancel" would be ambiguous — "Keep editing" beside
   *  "Discard" says which of the two keeps the user's work. Default Cancel. */
  cancelText?: string;
  /** Paints the affirmative button danger — for deletes and disconnects. */
  destructive?: boolean;
  onConfirm: () => void;
  /** A SECOND way forward, shown under the primary — "Only Push Day" beside
   *  "Switch both". Optional; most confirms have one action. */
  secondaryText?: string;
  onSecondary?: () => void;
  /** Present the platform's own dialog instead of the branded sheet — for a
   *  confirm asked from inside a native sheet (R30/R31). See the header. */
  native?: boolean;
}

/**
 * Mounted hosts, newest last; `confirm` goes to the newest.
 *
 * A stack rather than one slot because a confirm can be asked for from INSIDE
 * a sheet ("Discard this entry?", "Remove this food?"). The tab-layout host is
 * a sibling native Modal of that sheet, and iOS will not present a modal from a
 * controller that is already presenting one — the confirm silently failed to
 * appear, and a sheet whose dismissal waits on it could not be closed at all.
 * So every open `BottomSheet` mounts a nested host inside its own Modal
 * (presented FROM the sheet, which iOS allows), and that host takes over while
 * the sheet is up.
 */
const hosts: ((opts: ConfirmOptions) => void)[] = [];

export function confirm(opts: ConfirmOptions): void {
  // No host mounted (a test, or a surface outside the tab layout): fail open
  // by NOT performing the action — a confirm that auto-accepts is worse than
  // one that never fires.
  hosts[hosts.length - 1]?.(opts);
}

/** {@link confirm} as the platform's own dialog — the call for a confirm
 *  asked from inside a `BottomSheet native` (R30/R31). */
export function confirmNative(opts: Omit<ConfirmOptions, 'native'>): void {
  confirm({ ...opts, native: true });
}

/**
 * The system dialog for a `native` confirm. iOS: an action sheet — the main
 * action first (red when destructive), the secondary next, Cancel last.
 * Android: an alert — neutral / negative / positive = secondary, Cancel, main.
 * Exported for the tests; callers go through {@link confirm}.
 */
export function presentNativeConfirm(
  opts: ConfirmOptions,
  cancelLabel: string,
  scheme?: 'light' | 'dark',
): void {
  const secondary = opts.secondaryText && opts.onSecondary ? opts.secondaryText : null;
  const cancel = opts.cancelText ?? cancelLabel;
  const go = () => {
    haptics.tap();
    opts.onConfirm();
  };
  const second = () => {
    haptics.tap();
    opts.onSecondary?.();
  };
  if (Platform.OS === 'ios') {
    const options = secondary ? [opts.confirmText, secondary, cancel] : [opts.confirmText, cancel];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: opts.title,
        ...(opts.body ? { message: opts.body } : {}),
        options,
        cancelButtonIndex: options.length - 1,
        ...(opts.destructive ? { destructiveButtonIndex: 0 } : {}),
        ...(scheme ? { userInterfaceStyle: scheme } : {}),
      },
      (i) => {
        if (i === 0) go();
        else if (secondary && i === 1) second();
      },
    );
    return;
  }
  Alert.alert(
    opts.title,
    opts.body,
    [
      ...(secondary ? [{ text: secondary, onPress: second }] : []),
      { text: cancel, style: 'cancel' as const },
      { text: opts.confirmText, style: opts.destructive ? ('destructive' as const) : ('default' as const), onPress: go },
    ],
    { cancelable: true },
  );
}

export function ConfirmHost() {
  const t = useT();
  const { scheme } = useTheme();
  const styles = useThemedStyles(createStyles);
  // The host's registration outlives renders (it is pushed once, so its place
  // in the stack holds); the native path reads the current language and
  // scheme through a ref, written in an effect.
  const nativeRef = useRef({ cancel: t('common.cancel'), scheme });
  useEffect(() => {
    nativeRef.current = { cancel: t('common.cancel'), scheme };
  }, [t, scheme]);
  // At accessibility text sizes two buttons side by side broke their labels
  // mid-word ("Cancela / r"); stacked, each gets the full width — the main
  // action on top, Cancel last.
  const largeText = useWindowDimensions().fontScale > 1.3;
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const hasSecondary = !!(opts?.secondaryText && opts.onSecondary);
  // Three actions always stack, in the order the doc promises — main action,
  // the second way forward under it, Cancel last. Side by side, "Update and
  // complete" wrapped at the DEFAULT text size beside Cancel, with the
  // secondary above both (Train UX v2 QA).
  const stacked = largeText || hasSecondary;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = (o: ConfirmOptions) => {
      if (o.native && (Platform.OS === 'ios' || Platform.OS === 'android')) {
        presentNativeConfirm(o, nativeRef.current.cancel, nativeRef.current.scheme);
        return;
      }
      setOpts(o);
      setVisible(true);
    };
    hosts.push(host);
    return () => {
      const i = hosts.lastIndexOf(host);
      if (i >= 0) hosts.splice(i, 1);
    };
  }, []);

  function close() {
    setVisible(false);
  }

  const goButton = opts ? (
    <TouchableOpacity
      style={[styles.go, opts.destructive && styles.goDanger, stacked && styles.flat]}
      accessibilityRole="button"
      testID="confirm-go"
      onPress={() => {
        haptics.tap();
        close();
        opts.onConfirm();
      }}
    >
      <Text style={[styles.goText, opts.destructive && styles.goDangerText]}>{opts.confirmText}</Text>
    </TouchableOpacity>
  ) : null;

  return (
    // `overlays={false}`: the confirm's own sheet hosts no nested confirm or
    // toast — it is the overlay.
    <BottomSheet visible={visible} onClose={close} backdropTestID="confirm-backdrop" overlays={false}>
      {opts ? (
        <View style={styles.wrap}>
          <Text style={styles.title} accessibilityRole="header">{opts.title}</Text>
          {/* Scrolls when a long body meets a large text size, so the buttons
              are never pushed off the sheet. */}
          {opts.body ? (
            <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator>
              <Text style={styles.body}>{opts.body}</Text>
            </ScrollView>
          ) : null}
          {/* Stacked, the children are in SCREEN order (main action, the
              secondary, then Cancel): a reversed flex layout would show one
              order and have a screen reader read the other. */}
          <View style={[styles.row, stacked && styles.rowStacked]}>
            {stacked ? goButton : null}
            {hasSecondary ? (
              <TouchableOpacity
                style={[styles.cancel, styles.flat]}
                accessibilityRole="button"
                testID="confirm-secondary"
                onPress={() => {
                  haptics.tap();
                  close();
                  opts.onSecondary?.();
                }}
              >
                <Text style={styles.cancelText}>{opts.secondaryText}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.cancel, stacked && styles.flat]} onPress={close} accessibilityRole="button" testID="confirm-cancel">
              <Text style={styles.cancelText}>{opts.cancelText ?? t('common.cancel')}</Text>
            </TouchableOpacity>
            {stacked ? null : goButton}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { gap: space.sm, paddingTop: space.xs },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  bodyScroll: { flexGrow: 0, flexShrink: 1, maxHeight: 360 },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  rowStacked: { flexDirection: 'column' },
  flat: { flex: 0 },
  // 48 high: Android's touch-target floor (the label alone measured ~45).
  cancel: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  cancelText: { fontSize: font.body, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  go: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.ink,
  },
  goDanger: { backgroundColor: colors.danger },
  goText: { fontSize: font.body, fontWeight: '700', color: colors.onInk, textAlign: 'center' },
  // `onFill`: white on light's deep red, the dark canvas on dark's light red —
  // white there measured 3.37:1, under AA (it was white until 2026-10-05).
  goDangerText: { color: colors.onFill },
});
