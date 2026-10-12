import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Touchable } from './Touchable';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space, TARGET } from '@/theme';

/** One text button in a sheet header. */
export interface SheetHeaderAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Red text: only for an action that destroys something (Discard workout).
   *  Cancel is NOT destructive — it closes and keeps what was saved. */
  destructive?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

interface Props {
  title: string;
  /** Leading slot — Cancel / Close / Back. iOS puts dismissal here (HIG sheets). */
  leading?: SheetHeaderAction;
  /** Trailing slot — Save / Done, the confirming action, drawn bold. */
  trailing?: SheetHeaderAction;
  testID?: string;
}

/**
 * The one header every Train sheet uses (train-ux review J6, 2026-10-11):
 * `[leading] [title] [trailing]`, both buttons text-only and at least
 * `TARGET` square, so every sheet has a visible way out (NN/g, HIG "provide a
 * visible close") and the confirming action sits in the same place everywhere.
 *
 * Read-only sheets pass only `trailing` = Done. Editing sheets pass Cancel +
 * Save. With no leading button the title starts at the sheet's content edge:
 * an empty leading slot kept its 44pt, so a wrapping title ("Myo-rep
 * clusters by muscle") hung indented over the body text it heads (v3 QA). An
 * empty TRAILING slot keeps its width, so a title never runs to the edge.
 *
 * At accessibility text sizes (font scale ≥ {@link STACK_FONT_SCALE}) the
 * buttons take their own row and the title the full width under them, with
 * no line cap: beside "Keep training" a two-word title had a quarter of the
 * row and clipped mid-word ("Finish work…", Train UX v2 QA).
 */
export function SheetHeader({ title, leading, trailing, testID }: Props) {
  const styles = useThemedStyles(createStyles);
  const stacked = useWindowDimensions().fontScale >= STACK_FONT_SCALE;
  const button = (a: SheetHeaderAction | undefined, side: 'leading' | 'trailing') => {
    if (!a) return <View style={styles.slot} />;
    return (
      <Touchable
        style={[styles.slot, side === 'trailing' ? styles.slotTrailing : styles.slotLeading]}
        onPress={a.onPress}
        disabled={a.disabled}
        accessibilityRole="button"
        accessibilityLabel={a.accessibilityLabel ?? a.label}
        accessibilityState={{ disabled: !!a.disabled }}
        hitSlop={4}
        testID={a.testID}
      >
        <Text
          style={[
            styles.btnText,
            side === 'trailing' && styles.btnTextStrong,
            a.destructive && styles.btnTextDanger,
            a.disabled && styles.btnTextDisabled,
          ]}
          maxFontSizeMultiplier={1.6}
          numberOfLines={1}
        >
          {a.label}
        </Text>
      </Touchable>
    );
  };
  if (stacked) {
    return (
      <View style={styles.stack} testID={testID}>
        {leading || trailing ? (
          <View style={[styles.row, styles.stackButtons]}>
            {button(leading, 'leading')}
            {button(trailing, 'trailing')}
          </View>
        ) : null}
        <Text style={[styles.title, styles.titleStacked]} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.row} testID={testID}>
      {leading ? button(leading, 'leading') : null}
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.6} numberOfLines={2}>
        {title}
      </Text>
      {button(trailing, 'trailing')}
    </View>
  );
}

/** Where the header stacks (iOS AX1 and up). */
const STACK_FONT_SCALE = 1.6;

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
    stack: { gap: space.xs },
    stackButtons: { justifyContent: 'space-between' },
    titleStacked: { flex: 0 },
    title: { flex: 1, fontSize: font.h2, fontWeight: '800', color: colors.ink },
    slot: { minWidth: TARGET, minHeight: TARGET, justifyContent: 'center' },
    slotLeading: { alignItems: 'flex-start' },
    slotTrailing: { alignItems: 'flex-end' },
    btnText: { fontSize: font.body, color: colors.teal, fontWeight: '600' },
    btnTextStrong: { fontWeight: '800' },
    btnTextDanger: { color: colors.danger },
    btnTextDisabled: { color: colors.faint },
  });
