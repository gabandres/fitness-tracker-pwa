import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
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

export function ConfirmHost() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = (o: ConfirmOptions) => {
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

  return (
    // `overlays={false}`: the confirm's own sheet hosts no nested confirm or
    // toast — it is the overlay.
    <BottomSheet visible={visible} onClose={close} backdropTestID="confirm-backdrop" overlays={false}>
      {opts ? (
        <View style={styles.wrap}>
          <Text style={styles.title} accessibilityRole="header">{opts.title}</Text>
          {opts.body ? <Text style={styles.body}>{opts.body}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancel} onPress={close} accessibilityRole="button" testID="confirm-cancel">
              <Text style={styles.cancelText}>{opts.cancelText ?? t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.go, opts.destructive && styles.goDanger]}
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
  row: { flexDirection: 'row', gap: space.md, marginTop: space.md },
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
  cancelText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
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
  goText: { fontSize: font.body, fontWeight: '700', color: colors.onInk },
  // `onFill`: white on light's deep red, the dark canvas on dark's light red —
  // white there measured 3.37:1, under AA (it was white until 2026-10-05).
  goDangerText: { color: colors.onFill },
});
