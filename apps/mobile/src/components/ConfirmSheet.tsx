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
 * anywhere; `<ConfirmHost />` is mounted ONCE in the tab layout and renders
 * whatever the last call asked for. Module-level listener rather than context,
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
  /** Paints the affirmative button danger — for deletes and disconnects. */
  destructive?: boolean;
  onConfirm: () => void;
}

let notify: ((opts: ConfirmOptions) => void) | null = null;

export function confirm(opts: ConfirmOptions): void {
  // No host mounted (a test, or a surface outside the tab layout): fail open
  // by NOT performing the action — a confirm that auto-accepts is worse than
  // one that never fires.
  notify?.(opts);
}

export function ConfirmHost() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    notify = (o) => {
      setOpts(o);
      setVisible(true);
    };
    return () => {
      notify = null;
    };
  }, []);

  function close() {
    setVisible(false);
  }

  return (
    <BottomSheet visible={visible} onClose={close} backdropTestID="confirm-backdrop">
      {opts ? (
        <View style={styles.wrap}>
          <Text style={styles.title}>{opts.title}</Text>
          {opts.body ? <Text style={styles.body}>{opts.body}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancel} onPress={close} testID="confirm-cancel">
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.go, opts.destructive && styles.goDanger]}
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
  cancel: {
    flex: 1,
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
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.ink,
  },
  goDanger: { backgroundColor: colors.danger },
  goText: { fontSize: font.body, fontWeight: '700', color: colors.onInk },
  // `onInk` inverts with the theme (dark text in dark mode), which on a danger
  // red reads muddy — white holds on both themes' danger fills.
  goDangerText: { color: colors.white },
});
