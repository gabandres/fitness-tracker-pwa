import { type ReactNode, useRef } from 'react';
import { type AccessibilityActionEvent, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { radius, space } from '@/theme';
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
 *
 * Delete is undoable from the receipt (U5), so none of these asks first.
 */
export function HistoryRow({
  label,
  value,
  onEdit,
  onDelete,
  testID,
  deleteTestID,
  children,
}: {
  /** What the row IS, spoken first ("Edit the Sep 28 weigh-in"). */
  label: string;
  /** Its value, spoken after ("181.5 lb, down 0.4 lb"). */
  value?: string;
  onEdit: () => void;
  onDelete: () => void;
  testID?: string;
  deleteTestID?: string;
  children: ReactNode;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const swipe = useRef<SwipeableMethods>(null);

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
          <BodyIcon sf="pencil" ion="pencil" size={20} color={colors.onInk} />
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
          <BodyIcon sf="trash" ion="trash-outline" size={20} color={colors.onInk} />
        </TouchableOpacity>
      )}
    >
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={value ? { text: value } : undefined}
        accessibilityHint={t('body.rowHint')}
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
    </ReanimatedSwipeable>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    swipeContainer: { borderRadius: radius.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
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
  });
