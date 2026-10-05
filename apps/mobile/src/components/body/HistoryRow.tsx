import { type ReactNode, useRef, useState } from 'react';
import { type AccessibilityActionEvent, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { ContextMenu } from '@/components/ContextMenu';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { BodyIcon } from './BodyIcon';

/**
 * One row of Body's history — a weigh-in or a tape measurement — with every
 * way to act on it reachable by every kind of user.
 *
 * It used to be a Pressable with a pencil glyph and a nested trash button, and
 * the nesting was the bug (Body review, bug 6): VoiceOver focuses the outer
 * accessible element and never reaches a button inside it, so a screen-reader
 * user could edit a weigh-in and never delete one. The trash target was 31 pt
 * as well (A7), and two glyphs on every row made the list read as a toolbar
 * (V2).
 *
 * Now:
 * - **Tap** edits — the row is the target, the trailing chevron says so.
 * - **Swipe** (P3): trailing reveals Delete, leading reveals Edit. The swipe
 *   REVEALS; the tap on the revealed button acts. Deleting on swipe-open
 *   would let an over-eager scroll destroy a row, the trade Train's set rows
 *   refused for the same reason.
 * - **Screen readers** (A1): the row carries `edit` and `delete` actions, which
 *   VoiceOver lists in its rotor and TalkBack in its actions menu — the
 *   platform answer to "a list row with more than one thing to do".
 * - **Long-press**: the system context menu on iOS (`ContextMenu`); on
 *   Android, where that component renders the row alone, a small sheet with
 *   the same two actions (Body re-score) — M3's long-press menu, so the
 *   gesture does the same thing on both platforms.
 *
 * Delete is undoable from the receipt (U5), so none of these asks first.
 *
 * The iOS menu's Edit waits `MENU_DISMISS_MS` before opening the editor: the
 * action fires while UIKit is still dismissing the menu, and a sheet presented
 * into that transition can be dropped — `weightOpen` true, no sheet, the next
 * tap dead (Body re-score 3, bug 2; the same wait as Today's diary rows).
 * Remove only writes, so it runs at once. A `preview` lifts above the menu
 * like Today's rows and Train's templates do, and tapping it edits.
 */
/** See `MENU_DISMISS_MS` in `MealEntries.tsx` — the same 300 ms, local so a
 *  Body row does not pull in the diary to read one number. */
const MENU_DISMISS_MS = 300;

export function HistoryRow({
  label,
  value,
  onEdit,
  onDelete,
  testID,
  deleteTestID,
  preview,
  previewSize,
  children,
}: {
  /** What the row IS, spoken first ("Sep 28 weigh-in"). A noun, not an
   *  instruction: the hint says what a tap does, and "Edit the Sep 28
   *  weigh-in… Opens it to edit" said it twice (Body re-score). */
  label: string;
  /** Its value, spoken after ("181.5 lb, down 0.4 lb"). */
  value?: string;
  onEdit: () => void;
  onDelete: () => void;
  testID?: string;
  deleteTestID?: string;
  /** The iOS context menu's preview card, and its fixed size (UIKit asks for
   *  the size before it renders). */
  preview?: ReactNode;
  previewSize?: { width: number; height: number };
  children: ReactNode;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /** Close the Android menu, then act — after its exit, so the editor's
   *  sheet does not open under a menu still on its way out. */
  function fromMenu(act: () => void) {
    setMenuOpen(false);
    setTimeout(act, 220);
  }

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'activate' || name === 'edit') onEdit();
    else if (name === 'delete') onDelete();
  };

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      containerStyle={styles.swipeContainer}
      renderLeftActions={() => (
        <TouchableOpacity
          style={[styles.action, styles.actionEdit]}
          onPress={() => {
            haptics.tap();
            swipe.current?.close();
            onEdit();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.edit')}
        >
          <BodyIcon sf="pencil" ion="pencil" size={20} color={colors.onFill} />
        </TouchableOpacity>
      )}
      renderRightActions={() => (
        <TouchableOpacity
          style={[styles.action, styles.actionDelete]}
          onPress={() => {
            haptics.tap();
            swipe.current?.close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.remove')}
          testID={deleteTestID ? `${deleteTestID}-swipe` : undefined}
        >
          <BodyIcon sf="trash" ion="trash-outline" size={20} color={colors.onFill} />
        </TouchableOpacity>
      )}
    >
      {/* iOS long-press: the system context menu, beside the swipe. */}
      <ContextMenu
        title={label}
        preview={preview}
        previewSize={previewSize}
        onPreviewPress={onEdit}
        actions={[
          { key: 'edit', title: t('common.edit'), icon: 'pencil', onPress: () => setTimeout(onEdit, MENU_DISMISS_MS) },
          { key: 'delete', title: t('common.remove'), icon: 'trash', destructive: true, onPress: onDelete },
        ]}
      >
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onEdit}
        onLongPress={
          Platform.OS === 'android'
            ? () => {
                haptics.tap();
                setMenuOpen(true);
              }
            : undefined
        }
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={value ? { text: value } : undefined}
        // Where Remove lives differs: VoiceOver's actions are a swipe up or
        // down, TalkBack's are a menu. One sentence for both was jargon.
        accessibilityHint={t(Platform.OS === 'android' ? 'body.rowHintAndroid' : 'body.rowHint')}
        accessibilityActions={[
          { name: 'activate' },
          { name: 'edit', label: t('common.edit') },
          { name: 'delete', label: t('common.remove') },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        testID={testID}
      >
        <View style={styles.content}>{children}</View>
        <BodyIcon sf="chevron.right" ion="chevron-forward" size={16} color={colors.muted} />
      </Pressable>
      </ContextMenu>
      {Platform.OS === 'android' ? (
        <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} detents="fit">
          <View style={styles.menu} testID={testID ? `${testID}-menu` : undefined}>
            <Text style={styles.menuTitle} accessibilityRole="header" numberOfLines={2}>
              {label}
            </Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => fromMenu(onEdit)}
              accessibilityRole="button"
              testID={testID ? `${testID}-menu-edit` : undefined}
            >
              <BodyIcon sf="pencil" ion="pencil" size={20} color={colors.ink} />
              <Text style={styles.menuText}>{t('common.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => fromMenu(onDelete)}
              accessibilityRole="button"
              testID={deleteTestID ? `${deleteTestID}-menu` : undefined}
            >
              <BodyIcon sf="trash" ion="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.menuText, styles.menuTextDanger]}>{t('common.remove')}</Text>
            </TouchableOpacity>
          </View>
        </BottomSheet>
      ) : null}
    </ReanimatedSwipeable>
  );
}

const createStyles = ({ colors, scheme }: Theme) =>
  StyleSheet.create({
    swipeContainer: { borderRadius: radius.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      // Dark card on dark paper is 1.09:1, so the hairline left the rows
      // unframed (re-score 3, Visual); half-strength `lineStrong` frames them
      // without turning the list into a grid of boxes.
      borderColor: scheme === 'dark' ? `${colors.lineStrong}80` : colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      minHeight: 52,
    },
    rowPressed: { opacity: 0.7 },
    // `flexWrap` so a long date and a weight with its delta stack at large
    // text sizes instead of pushing the chevron off the card (A11).
    content: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: space.md, rowGap: 2 },
    action: { width: 72, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
    actionEdit: { backgroundColor: colors.tealSolid, marginRight: space.sm },
    actionDelete: { backgroundColor: colors.danger, marginLeft: space.sm },
    menu: { gap: space.xs },
    menuTitle: { fontSize: font.small, fontWeight: '700', color: colors.muted, marginBottom: space.xs },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
    menuText: { fontSize: font.body, fontWeight: '600', color: colors.ink },
    menuTextDanger: { color: colors.danger },
  });
